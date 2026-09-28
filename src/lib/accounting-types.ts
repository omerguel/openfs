/* ------------------------------------------------------------------ */
/* Shared accounting types — single source of truth for the API       */
/* contract between the Bun server (src/server) and the SPA.          */
/* All amounts are integer cents (see src/lib/money.ts).              */
/* ------------------------------------------------------------------ */

export type AccountKind =
  | "geldkonto"
  | "transit"
  | "durchlaufend"
  | "anzahlung"
  | "steuer"
  | "erloes"
  | "privat"
  | "aufwand";

export type Account = {
  number: string;
  name: string;
  kind: AccountKind;
  /** 19 | 7 | 0 — null when VAT does not apply (Geldkonten, Transit, …) */
  vatRate: number | null;
  vatLabel: string;
  active: boolean;
  openingCents: number | null;
  openingDate: string | null;
};

export type PaymentMethod = "bar" | "ueberweisung" | "ec";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bar: "Bar",
  ueberweisung: "Überweisung",
  ec: "EC-Karte",
};

export type TransactionType =
  | "zahlung_guthaben"
  | "direktzahlung"
  | "guthaben_uebertragung"
  | "transfer"
  | "ausgabe";

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  zahlung_guthaben: "Zahlung auf Guthaben",
  direktzahlung: "Direktzahlung",
  guthaben_uebertragung: "Guthabenübertragung auf Kosten",
  transfer: "Transfer",
  ausgabe: "Ausgabe",
};

/** Snapshot of the student at booking time (GoBD: receipts stay stable). */
export type StudentRef = {
  customerNo: string;
  name: string;
  address: string;
  contractNo: string;
  classes: string;
};

export type ChargeLine = {
  habenKonto: string;
  amountCents: number;
  description: string;
};

export type CreateTransactionInput =
  | {
      type: "zahlung_guthaben";
      date: string; // ISO YYYY-MM-DD
      amountCents: number;
      geldkonto: string; // 1000 | 1200
      paymentMethod: PaymentMethod;
      student: StudentRef;
      description?: string;
    }
  | {
      type: "direktzahlung";
      date: string;
      amountCents: number;
      geldkonto: string;
      habenKonto: string; // 8400 | 8300 | 8100 | 1590
      paymentMethod: PaymentMethod;
      student: StudentRef;
      description: string;
    }
  | {
      type: "guthaben_uebertragung";
      date: string;
      /** Total; with `lines` it must equal their sum (or be omitted). */
      amountCents: number;
      /** Required unless `lines` is given. */
      habenKonto?: string; // 4400 | 4300 | 4100 | 1370
      student: StudentRef;
      description: string;
      /** Multi-line charge (e.g. exam: Vorstellungsentgelt + TÜV-Gebühr as
          durchlaufender Posten) — one transaction, one booking per line,
          VAT per line from its own Haben account. Replaces habenKonto. */
      lines?: ChargeLine[];
    }
  | {
      type: "transfer";
      date: string;
      amountCents: number;
      fromKonto: string; // Geldkonto
      toKonto: string; // Geldkonto
      description?: string;
    }
  | {
      type: "ausgabe";
      date: string;
      amountCents: number;
      geldkonto: string;
      aufwandKonto: string;
      paymentMethod?: PaymentMethod;
      description: string;
    };

export type LedgerRow = {
  id: number;
  date: string;
  belegNr: string | null;
  type: TransactionType;
  typeLabel: string;
  studentName: string | null;
  description: string;
  vatLabel: string;
  incomeCents: number | null;
  expenseCents: number | null;
  storniert: boolean;
  isStorno: boolean;
  stornoReason: string | null;
  printable: boolean;
};

export type LedgerResponse = {
  rows: LedgerRow[];
  openingCents: number;
  closingCents: number;
};

export type JournalRow = {
  transactionId: number;
  date: string;
  belegNr: string | null;
  buchungNr: string;
  type: TransactionType;
  typeLabel: string;
  description: string;
  sollKonto: string;
  sollName: string;
  habenKonto: string;
  habenName: string;
  amountCents: number;
  vatRate: number | null;
  storniert: boolean;
  isStorno: boolean;
  stornoReason: string | null;
  printable: boolean;
};

export type QuittungLine = {
  description: string;
  netCents: number;
  vatRate: number | null;
  vatCents: number;
  grossCents: number;
  durchlaufenderPosten: boolean;
};

export type QuittungData = {
  quittungNr: string;
  issuedAt: string;
  date: string;
  belegNr: string | null;
  paymentMethod: PaymentMethod | null;
  issuer: {
    name: string;
    address: string;
    phone: string;
    email: string;
    steuernummer: string;
    ustIdNr: string;
  };
  recipient: { name: string; address: string } | null;
  verwendungszweck: string;
  lines: QuittungLine[];
  totalCents: number;
};

export type CompanyProfile = {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  steuernummer: string;
  ustIdNr: string;
  /** DATEV-Beraternummer (1001–9999999) — required for the export */
  beraterNr: string;
  /** DATEV-Mandantennummer (1–99999) — required for the export */
  mandantNr: string;
  /** Bankverbindung — printed on Rechnungen, creditor account for SEPA. */
  bankName: string;
  iban: string;
  bic: string;
  /** SEPA-Gläubiger-Identifikationsnummer (e.g. DE98ZZZ09999999999). */
  glaeubigerId: string;
};
