/* Why a student was archived (stored with the archive snapshot). */

export const ARCHIVE_REASONS: { value: string; label: string }[] = [
  { value: "abgeschlossen", label: "Ausbildung abgeschlossen" },
  { value: "abgebrochen", label: "Ausbildung abgebrochen" },
  { value: "wechsel", label: "Wechsel zu anderer Fahrschule" },
  { value: "sonstiges", label: "Sonstiges" },
];

export function archiveReasonLabel(value: string): string {
  return ARCHIVE_REASONS.find((reason) => reason.value === value)?.label ?? value;
}
