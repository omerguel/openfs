/* ------------------------------------------------------------------ */
/* Theorie-Lektionen — what was taught in one Doppelstunde.            */
/*                                                                     */
/* Attendance is recorded per session together with the lesson:       */
/* "Grundstoff 1" … "Grundstoff 12" and the class-specific             */
/* "Zusatzstoff 1" … "Zusatzstoff n". Calendar Termine are usually     */
/* titled "Thema 9: …" with Themen numbered straight through, so       */
/* Thema 13 is Zusatzstoff 1.                                          */
/* ------------------------------------------------------------------ */

import { THEORY_CLASS_SPECIFIC_UNITS, THEORY_GRUNDSTOFF_UNITS } from "./theory";

/** Lesson labels for a group's class ("B" → Grundstoff 1–12, Zusatzstoff 1–2). */
export function theoryLessonOptions(klass = "B"): string[] {
  const key = klass.trim().toUpperCase();
  const extra =
    THEORY_CLASS_SPECIFIC_UNITS[key === "B197" || key === "BF17" ? "B" : key] ??
    THEORY_CLASS_SPECIFIC_UNITS.B!;
  return [
    ...Array.from({ length: THEORY_GRUNDSTOFF_UNITS }, (_, i) => `Grundstoff ${i + 1}`),
    ...Array.from({ length: extra }, (_, i) => `Zusatzstoff ${i + 1}`),
  ];
}

/** Lesson label from a Termin title — "Thema 9: Ruhender Verkehr" →
    "Grundstoff 9", "Thema 13 …" → "Zusatzstoff 1", "Zusatzstoff 2 …"
    unchanged. null when the title names no lesson. */
export function theoryLessonFromTitle(title: string): string | null {
  const direct = /\b(Grundstoff|Zusatzstoff)\s*(\d{1,2})\b/i.exec(title);
  if (direct) {
    const kind = direct[1]!.toLowerCase() === "grundstoff" ? "Grundstoff" : "Zusatzstoff";
    return `${kind} ${Number(direct[2])}`;
  }
  const thema = /\b(?:Thema|Lektion)\s*(\d{1,2})\b/i.exec(title);
  if (!thema) return null;
  const number = Number(thema[1]);
  if (number < 1) return null;
  return number <= THEORY_GRUNDSTOFF_UNITS
    ? `Grundstoff ${number}`
    : `Zusatzstoff ${number - THEORY_GRUNDSTOFF_UNITS}`;
}
