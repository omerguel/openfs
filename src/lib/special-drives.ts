/* ------------------------------------------------------------------ */
/* Lesson kinds (Sonderfahrten) — shared by server validation and UI.  */
/*                                                                     */
/* A practical lesson ("Praktisch") can be tagged with the kind of     */
/* drive. The special drives (Überland, Autobahn, Nacht) have legal    */
/* minimums for class B (Anlage 4 FahrschAusbO): 5, 4 and 3 lessons    */
/* of 45 minutes each.                                                 */
/* ------------------------------------------------------------------ */

export const LESSON_KINDS = [
  "Übungsfahrt",
  "Überlandfahrt",
  "Autobahnfahrt",
  "Nachtfahrt",
  "Grundfahraufgaben",
] as const;

export type LessonKind = (typeof LESSON_KINDS)[number];

export const isLessonKind = (value: unknown): value is LessonKind =>
  typeof value === "string" && (LESSON_KINDS as readonly string[]).includes(value);

export type SpecialDriveKind = "Überlandfahrt" | "Autobahnfahrt" | "Nachtfahrt";

/** Legal minimums for class B, in minutes (lessons × 45 min). */
export const SPECIAL_DRIVE_REQUIREMENTS_B: Record<SpecialDriveKind, number> = {
  Überlandfahrt: 5 * 45,
  Autobahnfahrt: 4 * 45,
  Nachtfahrt: 3 * 45,
};

export type SpecialDriveProgress = {
  kind: SpecialDriveKind;
  requiredMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  done: boolean;
};

/* The subset of an event the helper reads — CalEvent and the server's
   CalendarEvent both satisfy it. */
export type SpecialDriveEvent = {
  type: string;
  date: string;
  start: string;
  end: string;
  lessonKind?: string | null;
  cancelledAt?: string | null;
};

const minutesOf = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

/** Completed special-drive minutes vs. the class-B minimums. Counts only
    non-cancelled practical lessons of that kind dated today or earlier.
    `today` is an ISO date ("YYYY-MM-DD"). */
export function computeSpecialDriveProgress(
  events: SpecialDriveEvent[],
  today: string,
): SpecialDriveProgress[] {
  const completed: Record<SpecialDriveKind, number> = {
    Überlandfahrt: 0,
    Autobahnfahrt: 0,
    Nachtfahrt: 0,
  };
  for (const event of events) {
    if (event.type !== "Praktisch" || event.cancelledAt) continue;
    if (event.date > today) continue;
    const kind = event.lessonKind;
    if (kind !== "Überlandfahrt" && kind !== "Autobahnfahrt" && kind !== "Nachtfahrt") {
      continue;
    }
    completed[kind] += Math.max(0, minutesOf(event.end) - minutesOf(event.start));
  }
  return (Object.keys(SPECIAL_DRIVE_REQUIREMENTS_B) as SpecialDriveKind[]).map((kind) => {
    const requiredMinutes = SPECIAL_DRIVE_REQUIREMENTS_B[kind];
    const completedMinutes = completed[kind];
    return {
      kind,
      requiredMinutes,
      completedMinutes,
      remainingMinutes: Math.max(0, requiredMinutes - completedMinutes),
      done: completedMinutes >= requiredMinutes,
    };
  });
}
