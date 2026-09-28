/* ------------------------------------------------------------------ */
/* Statistik — read-only aggregations over the existing tables.        */
/* No new tables, no writes: students, instructors, vehicles,          */
/* calendar_events, accounts, transactions and bookings are queried    */
/* as-is. The HTTP wrapper (statisticsRoutes) lives at the bottom and  */
/* is mounted into Bun.serve() in src/index.ts like the factories in   */
/* routes.ts.                                                          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { instructorNameSql } from "./refs";
import { handle, json } from "./http";

/* ------------------------------- types ----------------------------- */

export type MonthCount = {
  /** ISO month "YYYY-MM". */
  month: string;
  count: number;
};

export type StudentStatistics = {
  total: number;
  aktiv: number;
  inaktiv: number;
  registrationsPerMonth: MonthCount[];
};

export type LessonTypeCount = {
  type: string;
  count: number;
};

export type LessonsPerMonth = {
  /** ISO month "YYYY-MM". */
  month: string;
  praktisch: number;
  theorie: number;
  pruefung: number;
  andere: number;
  total: number;
};

export type LessonStatistics = {
  total: number;
  byType: LessonTypeCount[];
  perMonth: LessonsPerMonth[];
};

export type InstructorUtilization = {
  instructor: string;
  events: number;
  minutes: number;
};

export type InstructorStatistics = {
  total: number;
  aktiv: number;
  utilization: InstructorUtilization[];
};

export type VehicleStatistics = {
  total: number;
  aktiv: number;
  wartung: number;
};

export type RevenuePerMonth = {
  /** ISO month "YYYY-MM". */
  month: string;
  cents: number;
};

export type RevenueStatistics = {
  totalCents: number;
  perMonth: RevenuePerMonth[];
};

export type ExamTypeStatistics = {
  /** Event type label. */
  type: string;
  total: number;
  bestanden: number;
  nicht_bestanden: number;
  /** Offen = recorded but no result yet (NULL exam_result). */
  offen: number;
  /** First-attempt pass rate 0–1; null if no first-attempt data exists.
      First attempt = chronologically first exam event of this type for a
      given student_id that has a recorded result. Events without a
      student_id are excluded from this rate (counted in totals only). */
  firstAttemptPassRate: number | null;
};

export type ExamStatistics = {
  byType: ExamTypeStatistics[];
};

export type Statistics = {
  students: StudentStatistics;
  lessons: LessonStatistics;
  instructors: InstructorStatistics;
  vehicles: VehicleStatistics;
  revenue: RevenueStatistics;
  exams: ExamStatistics;
};

/* ------------------------------ students --------------------------- */

/* registration_date is free text in the schema — seeds use the German
   "DD.MM.YYYY" form, ISO "YYYY-MM-DD" also occurs. Normalize both to
   "YYYY-MM"; anything else (incl. empty) is skipped. */
export function registrationMonth(raw: string): string | null {
  const value = raw.trim();
  const german = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (german) return `${german[3]}-${german[2]}`;
  const iso = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

/* "YYYY-MM" → next "YYYY-MM". */
function nextMonth(month: string): string {
  const [y = 0, m = 0] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/* Every month from the first registration up to `until` (or the last
   registration, if later), with 0 for months without signups — so the
   chart has no silent gaps and the Ø per month is honest. */
export function fillMonths(perMonth: Map<string, number>, until: string): MonthCount[] {
  const months = [...perMonth.keys()].sort();
  const first = months[0];
  if (!first) return [];
  const last = months.at(-1)! > until ? months.at(-1)! : until;
  const out: MonthCount[] = [];
  // Hard cap guards against absurd dates (e.g. year 1900) blowing up the list.
  for (let month = first; month <= last && out.length < 600; month = nextMonth(month)) {
    out.push({ month, count: perMonth.get(month) ?? 0 });
  }
  return out;
}

const isoMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export function studentStatistics(db: Database, now = new Date()): StudentStatistics {
  const rows = db
    .query<{ status: string; registration_date: string }, []>(
      "SELECT status, registration_date FROM students",
    )
    .all();

  const perMonth = new Map<string, number>();
  let aktiv = 0;
  for (const row of rows) {
    if (row.status === "aktiv") aktiv += 1;
    const month = registrationMonth(row.registration_date);
    if (month) perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }

  return {
    total: rows.length,
    aktiv,
    inaktiv: rows.length - aktiv,
    registrationsPerMonth: fillMonths(perMonth, isoMonth(now)),
  };
}

/* ------------------------------ lessons ---------------------------- */

/* Stacked-chart buckets for the five event types. Both exam types land
   in "pruefung" so the chart stays readable. */
const LESSON_BUCKETS: Record<string, keyof Omit<LessonsPerMonth, "month" | "total">> = {
  Praktisch: "praktisch",
  Theorie: "theorie",
  "Vorstellung zur prakt. Prüfung": "pruefung",
  Theorieprüfung: "pruefung",
  Andere: "andere",
};

export function lessonStatistics(db: Database): LessonStatistics {
  const rows = db
    .query<{ month: string; type: string; count: number }, []>(
      `SELECT substr(date, 1, 7) AS month, type, count(*) AS count
       FROM calendar_events
       WHERE cancelled_at IS NULL
       GROUP BY month, type
       ORDER BY month`,
    )
    .all();

  const byType = new Map<string, number>();
  const perMonth = new Map<string, LessonsPerMonth>();
  let total = 0;

  for (const row of rows) {
    total += row.count;
    byType.set(row.type, (byType.get(row.type) ?? 0) + row.count);

    let bucket = perMonth.get(row.month);
    if (!bucket) {
      bucket = {
        month: row.month,
        praktisch: 0,
        theorie: 0,
        pruefung: 0,
        andere: 0,
        total: 0,
      };
      perMonth.set(row.month, bucket);
    }
    bucket[LESSON_BUCKETS[row.type] ?? "andere"] += row.count;
    bucket.total += row.count;
  }

  return {
    total,
    byType: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "de")),
    perMonth: [...perMonth.values()],
  };
}

/* ---------------------------- instructors -------------------------- */

export function instructorStatistics(db: Database): InstructorStatistics {
  const counts = db
    .query<{ total: number; aktiv: number }, []>(
      `SELECT count(*) AS total,
              sum(CASE WHEN status = 'aktiv' THEN 1 ELSE 0 END) AS aktiv
       FROM instructors`,
    )
    .get()!;

  /* start/end are fixed "HH:MM" strings (validated on write), so the
     duration arithmetic is safe inline. */
  const utilization = db
    .query<InstructorUtilization, []>(
      `SELECT ${instructorNameSql("ce")} AS instructor,
              count(*) AS events,
              sum(
                (CAST(substr(ce."end", 1, 2) AS INTEGER) * 60 + CAST(substr(ce."end", 4, 2) AS INTEGER))
                - (CAST(substr(ce.start, 1, 2) AS INTEGER) * 60 + CAST(substr(ce.start, 4, 2) AS INTEGER))
              ) AS minutes
       FROM calendar_events ce
       WHERE ce.cancelled_at IS NULL
       GROUP BY ce.instructor_id
       ORDER BY minutes DESC, instructor`,
    )
    .all();

  return {
    total: counts.total,
    aktiv: counts.aktiv ?? 0,
    utilization,
  };
}

/* ------------------------------ vehicles --------------------------- */

export function vehicleStatistics(db: Database): VehicleStatistics {
  const row = db
    .query<{ total: number; aktiv: number }, []>(
      `SELECT count(*) AS total,
              sum(CASE WHEN status = 'aktiv' THEN 1 ELSE 0 END) AS aktiv
       FROM vehicles`,
    )
    .get()!;
  const aktiv = row.aktiv ?? 0;
  return { total: row.total, aktiv, wartung: row.total - aktiv };
}

/* ------------------------------ revenue ---------------------------- */

/* Umsatz = booking lines credited (Haben) to an Erlöskonto. Storno
   pairs cancel out by definition, so both the reversal transaction
   (storno_of) and the reversed original (storniert_by) are excluded —
   what remains is the active revenue ledger. */
export function revenueStatistics(db: Database): RevenueStatistics {
  const perMonth = db
    .query<RevenuePerMonth, []>(
      `SELECT substr(t.date, 1, 7) AS month, sum(b.amount_cents) AS cents
       FROM bookings b
       JOIN transactions t ON t.id = b.transaction_id
       JOIN accounts a ON a.number = b.haben_account
       WHERE a.kind = 'erloes'
         AND t.storno_of IS NULL
         AND t.storniert_by IS NULL
       GROUP BY month
       ORDER BY month`,
    )
    .all();

  return {
    totalCents: perMonth.reduce((sum, row) => sum + row.cents, 0),
    perMonth,
  };
}

/* ------------------------------- exams ----------------------------- */

const EXAM_EVENT_TYPES = ["Theorieprüfung", "Vorstellung zur prakt. Prüfung"] as const;

export function examStatistics(db: Database): ExamStatistics {
  const byType: ExamTypeStatistics[] = EXAM_EVENT_TYPES.map((type) => {
    // Totals row: all events of this type regardless of student_id or result.
    const totals = db
      .query<{ total: number; bestanden: number; nicht_bestanden: number }, [string]>(
        `SELECT
           count(*) AS total,
           coalesce(sum(CASE WHEN exam_result = 'bestanden' THEN 1 ELSE 0 END), 0) AS bestanden,
           coalesce(sum(CASE WHEN exam_result = 'nicht_bestanden' THEN 1 ELSE 0 END), 0) AS nicht_bestanden
         FROM calendar_events
         WHERE type = ? AND cancelled_at IS NULL`,
      )
      .get(type)!;

    const offen = totals.total - totals.bestanden - totals.nicht_bestanden;

    // First-attempt pass rate: only events with a student_id AND an
    // exam_result. The "first attempt" per student is the event with the
    // lowest date (then id) that has a recorded result.
    const firstAttemptRows = db
      .query<{ student_id: number; exam_result: string }, [string]>(
        `SELECT student_id, exam_result FROM (
           SELECT student_id, exam_result,
                  ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY date, id) AS rn
           FROM calendar_events
           WHERE type = ?
             AND student_id IS NOT NULL
             AND exam_result IS NOT NULL
         ) WHERE rn = 1`,
      )
      .all(type);

    let firstAttemptPassRate: number | null = null;
    if (firstAttemptRows.length > 0) {
      const passed = firstAttemptRows.filter((r) => r.exam_result === "bestanden").length;
      firstAttemptPassRate = passed / firstAttemptRows.length;
    }

    return {
      type,
      total: totals.total,
      bestanden: totals.bestanden,
      nicht_bestanden: totals.nicht_bestanden,
      offen,
      firstAttemptPassRate,
    };
  });

  return { byType };
}

/* ------------------------------ payload ---------------------------- */

export function getStatistics(db: Database): Statistics {
  return {
    students: studentStatistics(db),
    lessons: lessonStatistics(db),
    instructors: instructorStatistics(db),
    vehicles: vehicleStatistics(db),
    revenue: revenueStatistics(db),
    exams: examStatistics(db),
  };
}

/* ------------------------------- HTTP ------------------------------ */

export function statisticsRoutes(db: Database) {
  return {
    "/api/statistics": {
      GET: (req: BunRequest) => handle(() => json(getStatistics(db)))(),
    },
  };
}
