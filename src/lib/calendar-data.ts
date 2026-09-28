/* ------------------------------------------------------------------ */
/* Calendar data — single source of truth                              */
/*                                                                     */
/* Shared event type, date helpers, and labels for the calendar UI.    */
/* Events are persisted in the DB and read through the                  */
/* use-calendar-events hook; this file holds the pure types/helpers     */
/* the dashboard, calendar, and Stunden tab share.                      */
/* ------------------------------------------------------------------ */

import type { CancellationKind } from "./cancellation";
import type { LessonKind } from "./special-drives";

export type EventType =
  | "Praktisch"
  | "Theorie"
  | "Vorstellung zur prakt. Prüfung"
  | "Theorieprüfung"
  | "Andere";

export type CalEvent = {
  id: string;
  date: string; // ISO calendar date, e.g. "2026-06-09"
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  location?: string;
  instructor: string;
  /** FK → instructors.id (null = unassigned); `instructor` is its display name. */
  instructorId?: number | null;
  vehicle?: string;
  /** FK → vehicles.id (null = none); `vehicle` is its display label. */
  vehicleId?: number | null;
  type: EventType;
  tentative?: boolean;
  /** FK → students.id; set when the event was created for a known student
      or back-filled by migration. Omitted when NULL. */
  studentId?: number;
  /** FK → transactions.id; set after billing via the /bill endpoint.
      Omitted when NULL. */
  billedTransactionId?: number;
  /** Derived by the server: true when billedTransactionId is set AND the
      linked transaction has not been storniert. Omitted when not billed. */
  billedActive?: boolean;
  /** Exam result — only present on exam-type events that have been graded. */
  examResult?: "bestanden" | "nicht_bestanden";
  /** Kind of practical drive (Sonderfahrt) — only on "Praktisch". */
  lessonKind?: LessonKind;
  /** Shared by all occurrences of one recurring series. */
  seriesId?: string;
  /** Set when the lesson was cancelled / the student did not show up.
      The event stays in the calendar as struck-through history. */
  cancelledAt?: string;
  cancellationKind?: CancellationKind;
  /** FK → transactions.id of the Ausfallentschädigung, if charged. */
  cancellationFeeTransactionId?: number;
  /** Derived: fee booked and not storniert. */
  cancellationFeeActive?: boolean;
  /** Non-blocking hints returned by create/update (never stored). */
  warnings?: string[];
};

/* Cancelled lessons stay visible but no longer count anywhere. */
export const isCancelled = (event: { cancelledAt?: string }) =>
  Boolean(event.cancelledAt);

/* The app's notion of "today" — drives week anchoring/highlighting.
   Events themselves are persisted in the DB (see use-calendar-events). */
export const TODAY = new Date();

export const eventTypeOptions: EventType[] = [
  "Praktisch",
  "Theorie",
  "Vorstellung zur prakt. Prüfung",
  "Theorieprüfung",
  "Andere",
];

/* Short, badge-friendly labels per event type. */
export const eventTypeShortLabel: Record<EventType, string> = {
  Praktisch: "Praxis",
  Theorie: "Theorie",
  "Vorstellung zur prakt. Prüfung": "Prüfung",
  Theorieprüfung: "TÜV",
  Andere: "Extra",
};

/* Quick-create presets shared by the "Ereignis" dropdown (click or
   drag onto the grid) and the edit dialog's Schnellauswahl row. */
export type EventPreset = {
  label: string;
  title: string;
  type: EventType;
  duration: number; // minutes
};

export const eventPresets: EventPreset[] = [
  { label: "Fahrstunde 45", title: "Fahrstunde", type: "Praktisch", duration: 45 },
  { label: "Fahrstunde 90", title: "Doppelstunde", type: "Praktisch", duration: 90 },
  { label: "Theorie 90", title: "Theorieunterricht", type: "Theorie", duration: 90 },
  {
    label: "Prüfung 45",
    title: "Praktische Prüfung",
    type: "Vorstellung zur prakt. Prüfung",
    duration: 45,
  },
];

/* A "Fahrstunde" is a regular practical driving lesson. Theory lessons,
   exams, exam prep and other appointments are NOT Fahrstunden. */
export const isFahrstunde = (event: { type: EventType }) => event.type === "Praktisch";

export const nonFahrstundeTypes = eventTypeOptions.filter(
  (type) => !isFahrstunde({ type }),
);

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

export const startOfWeek = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (result.getDay() + 6) % 7; // Monday = 0
  result.setDate(result.getDate() - day);
  return result;
};

export const addDays = (date: Date, amount: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
};

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const toISODate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export const parseISODate = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const toMinutes = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

/* Assign a reusable layer within each transitive overlap group. Layer counts
   are group-local: a busy morning must not offset unrelated afternoon cards. */
export function layoutDay(dayEvents: CalEvent[]) {
  const sorted = dayEvents.toSorted(
    (a, b) =>
      toMinutes(a.start) - toMinutes(b.start) ||
      toMinutes(b.end) - toMinutes(a.end) ||
      a.id.localeCompare(b.id),
  );
  const columnEnds: number[] = [];
  const placed: Array<{
    event: CalEvent;
    column: number;
    cluster: number;
    columns: number;
  }> = [];
  let cluster = -1;
  let clusterEnd = -1;
  let clusterStartIndex = 0;

  const finishCluster = () => {
    const columns = Math.max(1, columnEnds.length);
    for (let i = clusterStartIndex; i < placed.length; i += 1) {
      placed[i]!.columns = columns;
    }
  };

  for (const event of sorted) {
    const start = toMinutes(event.start);
    const end = toMinutes(event.end);

    if (start >= clusterEnd) {
      if (cluster >= 0) finishCluster();
      cluster += 1;
      clusterStartIndex = placed.length;
      clusterEnd = end;
      columnEnds.length = 0;
    } else {
      clusterEnd = Math.max(clusterEnd, end);
    }

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    placed.push({ event, column, cluster, columns: 1 });
  }

  if (cluster >= 0) finishCluster();
  const columns = Math.max(1, ...placed.map((item) => item.columns));
  return { placed, columns };
}

/* One pass over the (already filtered) events instead of one filter per
   day column + one per day header. Keys are the events' own ISO dates. */
export function groupEventsByDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const byDay = new Map<string, CalEvent[]>();
  for (const event of events) {
    const list = byDay.get(event.date);
    if (list) list.push(event);
    else byDay.set(event.date, [event]);
  }
  return byDay;
}
