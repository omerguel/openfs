/* ------------------------------------------------------------------ */
/* Calendar events (Termine) — DB access + validation.                 */
/* The HTTP wrappers live in routes.ts (calendarEventRoutes).          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { CancellationKind } from "../lib/cancellation";
import { isLessonKind, type LessonKind } from "../lib/special-drives";
import {
  formatGermanDate,
  MAX_PRACTICAL_MINUTES_PER_DAY,
  PRACTICAL_EVENT_TYPES,
} from "../lib/working-time";
import { findAbsence } from "./absences";
import { archiveRow, tableExists } from "./archive";
import { currentUser } from "./request-context";

import { ValidationError } from "./engine";
import {
  instructorNameSql,
  resolveInstructorId,
  resolveVehicleId,
  vehicleNameSql,
} from "./refs";

export type { CancellationKind };

export type CalendarEventType =
  | "Praktisch"
  | "Theorie"
  | "Vorstellung zur prakt. Prüfung"
  | "Theorieprüfung"
  | "Andere";

const EVENT_TYPES: CalendarEventType[] = [
  "Praktisch",
  "Theorie",
  "Vorstellung zur prakt. Prüfung",
  "Theorieprüfung",
  "Andere",
];

/* The wire shape matches CalEvent in src/lib/calendar-data.ts: id is a
   string, and the optional fields are omitted when empty/false/null. */
export type CalendarEvent = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  location?: string;
  instructor: string;
  /** FK → instructors.id; null = unassigned. `instructor` is its display name. */
  instructorId: number | null;
  vehicle?: string;
  /** FK → vehicles.id; null = no vehicle. `vehicle` is its display name. */
  vehicleId: number | null;
  type: CalendarEventType;
  tentative?: boolean;
  /** FK → students.id; set on creation or via the back-fill migration. */
  studentId?: number;
  /** FK → transactions.id; set after billing via markEventBilled(). */
  billedTransactionId?: number;
  /** Derived: true when billedTransactionId is set AND the linked
      transaction has not been storniert. Populated by the SELECT query. */
  billedActive?: boolean;
  /** Exam result — only meaningful for the two exam event types. */
  examResult?: "bestanden" | "nicht_bestanden";
  /** Kind of practical drive (Sonderfahrt) — only on type "Praktisch". */
  lessonKind?: LessonKind;
  /** Shared by all occurrences created by one series request. */
  seriesId?: string;
  /** Set when the lesson was cancelled or the student did not show up.
      The event stays in the calendar as history. */
  cancelledAt?: string;
  cancellationKind?: CancellationKind;
  /** FK → transactions.id of the Ausfallentschädigung, if one was charged. */
  cancellationFeeTransactionId?: number;
  /** Derived: true while the fee transaction has not been storniert. */
  cancellationFeeActive?: boolean;
  /** Derived: booked amount of the Ausfallentschädigung in cents. */
  cancellationFeeCents?: number;
  /** Free-text note for this lesson (Abholort, Lernstand, …). */
  notes?: string;
  /** Non-blocking hints from create/update (e.g. daily limit exceeded).
      Only present on write responses, never stored. */
  warnings?: string[];
};

const EXAM_TYPES: CalendarEventType[] = [
  "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung",
];

export type CalendarEventInput = Omit<
  CalendarEvent,
  | "id"
  | "billedTransactionId"
  | "billedActive"
  | "examResult"
  | "instructorId"
  | "vehicleId"
  | "lessonKind"
  | "seriesId"
  | "cancelledAt"
  | "cancellationKind"
  | "cancellationFeeTransactionId"
  | "cancellationFeeActive"
  | "cancellationFeeCents"
  | "warnings"
> & {
  instructorId?: number | null;
  vehicleId?: number | null;
  lessonKind?: LessonKind | null;
  /** Write-only: skip the overlap/absence checks (user confirmed). */
  allowConflicts?: boolean;
};

type CalendarEventData = Omit<
  CalendarEventInput,
  "instructor" | "vehicle" | "lessonKind" | "allowConflicts"
> & {
  instructorId: number | null;
  vehicleId: number | null;
  lessonKind: LessonKind | null;
};

type CalendarEventRow = {
  id: number;
  date: string;
  start: string;
  end: string;
  title: string;
  subtitle: string;
  location: string;
  instructor: string;
  vehicle: string;
  instructor_id: number | null;
  vehicle_id: number | null;
  type: CalendarEventType;
  tentative: number;
  student_id: number | null;
  billed_transaction_id: number | null;
  tx_storniert_by: number | null;
  exam_result: string | null;
  lesson_kind: string | null;
  series_id: string | null;
  cancelled_at: string | null;
  cancellation_kind: string | null;
  cancellation_fee_transaction_id: number | null;
  fee_storniert_by: number | null;
  notes: string | null;
};

const toEvent = (row: CalendarEventRow): CalendarEvent => {
  const event: CalendarEvent = {
    id: String(row.id),
    date: row.date,
    start: row.start,
    end: row.end,
    title: row.title,
    instructor: row.instructor,
    instructorId: row.instructor_id,
    vehicleId: row.vehicle_id,
    type: row.type,
  };
  if (row.subtitle) event.subtitle = row.subtitle;
  if (row.location) event.location = row.location;
  if (row.vehicle) event.vehicle = row.vehicle;
  if (row.tentative) event.tentative = true;
  if (row.student_id != null) event.studentId = row.student_id;
  if (row.billed_transaction_id != null) {
    event.billedTransactionId = row.billed_transaction_id;
    event.billedActive = row.tx_storniert_by == null;
  }
  if (row.exam_result === "bestanden" || row.exam_result === "nicht_bestanden") {
    event.examResult = row.exam_result;
  }
  if (isLessonKind(row.lesson_kind)) event.lessonKind = row.lesson_kind;
  if (row.series_id) event.seriesId = row.series_id;
  if (row.cancelled_at) {
    event.cancelledAt = row.cancelled_at;
    event.cancellationKind =
      row.cancellation_kind === "nicht_erschienen" ? "nicht_erschienen" : "abgesagt";
  }
  if (row.cancellation_fee_transaction_id != null) {
    event.cancellationFeeTransactionId = row.cancellation_fee_transaction_id;
    event.cancellationFeeActive = row.fee_storniert_by == null;
  }
  if (row.notes) event.notes = row.notes;
  return event;
};

const SELECT = `
  SELECT
    ce.id, ce.date, ce.start, ce."end", ce.title, ce.subtitle,
    ce.location, ce.instructor_id, ce.vehicle_id,
    ${instructorNameSql("ce")} AS instructor, ${vehicleNameSql("ce", "")} AS vehicle,
    ce.type, ce.tentative,
    ce.student_id, ce.billed_transaction_id, ce.exam_result,
    ce.lesson_kind, ce.series_id, ce.cancelled_at, ce.cancellation_kind,
    ce.cancellation_fee_transaction_id, ce.notes,
    CASE
      WHEN ce.billed_transaction_id IS NOT NULL THEN (
        SELECT t.storniert_by FROM transactions t WHERE t.id = ce.billed_transaction_id
      )
      ELSE NULL
    END AS tx_storniert_by,
    CASE
      WHEN ce.cancellation_fee_transaction_id IS NOT NULL THEN (
        SELECT t.storniert_by FROM transactions t
        WHERE t.id = ce.cancellation_fee_transaction_id
      )
      ELSE NULL
    END AS fee_storniert_by
  FROM calendar_events ce
`;

/* Booked amount of each Ausfallentschädigung (sum of its bookings).
   Separate from SELECT because minimal schemas (some unit tests) have
   no bookings table. Fahrlehrer/innen see that a fee was charged, never
   its amount (no money for the role). */
function withFeeAmounts(db: Database, events: CalendarEvent[]): CalendarEvent[] {
  if (currentUser()?.role === "fahrlehrer") return events;
  const ids = events
    .map((event) => event.cancellationFeeTransactionId)
    .filter((id): id is number => id != null);
  if (ids.length === 0 || !tableExists(db, "bookings")) return events;
  const amounts = new Map(
    db
      .query<{ transaction_id: number; cents: number }, number[]>(
        `SELECT transaction_id, sum(amount_cents) AS cents FROM bookings
         WHERE transaction_id IN (${ids.map(() => "?").join(",")})
         GROUP BY transaction_id`,
      )
      .all(...ids)
      .map((row) => [row.transaction_id, row.cents]),
  );
  for (const event of events) {
    const cents =
      event.cancellationFeeTransactionId != null
        ? amounts.get(event.cancellationFeeTransactionId)
        : undefined;
    if (cents != null) event.cancellationFeeCents = cents;
  }
  return events;
}

export function listCalendarEvents(
  db: Database,
  filter?: { from?: string; to?: string },
): CalendarEvent[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter?.from) {
    clauses.push("ce.date >= ?");
    params.push(filter.from);
  }
  if (filter?.to) {
    clauses.push("ce.date <= ?");
    params.push(filter.to);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return withFeeAmounts(
    db,
    db
      .query<CalendarEventRow, string[]>(`${SELECT}${where} ORDER BY ce.date, ce.start`)
      .all(...params)
      .map(toEvent),
  );
}

export function getCalendarEvent(db: Database, id: number): CalendarEvent {
  const row = db.query<CalendarEventRow, [number]>(`${SELECT} WHERE ce.id = ?`).get(id);
  if (!row) throw new ValidationError("Termin nicht gefunden.");
  return withFeeAmounts(db, [toEvent(row)])[0]!;
}

const toMinutes = (value: string): number => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

const EMPTY: CalendarEventData = {
  date: "",
  start: "",
  end: "",
  title: "",
  subtitle: "",
  location: "",
  instructorId: null,
  vehicleId: null,
  type: "Praktisch",
  tentative: false,
  studentId: undefined,
  lessonKind: null,
  notes: "",
};

/* Merge a partial payload over current values, trimming strings and
   applying the validation rules shared by create and update. */
function normalize(
  db: Database,
  input: Partial<CalendarEventInput>,
  current: CalendarEventData,
): CalendarEventData {
  const str = (
    key: "date" | "start" | "end" | "title" | "subtitle" | "location" | "notes",
    fallback: string,
  ): string => {
    const value = input[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const date = str("date", current.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Feld 'date' muss ein ISO-Datum sein.");
  }

  const start = str("start", current.start);
  const end = str("end", current.end);
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    throw new ValidationError("Beginn und Ende müssen im Format HH:MM sein.");
  }
  if (toMinutes(end) <= toMinutes(start)) {
    throw new ValidationError("Ende muss nach Beginn liegen.");
  }

  const title = str("title", current.title);
  if (!title) {
    throw new ValidationError("Titel ist ein Pflichtfeld.");
  }

  const type = input.type === undefined ? current.type : input.type;
  if (!EVENT_TYPES.includes(type as CalendarEventType)) {
    throw new ValidationError("Ungültiger Termin-Typ.");
  }

  let tentative = current.tentative ?? false;
  if (input.tentative !== undefined) {
    if (typeof input.tentative !== "boolean") {
      throw new ValidationError("Feld 'tentative' muss ein Wahrheitswert sein.");
    }
    tentative = input.tentative;
  }

  const instructorId = resolveInstructorId(
    db,
    { id: input.instructorId, name: input.instructor },
    current.instructorId,
  );
  const vehicleId = resolveVehicleId(
    db,
    { id: input.vehicleId, name: input.vehicle },
    current.vehicleId,
  );

  // studentId: validate that it references an existing student when provided.
  let studentId: number | undefined = current.studentId;
  if ("studentId" in input) {
    const raw = input.studentId;
    if (raw === undefined || raw === null) {
      studentId = undefined;
    } else {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
        throw new ValidationError("Feld 'studentId' muss eine positive ganze Zahl sein.");
      }
      const exists =
        db
          .query<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM students WHERE id = ?",
          )
          .get(raw)!.n > 0;
      if (!exists) {
        throw new ValidationError(`Fahrschüler mit ID ${raw} nicht gefunden.`);
      }
      studentId = raw;
    }
  }

  // lessonKind: only practical lessons carry a kind. An explicit kind on
  // another type is an error; a kept kind is dropped when the type changes.
  let lessonKind: LessonKind | null = current.lessonKind;
  if (input.lessonKind !== undefined) {
    if (input.lessonKind === null) {
      lessonKind = null;
    } else if (!isLessonKind(input.lessonKind)) {
      throw new ValidationError("Ungültige Fahrtart.");
    } else if (type !== "Praktisch") {
      throw new ValidationError(
        "Eine Fahrtart ist nur bei praktischen Fahrstunden möglich.",
      );
    } else {
      lessonKind = input.lessonKind;
    }
  }
  if (type !== "Praktisch") lessonKind = null;

  const notes = str("notes", current.notes ?? "");
  if (notes.length > 2000) {
    throw new ValidationError("Notiz darf höchstens 2000 Zeichen lang sein.");
  }

  return {
    date,
    start,
    end,
    title,
    subtitle: str("subtitle", current.subtitle ?? ""),
    location: str("location", current.location ?? ""),
    notes,
    instructorId,
    vehicleId,
    type: type as CalendarEventType,
    tentative,
    studentId,
    lessonKind,
  };
}

/* ------------------------------------------------------------------ */
/* Scheduling checks (absences, overlaps) and daily-limit warnings     */
/* ------------------------------------------------------------------ */

type OverlapRow = {
  title: string;
  subtitle: string;
  start: string;
  end: string;
  instructor: string;
  vehicle: string;
};

/** First non-cancelled event on the same day that overlaps the slot and
    uses the given resource. Touching edges don't overlap ("HH:MM" strings
    compare correctly as text). */
function findResourceOverlap(
  db: Database,
  column: "instructor_id" | "vehicle_id",
  resourceId: number,
  data: Pick<CalendarEventData, "date" | "start" | "end">,
  excludeId: number | null,
): OverlapRow | null {
  return db
    .query<OverlapRow, [number, string, string, string, number]>(
      `SELECT ce.title, ce.subtitle, ce.start, ce."end",
              ${instructorNameSql("ce")} AS instructor, ${vehicleNameSql("ce", "")} AS vehicle
       FROM calendar_events ce
       WHERE ce.id != ? AND ce.date = ? AND ce.cancelled_at IS NULL
         AND ce.start < ? AND ce."end" > ? AND ce.${column} = ?
       ORDER BY ce.start
       LIMIT 1`,
    )
    .get(excludeId ?? 0, data.date, data.end, data.start, resourceId);
}

const describeOverlap = (row: OverlapRow) =>
  `„${row.title}“${row.subtitle ? ` mit ${row.subtitle}` : ""} (${row.start}–${row.end})`;

/** Scheduling rules for a new or moved Termin:
    - A vehicle can only be in one place: a double booking is always
      rejected, even with allowConflicts.
    - An absent instructor or an instructor overlap is rejected unless the
      user confirmed it (allowConflicts) — those can be intentional (e.g.
      a Besprechung during a lesson, a hand-over at the Prüfstelle).
    `excludeId` is the event being updated. */
export function checkScheduling(
  db: Database,
  data: Pick<CalendarEventData, "date" | "start" | "end" | "instructorId" | "vehicleId">,
  excludeId: number | null,
  options: { allowConflicts?: boolean } = {},
): void {
  if (data.vehicleId != null) {
    const clash = findResourceOverlap(db, "vehicle_id", data.vehicleId, data, excludeId);
    if (clash) {
      throw new ValidationError(
        `Fahrzeug ${clash.vehicle} ist bereits belegt: ${describeOverlap(clash)}${
          clash.instructor ? ` bei ${clash.instructor}` : ""
        }. Bitte ein anderes Fahrzeug oder eine andere Zeit wählen.`,
      );
    }
  }
  if (options.allowConflicts === true || data.instructorId == null) return;

  const absence = findAbsence(db, data.instructorId, data.date);
  if (absence) {
    throw new ValidationError(
      `${absence.instructor} ist am ${formatGermanDate(data.date)} abwesend (${absence.kind}).`,
    );
  }
  const overlap = findResourceOverlap(
    db,
    "instructor_id",
    data.instructorId,
    data,
    excludeId,
  );
  if (overlap) {
    throw new ValidationError(
      `Überschneidung mit ${describeOverlap(overlap)} für Fahrlehrer/in ${overlap.instructor}.`,
    );
  }
}

/** Practical minutes (Praktisch + Vorstellung, not cancelled) of one
    instructor on one day. */
export function practicalMinutesOnDay(
  db: Database,
  instructorId: number,
  date: string,
): number {
  const rows = db
    .query<{ start: string; end: string }, [number, string, string, string]>(
      `SELECT start, "end" FROM calendar_events
       WHERE instructor_id = ? AND date = ? AND cancelled_at IS NULL
         AND type IN (?, ?)`,
    )
    .all(instructorId, date, PRACTICAL_EVENT_TYPES[0]!, PRACTICAL_EVENT_TYPES[1]!);
  return rows.reduce((sum, row) => sum + (toMinutes(row.end) - toMinutes(row.start)), 0);
}

/** Non-blocking hints for a freshly written event. */
export function dailyLimitWarnings(db: Database, event: CalendarEvent): string[] {
  if (event.instructorId == null || event.cancelledAt) return [];
  if (!PRACTICAL_EVENT_TYPES.includes(event.type)) return [];
  const minutes = practicalMinutesOnDay(db, event.instructorId, event.date);
  if (minutes <= MAX_PRACTICAL_MINUTES_PER_DAY) return [];
  return [
    `Tageshöchstdauer praktischer Unterricht (${MAX_PRACTICAL_MINUTES_PER_DAY} Min.) für ${event.instructor} am ${formatGermanDate(event.date)} überschritten: ${minutes} Min.`,
  ];
}

/** Hint when the booked vehicle is marked as "wartung" (not blocking:
    the status may be outdated, the office decides). */
export function vehicleWarnings(db: Database, event: CalendarEvent): string[] {
  if (event.vehicleId == null || event.cancelledAt) return [];
  const row = db
    .query<{ status: string }, [number]>("SELECT status FROM vehicles WHERE id = ?")
    .get(event.vehicleId);
  if (row?.status !== "wartung") return [];
  return [`Fahrzeug ${event.vehicle} ist als „In Wartung“ markiert.`];
}

const withWarnings = (
  db: Database,
  event: CalendarEvent,
  checkVehicle = true,
): CalendarEvent => {
  const warnings = [
    ...dailyLimitWarnings(db, event),
    ...(checkVehicle ? vehicleWarnings(db, event) : []),
  ];
  return warnings.length ? { ...event, warnings } : event;
};

export function createCalendarEvent(
  db: Database,
  input: Partial<CalendarEventInput>,
  options: { seriesId?: string } = {},
): CalendarEvent {
  const data = normalize(db, input, EMPTY);
  checkScheduling(db, data, null, { allowConflicts: input.allowConflicts === true });
  const row = db
    .query<
      { id: number },
      [
        string,
        string,
        string,
        string,
        string,
        string,
        number | null,
        number | null,
        string,
        number,
        number | null,
        string | null,
        string | null,
        string,
      ]
    >(
      `INSERT INTO calendar_events
         (date, start, "end", title, subtitle, location, instructor_id, vehicle_id, type,
          tentative, student_id, lesson_kind, series_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.date,
      data.start,
      data.end,
      data.title,
      data.subtitle ?? "",
      data.location ?? "",
      data.instructorId,
      data.vehicleId,
      data.type,
      data.tentative ? 1 : 0,
      data.studentId ?? null,
      data.lessonKind,
      options.seriesId ?? null,
      data.notes ?? "",
    )!;
  return withWarnings(db, getCalendarEvent(db, row.id));
}

export function updateCalendarEvent(
  db: Database,
  id: number,
  input: Partial<CalendarEventInput>,
): CalendarEvent {
  const current = getCalendarEvent(db, id);
  const data = normalize(db, input, {
    ...current,
    lessonKind: current.lessonKind ?? null,
  });
  // Only a change of slot or resource is checked — editing the title of
  // an event that already overlaps (legacy data, confirmed conflict) must
  // not be blocked. Cancelled events never conflict.
  const moved =
    data.date !== current.date ||
    data.start !== current.start ||
    data.end !== current.end ||
    data.instructorId !== current.instructorId ||
    data.vehicleId !== current.vehicleId;
  if (moved && !current.cancelledAt) {
    checkScheduling(db, data, id, { allowConflicts: input.allowConflicts === true });
  }
  db.prepare(
    `UPDATE calendar_events
     SET date = ?, start = ?, "end" = ?, title = ?, subtitle = ?, location = ?,
         instructor_id = ?, vehicle_id = ?, type = ?, tentative = ?, student_id = ?,
         lesson_kind = ?, notes = ?
     WHERE id = ?`,
  ).run(
    data.date,
    data.start,
    data.end,
    data.title,
    data.subtitle ?? "",
    data.location ?? "",
    data.instructorId,
    data.vehicleId,
    data.type,
    data.tentative ? 1 : 0,
    data.studentId ?? null,
    data.lessonKind,
    data.notes ?? "",
    id,
  );
  return withWarnings(db, getCalendarEvent(db, id), moved);
}

/** Mark an event as billed by storing the transaction id. Call this
    inside a db.transaction() wrapping the createTransaction() call so
    both writes are atomic. NOT settable via the generic update path. */
export function markEventBilled(
  db: Database,
  eventId: number,
  transactionId: number,
): CalendarEvent {
  const event = getCalendarEvent(db, eventId);
  if (!event) throw new ValidationError("Termin nicht gefunden.");
  db.prepare("UPDATE calendar_events SET billed_transaction_id = ? WHERE id = ?").run(
    transactionId,
    eventId,
  );
  return getCalendarEvent(db, eventId);
}

/** Why an event must not be deleted, or null when it may. Shared by the
    single delete and the series delete (which skips blocked events). */
export function deleteBlockReason(db: Database, event: CalendarEvent): string | null {
  // Guard: block deletion of billed events unless the linked transaction
  // has been storniert (billedActive = true means it is still active).
  if (event.billedTransactionId != null && event.billedActive) {
    return "Termin ist abgerechnet — zuerst stornieren.";
  }

  // Guard: an active Ausfallentschädigung references the event — the
  // booking must be storniert before the event can disappear.
  if (event.cancellationFeeTransactionId != null && event.cancellationFeeActive) {
    return "Für den Termin wurde eine Ausfallgebühr gebucht — zuerst stornieren.";
  }

  // Guard: attestations are immutable compliance records referencing the
  // event (FK) — deleting the event would either fail raw or orphan them.
  // tableExists because the table is created at app startup, not by openDb.
  if (tableExists(db, "lesson_attestations")) {
    const attested =
      db
        .query<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM lesson_attestations WHERE event_id = ?",
        )
        .get(Number(event.id))!.n > 0;
    if (attested) {
      return "Termin hat einen Ausbildungsnachweis und kann nicht gelöscht werden.";
    }
  }
  return null;
}

export function deleteCalendarEvent(db: Database, id: number): void {
  const event = getCalendarEvent(db, id);
  const blocked = deleteBlockReason(db, event);
  if (blocked) throw new ValidationError(blocked);

  const remove = db.transaction(() => {
    archiveRow(db, "calendar_event", id, `${event.title} · ${event.date} ${event.start}`);
    db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
  });
  remove();
}

/** Record (or clear) an exam result on an exam-type event.
    - Allowed only on "Theorieprüfung" and "Vorstellung zur prakt. Prüfung".
    - result: 'bestanden' | 'nicht_bestanden' | null (null clears).
    NOT settable via the generic update/normalize path. */
export function recordExamResult(
  db: Database,
  eventId: number,
  result: "bestanden" | "nicht_bestanden" | null,
): CalendarEvent {
  const event = getCalendarEvent(db, eventId);
  if (!EXAM_TYPES.includes(event.type)) {
    throw new ValidationError(
      "Prüfungsergebnis kann nur für Prüfungs-Termine gespeichert werden.",
    );
  }
  if (result !== null && result !== "bestanden" && result !== "nicht_bestanden") {
    throw new ValidationError(
      "Ergebnis muss 'bestanden', 'nicht_bestanden' oder null sein.",
    );
  }
  db.prepare("UPDATE calendar_events SET exam_result = ? WHERE id = ?").run(
    result,
    eventId,
  );
  return getCalendarEvent(db, eventId);
}
