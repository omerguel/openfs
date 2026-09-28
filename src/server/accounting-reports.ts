/* ------------------------------------------------------------------ */
/* Buchhaltung reports — read-only views over the immutable bookings:  */
/*  - current balances of the Geldkonten (Kasse/Bank)                  */
/*  - Kassenbuch / Bankbuch per Geldkonto with running balance         */
/*  - CSV exports (Kassenbuch, Buchungsjournal)                        */
/*  - Umsatzsteuer overview per month/quarter as a UStVA helper        */
/*    (Vorbereitung — the Voranmeldung itself is filed via ELSTER or   */
/*    the Steuerberater from the DATEV export).                        */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type {
  Cashbook,
  CashbookRow,
  GeldkontoBalance,
  VatPeriod,
  VatReport,
} from "../lib/accounting-report-types";
import { TRANSACTION_TYPE_LABELS, type TransactionType } from "../lib/accounting-types";
import { toCsv } from "../lib/csv";
import { splitVat } from "../lib/money";
import { listAccounts, listJournal, ValidationError } from "./engine";
import { handle, json } from "./http";
import { todayIso } from "./invoices";

function optionalDate(value: string | null, field: string): string | null {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Feld '${field}' muss ein Datum (JJJJ-MM-TT) sein.`);
  }
  return value;
}

/* ------------------------------ balances ---------------------------- */

type MoveRow = {
  transaction_id: number;
  date: string;
  beleg_nr: string | null;
  type: string;
  description: string;
  student_name: string | null;
  storno_of: number | null;
  storniert_by: number | null;
  soll_account: string;
  haben_account: string;
  amount_cents: number;
};

function movements(db: Database, account: string): MoveRow[] {
  return db
    .query<MoveRow, [string, string]>(
      `SELECT t.id AS transaction_id, t.date, t.beleg_nr, t.type, t.description,
              t.student_name, t.storno_of, t.storniert_by,
              b.soll_account, b.haben_account, b.amount_cents
       FROM bookings b JOIN transactions t ON t.id = b.transaction_id
       WHERE b.soll_account = ? OR b.haben_account = ?
       ORDER BY t.date, t.id, b.id`,
    )
    .all(account, account);
}

export function listGeldkontoBalances(
  db: Database,
  today = todayIso(),
): GeldkontoBalance[] {
  return listAccounts(db)
    .filter((account) => account.kind === "geldkonto")
    .map((account) => {
      const opening = account.openingCents ?? 0;
      let balance = opening;
      let todayBalance = opening;
      for (const move of movements(db, account.number)) {
        const delta =
          (move.soll_account === account.number ? move.amount_cents : 0) -
          (move.haben_account === account.number ? move.amount_cents : 0);
        balance += delta;
        if (move.date <= today) todayBalance += delta;
      }
      return {
        number: account.number,
        name: account.name,
        active: account.active,
        openingCents: opening,
        openingDate: account.openingDate,
        balanceCents: balance,
        todayCents: todayBalance,
      };
    });
}

/* ------------------------------ Kassenbuch -------------------------- */

export function getCashbook(
  db: Database,
  accountNumber: string,
  filter: { from?: string | null; to?: string | null } = {},
): Cashbook {
  const account = listAccounts(db).find(
    (a) => a.number === accountNumber && a.kind === "geldkonto",
  );
  if (!account) throw new ValidationError(`Geldkonto ${accountNumber} existiert nicht.`);
  const from = filter.from ?? null;
  const to = filter.to ?? null;
  let running = account.openingCents ?? 0;
  let opening = running;
  let totalIn = 0;
  let totalOut = 0;
  let negativeRows = 0;
  // One row per transaction (a transfer has two bookings on different
  // accounts, a charge none — only the movement on this account counts).
  const byTx = new Map<number, { move: MoveRow; inCents: number; outCents: number }>();
  for (const move of movements(db, account.number)) {
    const entry = byTx.get(move.transaction_id) ?? { move, inCents: 0, outCents: 0 };
    if (move.soll_account === account.number) entry.inCents += move.amount_cents;
    if (move.haben_account === account.number) entry.outCents += move.amount_cents;
    byTx.set(move.transaction_id, entry);
  }
  const rows: CashbookRow[] = [];
  for (const { move, inCents, outCents } of byTx.values()) {
    if (to && move.date > to) break;
    running += inCents - outCents;
    if (from && move.date < from) {
      opening = running;
      continue;
    }
    totalIn += inCents;
    totalOut += outCents;
    if (running < 0) negativeRows += 1;
    rows.push({
      transactionId: move.transaction_id,
      date: move.date,
      belegNr: move.beleg_nr,
      typeLabel: TRANSACTION_TYPE_LABELS[move.type as TransactionType] ?? move.type,
      description: move.description,
      studentName: move.student_name,
      inCents,
      outCents,
      balanceCents: running,
      storniert: move.storniert_by != null,
      isStorno: move.storno_of != null,
    });
  }
  return {
    account: { number: account.number, name: account.name },
    from,
    to,
    openingCents: opening,
    closingCents: opening + totalIn - totalOut,
    totalInCents: totalIn,
    totalOutCents: totalOut,
    rows,
    negativeRows,
  };
}

/* -------------------------------- CSV -------------------------------- */

/** 123456 → "1234,56" (no thousands separator, spreadsheet-friendly). */
function csvAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Neutralise spreadsheet formula triggers in free text. */
function csvText(value: string | null | undefined): string {
  const text = (value ?? "").replace(/[\r\n]+/g, " ");
  return /^[=+\-@\t]/.test(text) ? `'${text}` : text;
}

const csvDate = (iso: string) => iso.split("-").reverse().join(".");

export function cashbookCsv(cashbook: Cashbook): string {
  const rows: string[][] = [
    [
      "Datum",
      "Belegnr.",
      "Typ",
      "Beschreibung",
      "Fahrschüler/in",
      "Einnahme",
      "Ausgabe",
      "Saldo",
      "Storno",
    ],
    ["", "", "", "Anfangsbestand", "", "", "", csvAmount(cashbook.openingCents), ""],
    ...cashbook.rows.map((row) => [
      csvDate(row.date),
      row.belegNr ?? "",
      row.typeLabel,
      csvText(row.description),
      csvText(row.studentName),
      row.inCents ? csvAmount(row.inCents) : "",
      row.outCents ? csvAmount(row.outCents) : "",
      csvAmount(row.balanceCents),
      row.isStorno ? "Stornobuchung" : row.storniert ? "storniert" : "",
    ]),
    [
      "",
      "",
      "",
      "Summe / Endbestand",
      "",
      csvAmount(cashbook.totalInCents),
      csvAmount(cashbook.totalOutCents),
      csvAmount(cashbook.closingCents),
      "",
    ],
  ];
  return `﻿${toCsv(rows)}\r\n`;
}

export function journalCsv(
  db: Database,
  filter: { from?: string; to?: string },
): { csv: string; count: number } {
  const journal = listJournal(db, { ...filter, sort: "asc" });
  const total = journal
    .filter((row) => !row.storniert && !row.isStorno)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const rows: string[][] = [
    [
      "Datum",
      "Belegnr.",
      "Buchungsnr.",
      "Typ",
      "Beschreibung",
      "Soll",
      "Soll-Konto",
      "Haben",
      "Haben-Konto",
      "Betrag",
      "USt-Satz",
      "Storno",
    ],
    ...journal.map((row) => [
      csvDate(row.date),
      row.belegNr ?? "",
      row.buchungNr,
      row.typeLabel,
      csvText(row.description),
      row.sollKonto,
      row.sollName,
      row.habenKonto,
      row.habenName,
      csvAmount(row.amountCents),
      row.vatRate == null ? "" : `${row.vatRate} %`,
      row.isStorno ? "Stornobuchung" : row.storniert ? "storniert" : "",
    ]),
    ["", "", "", "", "Summe (ohne Stornos)", "", "", "", "", csvAmount(total), "", ""],
  ];
  return { csv: `﻿${toCsv(rows)}\r\n`, count: journal.length };
}

/* ------------------------- Umsatzsteuer overview --------------------- */

type VatRow = {
  date: string;
  soll_account: string;
  haben_account: string;
  amount_cents: number;
  vat_rate: number | null;
  net_cents: number | null;
  vat_cents: number | null;
};

function emptyPeriod(key: string, label: string, from: string, to: string): VatPeriod {
  return {
    key,
    label,
    from,
    to,
    revenue19NetCents: 0,
    revenue19VatCents: 0,
    revenue7NetCents: 0,
    revenue7VatCents: 0,
    prepayment19NetCents: 0,
    prepayment19VatCents: 0,
    taxFreeCents: 0,
    notTaxableCents: 0,
    passThroughCents: 0,
    inputVatCents: 0,
    outputVatCents: 0,
    payableCents: 0,
  };
}

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function lastDay(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

/* Other-side kinds that govern a line's VAT themselves (the engine's
   vatAccount); mirrors the DATEV BU-40 rule in datev.ts. */
const VAT_GOVERNING_KINDS = new Set(["erloes", "aufwand", "durchlaufend"]);

/**
 * A 3272 line booked without VAT against a Geldkonto or 9000 carries no
 * Anzahlungs-USt: a Saldovortrag, or the part of a payment that settles
 * an opening debt (already taxed in the previous software). A charge
 * 3272 an 1370/4830 has no VAT rate either, but there the other account
 * governs and the 3272 side still releases the Anzahlungs-USt.
 */
function anzahlungWithoutVat(row: VatRow, otherKind: string | undefined): boolean {
  return row.vat_rate == null && !VAT_GOVERNING_KINDS.has(otherKind ?? "");
}

/**
 * Umsatzsteuer per period, derived from the bookings the same way DATEV
 * derives it from the Automatikkonten of the export:
 *  - Erlöskonten (4400 19 %, 4300 7 %) in Haben: revenue + USt; in Soll
 *    (Storno reversal) negative.
 *  - 3272 Erhaltene Anzahlungen 19 %: every payment in Haben adds 19 %
 *    Anzahlungs-USt; every charge that consumes the Guthaben (3272 in
 *    Soll) releases 19 % of its amount again, because the charge's own
 *    Erlöskonto carries the final tax. Saldenvorträge (9000) carry no tax,
 *    nor does the "Ausgleich Saldovortrag" part of a payment (Geldkonto
 *    an 3272 without VAT) that settles an opening debt.
 *  - Aufwandskonten with 19 %/7 % in Soll: abziehbare Vorsteuer.
 * 4100 (0 %) is shown as steuerfreier Umsatz, 4830 as nicht steuerbar,
 * 1370 as durchlaufender Posten — none of them carries tax.
 */
export function vatReport(
  db: Database,
  year: number,
  period: "month" | "quarter",
): VatReport {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError("Ungültiges Jahr.");
  }
  const kinds = new Map(listAccounts(db).map((a) => [a.number, a.kind]));
  const periods: VatPeriod[] =
    period === "month"
      ? MONTHS.map((name, i) =>
          emptyPeriod(
            `${year}-${String(i + 1).padStart(2, "0")}`,
            `${name} ${year}`,
            `${year}-${String(i + 1).padStart(2, "0")}-01`,
            lastDay(year, i + 1),
          ),
        )
      : [1, 2, 3, 4].map((q) =>
          emptyPeriod(
            `${year}-Q${q}`,
            `${q}. Quartal ${year}`,
            `${year}-${String(q * 3 - 2).padStart(2, "0")}-01`,
            lastDay(year, q * 3),
          ),
        );
  const rows = db
    .query<VatRow, [string, string]>(
      `SELECT t.date, b.soll_account, b.haben_account, b.amount_cents, b.vat_rate,
              b.net_cents, b.vat_cents
       FROM bookings b JOIN transactions t ON t.id = b.transaction_id
       WHERE t.date BETWEEN ? AND ?`,
    )
    .all(`${year}-01-01`, `${year}-12-31`);

  for (const row of rows) {
    const target = periods.find((p) => row.date >= p.from && row.date <= p.to);
    if (!target) continue;
    const net = row.net_cents ?? row.amount_cents;
    const vat = row.vat_cents ?? 0;
    const sides: [string, number][] = [
      [row.haben_account, 1],
      [row.soll_account, -1],
    ];
    for (const [account, sign] of sides) {
      const kind = kinds.get(account);
      const other = sign === 1 ? row.soll_account : row.haben_account;
      if (kind === "erloes") {
        if (row.vat_rate === 19) {
          target.revenue19NetCents += sign * net;
          target.revenue19VatCents += sign * vat;
        } else if (row.vat_rate === 7) {
          target.revenue7NetCents += sign * net;
          target.revenue7VatCents += sign * vat;
        } else if (row.vat_rate === 0) {
          target.taxFreeCents += sign * row.amount_cents;
        } else {
          target.notTaxableCents += sign * row.amount_cents;
        }
      } else if (kind === "durchlaufend") {
        target.passThroughCents += sign * row.amount_cents;
      } else if (kind === "anzahlung" && !anzahlungWithoutVat(row, kinds.get(other))) {
        const split = splitVat(row.amount_cents, 19);
        target.prepayment19NetCents += sign * split.netCents;
        target.prepayment19VatCents += sign * split.vatCents;
      } else if (kind === "aufwand" && (row.vat_rate === 19 || row.vat_rate === 7)) {
        // Aufwand in Soll = Vorsteuer; in Haben (Storno) negative.
        target.inputVatCents += -sign * vat;
      }
    }
  }
  const total = emptyPeriod(
    String(year),
    `Jahr ${year}`,
    `${year}-01-01`,
    `${year}-12-31`,
  );
  for (const p of periods) {
    p.outputVatCents = p.revenue19VatCents + p.revenue7VatCents + p.prepayment19VatCents;
    p.payableCents = p.outputVatCents - p.inputVatCents;
    for (const key of Object.keys(total) as (keyof VatPeriod)[]) {
      if (typeof total[key] === "number") {
        (total[key] as number) += p[key] as number;
      }
    }
  }
  return { year, period, periods, total };
}

/* -------------------------------- HTTP ------------------------------- */

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function accountingReportRoutes(db: Database) {
  return {
    "/api/accounting/balances": {
      GET: () => handle(() => json({ balances: listGeldkontoBalances(db) }))(),
    },
    "/api/accounting/cashbook/:account": {
      GET: (req: BunRequest<"/api/accounting/cashbook/:account">) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const cashbook = getCashbook(db, req.params.account, {
            from: optionalDate(params.get("from"), "from"),
            to: optionalDate(params.get("to"), "to"),
          });
          if (params.get("format") !== "csv") return json(cashbook);
          const kind = cashbook.account.number === "1600" ? "Kassenbuch" : "Bankbuch";
          const range = [cashbook.from, cashbook.to]
            .filter(Boolean)
            .map((d) => d!.replaceAll("-", ""))
            .join("-");
          return csvResponse(
            cashbookCsv(cashbook),
            `${kind}_${cashbook.account.number}${range ? `_${range}` : ""}.csv`,
          );
        })(),
    },
    "/api/accounting/journal/export": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const from = optionalDate(params.get("from"), "from") ?? undefined;
          const to = optionalDate(params.get("to"), "to") ?? undefined;
          const { csv } = journalCsv(db, { from, to });
          const range = [from, to]
            .filter(Boolean)
            .map((d) => d!.replaceAll("-", ""))
            .join("-");
          return csvResponse(csv, `Buchungsjournal${range ? `_${range}` : ""}.csv`);
        })(),
    },
    "/api/accounting/vat-report": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const year = Number(params.get("year") ?? todayIso().slice(0, 4));
          const period = params.get("period") === "quarter" ? "quarter" : "month";
          return json(vatReport(db, year, period));
        })(),
    },
  };
}
