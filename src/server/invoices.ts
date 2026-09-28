/* ------------------------------------------------------------------ */
/* Rechnungen (§ 14 UStG), Offene Posten und Mahnwesen.                */
/*                                                                     */
/* A Rechnung is an immutable document over charges that are booked    */
/* through the engine (guthaben_uebertragung: 3272 an Erlöskonto).     */
/* Creating an invoice never writes bookings itself — new charges go   */
/* through createTransaction, Mahngebühren too. Corrections happen via */
/* a Stornorechnung (own number, negated lines, storno_of → original); */
/* the charges can be storniert alongside or re-invoiced.              */
/*                                                                     */
/* Payment status is derived, never stored: a student's payments       */
/* (zahlung_guthaben) settle their charges oldest-first (FIFO); an     */
/* invoice is open by what is left on its charges.                     */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type { Account, ChargeLine } from "../lib/accounting-types";
import {
  DEFAULT_INVOICING_SETTINGS,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceIssuer,
  type InvoiceKind,
  type InvoiceLine,
  type InvoiceReminder,
  type InvoicingSettings,
  type OpenItems,
  type OpenItemsStudent,
  type UninvoicedCharge,
  type VatSummaryRow,
  REMINDER_LABELS,
} from "../lib/invoice-types";
import { getCompany, nextSequence } from "./db";
import {
  createTransaction,
  listAccounts,
  listStudentBalances,
  stornoTransaction,
  ValidationError,
} from "./engine";
import { handle, json } from "./http";
import { getStudent } from "./students";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Feld '${field}' muss ein Datum (JJJJ-MM-TT) sein.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`Ungültiges Datum: ${value}.`);
  }
  return value;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function nextInvoiceNr(db: Database, date: string): string {
  const year = Number(date.slice(0, 4));
  return `R-${year}-${String(nextSequence(db, `rechnung:${year}`)).padStart(5, "0")}`;
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export function getInvoicingSettings(db: Database): InvoicingSettings {
  const row = db
    .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'invoicing'")
    .get();
  if (!row) return { ...DEFAULT_INVOICING_SETTINGS };
  return { ...DEFAULT_INVOICING_SETTINGS, ...(JSON.parse(row.value) as object) };
}

export function setInvoicingSettings(db: Database, input: unknown): InvoicingSettings {
  const body = (input ?? {}) as Partial<InvoicingSettings>;
  const current = getInvoicingSettings(db);
  const days = (value: unknown, fallback: number, label: string) => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 365) {
      throw new ValidationError(`${label} muss eine Tageszahl zwischen 0 und 365 sein.`);
    }
    return value as number;
  };
  let fees = current.reminderFeeCents;
  if (body.reminderFeeCents !== undefined) {
    const raw = body.reminderFeeCents as unknown;
    if (
      !Array.isArray(raw) ||
      raw.length !== 3 ||
      raw.some((fee) => !Number.isInteger(fee) || fee < 0)
    ) {
      throw new ValidationError("Mahngebühren müssen drei Beträge in Cent (>= 0) sein.");
    }
    fees = raw as InvoicingSettings["reminderFeeCents"];
  }
  const next: InvoicingSettings = {
    paymentTermDays: days(body.paymentTermDays, current.paymentTermDays, "Zahlungsziel"),
    reminderTermDays: days(body.reminderTermDays, current.reminderTermDays, "Mahnfrist"),
    reminderFeeCents: fees,
  };
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('invoicing', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(next));
  return next;
}

/* ------------------------------------------------------------------ */
/* charges + FIFO allocation                                           */
/* ------------------------------------------------------------------ */

type ChargeRow = {
  id: number;
  date: string;
  description: string;
  gross_cents: number;
};

/* Active charges of a student: guthaben_uebertragung that is neither a
   Storno nor storniert. Oldest first — the FIFO order. */
function activeCharges(db: Database, customerNo: string): ChargeRow[] {
  return db
    .query<ChargeRow, [string]>(
      `SELECT t.id, t.date, t.description, SUM(b.amount_cents) AS gross_cents
       FROM transactions t JOIN bookings b ON b.transaction_id = t.id
       WHERE t.type = 'guthaben_uebertragung'
         AND t.storno_of IS NULL AND t.storniert_by IS NULL
         AND t.student_customer_no = ?
       GROUP BY t.id
       ORDER BY t.date, t.id`,
    )
    .all(customerNo);
}

function paymentPool(db: Database, customerNo: string): number {
  return (
    db
      .query<{ total: number | null }, [string]>(
        `SELECT SUM(b.amount_cents) AS total
         FROM transactions t JOIN bookings b ON b.transaction_id = t.id
         WHERE t.type = 'zahlung_guthaben'
           AND t.storno_of IS NULL AND t.storniert_by IS NULL
           AND t.student_customer_no = ?`,
      )
      .get(customerNo)!.total ?? 0
  );
}

/** Uncovered remainder per active charge (transaction id → cents). */
export function chargeRemainders(db: Database, customerNo: string): Map<number, number> {
  let pool = paymentPool(db, customerNo);
  const remainders = new Map<number, number>();
  for (const charge of activeCharges(db, customerNo)) {
    const covered = Math.min(pool, charge.gross_cents);
    pool -= covered;
    remainders.set(charge.id, charge.gross_cents - covered);
  }
  return remainders;
}

/** Transactions on a live (not storniert) invoice. */
function invoicedTransactionIds(db: Database, customerNo: string): Set<number> {
  return new Set(
    db
      .query<{ transaction_id: number }, [string]>(
        `SELECT ii.transaction_id FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.kind = 'rechnung' AND i.storniert_by IS NULL
           AND i.student_customer_no = ?`,
      )
      .all(customerNo)
      .map((row) => row.transaction_id),
  );
}

function reminderFeeTransactionIds(db: Database): Set<number> {
  return new Set(
    db
      .query<{ id: number }, []>(
        "SELECT fee_transaction_id AS id FROM invoice_reminders WHERE fee_transaction_id IS NOT NULL",
      )
      .all()
      .map((row) => row.id),
  );
}

export function listUninvoicedCharges(
  db: Database,
  studentId: number,
): UninvoicedCharge[] {
  const student = getStudent(db, studentId);
  const invoiced = invoicedTransactionIds(db, student.customerNumber);
  const fees = reminderFeeTransactionIds(db);
  const remainders = chargeRemainders(db, student.customerNumber);
  return activeCharges(db, student.customerNumber)
    .filter((charge) => !invoiced.has(charge.id) && !fees.has(charge.id))
    .map((charge) => ({
      transactionId: charge.id,
      date: charge.date,
      description: charge.description,
      grossCents: charge.gross_cents,
      openCents: remainders.get(charge.id) ?? 0,
    }));
}

/* ------------------------------------------------------------------ */
/* line building                                                       */
/* ------------------------------------------------------------------ */

type BookingRow = {
  transaction_id: number;
  haben_account: string;
  amount_cents: number;
  vat_rate: number | null;
  net_cents: number | null;
  vat_cents: number | null;
  line_description: string;
};

function linesForTransaction(
  db: Database,
  transactionId: number,
  accounts: Map<string, Account>,
): InvoiceLine[] {
  const tx = db
    .query<{ date: string; description: string }, [number]>(
      "SELECT date, description FROM transactions WHERE id = ?",
    )
    .get(transactionId)!;
  return db
    .query<BookingRow, [number]>(
      `SELECT transaction_id, haben_account, amount_cents, vat_rate, net_cents,
              vat_cents, line_description
       FROM bookings WHERE transaction_id = ? ORDER BY id`,
    )
    .all(transactionId)
    .map((booking) => {
      const account = accounts.get(booking.haben_account);
      const durchlaufend = account?.kind === "durchlaufend";
      return {
        transactionId,
        date: tx.date,
        description: booking.line_description || tx.description,
        netCents: booking.net_cents ?? booking.amount_cents,
        vatRate: booking.vat_rate,
        vatCents: booking.vat_cents ?? 0,
        grossCents: booking.amount_cents,
        durchlaufend,
        steuerfrei: !durchlaufend && booking.vat_rate === 0,
      };
    });
}

export function vatSummary(lines: InvoiceLine[]): VatSummaryRow[] {
  const byRate = new Map<string, VatSummaryRow>();
  for (const line of lines) {
    const key = String(line.vatRate);
    const row = byRate.get(key) ?? {
      vatRate: line.vatRate,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    row.netCents += line.netCents;
    row.vatCents += line.vatCents;
    row.grossCents += line.grossCents;
    byRate.set(key, row);
  }
  return [...byRate.values()].sort((a, b) => (b.vatRate ?? -1) - (a.vatRate ?? -1));
}

function issuerSnapshot(db: Database): InvoiceIssuer {
  const company = getCompany(db);
  return {
    name: company.name,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    steuernummer: company.steuernummer,
    ustIdNr: company.ustIdNr,
    bankName: company.bankName,
    iban: company.iban,
    bic: company.bic,
  };
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

type InvoiceRow = {
  id: number;
  invoice_nr: string;
  kind: InvoiceKind;
  date: string;
  due_date: string;
  student_id: number | null;
  student_customer_no: string;
  recipient_name: string;
  recipient_address: string;
  student_contract_no: string;
  student_classes: string;
  issuer: string;
  lines: string;
  total_cents: number;
  prepaid_cents: number;
  note: string;
  storno_of: number | null;
  storno_reason: string | null;
  storniert_by: number | null;
};

type ReminderRow = {
  id: number;
  invoice_id: number;
  level: 1 | 2 | 3;
  date: string;
  due_date: string;
  open_cents: number;
  fee_cents: number;
};

const toReminder = (row: ReminderRow): InvoiceReminder => ({
  id: row.id,
  invoiceId: row.invoice_id,
  level: row.level,
  date: row.date,
  dueDate: row.due_date,
  openCents: row.open_cents,
  feeCents: row.fee_cents,
});

/* Remainders are computed once per student and shared by all of that
   student's invoices in one listing. */
type RemainderCache = Map<string, Map<number, number>>;

function toInvoice(
  db: Database,
  row: InvoiceRow,
  cache: RemainderCache,
  today: string,
): Invoice {
  const lines = JSON.parse(row.lines) as InvoiceLine[];
  const numberOf = (id: number | null) =>
    id == null
      ? null
      : {
          id,
          invoiceNr: db
            .query<{ invoice_nr: string }, [number]>(
              "SELECT invoice_nr FROM invoices WHERE id = ?",
            )
            .get(id)!.invoice_nr,
        };
  const reminders = db
    .query<ReminderRow, [number]>(
      "SELECT * FROM invoice_reminders WHERE invoice_id = ? ORDER BY level",
    )
    .all(row.id)
    .map(toReminder);

  let openCents = 0;
  let status: Invoice["status"];
  if (row.kind === "storno") {
    status = "storno";
  } else if (row.storniert_by != null) {
    status = "storniert";
  } else {
    let remainders = cache.get(row.student_customer_no);
    if (!remainders) {
      remainders = chargeRemainders(db, row.student_customer_no);
      cache.set(row.student_customer_no, remainders);
    }
    const items = db
      .query<{ transaction_id: number }, [number]>(
        "SELECT transaction_id FROM invoice_items WHERE invoice_id = ?",
      )
      .all(row.id);
    for (const item of items) openCents += remainders.get(item.transaction_id) ?? 0;
    status =
      openCents === 0 ? "bezahlt" : openCents < row.total_cents ? "teilbezahlt" : "offen";
  }
  const latestDue = reminders.at(-1)?.dueDate ?? row.due_date;
  const overdueDays =
    openCents > 0 && latestDue < today ? daysBetween(row.due_date, today) : 0;

  return {
    id: row.id,
    invoiceNr: row.invoice_nr,
    kind: row.kind,
    date: row.date,
    dueDate: row.due_date,
    studentId: row.student_id,
    customerNo: row.student_customer_no,
    recipient: { name: row.recipient_name, address: row.recipient_address },
    contractNo: row.student_contract_no,
    classes: row.student_classes,
    issuer: JSON.parse(row.issuer) as InvoiceIssuer,
    lines,
    vatSummary: vatSummary(lines),
    totalCents: row.total_cents,
    prepaidCents: row.prepaid_cents,
    note: row.note,
    stornoOf: numberOf(row.storno_of),
    stornoReason: row.storno_reason,
    storniertBy: numberOf(row.storniert_by),
    openCents,
    status,
    overdueDays,
    reminders,
  };
}

export function getInvoice(db: Database, id: number, today = todayIso()): Invoice {
  const row = db
    .query<InvoiceRow, [number]>("SELECT * FROM invoices WHERE id = ?")
    .get(id);
  if (!row) throw new ValidationError("Rechnung nicht gefunden.");
  return toInvoice(db, row, new Map(), today);
}

export type InvoiceFilter = {
  customerNo?: string;
  studentId?: number;
  from?: string;
  to?: string;
};

export function listInvoices(
  db: Database,
  filter: InvoiceFilter = {},
  today = todayIso(),
): Invoice[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.customerNo) {
    clauses.push("student_customer_no = ?");
    params.push(filter.customerNo);
  }
  if (filter.studentId) {
    clauses.push("student_id = ?");
    params.push(filter.studentId);
  }
  if (filter.from) {
    clauses.push("date >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("date <= ?");
    params.push(filter.to);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const cache: RemainderCache = new Map();
  return db
    .query<InvoiceRow, (string | number)[]>(
      `SELECT * FROM invoices${where} ORDER BY date DESC, id DESC`,
    )
    .all(...params)
    .map((row) => toInvoice(db, row, cache, today));
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

export function createInvoice(db: Database, input: CreateInvoiceInput): Invoice {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  if (!Number.isInteger(input.studentId) || input.studentId <= 0) {
    throw new ValidationError("Fahrschüler/in ist erforderlich.");
  }
  const date = requireDate(input.date, "date");
  const student = getStudent(db, input.studentId);
  const customerNo = student.customerNumber;
  const name = `${student.firstName} ${student.lastName}`.trim();
  const transactionIds = input.transactionIds ?? [];
  if (!Array.isArray(transactionIds)) {
    throw new ValidationError("Feld 'transactionIds' muss eine Liste sein.");
  }
  const newLines = input.newLines ?? [];
  if (!Array.isArray(newLines)) {
    throw new ValidationError("Feld 'newLines' muss eine Liste sein.");
  }
  if (transactionIds.length === 0 && newLines.length === 0) {
    throw new ValidationError("Die Rechnung braucht mindestens eine Position.");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const settings = getInvoicingSettings(db);

  const write = db.transaction((): number => {
    const ids = [...new Set(transactionIds.map(Number))];
    if (newLines.length > 0) {
      const lines = newLines as ChargeLine[];
      const created = createTransaction(db, {
        type: "guthaben_uebertragung",
        date,
        amountCents: lines.reduce((sum, line) => sum + Number(line.amountCents), 0),
        student: {
          customerNo,
          name,
          address: student.address,
          contractNo: student.contractNumber,
          classes: student.classes,
        },
        description: `FS ${name}${student.classes ? ` - ${student.classes}` : ""}, ${lines
          .map((line) => String(line.description ?? "").trim())
          .join(", ")}`,
        lines,
      });
      ids.push(created.id);
    }

    const active = new Map(activeCharges(db, customerNo).map((c) => [c.id, c]));
    const invoiced = invoicedTransactionIds(db, customerNo);
    const fees = reminderFeeTransactionIds(db);
    for (const id of ids) {
      if (!active.has(id)) {
        throw new ValidationError(
          `Buchung ${id} ist keine offene Leistung von ${name} (storniert, fremd oder keine Guthabenübertragung).`,
        );
      }
      if (invoiced.has(id)) {
        throw new ValidationError(
          `Buchung ${id} ist bereits in einer Rechnung enthalten.`,
        );
      }
      if (fees.has(id)) {
        throw new ValidationError(`Buchung ${id} ist eine Mahngebühr.`);
      }
    }

    const accounts = new Map(listAccounts(db).map((a) => [a.number, a]));
    const ordered = ids.toSorted((a, b) => {
      const left = active.get(a)!;
      const right = active.get(b)!;
      return left.date.localeCompare(right.date) || a - b;
    });
    const lines = ordered.flatMap((id) => linesForTransaction(db, id, accounts));
    const total = lines.reduce((sum, line) => sum + line.grossCents, 0);
    const remainders = chargeRemainders(db, customerNo);
    const open = ordered.reduce((sum, id) => sum + (remainders.get(id) ?? 0), 0);

    const invoiceNr = nextInvoiceNr(db, date);
    const invoiceId = Number(
      db
        .prepare(
          `INSERT INTO invoices
             (invoice_nr, kind, date, due_date, student_id, student_customer_no,
              recipient_name, recipient_address, student_contract_no, student_classes,
              issuer, lines, total_cents, prepaid_cents, note)
           VALUES (?, 'rechnung', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          invoiceNr,
          date,
          addDays(date, settings.paymentTermDays),
          student.id,
          customerNo,
          name,
          student.address,
          student.contractNumber,
          student.classes,
          JSON.stringify(issuerSnapshot(db)),
          JSON.stringify(lines),
          total,
          total - open,
          note,
        ).lastInsertRowid,
    );
    const insertItem = db.prepare(
      "INSERT INTO invoice_items (invoice_id, transaction_id) VALUES (?, ?)",
    );
    for (const id of ordered) insertItem.run(invoiceId, id);
    return invoiceId;
  });

  return getInvoice(db, write());
}

export function stornoInvoice(
  db: Database,
  id: number,
  input: { reason?: unknown; date?: unknown; stornoCharges?: unknown },
): { storno: Invoice; original: Invoice } {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new ValidationError("Stornogrund ist erforderlich.");
  const date = requireDate(input.date, "date");
  const stornoCharges = input.stornoCharges === true;
  const original = db
    .query<InvoiceRow, [number]>("SELECT * FROM invoices WHERE id = ?")
    .get(id);
  if (!original) throw new ValidationError("Rechnung nicht gefunden.");
  if (original.kind === "storno") {
    throw new ValidationError("Eine Stornorechnung kann nicht storniert werden.");
  }
  if (original.storniert_by != null) {
    throw new ValidationError("Diese Rechnung wurde bereits storniert.");
  }

  const write = db.transaction((): number => {
    const lines = (JSON.parse(original.lines) as InvoiceLine[]).map((line) => ({
      ...line,
      netCents: -line.netCents,
      vatCents: -line.vatCents,
      grossCents: -line.grossCents,
    }));
    const stornoId = Number(
      db
        .prepare(
          `INSERT INTO invoices
             (invoice_nr, kind, date, due_date, student_id, student_customer_no,
              recipient_name, recipient_address, student_contract_no, student_classes,
              issuer, lines, total_cents, prepaid_cents, note, storno_of, storno_reason)
           VALUES (?, 'storno', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          nextInvoiceNr(db, date),
          date,
          date,
          original.student_id,
          original.student_customer_no,
          original.recipient_name,
          original.recipient_address,
          original.student_contract_no,
          original.student_classes,
          JSON.stringify(issuerSnapshot(db)),
          JSON.stringify(lines),
          -original.total_cents,
          `Storno zu Rechnung ${original.invoice_nr}`,
          id,
          reason,
        ).lastInsertRowid,
    );
    db.prepare("UPDATE invoices SET storniert_by = ? WHERE id = ?").run(stornoId, id);

    if (stornoCharges) {
      const items = db
        .query<{ transaction_id: number; storniert_by: number | null }, [number]>(
          `SELECT ii.transaction_id, t.storniert_by FROM invoice_items ii
           JOIN transactions t ON t.id = ii.transaction_id
           WHERE ii.invoice_id = ?`,
        )
        .all(id);
      for (const item of items) {
        if (item.storniert_by != null) continue;
        stornoTransaction(
          db,
          item.transaction_id,
          `Rechnung ${original.invoice_nr} storniert: ${reason}`,
          date,
        );
      }
    }
    return stornoId;
  });

  const stornoId = write();
  return { storno: getInvoice(db, stornoId), original: getInvoice(db, id) };
}

/* Mahnwesen: next level (1 → 3) for an overdue open invoice. The fee is a
   normal charge booked through the engine to 4830 (nicht steuerbar). */
export function createReminder(
  db: Database,
  invoiceId: number,
  input: { date?: unknown; feeCents?: unknown },
): InvoiceReminder {
  const date = requireDate(input.date, "date");
  const invoice = getInvoice(db, invoiceId, date);
  if (invoice.kind !== "rechnung" || invoice.status === "storniert") {
    throw new ValidationError("Nur offene Rechnungen können gemahnt werden.");
  }
  if (invoice.openCents <= 0) {
    throw new ValidationError("Die Rechnung ist bereits bezahlt.");
  }
  const last = invoice.reminders.at(-1);
  const dueDate = last?.dueDate ?? invoice.dueDate;
  if (dueDate >= date) {
    throw new ValidationError(
      `Die Zahlungsfrist läuft noch bis ${dueDate.split("-").reverse().join(".")}.`,
    );
  }
  const level = ((last?.level ?? 0) + 1) as InvoiceReminder["level"];
  if (level > 3) {
    throw new ValidationError(
      "Die letzte Mahnstufe ist erreicht — bitte weitere Schritte außerhalb der Software einleiten.",
    );
  }
  const settings = getInvoicingSettings(db);
  const feeCents =
    input.feeCents === undefined
      ? (settings.reminderFeeCents[level - 1] ?? 0)
      : Number(input.feeCents);
  if (!Number.isInteger(feeCents) || feeCents < 0) {
    throw new ValidationError("Mahngebühr muss ein Betrag in Cent (>= 0) sein.");
  }

  const write = db.transaction((): number => {
    let feeTransactionId: number | null = null;
    if (feeCents > 0) {
      feeTransactionId = createTransaction(db, {
        type: "guthaben_uebertragung",
        date,
        amountCents: feeCents,
        habenKonto: "4830",
        student: {
          customerNo: invoice.customerNo,
          name: invoice.recipient.name,
          address: invoice.recipient.address,
          contractNo: invoice.contractNo,
          classes: invoice.classes,
        },
        description: `Mahngebühr ${REMINDER_LABELS[level]} zu Rechnung ${invoice.invoiceNr}`,
      }).id;
    }
    return Number(
      db
        .prepare(
          `INSERT INTO invoice_reminders
             (invoice_id, level, date, due_date, open_cents, fee_cents, fee_transaction_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          invoiceId,
          level,
          date,
          addDays(date, settings.reminderTermDays),
          invoice.openCents,
          feeCents,
          feeTransactionId,
        ).lastInsertRowid,
    );
  });

  const reminderId = write();
  return toReminder(
    db
      .query<ReminderRow, [number]>("SELECT * FROM invoice_reminders WHERE id = ?")
      .get(reminderId)!,
  );
}

/* ------------------------------------------------------------------ */
/* Offene Posten                                                       */
/* ------------------------------------------------------------------ */

export function listOpenItems(db: Database, today = todayIso()): OpenItems {
  const invoices = listInvoices(db, {}, today).filter(
    (invoice) => invoice.kind === "rechnung" && invoice.openCents > 0,
  );
  const fees = reminderFeeTransactionIds(db);
  const balances = new Map(listStudentBalances(db).map((b) => [b.customerNo, b]));
  const studentIds = new Map(
    db
      .query<{ id: number; customer_number: string }, []>(
        "SELECT id, customer_number FROM students",
      )
      .all()
      .map((row) => [row.customer_number, row.id]),
  );

  const customers = new Set<string>([
    ...invoices.map((invoice) => invoice.customerNo),
    ...[...balances.values()].filter((b) => b.balanceCents < 0).map((b) => b.customerNo),
  ]);

  const students: OpenItemsStudent[] = [];
  for (const customerNo of customers) {
    const remainders = chargeRemainders(db, customerNo);
    const invoiced = invoicedTransactionIds(db, customerNo);
    let uninvoiced = 0;
    for (const [txId, open] of remainders) {
      if (!invoiced.has(txId) && !fees.has(txId)) uninvoiced += open;
    }
    const invoicedOpen = invoices
      .filter((invoice) => invoice.customerNo === customerNo)
      .reduce((sum, invoice) => sum + invoice.openCents, 0);
    const balance = balances.get(customerNo);
    students.push({
      studentId: studentIds.get(customerNo) ?? null,
      customerNo,
      name:
        balance?.name ??
        invoices.find((invoice) => invoice.customerNo === customerNo)?.recipient.name ??
        customerNo,
      invoicedOpenCents: invoicedOpen,
      uninvoicedOpenCents: uninvoiced,
      balanceCents: balance?.balanceCents ?? 0,
    });
  }
  students.sort(
    (a, b) =>
      b.invoicedOpenCents +
      b.uninvoicedOpenCents -
      (a.invoicedOpenCents + a.uninvoicedOpenCents),
  );

  const overdue = invoices.filter((invoice) => invoice.overdueDays > 0);
  return {
    invoices,
    students,
    totals: {
      openCents: invoices.reduce((sum, invoice) => sum + invoice.openCents, 0),
      overdueCents: overdue.reduce((sum, invoice) => sum + invoice.openCents, 0),
      overdueCount: overdue.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function parseId(raw: string, label = "Rechnungs-ID"): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Ungültige ${label}.`);
  return id;
}

export function invoiceRoutes(db: Database) {
  return {
    "/api/invoices": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const studentId = params.get("studentId");
          return json({
            invoices: listInvoices(db, {
              customerNo: params.get("customerNo") ?? undefined,
              studentId: studentId ? parseId(studentId, "Fahrschüler-ID") : undefined,
              from: params.get("from") ?? undefined,
              to: params.get("to") ?? undefined,
            }),
          });
        })(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createInvoice(db, (await req.json()) as CreateInvoiceInput), 201),
        )(),
    },

    "/api/invoices/uninvoiced": {
      GET: (req: BunRequest) =>
        handle(() => {
          const raw = new URL(req.url).searchParams.get("studentId") ?? "";
          return json({
            charges: listUninvoicedCharges(db, parseId(raw, "Fahrschüler-ID")),
          });
        })(),
    },

    "/api/invoices/:id": {
      GET: (req: BunRequest<"/api/invoices/:id">) =>
        handle(() => json(getInvoice(db, parseId(req.params.id))))(),
    },

    "/api/invoices/:id/storno": {
      POST: (req: BunRequest<"/api/invoices/:id/storno">) =>
        handle(async () =>
          json(stornoInvoice(db, parseId(req.params.id), await req.json()), 201),
        )(),
    },

    "/api/invoices/:id/reminders": {
      POST: (req: BunRequest<"/api/invoices/:id/reminders">) =>
        handle(async () =>
          json(createReminder(db, parseId(req.params.id), await req.json()), 201),
        )(),
    },

    "/api/open-items": {
      GET: () => handle(() => json(listOpenItems(db)))(),
    },

    "/api/settings/invoicing": {
      GET: () => handle(() => json(getInvoicingSettings(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () => json(setInvoicingSettings(db, await req.json())))(),
    },
  };
}
