/* ------------------------------------------------------------------ */
/* Recurring lessons (Serientermine).                                  */
/*                                                                     */
/* A series is not a stored rule — POST creates every occurrence as a  */
/* plain Termin sharing a series_id, atomically: one conflict or        */
/* absence rolls the whole series back. Deleting "from a date on"      */
/* reuses the single-delete guards and skips billed/attested/charged   */
/* occurrences instead of failing.                                     */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { formatGermanDate } from "../lib/working-time";
import {
  type CalendarEvent,
  type CalendarEventInput,
  createCalendarEvent,
  deleteBlockReason,
  deleteCalendarEvent,
  getCalendarEvent,
} from "./calendar-events";
import { ValidationError } from "./engine";
import { handle, json } from "./http";

export type SeriesRepeat = {
  interval: "weekly" | "biweekly";
  /** Number of occurrences including the first (2–52). */
  count?: number;
  /** Last possible date (inclusive), at most one year after the first. */
  until?: string;
};

export type SeriesInput = Partial<CalendarEventInput> & { repeat?: SeriesRepeat };

export type SeriesResult = {
  seriesId: string;
  events: CalendarEvent[];
  warnings?: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COUNT = 52;

const parseUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const addDaysIso = (iso: string, days: number) => {
  const date = parseUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
};

function isValidIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    !Number.isNaN(parseUtc(value).getTime()) &&
    toIso(parseUtc(value)) === value
  );
}

/** Occurrence dates for a series starting at `first`. Pure. */
export function seriesDates(first: string, repeat: unknown): string[] {
  if (!isValidIsoDate(first)) {
    throw new ValidationError("Feld 'date' muss ein ISO-Datum sein.");
  }
  if (!repeat || typeof repeat !== "object") {
    throw new ValidationError("Feld 'repeat' fehlt.");
  }
  const { interval, count, until } = repeat as SeriesRepeat;
  if (interval !== "weekly" && interval !== "biweekly") {
    throw new ValidationError("Intervall muss 'weekly' oder 'biweekly' sein.");
  }
  const step = interval === "weekly" ? 7 : 14;
  if ((count === undefined) === (until === undefined)) {
    throw new ValidationError("Bitte entweder Anzahl oder Enddatum angeben.");
  }

  if (count !== undefined) {
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 2 ||
      count > MAX_COUNT
    ) {
      throw new ValidationError(`Anzahl muss zwischen 2 und ${MAX_COUNT} liegen.`);
    }
    return Array.from({ length: count }, (_, i) => addDaysIso(first, i * step));
  }

  if (!isValidIsoDate(until)) {
    throw new ValidationError("Enddatum muss ein ISO-Datum sein.");
  }
  const limit = parseUtc(first);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  const oneYear = toIso(limit);
  if (until > oneYear) {
    throw new ValidationError(
      "Enddatum darf höchstens ein Jahr nach dem ersten Termin liegen.",
    );
  }
  const dates: string[] = [];
  for (let date = first; date <= until; date = addDaysIso(date, step)) {
    dates.push(date);
  }
  if (dates.length < 2) {
    throw new ValidationError("Eine Serie umfasst mindestens zwei Termine.");
  }
  return dates;
}

/** Create all occurrences in one transaction with a shared series id. */
export function createCalendarEventSeries(
  db: Database,
  input: SeriesInput,
): SeriesResult {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const { repeat, ...event } = input;
  const dates = seriesDates(event.date as string, repeat);
  const seriesId = crypto.randomUUID();

  const run = db.transaction(() =>
    dates.map((date) => {
      try {
        return createCalendarEvent(db, { ...event, date }, { seriesId });
      } catch (error) {
        // Name the failing occurrence — the first date is in the dialog,
        // the others are not.
        if (error instanceof ValidationError && date !== dates[0]) {
          throw new ValidationError(
            `Termin am ${formatGermanDate(date)}: ${error.message}`,
          );
        }
        throw error;
      }
    }),
  );
  const events = run();
  const warnings = events.flatMap((created) => created.warnings ?? []);
  return warnings.length ? { seriesId, events, warnings } : { seriesId, events };
}

/** Delete the occurrences dated on/after `from` (all when omitted).
    Occurrences a single delete would refuse are skipped and counted. */
export function deleteCalendarEventSeries(
  db: Database,
  seriesId: string,
  from?: string,
): { deleted: number; skipped: number } {
  if (from !== undefined && !isValidIsoDate(from)) {
    throw new ValidationError("Feld 'from' muss ein ISO-Datum sein.");
  }
  const members = db
    .query<{ id: number; date: string }, [string]>(
      "SELECT id, date FROM calendar_events WHERE series_id = ? ORDER BY date, start",
    )
    .all(seriesId);
  if (members.length === 0) throw new ValidationError("Serie nicht gefunden.");

  let deleted = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const member of members) {
      if (from && member.date < from) continue;
      if (deleteBlockReason(db, getCalendarEvent(db, member.id))) {
        skipped += 1;
        continue;
      }
      deleteCalendarEvent(db, member.id);
      deleted += 1;
    }
  });
  run();
  return { deleted, skipped };
}

export function calendarSeriesRoutes(db: Database) {
  return {
    "/api/calendar-events/series": {
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createCalendarEventSeries(db, (await req.json()) as SeriesInput), 201),
        )(),
    },

    "/api/calendar-events/series/:seriesId": {
      DELETE: (req: BunRequest<"/api/calendar-events/series/:seriesId">) =>
        handle(() => {
          const from = new URL(req.url).searchParams.get("from") ?? undefined;
          return json(deleteCalendarEventSeries(db, req.params.seriesId, from));
        })(),
    },
  };
}
