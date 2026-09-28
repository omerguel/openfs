/* ------------------------------------------------------------------ */
/* Derived student facts — computed on read, never stored:             */
/*  - balance      from the ledger (Guthaben on 3272, per customer no.) */
/*  - last / next lesson from the calendar (cancelled Termine skipped)  */
/*  - lessons      Sonderfahrten minutes from tagged practical lessons  */
/*                 + attended Theorie-Einheiten                         */
/* These used to be hand-typed columns on `students` that silently     */
/* drifted from the real data; migrateDerivedStudentFields (db.ts)     */
/* dropped them.                                                       */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { Lesson } from "../lib/student-data";
import {
  computeSpecialDriveProgress,
  type SpecialDriveEvent,
} from "../lib/special-drives";
import { tableExists } from "./archive";
import { listStudentBalances } from "./engine";

export type StudentFacts = {
  balanceCents: number;
  /** "-85,00 EUR" — the display string the UI always showed. */
  balance: string;
  /** "08.06.2026, 16:00" or "Nicht geplant". */
  lastLesson: string;
  nextLesson: string;
  lessons: Lesson[];
};

export const NOT_PLANNED = "Nicht geplant";

const euro = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBalance(cents: number): string {
  return `${euro.format(cents / 100)} EUR`;
}

function formatSlot(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}, ${time}`;
}

function localNow(now: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

type EventRow = SpecialDriveEvent & { student_id: number; lesson_kind: string | null };

/** Facts for the given students, keyed by student id. */
export function deriveStudentFacts(
  db: Database,
  students: { id: number; customerNumber: string }[],
  now = new Date(),
): Map<number, StudentFacts> {
  const { date: today, time } = localNow(now);
  const balances = new Map(
    listStudentBalances(db).map((row) => [row.customerNo, row.balanceCents]),
  );

  const events = new Map<number, EventRow[]>();
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
    .all()
    .map((c) => c.name);
  const hasKind = cols.includes("lesson_kind");
  const hasCancelled = cols.includes("cancelled_at");
  for (const row of db
    .query<EventRow, []>(
      `SELECT student_id, type, date, start, "end",
              ${hasKind ? "lesson_kind" : "NULL"} AS lesson_kind,
              ${hasCancelled ? "cancelled_at" : "NULL"} AS cancelledAt
       FROM calendar_events
       WHERE student_id IS NOT NULL
       ORDER BY date, start`,
    )
    .all()) {
    const list = events.get(row.student_id) ?? [];
    list.push({ ...row, lessonKind: row.lesson_kind });
    events.set(row.student_id, list);
  }

  const theoryUnits = new Map<number, number>();
  if (tableExists(db, "theory_attendance")) {
    for (const row of db
      .query<{ student_id: number; n: number }, []>(
        `SELECT student_id, count(*) AS n FROM theory_attendance
         WHERE attended = 1 GROUP BY student_id`,
      )
      .all()) {
      theoryUnits.set(row.student_id, row.n);
    }
  }

  const facts = new Map<number, StudentFacts>();
  for (const student of students) {
    const own = (events.get(student.id) ?? []).filter((e) => !e.cancelledAt);
    const past = own.filter((e) => e.date < today || (e.date === today && e.end <= time));
    const upcoming = own.filter(
      (e) => e.date > today || (e.date === today && e.end > time),
    );
    const last = past.at(-1);
    const next = upcoming[0];
    const balanceCents = balances.get(student.customerNumber) ?? 0;
    const lessons: Lesson[] = computeSpecialDriveProgress(own, today).map((drive) => ({
      label: drive.kind,
      done: `${drive.completedMinutes}/${drive.requiredMinutes}min`,
    }));
    lessons.push({
      label: "Theorieunterricht",
      done: `${theoryUnits.get(student.id) ?? 0} Einheiten`,
    });
    facts.set(student.id, {
      balanceCents,
      balance: formatBalance(balanceCents),
      lastLesson: last ? formatSlot(last.date, last.start) : NOT_PLANNED,
      nextLesson: next ? formatSlot(next.date, next.start) : NOT_PLANNED,
      lessons,
    });
  }
  return facts;
}
