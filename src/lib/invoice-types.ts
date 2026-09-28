/* ------------------------------------------------------------------ */
/* Rechnungen / Offene Posten / Mahnwesen — shared API types between   */
/* the Bun server (src/server/invoices.ts) and the SPA. Amounts are    */
/* integer cents (src/lib/money.ts).                                   */
/* ------------------------------------------------------------------ */

export type InvoiceKind = "rechnung" | "storno";

/** Live status: derived from the student's payments at read time. */
export type InvoiceStatus = "offen" | "teilbezahlt" | "bezahlt" | "storniert" | "storno";

export type InvoiceLine = {
  /** Charge (guthaben_uebertragung) the line was taken from. */
  transactionId: number | null;
  /** Leistungsdatum (§ 14 Abs. 4 Nr. 6 UStG). */
  date: string;
  description: string;
  netCents: number;
  /** null = no VAT applies (durchlaufender Posten / nicht steuerbar). */
  vatRate: number | null;
  vatCents: number;
  grossCents: number;
  durchlaufend: boolean;
  /** Booked to a tax-free revenue account (vatRate 0, e.g. § 4 Nr. 21 UStG). */
  steuerfrei: boolean;
};

export type InvoiceIssuer = {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  steuernummer: string;
  ustIdNr: string;
  bankName: string;
  iban: string;
  bic: string;
};

export type InvoiceReminder = {
  id: number;
  invoiceId: number;
  /** 1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = 2. (letzte) Mahnung */
  level: 1 | 2 | 3;
  date: string;
  dueDate: string;
  openCents: number;
  feeCents: number;
};

export const REMINDER_LABELS: Record<InvoiceReminder["level"], string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

export type VatSummaryRow = {
  /** null = ohne USt (durchlaufend / nicht steuerbar) */
  vatRate: number | null;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type Invoice = {
  id: number;
  invoiceNr: string;
  kind: InvoiceKind;
  date: string;
  dueDate: string;
  studentId: number | null;
  customerNo: string;
  recipient: { name: string; address: string };
  contractNo: string;
  classes: string;
  issuer: InvoiceIssuer;
  lines: InvoiceLine[];
  vatSummary: VatSummaryRow[];
  totalCents: number;
  /** Payments already applied to this invoice's charges when it was issued. */
  prepaidCents: number;
  /** prepaidCents split by the tax rate of the positions it was applied to
   *  (see allocatePrepaid in src/server/invoices.ts). Never carries more VAT
   *  than the invoiced positions of that rate. */
  prepaidVat: VatSummaryRow[];
  note: string;
  stornoOf: { id: number; invoiceNr: string } | null;
  stornoReason: string | null;
  storniertBy: { id: number; invoiceNr: string } | null;
  /** Live: amount of the invoiced charges not yet covered by payments. */
  openCents: number;
  status: InvoiceStatus;
  /** Days past due (0 when not overdue or settled). */
  overdueDays: number;
  reminders: InvoiceReminder[];
  /** Earliest date the next Mahnstufe can be issued (null: none possible). */
  nextReminderOn: string | null;
};

/** Mahnung over an opening debt (Saldovortrag „offener Betrag“). */
export type OpeningBalanceReminder = Omit<InvoiceReminder, "invoiceId"> & {
  transactionId: number;
};

/** An opening debt taken over from the previous software — not an
 *  invoice, but an open item that is settled by payments (FIFO, oldest
 *  first) and can be dunned like an invoice. */
export type OpeningBalanceItem = {
  transactionId: number;
  belegNr: string | null;
  date: string;
  studentId: number | null;
  customerNo: string;
  recipient: { name: string; address: string };
  contractNo: string;
  classes: string;
  /** Current profile data (a Saldovortrag has no frozen issuer snapshot). */
  issuer: InvoiceIssuer;
  amountCents: number;
  openCents: number;
  overdueDays: number;
  reminders: OpeningBalanceReminder[];
  nextReminderOn: string | null;
};

export type UninvoicedCharge = {
  transactionId: number;
  date: string;
  description: string;
  grossCents: number;
  /** Part of the charge not yet covered by payments. */
  openCents: number;
};

export type OpenItemsStudent = {
  studentId: number | null;
  customerNo: string;
  name: string;
  /** Sum of open amounts on invoices. */
  invoicedOpenCents: number;
  /** Open charges that are not on any invoice yet. */
  uninvoicedOpenCents: number;
  /** Open part of an opening debt (Saldovortrag). */
  openingOpenCents: number;
  /** Positive = Guthaben (credit). */
  balanceCents: number;
};

export type OpenItems = {
  invoices: Invoice[];
  students: OpenItemsStudent[];
  openingBalances: OpeningBalanceItem[];
  totals: {
    openCents: number;
    overdueCents: number;
    overdueCount: number;
    /** Open opening debts (Saldovortrag), not included in openCents. */
    openingCents: number;
  };
};

export type InvoicingSettings = {
  /** Zahlungsziel in Tagen ab Rechnungsdatum. */
  paymentTermDays: number;
  /** Frist in Tagen, die jede Mahnung setzt. */
  reminderTermDays: number;
  /** Default Mahngebühr per level (index 0 = Zahlungserinnerung). */
  reminderFeeCents: [number, number, number];
};

export const DEFAULT_INVOICING_SETTINGS: InvoicingSettings = {
  paymentTermDays: 14,
  reminderTermDays: 7,
  reminderFeeCents: [0, 500, 500],
};

export type CreateInvoiceInput = {
  studentId: number;
  date: string;
  /** Existing, not yet invoiced charges of the student. */
  transactionIds?: number[];
  /** New charges booked together with the invoice (one transaction). */
  newLines?: { habenKonto: string; amountCents: number; description: string }[];
  note?: string;
};
