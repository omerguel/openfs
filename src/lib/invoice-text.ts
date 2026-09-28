/* ------------------------------------------------------------------ */
/* Position texts for Rechnungen. Charges are booked with a Buchungs-  */
/* text meant for the journal ("FS Aylin Demir - B197, Fahrübungs-     */
/* stunde (90)"); on an invoice the recipient is already in the        */
/* address block and the duration code reads like noise. New invoices */
/* store the cleaned text ("Fahrübungsstunde 90 Min."); issued ones    */
/* keep what they were issued with (GoBD).                             */
/* ------------------------------------------------------------------ */

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
