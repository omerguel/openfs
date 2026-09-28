/* ------------------------------------------------------------------ */
/* What an absence (Urlaub, Krank, …) does to already booked Termine.  */
/*                                                                     */
/* An absence entered after lessons were booked does not touch them    */
/* by itself. The office sees the affected lessons right away and can  */
/* hand them to a colleague (re-checked like a move) or cancel them    */
/* without a fee — the school cancelled, not the student.              */
/* Separate from absences.ts because calendar-events.ts imports that   */
/* module (absence check) and this one needs calendar-events.          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import {
  type CalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "./calendar-events";
import { cancelCalendarEvent } from "./cancellations";
import { ValidationError } from "./engine";
import { handle, json } from "./http";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LessonActionFailure = {
  id: string;
  title: string;
  date: string;
  start: string;
  reason: string;
};

export type LessonActionResult = {
  done: CalendarEvent[];
  failed: LessonActionFailure[];
};

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${label} muss eine positive ganze Zahl sein.`);
  }
  return value;
}

function requireEventIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("Bitte mindestens einen Termin auswählen.");
  }
  if (value.length > 500) {
    throw new ValidationError("Höchstens 500 Termine auf einmal.");
  }
  return value.map((id) => requirePositiveInt(Number(id), "Termin-ID"));
}

/** Non-cancelled Termine of the instructor in [from, to] (inclusive). */
export function lessonsAffectedByAbsence(
  db: Database,
  filter: { instructorId: number; from: string; to: string },
): CalendarEvent[] {
  const instructorId = requirePositiveInt(filter.instructorId, "Fahrlehrer-ID");
  for (const value of [filter.from, filter.to]) {
    if (typeof value !== "string" || !ISO_DATE.test(value)) {
      throw new ValidationError("Zeitraum muss aus ISO-Daten (JJJJ-MM-TT) bestehen.");
    }
  }
  if (filter.to < filter.from) {
    throw new ValidationError("Bis-Datum darf nicht vor dem Von-Datum liegen.");
  }
  return listCalendarEvents(db, { from: filter.from, to: filter.to }).filter(
    (event) => event.instructorId === instructorId && !event.cancelledAt,
  );
}

/* Each lesson is handled on its own: one lesson that cannot move (the
   colleague is busy, the lesson is billed) must not block the others. */
function forEachLesson(
  db: Database,
  ids: number[],
  action: (event: CalendarEvent) => CalendarEvent,
): LessonActionResult {
  const done: CalendarEvent[] = [];
  const failed: LessonActionFailure[] = [];
  for (const id of ids) {
    const event = getCalendarEvent(db, id);
    try {
      done.push(action(event));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      failed.push({
        id: event.id,
        title: event.title,
        date: event.date,
        start: event.start,
        reason: error.message,
      });
    }
  }
  return { done, failed };
}

/** Hand the lessons to another instructor. The new slot owner is checked
    like any move (absence, overlap, vehicle) — no override here. */
export function reassignLessons(
  db: Database,
  input: { eventIds?: unknown; instructorId?: unknown },
): LessonActionResult {
  if (!input || typeof input !== "object")
    throw new ValidationError("Ungültige Anfrage.");
  const ids = requireEventIds(input.eventIds);
  const instructorId = requirePositiveInt(input.instructorId, "Fahrlehrer-ID");
  if (!db.query("SELECT 1 FROM instructors WHERE id = ?").get(instructorId)) {
    throw new ValidationError(`Fahrlehrer/in mit ID ${instructorId} nicht gefunden.`);
  }
  return forEachLesson(db, ids, (event) => {
    if (event.cancelledAt) throw new ValidationError("Termin ist abgesagt.");
    return updateCalendarEvent(db, Number(event.id), { instructorId });
  });
}

/** Cancel the lessons on the school's behalf — never with a fee. */
export function cancelLessonsWithoutFee(
  db: Database,
  input: { eventIds?: unknown },
): LessonActionResult {
  if (!input || typeof input !== "object")
    throw new ValidationError("Ungültige Anfrage.");
  const ids = requireEventIds(input.eventIds);
  return forEachLesson(
    db,
    ids,
    (event) =>
      cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt", chargeFee: false })
        .event,
  );
}

export function absenceImpactRoutes(db: Database) {
  return {
    "/api/absences/affected": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          return json({
            events: lessonsAffectedByAbsence(db, {
              instructorId: Number(params.get("instructorId")),
              from: params.get("from") ?? "",
              to: params.get("to") ?? params.get("from") ?? "",
            }),
          });
        })(),
    },
    "/api/absences/reassign": {
      POST: (req: BunRequest) =>
        handle(async () => json(reassignLessons(db, await req.json())))(),
    },
    "/api/absences/cancel-lessons": {
      POST: (req: BunRequest) =>
        handle(async () => json(cancelLessonsWithoutFee(db, await req.json())))(),
    },
  };
}
