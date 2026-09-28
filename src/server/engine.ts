/* ------------------------------------------------------------------ */
/* Booking engine — the only code path that writes Buchungen.          */
/*                                                                     */
/* Clients send intent (type + params); the engine derives the         */
/* Soll/Haben accounts, VAT split and document numbers server-side.    */
/* Bookings are immutable; corrections happen via Storno reversals.    */
/* Sole exception: pseudonymiseExpiredCustomer (Löschkonzept) replaces */
/* names in records whose statutory retention period is over.          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type {
  Account,
  ChargeLine,
  CreateTransactionInput,
  JournalRow,
  LedgerResponse,
  LedgerRow,
  PaymentMethod,
  QuittungData,
  QuittungLine,
  TransactionType,
} from "../lib/accounting-types";
import { TRANSACTION_TYPE_LABELS } from "../lib/accounting-types";
import { splitVat } from "../lib/money";
import { periodEnd } from "../lib/retention";
import { getCompany, nextBelegNr, nextBuchungNr, nextQuittungNr } from "./db";
import { SALDOVORTRAG_SETTLEMENT_LINE, unsettledOpeningDebt } from "./open-items";

export { ValidationError } from "./errors";
import { ValidationError } from "./errors";

/* ---------------------------- accounts ---------------------------- */

type AccountRow = {
  number: string;
  name: string;
  kind: string;
  vat_rate: number | null;
  vat_label: string;
  active: number;
  opening_cents: number | null;
  opening_date: string | null;
};

function toAccount(row: AccountRow): Account {
  return {
    number: row.number,
    name: row.name,
    kind: row.kind as Account["kind"],
    vatRate: row.vat_rate,
    vatLabel: row.vat_label,
    active: row.active === 1,
    openingCents: row.opening_cents,
    openingDate: row.opening_date,
  };
}

export function listAccounts(db: Database): Account[] {
  return db
    .query<AccountRow, []>("SELECT * FROM accounts ORDER BY number")
    .all()
    .map(toAccount);
}

export function setAccountActive(db: Database, number: string, active: boolean) {
  const result = db
    .prepare("UPDATE accounts SET active = ? WHERE number = ?")
    .run(active ? 1 : 0, number);
  if (result.changes === 0) {
    throw new ValidationError(`Konto ${number} existiert nicht.`);
  }
}

function requireAccount(
  db: Database,
  number: unknown,
  kinds: Account["kind"][],
  role: string,
): Account {
  if (typeof number !== "string" || !number) {
    throw new ValidationError(`${role}: Konto fehlt.`);
  }
  const row = db
    .query<AccountRow, [string]>("SELECT * FROM accounts WHERE number = ?")
    .get(number);
  if (!row) throw new ValidationError(`${role}: Konto ${number} existiert nicht.`);
  const account = toAccount(row);
  if (!account.active) {
    throw new ValidationError(`${role}: Konto ${number} ${account.name} ist inaktiv.`);
  }
  if (!kinds.includes(account.kind)) {
    throw new ValidationError(
      `${role}: Konto ${number} ${account.name} ist hier nicht zulässig.`,
    );
  }
  return account;
}

const SYSTEM_ACCOUNTS = { anzahlung: "3272", transit: "1460", vortrag: "9000" } as const;

function requireSystemAccount(
  db: Database,
  role: keyof typeof SYSTEM_ACCOUNTS,
  label: string,
): Account {
  return requireAccount(db, SYSTEM_ACCOUNTS[role], [role], label);
}

function reconcilePaymentAccount(method: PaymentMethod, account: Account): void {
  const isCashAccount = account.number === "1600";
  if ((method === "bar") !== isCashAccount) {
    throw new ValidationError(
      method === "bar"
        ? "Barzahlungen müssen auf das Kassenkonto 1600 gebucht werden."
        : "Unbare Zahlungen dürfen nicht auf das Kassenkonto 1600 gebucht werden.",
    );
  }
}

/* --------------------------- validation --------------------------- */

const PAYMENT_METHODS: PaymentMethod[] = ["bar", "ueberweisung", "ec", "lastschrift"];

function requireAmount(amountCents: unknown): number {
  if (
    typeof amountCents !== "number" ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new ValidationError("Der Betrag muss ein positiver Betrag in Cent sein.");
  }
  return amountCents;
}

function requireDate(date: unknown): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Ungültiges Datum (erwartet JJJJ-MM-TT).");
  }
  // Parse as UTC — local-time parsing would shift the date across the
  // timezone offset and reject valid dates west of UTC midnight.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError(`Ungültiges Datum: ${date}.`);
  }
  return date;
}

function requirePaymentMethod(method: unknown): PaymentMethod {
  if (!PAYMENT_METHODS.includes(method as PaymentMethod)) {
    throw new ValidationError("Ungültige Zahlungsart.");
  }
  return method as PaymentMethod;
}

function requireStudent(student: unknown) {
  const s = student as CreateTransactionInput extends { student: infer S } ? S : never;
  if (
    !s ||
    typeof s !== "object" ||
    typeof (s as { name?: unknown }).name !== "string" ||
    !(s as { name: string }).name.trim()
  ) {
    throw new ValidationError("Fahrschüler ist erforderlich.");
  }
  const ref = s as {
    customerNo?: string;
    name: string;
    address?: string;
    contractNo?: string;
    classes?: string;
  };
  return {
    customerNo: ref.customerNo ?? "",
    name: ref.name.trim(),
    address: ref.address ?? "",
    contractNo: ref.contractNo ?? "",
    classes: ref.classes ?? "",
  };
}

function requireChargeLines(lines: unknown): ChargeLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ValidationError("Mindestens eine Position ist erforderlich.");
  }
  if (lines.length > 50) {
    throw new ValidationError("Höchstens 50 Positionen pro Buchung.");
  }
  return lines.map((raw) => {
    const line = raw as Partial<ChargeLine> | null;
    if (!line || typeof line !== "object") {
      throw new ValidationError("Ungültige Position.");
    }
    const description =
      typeof line.description === "string" ? line.description.trim() : "";
    if (!description) {
      throw new ValidationError("Jede Position braucht eine Beschreibung.");
    }
    return {
      habenKonto: String(line.habenKonto ?? ""),
      amountCents: requireAmount(line.amountCents),
      description,
    };
  });
}

/** Only one opening balance per student — unless the first was storniert. */
function requireNoActiveSaldovortrag(db: Database, customerNo: string, name: string) {
  const existing = db
    .query<{ beleg_nr: string | null }, [string]>(
      `SELECT beleg_nr FROM transactions
       WHERE type = 'saldovortrag' AND student_customer_no = ?
         AND storno_of IS NULL AND storniert_by IS NULL`,
    )
    .get(customerNo);
  if (existing) {
    throw new ValidationError(
      `Für ${name} (Kunde ${customerNo}) ist bereits ein Saldovortrag gebucht${
        existing.beleg_nr ? ` (Beleg ${existing.beleg_nr})` : ""
      } — bitte zuerst stornieren.`,
    );
  }
}

/* ----------------------- transaction creation ---------------------- */

type BookingSpec = {
  soll: Account;
  haben: Account;
  amountCents: number;
  /** account whose VAT setting governs this line; null → no VAT line */
  vatAccount: Account | null;
  lineDescription: string;
};

export type CreatedTransaction = {
  id: number;
  belegNr: string | null;
  bookings: { buchungNr: string; soll: string; haben: string; amountCents: number }[];
};

export function createTransaction(
  db: Database,
  input: CreateTransactionInput,
): CreatedTransaction {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const date = requireDate(input.date);
  const amountCents = requireAmount(input.amountCents);

  let bookings: BookingSpec[];
  let paymentMethod: PaymentMethod | null = null;
  let student: ReturnType<typeof requireStudent> | null = null;
  let description = "description" in input ? (input.description ?? "") : "";
  let hasBeleg = true;

  switch (input.type) {
    case "zahlung_guthaben": {
      const geldkonto = requireAccount(db, input.geldkonto, ["geldkonto"], "Geldkonto");
      const anzahlung = requireSystemAccount(db, "anzahlung", "Guthabenkonto");
      paymentMethod = requirePaymentMethod(input.paymentMethod);
      reconcilePaymentAccount(paymentMethod, geldkonto);
      student = requireStudent(input.student);
      if (!description) {
        description = `FS ${student.name}${student.classes ? ` - ${student.classes}` : ""}`;
      }
      // The part that settles an opening debt from the previous software
      // (Saldovortrag "forderung") pays for services already taxed there —
      // it carries no Anzahlungs-USt. Only the rest is a real Anzahlung.
      const settlement = Math.min(
        amountCents,
        unsettledOpeningDebt(db, student.customerNo),
      );
      bookings = [];
      if (settlement > 0) {
        bookings.push({
          soll: geldkonto,
          haben: anzahlung,
          amountCents: settlement,
          vatAccount: null,
          lineDescription: SALDOVORTRAG_SETTLEMENT_LINE,
        });
      }
      if (amountCents > settlement) {
        bookings.push({
          soll: geldkonto,
          haben: anzahlung,
          amountCents: amountCents - settlement,
          vatAccount: anzahlung,
          lineDescription: "Zahlung auf Ausbildungskonto",
        });
      }
      break;
    }
    case "direktzahlung": {
      const geldkonto = requireAccount(db, input.geldkonto, ["geldkonto"], "Geldkonto");
      const haben = requireAccount(
        db,
        input.habenKonto,
        ["erloes", "durchlaufend"],
        "Erlöskonto",
      );
      paymentMethod = requirePaymentMethod(input.paymentMethod);
      reconcilePaymentAccount(paymentMethod, geldkonto);
      student = requireStudent(input.student);
      if (!description.trim()) {
        throw new ValidationError("Beschreibung der Leistung ist erforderlich.");
      }
      bookings = [
        {
          soll: geldkonto,
          haben,
          amountCents,
          vatAccount: haben,
          lineDescription: description,
        },
      ];
      break;
    }
    case "guthaben_uebertragung": {
      const anzahlung = requireSystemAccount(db, "anzahlung", "Guthabenkonto");
      student = requireStudent(input.student);
      hasBeleg = false;
      if (input.lines !== undefined) {
        const lines = requireChargeLines(input.lines);
        const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
        if (amountCents !== total) {
          throw new ValidationError(
            "Gesamtbetrag stimmt nicht mit der Summe der Positionen überein.",
          );
        }
        bookings = lines.map((line) => {
          const haben = requireAccount(
            db,
            line.habenKonto,
            ["erloes", "durchlaufend"],
            "Erlöskonto",
          );
          return {
            soll: anzahlung,
            haben,
            amountCents: line.amountCents,
            vatAccount: haben,
            lineDescription: line.description,
          };
        });
        if (!description.trim()) description = lines.map((l) => l.description).join(", ");
        break;
      }
      const haben = requireAccount(
        db,
        input.habenKonto,
        ["erloes", "durchlaufend"],
        "Erlöskonto",
      );
      if (!description.trim()) {
        throw new ValidationError("Beschreibung der Leistung ist erforderlich.");
      }
      bookings = [
        {
          soll: anzahlung,
          haben,
          amountCents,
          vatAccount: haben,
          lineDescription: description,
        },
      ];
      break;
    }
    case "transfer": {
      const from = requireAccount(db, input.fromKonto, ["geldkonto"], "Von-Konto");
      const to = requireAccount(db, input.toKonto, ["geldkonto"], "Nach-Konto");
      if (from.number === to.number) {
        throw new ValidationError("Transfer benötigt zwei verschiedene Geldkonten.");
      }
      const transit = requireSystemAccount(db, "transit", "Geldtransit");
      bookings = [
        {
          soll: transit,
          haben: from,
          amountCents,
          vatAccount: null,
          lineDescription: "",
        },
        { soll: to, haben: transit, amountCents, vatAccount: null, lineDescription: "" },
      ];
      break;
    }
    case "saldovortrag": {
      const vortrag = requireSystemAccount(db, "vortrag", "Saldenvortragskonto");
      const anzahlung = requireSystemAccount(db, "anzahlung", "Guthabenkonto");
      student = requireStudent(input.student);
      if (!student.customerNo) {
        throw new ValidationError("Saldovortrag: Kundennummer des Fahrschülers fehlt.");
      }
      if (input.direction !== "guthaben" && input.direction !== "forderung") {
        throw new ValidationError(
          "Saldovortrag: Richtung muss 'guthaben' oder 'forderung' sein.",
        );
      }
      requireNoActiveSaldovortrag(db, student.customerNo, student.name);
      if (!description.trim()) {
        description = `Saldovortrag ${student.name} (${
          input.direction === "guthaben" ? "Guthaben" : "offener Betrag"
        })`;
      }
      // Guthaben: 9000 an 3272 (credit on the Ausbildungskonto);
      // Forderung: 3272 an 9000 (the student owes). No VAT split — the
      // VAT on old Anzahlungen was declared by the previous software.
      bookings = [
        input.direction === "guthaben"
          ? {
              soll: vortrag,
              haben: anzahlung,
              amountCents,
              vatAccount: null,
              lineDescription: "Saldovortrag Guthaben",
            }
          : {
              soll: anzahlung,
              haben: vortrag,
              amountCents,
              vatAccount: null,
              lineDescription: "Saldovortrag offener Betrag",
            },
      ];
      break;
    }
    case "ausgabe": {
      const geldkonto = requireAccount(db, input.geldkonto, ["geldkonto"], "Geldkonto");
      const aufwand = requireAccount(
        db,
        input.aufwandKonto,
        ["aufwand", "privat"],
        "Aufwandskonto",
      );
      if (input.paymentMethod != null) {
        paymentMethod = requirePaymentMethod(input.paymentMethod);
        reconcilePaymentAccount(paymentMethod, geldkonto);
      }
      if (!description.trim()) {
        throw new ValidationError("Beschreibung der Ausgabe ist erforderlich.");
      }
      bookings = [
        {
          soll: aufwand,
          haben: geldkonto,
          amountCents,
          vatAccount: aufwand,
          lineDescription: description,
        },
      ];
      break;
    }
    default:
      throw new ValidationError("Unbekannter Buchungstyp.");
  }

  const write = db.transaction(() => {
    const belegNr = hasBeleg ? nextBelegNr(db) : null;
    const txResult = db
      .prepare(
        `INSERT INTO transactions
           (beleg_nr, date, type, payment_method, description,
            student_customer_no, student_name, student_address,
            student_contract_no, student_classes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        belegNr,
        date,
        input.type,
        paymentMethod,
        description,
        student?.customerNo ?? null,
        student?.name ?? null,
        student?.address ?? null,
        student?.contractNo ?? null,
        student?.classes ?? null,
      );
    const transactionId = Number(txResult.lastInsertRowid);

    const created: CreatedTransaction["bookings"] = [];
    const insertBooking = db.prepare(
      `INSERT INTO bookings
         (transaction_id, buchung_nr, soll_account, haben_account,
          amount_cents, vat_rate, net_cents, vat_cents, line_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const spec of bookings) {
      const buchungNr = nextBuchungNr(db);
      const rate = spec.vatAccount?.vatRate ?? null;
      const split = rate == null ? null : splitVat(spec.amountCents, rate);
      insertBooking.run(
        transactionId,
        buchungNr,
        spec.soll.number,
        spec.haben.number,
        spec.amountCents,
        rate,
        split?.netCents ?? null,
        split?.vatCents ?? null,
        spec.lineDescription,
      );
      created.push({
        buchungNr,
        soll: spec.soll.number,
        haben: spec.haben.number,
        amountCents: spec.amountCents,
      });
    }
    return { id: transactionId, belegNr, bookings: created };
  });
  return write();
}

/* ------------------------------ storno ----------------------------- */

type TransactionRow = {
  id: number;
  beleg_nr: string | null;
  date: string;
  type: string;
  payment_method: string | null;
  description: string;
  student_customer_no: string | null;
  student_name: string | null;
  student_address: string | null;
  student_contract_no: string | null;
  student_classes: string | null;
  storno_of: number | null;
  storno_reason: string | null;
  storniert_by: number | null;
};

type BookingRow = {
  id: number;
  transaction_id: number;
  buchung_nr: string;
  soll_account: string;
  haben_account: string;
  amount_cents: number;
  vat_rate: number | null;
  net_cents: number | null;
  vat_cents: number | null;
  line_description: string;
};

function getTransactionRow(db: Database, id: number): TransactionRow {
  const row = db
    .query<TransactionRow, [number]>("SELECT * FROM transactions WHERE id = ?")
    .get(id);
  if (!row) throw new ValidationError(`Buchung ${id} existiert nicht.`);
  return row;
}

export function stornoTransaction(
  db: Database,
  id: number,
  reason: string,
  date: string,
): CreatedTransaction {
  if (!reason?.trim()) {
    throw new ValidationError("Stornogrund ist erforderlich.");
  }
  requireDate(date);
  const original = getTransactionRow(db, id);
  if (original.storno_of != null) {
    throw new ValidationError("Eine Stornobuchung kann nicht storniert werden.");
  }
  if (original.storniert_by != null) {
    throw new ValidationError("Diese Buchung wurde bereits storniert.");
  }
  // An invoiced charge is part of an issued Rechnung — reversing it alone
  // would leave the document stating a service that no longer exists.
  const invoice = db
    .query<{ invoice_nr: string }, [number]>(
      `SELECT i.invoice_nr FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.transaction_id = ? AND i.kind = 'rechnung' AND i.storniert_by IS NULL`,
    )
    .get(id);
  if (invoice) {
    throw new ValidationError(
      `Die Buchung ist Teil der Rechnung ${invoice.invoice_nr} — bitte zuerst die Rechnung stornieren.`,
    );
  }
  const originalBookings = db
    .query<BookingRow, [number]>(
      "SELECT * FROM bookings WHERE transaction_id = ? ORDER BY id",
    )
    .all(id);

  const write = db.transaction(() => {
    const belegNr = original.beleg_nr ? nextBelegNr(db) : null;
    const txResult = db
      .prepare(
        `INSERT INTO transactions
           (beleg_nr, date, type, payment_method, description,
            student_customer_no, student_name, student_address,
            student_contract_no, student_classes, storno_of, storno_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        belegNr,
        date,
        original.type,
        original.payment_method,
        `Storno: ${original.description}`.trim(),
        original.student_customer_no,
        original.student_name,
        original.student_address,
        original.student_contract_no,
        original.student_classes,
        id,
        reason.trim(),
      );
    const stornoId = Number(txResult.lastInsertRowid);

    const insertBooking = db.prepare(
      `INSERT INTO bookings
         (transaction_id, buchung_nr, soll_account, haben_account,
          amount_cents, vat_rate, net_cents, vat_cents, line_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const created: CreatedTransaction["bookings"] = [];
    for (const booking of originalBookings) {
      const buchungNr = nextBuchungNr(db);
      // Reversal: Soll and Haben swapped, amounts and VAT data copied.
      insertBooking.run(
        stornoId,
        buchungNr,
        booking.haben_account,
        booking.soll_account,
        booking.amount_cents,
        booking.vat_rate,
        booking.net_cents,
        booking.vat_cents,
        `Storno ${booking.buchung_nr}${booking.line_description ? `: ${booking.line_description}` : ""}`,
      );
      created.push({
        buchungNr,
        soll: booking.haben_account,
        haben: booking.soll_account,
        amountCents: booking.amount_cents,
      });
    }
    db.prepare("UPDATE transactions SET storniert_by = ? WHERE id = ?").run(stornoId, id);
    return { id: stornoId, belegNr, bookings: created };
  });
  return write();
}

/* ------------------------------ queries ---------------------------- */

function isPrintableType(type: string): boolean {
  return type === "zahlung_guthaben" || type === "direktzahlung";
}

function isPrintable(tx: TransactionRow): boolean {
  return isPrintableType(tx.type) && tx.storniert_by == null && tx.storno_of == null;
}

export type ListFilter = {
  from?: string;
  to?: string;
  q?: string;
  /** Exact student customer number (the booking's student snapshot). */
  customerNo?: string;
  status?: "all" | "active" | "storniert";
  /** Ledger only: leave out rows that move no money (charges, Saldovorträge). */
  cashOnly?: boolean;
  /** Journal only: by date, newest first (default) or oldest first. */
  sort?: "asc" | "desc";
};

function matchesFilter(tx: TransactionRow, filter: ListFilter): boolean {
  if (filter.customerNo && tx.student_customer_no !== filter.customerNo) return false;
  if (filter.from && tx.date < filter.from) return false;
  if (filter.to && tx.date > filter.to) return false;
  if (filter.status === "active" && (tx.storniert_by != null || tx.storno_of != null)) {
    return false;
  }
  if (filter.status === "storniert" && tx.storniert_by == null && tx.storno_of == null) {
    return false;
  }
  if (filter.q) {
    const haystack =
      `${tx.beleg_nr ?? ""} ${tx.description} ${tx.student_name ?? ""} ${TRANSACTION_TYPE_LABELS[tx.type as TransactionType] ?? ""}`.toLowerCase();
    if (!haystack.includes(filter.q.toLowerCase())) return false;
  }
  return true;
}

function accountMap(db: Database): Map<string, Account> {
  return new Map(listAccounts(db).map((a) => [a.number, a]));
}

function allTransactions(db: Database): TransactionRow[] {
  return db
    .query<TransactionRow, []>("SELECT * FROM transactions ORDER BY date DESC, id DESC")
    .all();
}

function bookingsByTransaction(db: Database): Map<number, BookingRow[]> {
  const map = new Map<number, BookingRow[]>();
  for (const booking of db
    .query<BookingRow, []>("SELECT * FROM bookings ORDER BY id")
    .all()) {
    const list = map.get(booking.transaction_id) ?? [];
    list.push(booking);
    map.set(booking.transaction_id, list);
  }
  return map;
}

/** VAT label of the account that governs a transaction's tax treatment. */
function transactionVatLabel(
  tx: TransactionRow,
  bookings: BookingRow[],
  accounts: Map<string, Account>,
): string {
  const withVat = bookings.find((b) => b.vat_rate != null);
  if (tx.type === "transfer" || tx.type === "saldovortrag") return "Nicht zutreffend";
  if (!withVat) {
    // A payment that only settles an opening debt carries no Anzahlungs-USt.
    if (tx.type === "zahlung_guthaben") return "Nicht zutreffend";
    const haben = accounts.get(bookings[0]?.haben_account ?? "");
    return haben?.vatLabel ?? "Nicht zutreffend";
  }
  if (tx.type === "ausgabe") {
    return accounts.get(withVat.soll_account)?.vatLabel ?? "Nicht zutreffend";
  }
  return accounts.get(withVat.haben_account)?.vatLabel ?? "Nicht zutreffend";
}

export function listLedger(db: Database, filter: ListFilter): LedgerResponse {
  const accounts = accountMap(db);
  const geldkonten = new Set(
    [...accounts.values()].filter((a) => a.kind === "geldkonto").map((a) => a.number),
  );
  const bookingMap = bookingsByTransaction(db);
  const transactions = allTransactions(db);
  const guthabenKonto = [...accounts.values()].find(
    (a) => a.kind === "anzahlung",
  )?.number;

  const openingBase = [...accounts.values()]
    .filter((a) => a.kind === "geldkonto")
    .reduce((sum, a) => sum + (a.openingCents ?? 0), 0);

  let beforeRange = 0;
  let inRange = 0;
  const rows: LedgerRow[] = [];

  for (const tx of transactions) {
    const bookings = bookingMap.get(tx.id) ?? [];
    let inflow = 0;
    let outflow = 0;
    for (const booking of bookings) {
      if (geldkonten.has(booking.soll_account)) inflow += booking.amount_cents;
      if (geldkonten.has(booking.haben_account)) outflow += booking.amount_cents;
    }
    const net = inflow - outflow;
    if (filter.from && tx.date < filter.from) beforeRange += net;
    if (!matchesFilter(tx, { from: filter.from, to: filter.to })) continue;
    inRange += net;
    if (!matchesFilter(tx, filter)) continue;
    if (filter.cashOnly && inflow === 0 && outflow === 0) continue;

    const isTransfer = tx.type === "transfer";
    let credit = 0;
    let debit = 0;
    for (const booking of bookings) {
      if (booking.haben_account === guthabenKonto) credit += booking.amount_cents;
      if (booking.soll_account === guthabenKonto) debit += booking.amount_cents;
    }
    // Direktzahlung: paid and consumed at once — the Guthaben stays as is.
    if (tx.type === "direktzahlung") {
      credit += Math.abs(net);
      debit += Math.abs(net);
    }
    const hasStudent = Boolean(tx.student_customer_no);
    rows.push({
      id: tx.id,
      date: tx.date,
      belegNr: tx.beleg_nr,
      type: tx.type as TransactionType,
      typeLabel: TRANSACTION_TYPE_LABELS[tx.type as TransactionType] ?? tx.type,
      studentName: tx.student_name,
      description: tx.description,
      vatLabel: transactionVatLabel(tx, bookings, accounts),
      incomeCents: !isTransfer && inflow > 0 ? inflow : null,
      expenseCents: !isTransfer && outflow > 0 ? outflow : null,
      studentCreditCents: hasStudent && credit > 0 ? credit : null,
      studentDebitCents: hasStudent && debit > 0 ? debit : null,
      storniert: tx.storniert_by != null,
      isStorno: tx.storno_of != null,
      stornoReason:
        tx.storno_of != null
          ? tx.storno_reason
          : stornoReasonOfReversal(transactions, tx),
      printable: isPrintable(tx),
    });
  }

  return {
    rows,
    openingCents: openingBase + beforeRange,
    closingCents: openingBase + beforeRange + inRange,
  };
}

function stornoReasonOfReversal(
  transactions: TransactionRow[],
  tx: TransactionRow,
): string | null {
  if (tx.storniert_by == null) return null;
  return (
    transactions.find((candidate) => candidate.id === tx.storniert_by)?.storno_reason ??
    null
  );
}

export function listJournal(db: Database, filter: ListFilter): JournalRow[] {
  const accounts = accountMap(db);
  const bookingMap = bookingsByTransaction(db);
  const transactions = allTransactions(db);
  const rows: JournalRow[] = [];

  for (const tx of transactions) {
    if (!matchesFilter(tx, filter)) continue;
    for (const booking of bookingMap.get(tx.id) ?? []) {
      rows.push({
        transactionId: tx.id,
        date: tx.date,
        belegNr: tx.beleg_nr,
        buchungNr: booking.buchung_nr,
        type: tx.type as TransactionType,
        typeLabel: TRANSACTION_TYPE_LABELS[tx.type as TransactionType] ?? tx.type,
        description: booking.line_description || tx.description,
        sollKonto: booking.soll_account,
        sollName: accounts.get(booking.soll_account)?.name ?? booking.soll_account,
        habenKonto: booking.haben_account,
        habenName: accounts.get(booking.haben_account)?.name ?? booking.haben_account,
        amountCents: booking.amount_cents,
        vatRate: booking.vat_rate,
        storniert: tx.storniert_by != null,
        isStorno: tx.storno_of != null,
        stornoReason:
          tx.storno_of != null
            ? tx.storno_reason
            : stornoReasonOfReversal(transactions, tx),
        printable: isPrintable(tx),
      });
    }
  }
  // Journal is sorted by Buchungsdatum (newest first unless sort=asc);
  // the Buchungsnummer orders bookings of the same day.
  const direction = filter.sort === "asc" ? 1 : -1;
  return rows.sort(
    (a, b) =>
      direction *
      (a.date.localeCompare(b.date) || a.buchungNr.localeCompare(b.buchungNr)),
  );
}

/* ----------------------------- Quittung ---------------------------- */

export function getQuittung(db: Database, transactionId: number): QuittungData {
  const tx = getTransactionRow(db, transactionId);
  if (!isPrintable(tx)) {
    throw new ValidationError(
      "Für diese Buchung kann keine Quittung ausgestellt werden.",
    );
  }
  const bookings = db
    .query<BookingRow, [number]>(
      "SELECT * FROM bookings WHERE transaction_id = ? ORDER BY id",
    )
    .all(transactionId);
  const accounts = accountMap(db);

  // Lazily assign the Quittungsnummer on first print: only issued
  // Quittungen consume numbers, so the sequence stays gapless.
  const issue = db.transaction(() => {
    const existing = db
      .query<{ quittung_nr: string; issued_at: string }, [number]>(
        "SELECT quittung_nr, issued_at FROM quittungen WHERE transaction_id = ?",
      )
      .get(transactionId);
    if (existing) {
      return { quittungNr: existing.quittung_nr, issuedAt: existing.issued_at };
    }
    const year = Number(tx.date.slice(0, 4));
    const quittungNr = nextQuittungNr(db, year);
    db.prepare("INSERT INTO quittungen (quittung_nr, transaction_id) VALUES (?, ?)").run(
      quittungNr,
      transactionId,
    );
    const issuedAt = db
      .query<{ issued_at: string }, [number]>(
        "SELECT issued_at FROM quittungen WHERE transaction_id = ?",
      )
      .get(transactionId)!.issued_at;
    return { quittungNr, issuedAt };
  });
  const { quittungNr, issuedAt } = issue();

  const lines: QuittungLine[] = bookings.map((booking) => {
    const haben = accounts.get(booking.haben_account);
    const durchlaufend = haben?.kind === "durchlaufend";
    return {
      description: booking.line_description || tx.description,
      netCents: booking.net_cents ?? booking.amount_cents,
      vatRate: booking.vat_rate,
      vatCents: booking.vat_cents ?? 0,
      grossCents: booking.amount_cents,
      durchlaufenderPosten: durchlaufend,
    };
  });

  const company = getCompany(db);
  const verwendungszweckParts = [
    tx.type === "zahlung_guthaben" ? "Zahlung auf Ausbildungskonto" : tx.description,
    tx.student_contract_no ? `Vertrag ${tx.student_contract_no}` : "",
    tx.student_classes ? `Klasse ${tx.student_classes}` : "",
  ].filter(Boolean);

  return {
    quittungNr,
    issuedAt,
    date: tx.date,
    belegNr: tx.beleg_nr,
    paymentMethod: (tx.payment_method as PaymentMethod | null) ?? null,
    issuer: {
      name: company.name,
      address: company.address,
      phone: company.phone,
      email: company.email,
      steuernummer: company.steuernummer,
      ustIdNr: company.ustIdNr,
    },
    recipient: tx.student_name
      ? { name: tx.student_name, address: tx.student_address ?? "" }
      : null,
    verwendungszweck: verwendungszweckParts.join(", "),
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
  };
}

/* ----------------------- student balances -------------------------- */

export type StudentBalance = {
  customerNo: string;
  name: string;
  balanceCents: number;
};

/**
 * Compute the real Guthaben per student from the ledger.
 *
 * Balance = SUM(bookings.haben_account = anzahlung-account, same student)
 *         − SUM(bookings.soll_account  = anzahlung-account, same student)
 *
 * Positive → credit; negative → owes.  Students with no anzahlung
 * bookings are absent from the result. The system role resolves explicitly.
 */
export function listStudentBalances(db: Database): StudentBalance[] {
  const anzahlungAccount = requireSystemAccount(db, "anzahlung", "Guthabenkonto");
  const acctNo = anzahlungAccount.number;

  type BalanceRow = {
    customer_no: string;
    name: string;
    balance_cents: number;
  };

  const rows = db
    .query<BalanceRow, [string, string, string]>(
      `SELECT
         t.student_customer_no                         AS customer_no,
         t.student_name                                AS name,
         SUM(
           CASE WHEN b.haben_account = ?1 THEN  b.amount_cents ELSE 0 END
         ) -
         SUM(
           CASE WHEN b.soll_account  = ?2 THEN  b.amount_cents ELSE 0 END
         )                                             AS balance_cents
       FROM bookings b
       JOIN transactions t ON t.id = b.transaction_id
       WHERE
         t.student_customer_no IS NOT NULL
         AND t.student_customer_no != ''
         AND (b.haben_account = ?3 OR b.soll_account = ?3)
       GROUP BY t.student_customer_no`,
    )
    .all(acctNo, acctNo, acctNo);

  return rows
    .filter((row) => row.customer_no != null)
    .map((row) => ({
      customerNo: row.customer_no,
      name: row.name ?? "",
      balanceCents: row.balance_cents,
    }));
}

/* ---------------- retention: expired accounting years -------------- */

/** Shortest period after which accounting records of a year may be
 *  touched: Bücher/Aufzeichnungen 10 Jahre (§ 147 Abs. 1 Nr. 1, Abs. 3 AO,
 *  § 257 HGB), counted from the end of the calendar year (§ 147 Abs. 4 AO). */
export const ACCOUNTING_RETENTION_MONTHS = 120;

export type PseudonymiseResult = { transactions: number; invoices: number };

function hasTable(db: Database, name: string): boolean {
  return (
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name)!.n > 0
  );
}

/** Newest booking/invoice date of a customer (null = no records). */
export function latestAccountingDate(db: Database, customerNo: string): string | null {
  const tx = db
    .query<{ date: string | null }, [string]>(
      "SELECT max(date) AS date FROM transactions WHERE student_customer_no = ?",
    )
    .get(customerNo)!.date;
  const inv = hasTable(db, "invoices")
    ? db
        .query<{ date: string | null }, [string]>(
          "SELECT max(date) AS date FROM invoices WHERE student_customer_no = ?",
        )
        .get(customerNo)!.date
    : null;
  if (!tx) return inv;
  if (!inv) return tx;
  return tx > inv ? tx : inv;
}

/**
 * Löschkonzept — the one narrowly scoped exception to immutability, for
 * records whose statutory retention period is OVER (see
 * docs/datenschutz/loeschkonzept.md): once every booking and invoice of a
 * customer lies in years whose period ended, the personal data they
 * embed (name, address, the name inside Buchungstext / Rechnungszeilen)
 * is replaced by a pseudonym. Amounts, accounts, dates, Beleg-/Buchungs-
 * /Rechnungsnummern, the gapless sequences and all balances stay exactly
 * as they are — nothing is deleted, no row is added or removed.
 *
 * Refuses (ValidationError) while any record of the customer is still
 * within its period, so it can never alter a record under GoBD retention.
 * Idempotent: a second call finds nothing left to replace.
 */
export function pseudonymiseExpiredCustomer(
  db: Database,
  input: {
    customerNo: string;
    pseudonym: string;
    /** Extra names to replace (e.g. from the student master data). */
    names?: string[];
    /** ISO date of the run. */
    today: string;
    /** Retention period in months (never below 120). */
    months?: number;
  },
): PseudonymiseResult {
  const months = Math.max(
    input.months ?? ACCOUNTING_RETENTION_MONTHS,
    ACCOUNTING_RETENTION_MONTHS,
  );
  const customerNo = input.customerNo.trim();
  if (!customerNo) throw new ValidationError("Kundennummer fehlt.");
  const latest = latestAccountingDate(db, customerNo);
  if (!latest) return { transactions: 0, invoices: 0 };
  const end = periodEnd(latest, months, true);
  if (!(end < input.today)) {
    throw new ValidationError(
      `Aufbewahrungsfrist der Buchhaltung für Kunde ${customerNo} läuft noch bis ${end}.`,
    );
  }
  const withInvoices = hasTable(db, "invoices");

  const names = new Set<string>(input.names ?? []);
  for (const row of db
    .query<{ name: string | null }, [string]>(
      "SELECT DISTINCT student_name AS name FROM transactions WHERE student_customer_no = ?",
    )
    .all(customerNo)) {
    if (row.name) names.add(row.name);
  }
  if (withInvoices) {
    for (const row of db
      .query<{ name: string }, [string]>(
        "SELECT DISTINCT recipient_name AS name FROM invoices WHERE student_customer_no = ?",
      )
      .all(customerNo)) {
      if (row.name) names.add(row.name);
    }
  }
  const replaceable = [...names]
    .map((name) => name.trim())
    .filter((name) => name.length >= 3 && name !== input.pseudonym)
    // Longest first, so "Max Muster" goes before a bare "Max".
    .sort((a, b) => b.length - a.length);

  let transactions = 0;
  let invoices = 0;
  db.transaction(() => {
    for (const name of replaceable) {
      db.prepare(
        `UPDATE transactions SET description = replace(description, ?1, ?2)
         WHERE student_customer_no = ?3 AND instr(description, ?1) > 0`,
      ).run(name, input.pseudonym, customerNo);
      db.prepare(
        `UPDATE bookings SET line_description = replace(line_description, ?1, ?2)
         WHERE transaction_id IN (SELECT id FROM transactions WHERE student_customer_no = ?3)
           AND instr(line_description, ?1) > 0`,
      ).run(name, input.pseudonym, customerNo);
      if (withInvoices) {
        db.prepare(
          `UPDATE invoices SET lines = replace(lines, ?1, ?2), note = replace(note, ?1, ?2)
           WHERE student_customer_no = ?3 AND (instr(lines, ?1) > 0 OR instr(note, ?1) > 0)`,
        ).run(name, input.pseudonym, customerNo);
      }
    }
    transactions = db
      .prepare(
        `UPDATE transactions SET student_name = ?1, student_address = ''
         WHERE student_customer_no = ?2
           AND (student_name IS NOT ?1 OR coalesce(student_address, '') != '')`,
      )
      .run(input.pseudonym, customerNo).changes;
    if (withInvoices) {
      invoices = db
        .prepare(
          `UPDATE invoices SET recipient_name = ?1, recipient_address = ''
           WHERE student_customer_no = ?2
             AND (recipient_name != ?1 OR recipient_address != '')`,
        )
        .run(input.pseudonym, customerNo).changes;
    }
  })();
  return { transactions, invoices };
}
