/* ------------------------------------------------------------------ */
/* Calendar events (Termine) — DB access + validation.                 */
/* The HTTP wrappers live in routes.ts (calendarEventRoutes).          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { archiveRow, tableExists } from "./archive";
import { ValidationError } from "./engine";
import {
  instructorNameSql,
  resolveInstructorId,
  resolveVehicleId,
  vehicleNameSql,
} from "./refs";

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
> & { instructorId?: number | null; vehicleId?: number | null };

type CalendarEventData = Omit<CalendarEventInput, "instructor" | "vehicle"> & {
  instructorId: number | null;
  vehicleId: number | null;
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
  return event;
};

const SELECT = `
  SELECT
    ce.id, ce.date, ce.start, ce."end", ce.title, ce.subtitle,
    ce.location, ce.instructor_id, ce.vehicle_id,
    ${instructorNameSql("ce")} AS instructor, ${vehicleNameSql("ce", "")} AS vehicle,
    ce.type, ce.tentative,
    ce.student_id, ce.billed_transaction_id, ce.exam_result,
    CASE
      WHEN ce.billed_transaction_id IS NOT NULL THEN (
        SELECT t.storniert_by FROM transactions t WHERE t.id = ce.billed_transaction_id
      )
      ELSE NULL
    END AS tx_storniert_by
  FROM calendar_events ce
`;

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
  return db
    .query<CalendarEventRow, string[]>(`${SELECT}${where} ORDER BY ce.date, ce.start`)
    .all(...params)
    .map(toEvent);
}

export function getCalendarEvent(db: Database, id: number): CalendarEvent {
  const row = db.query<CalendarEventRow, [number]>(`${SELECT} WHERE ce.id = ?`).get(id);
  if (!row) throw new ValidationError("Termin nicht gefunden.");
  return toEvent(row);
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
};

/* Merge a partial payload over current values, trimming strings and
   applying the validation rules shared by create and update. */
function normalize(
  db: Database,
  input: Partial<CalendarEventInput>,
  current: CalendarEventData,
): CalendarEventData {
  const str = (
    key: "date" | "start" | "end" | "title" | "subtitle" | "location",
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

  return {
    date,
    start,
    end,
    title,
    subtitle: str("subtitle", current.subtitle ?? ""),
    location: str("location", current.location ?? ""),
    instructorId,
    vehicleId,
    type: type as CalendarEventType,
    tentative,
    studentId,
  };
}

export function createCalendarEvent(
  db: Database,
  input: Partial<CalendarEventInput>,
): CalendarEvent {
  const data = normalize(db, input, EMPTY);
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
      ]
    >(
      `INSERT INTO calendar_events
         (date, start, "end", title, subtitle, location, instructor_id, vehicle_id, type, tentative, student_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
    )!;
  return getCalendarEvent(db, row.id);
}

export function updateCalendarEvent(
  db: Database,
  id: number,
  input: Partial<CalendarEventInput>,
): CalendarEvent {
  const current = getCalendarEvent(db, id);
  const data = normalize(db, input, current);
  db.prepare(
    `UPDATE calendar_events
     SET date = ?, start = ?, "end" = ?, title = ?, subtitle = ?, location = ?,
         instructor_id = ?, vehicle_id = ?, type = ?, tentative = ?, student_id = ?
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
    id,
  );
  return getCalendarEvent(db, id);
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

export function deleteCalendarEvent(db: Database, id: number): void {
  const event = getCalendarEvent(db, id);

  // Guard: block deletion of billed events unless the linked transaction
  // has been storniert (billedActive = true means it is still active).
  if (event.billedTransactionId != null && event.billedActive) {
    throw new ValidationError("Termin ist abgerechnet — zuerst stornieren.");
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
        .get(id)!.n > 0;
    if (attested) {
      throw new ValidationError(
        "Termin hat einen Ausbildungsnachweis und kann nicht gelöscht werden.",
      );
    }
  }

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
