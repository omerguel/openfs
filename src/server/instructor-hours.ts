/* ------------------------------------------------------------------ */
/* Instructor working-time report (Arbeitszeit).                       */
/*                                                                     */
/* Per instructor and day: practical minutes (Praktisch + Vorstellung   */
/* zur prakt. Prüfung), theory minutes (Theorie), other minutes         */
/* (Theorieprüfung, Andere) and their total. Cancelled Termine do not  */
/* count. Days above the Fahrlehrergesetz limit for practical          */
/* instruction are flagged.                                            */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import {
  MAX_PRACTICAL_MINUTES_PER_DAY,
  PRACTICAL_EVENT_TYPES,
} from "../lib/working-time";
import { type CalendarEvent, listCalendarEvents } from "./calendar-events";
import { ValidationError } from "./engine";
import { handle, json } from "./http";

export type InstructorDayHours = {
  date: string;
  practicalMinutes: number;
  theoryMinutes: number;
  otherMinutes: number;
  totalMinutes: number;
  /** practicalMinutes > MAX_PRACTICAL_MINUTES_PER_DAY */
  overLimit: boolean;
};

export type InstructorHours = {
  instructorId: number;
  instructor: string;
  days: InstructorDayHours[];
  practicalMinutes: number;
  theoryMinutes: number;
  otherMinutes: number;
  totalMinutes: number;
  overLimitDays: number;
};

export type InstructorHoursReport = {
  from: string;
  to: string;
  limitMinutes: number;
  instructors: InstructorHours[];
};

const minutesOf = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

/** Pure aggregation. `roster` lists instructors that should appear even
    without Termine (e.g. all active ones), in display order. */
export function aggregateInstructorHours(
  events: CalendarEvent[],
  roster: { id: number; name: string }[] = [],
): InstructorHours[] {
  const byInstructor = new Map<
    number,
    { name: string; days: Map<string, InstructorDayHours> }
  >();
  for (const member of roster) {
    byInstructor.set(member.id, { name: member.name, days: new Map() });
  }

  for (const event of events) {
    if (event.cancelledAt || event.instructorId == null) continue;
    let entry = byInstructor.get(event.instructorId);
    if (!entry) {
      entry = { name: event.instructor, days: new Map() };
      byInstructor.set(event.instructorId, entry);
    }
    let day = entry.days.get(event.date);
    if (!day) {
      day = {
        date: event.date,
        practicalMinutes: 0,
        theoryMinutes: 0,
        otherMinutes: 0,
        totalMinutes: 0,
        overLimit: false,
      };
      entry.days.set(event.date, day);
    }
    const minutes = Math.max(0, minutesOf(event.end) - minutesOf(event.start));
    if (PRACTICAL_EVENT_TYPES.includes(event.type)) day.practicalMinutes += minutes;
    else if (event.type === "Theorie") day.theoryMinutes += minutes;
    else day.otherMinutes += minutes;
    day.totalMinutes += minutes;
    day.overLimit = day.practicalMinutes > MAX_PRACTICAL_MINUTES_PER_DAY;
  }

  return [...byInstructor.entries()].map(([instructorId, entry]) => {
    const days = [...entry.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const sum = (
      key: "practicalMinutes" | "theoryMinutes" | "otherMinutes" | "totalMinutes",
    ) => days.reduce((total, day) => total + day[key], 0);
    return {
      instructorId,
      instructor: entry.name,
      days,
      practicalMinutes: sum("practicalMinutes"),
      theoryMinutes: sum("theoryMinutes"),
      otherMinutes: sum("otherMinutes"),
      totalMinutes: sum("totalMinutes"),
      overLimitDays: days.filter((day) => day.overLimit).length,
    };
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function instructorHoursReport(
  db: Database,
  from: string | undefined,
  to: string | undefined,
): InstructorHoursReport {
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new ValidationError("Bitte Zeitraum mit 'from' und 'to' (JJJJ-MM-TT) angeben.");
  }
  if (to < from) {
    throw new ValidationError("Das Enddatum darf nicht vor dem Startdatum liegen.");
  }
  const spanDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!(spanDays <= 366)) {
    throw new ValidationError("Der Zeitraum darf höchstens ein Jahr umfassen.");
  }
  const roster = db
    .query<{ id: number; name: string }, []>(
      `SELECT id, trim(first_name || ' ' || last_name) AS name FROM instructors
       WHERE status = 'aktiv' ORDER BY last_name, first_name`,
    )
    .all();
  return {
    from,
    to,
    limitMinutes: MAX_PRACTICAL_MINUTES_PER_DAY,
    instructors: aggregateInstructorHours(listCalendarEvents(db, { from, to }), roster),
  };
}

export function reportRoutes(db: Database) {
  return {
    "/api/reports/instructor-hours": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          return json(
            instructorHoursReport(
              db,
              params.get("from") ?? undefined,
              params.get("to") ?? undefined,
            ),
          );
        })(),
    },
  };
}
