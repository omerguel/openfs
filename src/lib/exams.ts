/* ------------------------------------------------------------------ */
/* Prüfungsplaner — pure helpers                                       */
/*                                                                     */
/* Exam filtering/grouping over calendar events plus the readiness     */
/* ranking for the "Prüfungsreife" panel. No I/O — everything here is  */
/* unit-testable (see exams.test.ts) and shared with the               */
/* /pruefungsplaner view.                                              */
/* ------------------------------------------------------------------ */

import {
  addDays,
  parseISODate,
  startOfWeek,
  toISODate,
  toMinutes,
  type CalEvent,
  type EventType,
} from "@/lib/calendar-data";

/* The two calendar event types that represent exams. */
export const EXAM_EVENT_TYPES = [
  "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung",
] as const;

export type ExamEventType = (typeof EXAM_EVENT_TYPES)[number];

/* Display labels for the exam types (the practical exam's stored type
   is the long-winded "Vorstellung zur prakt. Prüfung"). */
export const examTypeLabel: Record<ExamEventType, string> = {
  Theorieprüfung: "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung": "Praktische Prüfung",
};

export const isExamEvent = (event: { type: EventType }): boolean =>
  (EXAM_EVENT_TYPES as readonly string[]).includes(event.type);

/* Exam events within [todayISO, todayISO + horizonDays], sorted by
   date then start time. */
export function upcomingExams(
  events: CalEvent[],
  todayISO: string,
  horizonDays = 60,
): CalEvent[] {
  const horizonISO = toISODate(addDays(parseISODate(todayISO), horizonDays));
  return events
    .filter(
      (event) => isExamEvent(event) && event.date >= todayISO && event.date <= horizonISO,
    )
    .toSorted(
      (a, b) => a.date.localeCompare(b.date) || toMinutes(a.start) - toMinutes(b.start),
    );
}

export type ExamDayGroup = { date: string; exams: CalEvent[] };

/* Groups an already sorted exam list into per-day buckets, keeping the
   chronological order of both days and entries. */
export function groupExamsByDate(exams: CalEvent[]): ExamDayGroup[] {
  const groups: ExamDayGroup[] = [];
  for (const exam of exams) {
    const last = groups[groups.length - 1];
    if (last && last.date === exam.date) {
      last.exams.push(exam);
    } else {
      groups.push({ date: exam.date, exams: [exam] });
    }
  }
  return groups;
}

/* Exams inside the calendar week (Mon–Sun) that contains todayISO. */
export function countExamsThisWeek(exams: CalEvent[], todayISO: string): number {
  const weekStart = startOfWeek(parseISODate(todayISO));
  const fromISO = toISODate(weekStart);
  const toISO = toISODate(addDays(weekStart, 6));
  return exams.filter((exam) => exam.date >= fromISO && exam.date <= toISO).length;
}

export type ExamStats = {
  theory: number;
  practical: number;
  thisWeek: number;
  tentative: number;
};

/* KPI numbers for the dashboard cards, derived from the (already
   filtered) upcoming exam list. */
export function examStats(exams: CalEvent[], todayISO: string): ExamStats {
  return {
    theory: exams.filter((exam) => exam.type === "Theorieprüfung").length,
    practical: exams.filter((exam) => exam.type === "Vorstellung zur prakt. Prüfung")
      .length,
    thisWeek: countExamsThisWeek(exams, todayISO),
    tentative: exams.filter((exam) => exam.tentative).length,
  };
}

/* ------------------------------------------------------------------ */
/* Prüfungsreife (exam readiness)                                      */
/* ------------------------------------------------------------------ */

/* Structural subset of Student (src/lib/student-data.ts) the ranking
   needs — keeps these helpers decoupled from the full record. */
export type ReadinessStudent = {
  status: "aktiv" | "inaktiv";
  progress: number;
  theory: { status: string; progress: number };
};

/* Active students sorted by practical progress (desc), theory progress
   as tie-breaker — the order the "Prüfungsreife" panel displays. */
export function rankByReadiness<T extends ReadinessStudent>(students: T[]): T[] {
  return students
    .filter((student) => student.status === "aktiv")
    .toSorted((a, b) => b.progress - a.progress || b.theory.progress - a.theory.progress);
}

/* Which exam type to suggest for a student: once the theory course is
   "Bereit" (or already past, "In Prüfung"), the practical exam is the
   next step — otherwise the theory exam comes first. */
export function suggestedExamType(student: ReadinessStudent): ExamEventType {
  return student.theory.status === "Bereit" || student.theory.status === "In Prüfung"
    ? "Vorstellung zur prakt. Prüfung"
    : "Theorieprüfung";
}

/* ------------------------------------------------------------------ */
/* Exam readiness per student — one consistent status                 */
/* ------------------------------------------------------------------ */

export type ReadinessEvent = Pick<
  CalEvent,
  "type" | "date" | "start" | "studentId" | "subtitle" | "examResult" | "cancelledAt"
>;

export type ReadinessProfile = ReadinessStudent & {
  id: number;
  firstName: string;
  lastName: string;
  licenseDate?: string;
  theory: ReadinessStudent["theory"] & { attendedUnits?: number; requiredUnits?: number };
};

export type ExamStage =
  | "bestanden"
  | "gebucht"
  | "theorie_bestanden"
  | "theorie_fertig"
  | "in_ausbildung";

export type ExamReadiness = {
  stage: ExamStage;
  /** Next booked exam without a result (from today on). */
  booked: { type: ExamEventType; date: string; start: string } | null;
  /** Exam to plan next; null when one is booked, all is passed or the
      theory course is not complete yet. */
  suggestion: ExamEventType | null;
  /** One status line that never contradicts the numbers. */
  status: string;
};

const germanDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

/** Where a student stands: exam results and bookings come from the
    calendar (the student's own exam Termine), the theory course from the
    attended Doppelstunden. A booked practical exam is never followed by
    a "Theorieprüfung planen" suggestion. */
export function examReadiness(
  student: ReadinessProfile,
  events: ReadinessEvent[],
  todayISO: string,
): ExamReadiness {
  const name = `${student.firstName} ${student.lastName}`.trim();
  const exams = events
    .filter(
      (event) =>
        isExamEvent(event) &&
        !event.cancelledAt &&
        (event.studentId != null
          ? event.studentId === student.id
          : event.subtitle === name),
    )
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const passed = (type: ExamEventType) =>
    exams.some((exam) => exam.type === type && exam.examResult === "bestanden");
  const theoryPassed = passed("Theorieprüfung");
  const practicalPassed =
    Boolean(student.licenseDate) || passed("Vorstellung zur prakt. Prüfung");
  const next = exams.find((exam) => exam.date >= todayISO && !exam.examResult);
  const booked = next
    ? { type: next.type as ExamEventType, date: next.date, start: next.start }
    : null;
  const attended = student.theory.attendedUnits;
  const required = student.theory.requiredUnits;
  const theoryComplete =
    student.theory.status === "Bereit" ||
    (attended !== undefined && required !== undefined && attended >= required);

  if (practicalPassed) {
    return {
      stage: "bestanden",
      booked: null,
      suggestion: null,
      status: "Prüfung bestanden",
    };
  }
  if (booked) {
    return {
      stage: "gebucht",
      booked,
      suggestion: null,
      status: `${examTypeLabel[booked.type]} am ${germanDate(booked.date)} gebucht`,
    };
  }
  if (theoryPassed) {
    return {
      stage: "theorie_bestanden",
      booked: null,
      suggestion: "Vorstellung zur prakt. Prüfung",
      status: "Theorieprüfung bestanden",
    };
  }
  if (theoryComplete) {
    return {
      stage: "theorie_fertig",
      booked: null,
      suggestion: "Theorieprüfung",
      status: "Theorieunterricht vollständig",
    };
  }
  return {
    stage: "in_ausbildung",
    booked: null,
    suggestion: null,
    status:
      attended !== undefined && required !== undefined
        ? `Theorie: ${attended} von ${required} Doppelstunden`
        : "Theorieunterricht noch nicht abgeschlossen",
  };
}

const STAGE_ORDER: Record<ExamStage, number> = {
  theorie_bestanden: 0,
  theorie_fertig: 1,
  gebucht: 2,
  in_ausbildung: 3,
  bestanden: 4,
};

/** Active students who still need an exam, the ones ready for the next
    step first (then by practical, then theory progress). */
export function rankForExamPlanning<T extends ReadinessProfile>(
  students: T[],
  events: ReadinessEvent[],
  todayISO: string,
): { student: T; readiness: ExamReadiness }[] {
  return students
    .filter((student) => student.status === "aktiv")
    .map((student) => ({ student, readiness: examReadiness(student, events, todayISO) }))
    .filter(({ readiness }) => readiness.stage !== "bestanden")
    .toSorted(
      (a, b) =>
        STAGE_ORDER[a.readiness.stage] - STAGE_ORDER[b.readiness.stage] ||
        b.student.progress - a.student.progress ||
        b.student.theory.progress - a.student.theory.progress,
    );
}
