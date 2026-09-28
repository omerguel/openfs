/* ------------------------------------------------------------------ */
/* Rechnung / Stornorechnung / Mahnung as real PDF files (pdf.ts) and  */
/* "Per E-Mail senden" through the Postausgang (mail.ts) with the PDF  */
/* attached. The layout mirrors the on-screen sheet                    */
/* (src/components/rechnungen/InvoiceSheet.tsx); both read the frozen   */
/* invoice snapshot, so a re-download reproduces the issued document.  */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import {
  type Invoice,
  type InvoiceIssuer,
  type InvoiceReminder,
  type OpeningBalanceItem,
  type OpeningBalanceReminder,
  REMINDER_LABELS,
} from "../lib/invoice-types";
import {
  ENDRECHNUNG_NOTE,
  LETTER_CLOSING,
  invoiceFootnotes,
  letterSalutation,
  paymentSentence,
  prepaidVatLabel,
  reminderFileStem,
  reminderIntro,
  vatRateLabel,
} from "../lib/invoice-text";
import { formatCents } from "../lib/money";
import { ValidationError } from "./errors";
import { getInvoice, getOpeningBalance } from "./invoices";
import { isValidEmail, queueMail, type OutboxEntry } from "./mail";
import { A4, PdfDocument, type TextOptions, wrapText } from "./pdf";
import { getStudent } from "./students";

const LEFT = 56;
const RIGHT = A4.width - 56;
const BOTTOM = A4.height - 80;

const date = (iso: string) => iso.split("-").reverse().join(".");
const euro = (cents: number) => `${formatCents(cents)} €`;

function cityFromAddress(address: string): string {
  const last = address.split(",").pop() ?? "";
  return last.replace(/\d/g, "").trim();
}

/** Cursor-based writer: tracks y and breaks pages automatically. */
class Writer {
  y = 60;
  constructor(
    readonly pdf: PdfDocument,
    private readonly footer: string,
  ) {}

  ensure(space: number) {
    if (this.y + space <= BOTTOM) return;
    this.drawFooter();
    this.pdf.addPage();
    this.y = 60;
  }

  drawFooter() {
    if (!this.footer) return;
    const lines = wrapText(this.footer, RIGHT - LEFT, 8);
    let y = A4.height - 40 - (lines.length - 1) * 10;
    this.pdf.line(LEFT, y - 12, RIGHT, y - 12, 0.5, 0.75);
    for (const line of lines) {
      this.pdf.text(LEFT, y, line, { size: 8, gray: 0.4 });
      y += 10;
    }
  }

  paragraph(text: string, options: TextOptions & { gap?: number; width?: number } = {}) {
    const size = options.size ?? 10;
    const lineHeight = size * 1.35;
    for (const line of wrapText(
      text,
      options.width ?? RIGHT - LEFT,
      size,
      options.style,
    )) {
      this.ensure(lineHeight);
      this.pdf.text(LEFT, this.y, line, options);
      this.y += lineHeight;
    }
    this.y += options.gap ?? 6;
  }
}

type Letterhead = {
  issuer: InvoiceIssuer;
  title: string;
  recipient: { name: string; address: string };
  meta: [string, string][];
};

function bankFooter(issuer: InvoiceIssuer): string {
  if (!issuer.iban) return "";
  return `Bankverbindung: ${[
    issuer.bankName,
    `IBAN ${issuer.iban}`,
    issuer.bic && `BIC ${issuer.bic}`,
  ]
    .filter(Boolean)
    .join(" · ")}`;
}

function letterhead(w: Writer, head: Letterhead) {
  const { pdf } = w;
  const { issuer } = head;
  pdf.text(LEFT, w.y, issuer.name, { size: 13, style: "bold" });
  pdf.text(RIGHT, w.y + 2, head.title, { size: 18, style: "bold", align: "right" });
  w.y += 16;
  const contact = [
    issuer.address,
    [issuer.phone && `Tel. ${issuer.phone}`, issuer.email].filter(Boolean).join(" · "),
    issuer.steuernummer && `Steuernummer: ${issuer.steuernummer}`,
    issuer.ustIdNr && `USt-IdNr.: ${issuer.ustIdNr}`,
  ].filter(Boolean) as string[];
  for (const line of contact) {
    pdf.text(LEFT, w.y, line, { size: 9, gray: 0.35 });
    w.y += 12;
  }
  w.y += 6;
  pdf.line(LEFT, w.y, RIGHT, w.y, 0.5, 0.75);
  w.y += 22;

  const top = w.y;
  pdf.text(LEFT, w.y, head.recipient.name, { style: "bold" });
  w.y += 13;
  for (const part of head.recipient.address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    pdf.text(LEFT, w.y, part);
    w.y += 13;
  }
  let metaY = top;
  for (const [label, value] of head.meta) {
    pdf.text(RIGHT - 110, metaY, label, { size: 9, gray: 0.4, align: "right" });
    pdf.text(RIGHT, metaY, value, { size: 9, align: "right" });
    metaY += 13;
  }
  w.y = Math.max(w.y, metaY) + 22;
}

function closing(w: Writer, issuer: InvoiceIssuer, isoDate: string) {
  w.ensure(40);
  w.y += 6;
  const city = cityFromAddress(issuer.address);
  w.paragraph(`${city ? `${city}, den ` : ""}${date(isoDate)}`);
}

/* ------------------------------ invoice ----------------------------- */

export function invoiceFileName(invoice: Invoice): string {
  return `${invoice.invoiceNr}.pdf`;
}

export function renderInvoicePdf(invoice: Invoice): Uint8Array {
  const isStorno = invoice.kind === "storno";
  const title = isStorno ? "Stornorechnung" : "Rechnung";
  const pdf = new PdfDocument(`${title} ${invoice.invoiceNr}`);
  const w = new Writer(pdf, bankFooter(invoice.issuer));
  letterhead(w, {
    issuer: invoice.issuer,
    title,
    recipient: invoice.recipient,
    meta: [
      ["Rechnungsnr.", invoice.invoiceNr],
      ["Rechnungsdatum", date(invoice.date)],
      ["Kundennr.", invoice.customerNo],
      ...(invoice.contractNo
        ? ([["Vertrag", invoice.contractNo]] as [string, string][])
        : []),
    ],
  });

  if (isStorno && invoice.stornoOf) {
    w.paragraph(
      `Hiermit stornieren wir die Rechnung ${invoice.stornoOf.invoiceNr}${
        invoice.stornoReason ? ` (Grund: ${invoice.stornoReason})` : ""
      }.`,
      { gap: 12 },
    );
  }

  // Positions table.
  const cols = {
    date: LEFT,
    text: LEFT + 62,
    net: RIGHT - 150,
    vat: RIGHT - 80,
    gross: RIGHT,
  };
  const header = (y: number) => {
    const o: TextOptions = { size: 8.5, gray: 0.4 };
    pdf.text(cols.date, y, "Datum", o);
    pdf.text(cols.text, y, "Leistung", o);
    pdf.text(cols.net, y, "Netto €", { ...o, align: "right" });
    pdf.text(cols.vat, y, "USt", { ...o, align: "right" });
    pdf.text(cols.gross, y, "Brutto €", { ...o, align: "right" });
    pdf.line(LEFT, y + 5, RIGHT, y + 5, 0.5, 0.6);
  };
  w.ensure(40);
  header(w.y);
  w.y += 20;
  const textWidthMax = cols.net - 60 - cols.text;
  for (const line of invoice.lines) {
    const marker = line.durchlaufend
      ? " *"
      : line.steuerfrei
        ? " **"
        : line.vatRate == null
          ? " ***"
          : "";
    const wrapped = wrapText(`${line.description}${marker}`, textWidthMax, 10);
    const height = wrapped.length * 13 + 6;
    if (w.y + height > BOTTOM) {
      w.ensure(height + 30);
      header(w.y);
      w.y += 20;
    }
    pdf.text(cols.date, w.y, date(line.date));
    wrapped.forEach((text, i) => {
      pdf.text(cols.text, w.y + i * 13, text);
    });
    pdf.text(cols.net, w.y, formatCents(line.netCents), { align: "right" });
    pdf.text(cols.vat, w.y, line.vatRate == null ? "–" : `${line.vatRate} %`, {
      align: "right",
    });
    pdf.text(cols.gross, w.y, formatCents(line.grossCents), { align: "right" });
    w.y += height - 6;
    pdf.line(LEFT, w.y - 4, RIGHT, w.y - 4, 0.3, 0.85);
    w.y += 8;
  }

  // Tax summary per rate.
  w.y += 8;
  const sumCols = { label: RIGHT - 250, net: RIGHT - 150, vat: RIGHT - 80, gross: RIGHT };
  w.ensure(30 + invoice.vatSummary.length * 14);
  const small: TextOptions = { size: 8.5, gray: 0.4 };
  pdf.text(sumCols.label, w.y, "Steuersatz", small);
  pdf.text(sumCols.net, w.y, "Netto €", { ...small, align: "right" });
  pdf.text(sumCols.vat, w.y, "USt €", { ...small, align: "right" });
  pdf.text(sumCols.gross, w.y, "Brutto €", { ...small, align: "right" });
  w.y += 14;
  for (const row of invoice.vatSummary) {
    pdf.text(sumCols.label, w.y, vatRateLabel(row.vatRate, invoice));
    pdf.text(sumCols.net, w.y, formatCents(row.netCents), { align: "right" });
    pdf.text(sumCols.vat, w.y, formatCents(row.vatCents), { align: "right" });
    pdf.text(sumCols.gross, w.y, formatCents(row.grossCents), { align: "right" });
    w.y += 14;
  }
  pdf.line(sumCols.label, w.y - 6, RIGHT, w.y - 6, 0.6, 0.4);
  w.y += 6;
  pdf.text(sumCols.label, w.y, "Gesamtbetrag", { style: "bold" });
  pdf.text(RIGHT, w.y, euro(invoice.totalCents), { style: "bold", align: "right" });
  w.y += 16;
  const due = invoice.totalCents - invoice.prepaidCents;
  if (!isStorno && invoice.prepaidCents > 0) {
    w.ensure(30 + invoice.prepaidVat.length * 12);
    pdf.text(sumCols.label, w.y, "abzgl. erhaltener Anzahlungen");
    pdf.text(RIGHT, w.y, `– ${euro(invoice.prepaidCents)}`, { align: "right" });
    w.y += 12;
    for (const row of invoice.prepaidVat) {
      pdf.text(sumCols.label + 8, w.y, prepaidVatLabel(row), { size: 8.5, gray: 0.4 });
      w.y += 11;
    }
    w.y += 4;
    pdf.text(sumCols.label, w.y, "Zu zahlen", { style: "bold" });
    pdf.text(RIGHT, w.y, euro(due), { style: "bold", align: "right" });
    w.y += 16;
  }
  w.y += 10;

  if (!isStorno) {
    w.paragraph(paymentSentence(invoice, due));
    if (invoice.prepaidCents > 0) {
      w.paragraph(ENDRECHNUNG_NOTE, { size: 8.5, gray: 0.4 });
    }
  }
  if (invoice.note) w.paragraph(invoice.note);
  for (const note of invoiceFootnotes(invoice))
    w.paragraph(note, { size: 8.5, gray: 0.4, gap: 2 });
  closing(w, invoice.issuer, invoice.date);
  w.drawFooter();
  return pdf.toBytes();
}

/* ------------------------------ reminder ---------------------------- */

/** What a Mahnung refers to: an invoice or an opening debt. */
export type DunningSubject = {
  issuer: InvoiceIssuer;
  recipient: { name: string; address: string };
  customerNo: string;
  contractNo: string;
  /** "Rechnung R-2026-00001 vom 01.09.2026" */
  heading: string;
  /** "die oben genannte Rechnung" */
  reference: string;
  /** Verwendungszweck in the payment sentence. */
  paymentReference: string;
  fileStem: string;
  meta: [string, string][];
};

export function invoiceDunningSubject(invoice: Invoice): DunningSubject {
  return {
    issuer: invoice.issuer,
    recipient: invoice.recipient,
    customerNo: invoice.customerNo,
    contractNo: invoice.contractNo,
    heading: `zu Rechnung ${invoice.invoiceNr} vom ${date(invoice.date)}`,
    reference: "der oben genannten Rechnung",
    paymentReference: `der Rechnungsnummer ${invoice.invoiceNr}`,
    fileStem: invoice.invoiceNr,
    meta: [
      ["Rechnungsnr.", invoice.invoiceNr],
      ["Kundennr.", invoice.customerNo],
    ],
  };
}

export function openingDunningSubject(item: OpeningBalanceItem): DunningSubject {
  const ref = item.belegNr ? `Beleg ${item.belegNr}` : `Kundennr. ${item.customerNo}`;
  return {
    issuer: item.issuer,
    recipient: item.recipient,
    customerNo: item.customerNo,
    contractNo: item.contractNo,
    heading: `zum offenen Saldo vom ${date(item.date)} (Übernahme aus dem Vorsystem)`,
    reference: "dem oben genannten offenen Betrag",
    paymentReference: `Ihrer Kundennummer ${item.customerNo}`,
    fileStem: `Saldovortrag-${item.customerNo}`,
    meta: [
      ["Kundennr.", item.customerNo],
      ["Bezug", ref],
    ],
  };
}

export function reminderFileName(
  subject: DunningSubject,
  reminder: Pick<InvoiceReminder, "level">,
): string {
  return `${reminderFileStem(REMINDER_LABELS[reminder.level], subject.fileStem)}.pdf`;
}

export function renderReminderPdf(
  subject: DunningSubject,
  reminder: Pick<
    InvoiceReminder,
    "level" | "date" | "dueDate" | "openCents" | "feeCents"
  >,
): Uint8Array {
  const label = REMINDER_LABELS[reminder.level];
  const pdf = new PdfDocument(`${label} ${subject.fileStem}`);
  const w = new Writer(pdf, bankFooter(subject.issuer));
  letterhead(w, {
    issuer: subject.issuer,
    title: label,
    recipient: subject.recipient,
    meta: [["Datum", date(reminder.date)], ...subject.meta],
  });
  w.paragraph(`${label} ${subject.heading}`, { style: "bold", gap: 12 });
  w.paragraph(letterSalutation(subject.recipient.name), { gap: 8 });
  w.paragraph(reminderIntro(reminder.level, subject.reference), { gap: 12 });

  const labelX = RIGHT - 250;
  const rows: [string, number][] = [["Offener Betrag", reminder.openCents]];
  if (reminder.feeCents > 0) rows.push(["Mahngebühr", reminder.feeCents]);
  for (const [text, cents] of rows) {
    pdf.text(labelX, w.y, text);
    pdf.text(RIGHT, w.y, euro(cents), { align: "right" });
    w.y += 14;
  }
  pdf.line(labelX, w.y - 6, RIGHT, w.y - 6, 0.6, 0.4);
  w.y += 6;
  pdf.text(labelX, w.y, "Zu zahlen", { style: "bold" });
  pdf.text(RIGHT, w.y, euro(reminder.openCents + reminder.feeCents), {
    style: "bold",
    align: "right",
  });
  w.y += 26;

  w.paragraph(
    `Bitte überweisen Sie den Betrag bis zum ${date(reminder.dueDate)} unter Angabe ${subject.paymentReference}.${
      reminder.level === 3
        ? " Sollte bis dahin kein Zahlungseingang erfolgen, behalten wir uns weitere Schritte vor."
        : ""
    }`,
  );
  w.paragraph(
    "Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
    { gap: 14 },
  );
  w.paragraph(LETTER_CLOSING, { gap: 2 });
  w.paragraph(subject.issuer.name, { gap: 14 });
  closing(w, subject.issuer, reminder.date);
  w.drawFooter();
  return pdf.toBytes();
}

/* ------------------------------ lookups ----------------------------- */

export type PdfFile = { filename: string; bytes: Uint8Array };

export function invoicePdf(db: Database, invoiceId: number): PdfFile {
  const invoice = getInvoice(db, invoiceId);
  return { filename: invoiceFileName(invoice), bytes: renderInvoicePdf(invoice) };
}

function findReminder<T extends { id: number }>(list: T[], id: number): T {
  const reminder = list.find((r) => r.id === id);
  if (!reminder) throw new ValidationError("Mahnung nicht gefunden.");
  return reminder;
}

export function invoiceReminderPdf(
  db: Database,
  invoiceId: number,
  reminderId: number,
): PdfFile {
  const invoice = getInvoice(db, invoiceId);
  const reminder = findReminder<InvoiceReminder>(invoice.reminders, reminderId);
  const subject = invoiceDunningSubject(invoice);
  return {
    filename: reminderFileName(subject, reminder),
    bytes: renderReminderPdf(subject, reminder),
  };
}

export function openingReminderPdf(
  db: Database,
  transactionId: number,
  reminderId: number,
): PdfFile {
  const item = getOpeningBalance(db, transactionId);
  const reminder = findReminder<OpeningBalanceReminder>(item.reminders, reminderId);
  const subject = openingDunningSubject(item);
  return {
    filename: reminderFileName(subject, reminder),
    bytes: renderReminderPdf(subject, reminder),
  };
}

export function pdfResponse(file: PdfFile, inline = false): Response {
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename}"`,
    },
  });
}

/* ------------------------------- mail ------------------------------- */

export type SendDocumentInput = {
  recipient?: unknown;
  /** Send this Mahnung instead of the invoice itself. */
  reminderId?: unknown;
  message?: unknown;
};

function recipientFor(db: Database, studentId: number | null, raw: unknown): string {
  const given = typeof raw === "string" ? raw.trim() : "";
  if (given) return given;
  if (studentId != null) {
    try {
      const email = getStudent(db, studentId).email.trim();
      if (email) return email;
    } catch {
      // Student deleted — the caller has to name a recipient.
    }
  }
  throw new ValidationError(
    "Für diese/n Fahrschüler/in ist keine E-Mail-Adresse hinterlegt — bitte eine Adresse angeben.",
  );
}

function queueDocument(
  db: Database,
  input: {
    recipient: string;
    subject: string;
    body: string;
    file: PdfFile;
    relatedType: string;
    relatedId: number;
  },
): OutboxEntry {
  if (!isValidEmail(input.recipient)) {
    throw new ValidationError("Bitte eine gültige E-Mail-Adresse angeben.");
  }
  const entry = queueMail(db, {
    recipient: input.recipient,
    subject: input.subject,
    bodyText: input.body,
    kind: "generic",
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    attachments: [
      {
        filename: input.file.filename,
        contentType: "application/pdf",
        contentBase64: Buffer.from(input.file.bytes).toString("base64"),
      },
    ],
  });
  if (!entry) throw new ValidationError("Die E-Mail konnte nicht eingereiht werden.");
  return entry;
}

function mailBody(name: string, sentence: string, extra: unknown, issuer: string) {
  const message = typeof extra === "string" && extra.trim() ? `\n\n${extra.trim()}` : "";
  return `${letterSalutation(name)}\n\n${sentence}${message}\n\n${LETTER_CLOSING}\n${issuer}`;
}

export function sendInvoiceMail(
  db: Database,
  invoiceId: number,
  input: SendDocumentInput,
): OutboxEntry {
  const invoice = getInvoice(db, invoiceId);
  const recipient = recipientFor(db, invoice.studentId, input.recipient);
  if (input.reminderId != null) {
    const reminder = findReminder<InvoiceReminder>(
      invoice.reminders,
      Number(input.reminderId),
    );
    const subject = invoiceDunningSubject(invoice);
    const label = REMINDER_LABELS[reminder.level];
    return queueDocument(db, {
      recipient,
      subject: `${label} zu Rechnung ${invoice.invoiceNr}`,
      body: mailBody(
        invoice.recipient.name,
        `anbei erhalten Sie unsere ${label} zu Rechnung ${invoice.invoiceNr}. Offen sind ${euro(
          reminder.openCents + reminder.feeCents,
        )}, zahlbar bis zum ${date(reminder.dueDate)}.`,
        input.message,
        invoice.issuer.name,
      ),
      file: {
        filename: reminderFileName(subject, reminder),
        bytes: renderReminderPdf(subject, reminder),
      },
      relatedType: "invoice_reminder",
      relatedId: reminder.id,
    });
  }
  const due = invoice.totalCents - invoice.prepaidCents;
  const title = invoice.kind === "storno" ? "Stornorechnung" : "Rechnung";
  return queueDocument(db, {
    recipient,
    subject: `${title} ${invoice.invoiceNr}`,
    body: mailBody(
      invoice.recipient.name,
      invoice.kind === "storno"
        ? `anbei erhalten Sie die Stornorechnung ${invoice.invoiceNr}.`
        : `anbei erhalten Sie Ihre Rechnung ${invoice.invoiceNr} vom ${date(invoice.date)} über ${euro(
            invoice.totalCents,
          )}. ${paymentSentence(invoice, due)}`,
      input.message,
      invoice.issuer.name,
    ),
    file: { filename: invoiceFileName(invoice), bytes: renderInvoicePdf(invoice) },
    relatedType: "invoice",
    relatedId: invoice.id,
  });
}

export function sendOpeningReminderMail(
  db: Database,
  transactionId: number,
  reminderId: number,
  input: SendDocumentInput,
): OutboxEntry {
  const item = getOpeningBalance(db, transactionId);
  const reminder = findReminder<OpeningBalanceReminder>(item.reminders, reminderId);
  const subject = openingDunningSubject(item);
  const label = REMINDER_LABELS[reminder.level];
  return queueDocument(db, {
    recipient: recipientFor(db, item.studentId, input.recipient),
    subject: `${label} zu Ihrem offenen Saldo`,
    body: mailBody(
      item.recipient.name,
      `anbei erhalten Sie unsere ${label} zu Ihrem offenen Saldo. Offen sind ${euro(
        reminder.openCents + reminder.feeCents,
      )}, zahlbar bis zum ${date(reminder.dueDate)}.`,
      input.message,
      item.issuer.name,
    ),
    file: {
      filename: reminderFileName(subject, reminder),
      bytes: renderReminderPdf(subject, reminder),
    },
    relatedType: "saldovortrag_reminder",
    relatedId: reminder.id,
  });
}
