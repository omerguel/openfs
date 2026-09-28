/* ------------------------------------------------------------------ */
/* Existing scheduling conflicts in a date range.                      */
/*                                                                     */
/* New writes are checked in calendar-events.ts (checkScheduling);     */
/* this report finds what is already in the calendar — legacy data,    */
/* confirmed "Trotzdem speichern" overlaps, and Termine that an        */
/* absence entered later now collides with. Cancelled Termine never    */
/* conflict.                                                           */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { type Absence, listAbsences } from "./absences";
import { type CalendarEvent, listCalendarEvents } from "./calendar-events";
import { ValidationError } from "./engine";
import { handle, json } from "./http";

export type OverlapConflict = {
  resource: "instructor" | "vehicle";
  /** Display name of the shared instructor / vehicle. */
  label: string;
  first: CalendarEvent;
  second: CalendarEvent;
};

export type AbsenceConflict = { event: CalendarEvent; absence: Absence };

export type SchedulingConflicts = {
  overlaps: OverlapConflict[];
  absences: AbsenceConflict[];
  count: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: overlapping pairs among the given (same-day grouped) events. */
export function findOverlaps(events: CalendarEvent[]): OverlapConflict[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (event.cancelledAt) continue;
    const list = byDay.get(event.date);
    if (list) list.push(event);
    else byDay.set(event.date, [event]);
  }
  const overlaps: OverlapConflict[] = [];
  for (const day of byDay.values()) {
    day.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    for (let i = 0; i < day.length; i++) {
      const first = day[i]!;
      for (let j = i + 1; j < day.length; j++) {
        const second = day[j]!;
        if (second.start >= first.end) break; // sorted by start
        if (first.instructorId != null && first.instructorId === second.instructorId) {
          overlaps.push({
            resource: "instructor",
            label: first.instructor,
            first,
            second,
          });
        }
        if (first.vehicleId != null && first.vehicleId === second.vehicleId) {
          overlaps.push({
            resource: "vehicle",
            label: first.vehicle ?? "",
            first,
            second,
          });
        }
      }
    }
  }
  return overlaps;
}

export function listSchedulingConflicts(
  db: Database,
  range: { from?: string; to?: string },
): SchedulingConflicts {
  for (const value of [range.from, range.to]) {
    if (value !== undefined && !ISO_DATE.test(value)) {
      throw new ValidationError("Zeitraum muss aus ISO-Daten (JJJJ-MM-TT) bestehen.");
    }
  }
  const events = listCalendarEvents(db, range);
  const overlaps = findOverlaps(events);

  const absenceList = listAbsences(db, range);
  const absences: AbsenceConflict[] = [];
  for (const event of events) {
    if (event.cancelledAt || event.instructorId == null) continue;
    const absence = absenceList.find(
      (candidate) =>
        candidate.instructorId === event.instructorId &&
        candidate.fromDate <= event.date &&
        candidate.toDate >= event.date,
    );
    if (absence) absences.push({ event, absence });
  }
  return { overlaps, absences, count: overlaps.length + absences.length };
}

export function calendarConflictRoutes(db: Database) {
  return {
    "/api/calendar-events/conflicts": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          return json(
            listSchedulingConflicts(db, {
              from: params.get("from") ?? undefined,
              to: params.get("to") ?? undefined,
            }),
          );
        })(),
    },
  };
}
