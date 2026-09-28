/* ------------------------------------------------------------------ */
/* Position texts for Rechnungen. Charges are booked with a Buchungs-  */
/* text meant for the journal ("FS Aylin Demir - B197, Fahrübungs-     */
/* stunde (90)"); on an invoice the recipient is already in the        */
/* address block and the duration code reads like noise. New invoices */
/* store the cleaned text ("Fahrübungsstunde 90 Min."); issued ones    */
/* keep what they were issued with (GoBD).                             */
/* ------------------------------------------------------------------ */

import type { Invoice } from "./invoice-types";
import { formatCents } from "./money";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanPositionText(
  description: string,
  student: { name: string; classes?: string },
): string {
  let text = description.trim();
  // "FS <Name>[ - <Klassen>], " prefix of the booking text.
  const name = escapeRegExp(student.name.trim());
  if (name) {
    text = text.replace(new RegExp(`^FS\\s+${name}(\\s*-\\s*[^,]*)?,\\s*`, "i"), "");
  }
  text = text.replace(/^FS\s+[^,]+,\s*/, "");
  // Durchlaufende Posten are marked with a footnote on the invoice.
  text = text.replace(/\s*\(durchlaufender Posten\)/gi, "");
  // "(90)" / "(45)" duration codes → "90 Min.".
  text = text.replace(/\s*\((\d{2,3})\)(?=\s*(,|$))/g, " $1 Min.");
  return text.trim() || description.trim();
}

const euroText = (cents: number) => `${formatCents(cents)} €`;
const isoToGerman = (iso: string) => iso.split("-").reverse().join(".");

/* ------------------------------------------------------------------ */
/* Letter texts shared by the on-screen sheets and the PDF renderer.   */
/* The student record has no Anrede, so a named letter opens with the  */
/* gender-neutral "Guten Tag Vorname Nachname," (DIN 5008 compliant);  */
/* without a name it falls back to "Sehr geehrte Damen und Herren,".   */
/* ------------------------------------------------------------------ */

export function letterSalutation(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Guten Tag ${trimmed},` : "Sehr geehrte Damen und Herren,";
}

export function reminderIntro(level: 1 | 2 | 3, subject: string): string {
  if (level === 1) {
    return `sicherlich ist es Ihrer Aufmerksamkeit entgangen: Zu ${subject} konnten wir bisher keinen vollständigen Zahlungseingang feststellen.`;
  }
  return `trotz unserer bisherigen Erinnerung ist ${subject} noch nicht vollständig beglichen.`;
}

export const LETTER_CLOSING = "Mit freundlichen Grüßen";

/** "Zahlungserinnerung-R-2026-00002" / "1-Mahnung-R-2026-00002" — the PDF
 *  file name (server) and the print title (browser "Als PDF speichern"). */
export function reminderFileStem(label: string, stem: string): string {
  return `${label.replace(/[. ]+/g, "-").replace(/^-|-$/g, "")}-${stem}`;
}

/* Invoice sheet texts — identical on screen, in print and in the PDF. */

export const ENDRECHNUNG_NOTE =
  "Endrechnung: Die erhaltenen Anzahlungen sind samt der darin enthaltenen Umsatzsteuer abgesetzt (§ 14 Abs. 5 UStG). Die Steuer richtet sich nach den Leistungen, auf die die Anzahlungen angerechnet wurden.";

export function vatRateLabel(rate: number | null, invoice: Invoice): string {
  if (rate == null) {
    return invoice.lines.some((l) => l.durchlaufend) ? "ohne USt *" : "ohne USt";
  }
  return rate === 0 ? "0 % (steuerfrei)" : `${rate} %`;
}

export function prepaidVatLabel(row: { vatRate: number | null; vatCents: number }) {
  return row.vatRate && row.vatRate > 0
    ? `darin USt ${row.vatRate} %: ${euroText(row.vatCents)}`
    : row.vatRate === 0
      ? "darin steuerfreie Leistungen (0 %)"
      : "darin ohne USt (durchlaufende Posten)";
}

export function paymentSentence(invoice: Invoice, due: number): string {
  if (due <= 0)
    return "Der Rechnungsbetrag ist durch Ihre Anzahlungen bereits beglichen.";
  const target = invoice.issuer.iban
    ? ` auf das unten genannte Konto (IBAN ${invoice.issuer.iban})`
    : "";
  return `Bitte überweisen Sie ${euroText(due)} bis zum ${isoToGerman(invoice.dueDate)}${target} unter Angabe der Rechnungsnummer ${invoice.invoiceNr}.`;
}

export function invoiceFootnotes(invoice: Invoice): string[] {
  const notes: string[] = [];
  if (invoice.lines.some((l) => l.durchlaufend)) {
    notes.push(
      "* Durchlaufender Posten (§ 10 Abs. 1 UStG) — im Namen und für Rechnung des Fahrschülers verauslagt, keine Umsatzsteuer.",
    );
  }
  if (invoice.lines.some((l) => l.steuerfrei)) {
    notes.push("** Steuerfreie Leistung nach § 4 Nr. 21 UStG.");
  }
  if (invoice.lines.some((l) => l.vatRate == null && !l.durchlaufend)) {
    notes.push("*** Nicht steuerbar (kein Leistungsentgelt).");
  }
  return notes;
}
