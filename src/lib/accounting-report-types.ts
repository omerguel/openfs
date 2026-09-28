/* ------------------------------------------------------------------ */
/* Buchhaltung reports — shared API types (server:                     */
/* src/server/accounting-reports.ts). Amounts are integer cents.       */
/* ------------------------------------------------------------------ */

export type GeldkontoBalance = {
  number: string;
  name: string;
  active: boolean;
  openingCents: number;
  openingDate: string | null;
  /** Balance after every booking so far (incl. future-dated ones). */
  balanceCents: number;
  /** Balance at the end of today. */
  todayCents: number;
};

export type CashbookRow = {
  transactionId: number;
  date: string;
  belegNr: string | null;
  typeLabel: string;
  description: string;
  studentName: string | null;
  inCents: number;
  outCents: number;
  /** Running balance after this row. */
  balanceCents: number;
  storniert: boolean;
  isStorno: boolean;
};

export type Cashbook = {
  account: { number: string; name: string };
  from: string | null;
  to: string | null;
  openingCents: number;
  closingCents: number;
  totalInCents: number;
  totalOutCents: number;
  rows: CashbookRow[];
  /** Rows after which the running balance was below zero. */
  negativeRows: number;
};

export type VatPeriod = {
  /** "2026-09" or "2026-Q3" */
  key: string;
  label: string;
  from: string;
  to: string;
  /** Erlöse 19 % / 7 % (booked revenue, net + tax). */
  revenue19NetCents: number;
  revenue19VatCents: number;
  revenue7NetCents: number;
  revenue7VatCents: number;
  /** Erhaltene Anzahlungen 19 %: received minus released by charges. */
  prepayment19NetCents: number;
  prepayment19VatCents: number;
  /** Steuerfreie Umsätze (§ 4 Nr. 21 UStG, 0 %). */
  taxFreeCents: number;
  /** Nicht steuerbar (Mahngebühren) and durchlaufende Posten — info only. */
  notTaxableCents: number;
  passThroughCents: number;
  /** Abziehbare Vorsteuer from Ausgaben. */
  inputVatCents: number;
  /** USt total (19 % + 7 % incl. Anzahlungen). */
  outputVatCents: number;
  /** outputVat − inputVat (negative = Erstattung). */
  payableCents: number;
};

export type VatReport = {
  year: number;
  period: "month" | "quarter";
  periods: VatPeriod[];
  total: VatPeriod;
};
