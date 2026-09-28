/* ------------------------------------------------------------------ */
/* Appointment requests (Terminanfragen) — DB access + validation.     */
/* Self-contained: ensureAppointmentRequestTables() creates and seeds  */
/* the table, appointmentRequestRoutes() exposes the HTTP wrappers     */
/* (mount the factory into the Bun.serve() routes object in index.ts). */
/* Accepting a request creates a calendar event (calendar-events.ts).  */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import {
  createCalendarEvent,
  listCalendarEvents,
  type CalendarEvent,
  type CalendarEventType,
} from "./calendar-events";
import { campaignIdByTrackingCode } from "./campaigns";
import { ValidationError } from "./engine";
import { handle, json } from "./http";
import {
  notifyAppointmentRequestConfirmed,
  notifyAppointmentRequestDeclined,
} from "./notifications";
import { demoDataEnabled } from "./db";
import { schoolToday } from "./school-time";

export { schoolToday };

export type AppointmentRequestStatus = "offen" | "bestätigt" | "abgelehnt";

const REQUEST_TYPES: CalendarEventType[] = [
  "Praktisch",
  "Theorie",
  "Vorstellung zur prakt. Prüfung",
  "Theorieprüfung",
  "Andere",
];

const STATUSES: AppointmentRequestStatus[] = ["offen", "bestätigt", "abgelehnt"];

export type AppointmentRequest = {
  id: number;
  name: string;
  phone: string;
  email: string;
  message: string;
  requestedDate: string; // ISO "YYYY-MM-DD"
  requestedTime: string; // "HH:MM"
  type: CalendarEventType;
  status: AppointmentRequestStatus;
  createdAt: string;
  /** Campaign whose tracking link (/anfrage?kampagne=…) brought the request. */
  campaignId: number | null;
  campaignName: string | null;
  /** Student created from this request ("Als Fahrschüler anlegen"). */
  studentId: number | null;
  studentName: string | null;
  /** Fahrlehrer/in of the confirmed appointment (null = none yet). */
  appointmentInstructor: string | null;
};

export type AppointmentRequestInput = Omit<
  AppointmentRequest,
  | "id"
  | "createdAt"
  | "campaignId"
  | "campaignName"
  | "studentId"
  | "studentName"
  | "appointmentInstructor"
>;

/* Calendar event overlapping a request's slot — shown as a warning on
   the /terminanfragen page before the office accepts the request. */
export type AppointmentRequestConflict = {
  id: string;
  title: string;
  start: string;
  end: string;
  instructor: string;
};

export type AppointmentRequestWithConflicts = AppointmentRequest & {
  conflicts: AppointmentRequestConflict[];
  /** Other requests that are probably from the same person (same phone,
      e-mail or name, received within DUPLICATE_WINDOW_DAYS). */
  duplicateOf: number[];
};

/* Optional adjustments applied when a request is accepted — lets the
   office move the slot or assign an instructor before confirming. */
export type AcceptOverrides = {
  date?: string;
  start?: string;
  end?: string;
  instructor?: string;
  vehicle?: string;
  location?: string;
  /** Accept even when the slot overlaps or the instructor is absent. */
  allowConflicts?: boolean;
};

type AppointmentRequestRow = {
  id: number;
  name: string;
  phone: string;
  email: string;
  message: string;
  requested_date: string;
  requested_time: string;
  type: CalendarEventType;
  status: AppointmentRequestStatus;
  created_at: string;
  campaign_id: number | null;
  campaign_name: string | null;
  student_id: number | null;
  student_name: string | null;
  appointment_instructor: string | null;
};

/* ----------------------------- schema ----------------------------- */

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS appointment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  requested_date TEXT NOT NULL,  -- ISO "YYYY-MM-DD"
  requested_time TEXT NOT NULL,  -- "HH:MM"
  type TEXT NOT NULL CHECK (type IN ('Praktisch','Theorie','Vorstellung zur prakt. Prüfung','Theorieprüfung','Andere')),
  status TEXT NOT NULL CHECK (status IN ('offen','bestätigt','abgelehnt')) DEFAULT 'offen',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_status ON appointment_requests(status);
`;

type SeedRow = [
  name: string,
  phone: string,
  email: string,
  message: string,
  date: string,
  time: string,
  type: CalendarEventType,
  status: AppointmentRequestStatus,
  /** Days before today the request came in (created_at). */
  receivedDaysAgo: number,
];

/* ISO date `days` from today (local), so the demo inbox never ages:
   open requests ask for the coming weeks, handled ones lie behind. */
function daysFromToday(days: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/* Weekday-only variant: shifts Saturdays/Sundays to the next Monday. */
function weekdayFromToday(days: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const shift = date.getDay() === 6 ? 2 : date.getDay() === 0 ? 1 : 0;
  return daysFromToday(days + shift);
}

const seedRows = (): SeedRow[] => [
  [
    "Lena Hoffmann",
    "0151 23456701",
    "lena.hoffmann@web.de",
    "Ich hätte gerne eine Fahrstunde am Nachmittag, gerne auch Autobahn.",
    weekdayFromToday(3),
    "14:00",
    "Praktisch",
    "offen",
    3,
  ],
  [
    "Jonas Becker",
    "0160 9876512",
    "jonas.becker@gmx.de",
    "Kann ich am Dienstag am Theorieunterricht teilnehmen?",
    weekdayFromToday(4),
    "18:00",
    "Theorie",
    "offen",
    2,
  ],
  [
    "Miriam Schulz",
    "0176 44455566",
    "miriam.schulz@outlook.de",
    "Mein Fahrlehrer meinte, ich bin bereit für die Prüfung.",
    weekdayFromToday(10),
    "09:30",
    "Vorstellung zur prakt. Prüfung",
    "offen",
    1,
  ],
  [
    "Tarek Yılmaz",
    "0157 11223344",
    "tarek.yilmaz@gmail.com",
    "Doppelstunde wäre super, am liebsten Schaltwagen.",
    weekdayFromToday(5),
    "16:30",
    "Praktisch",
    "offen",
    1,
  ],
  [
    "Sophie Wagner",
    "0152 99887766",
    "sophie.wagner@web.de",
    "Anmeldung zur Theorieprüfung — alle Pflichtstunden sind erledigt.",
    weekdayFromToday(12),
    "11:00",
    "Theorieprüfung",
    "offen",
    0,
  ],
  [
    "David Krüger",
    "0171 55667788",
    "david.krueger@gmail.com",
    "Bitte eine Fahrstunde vor der Arbeit, früh morgens.",
    weekdayFromToday(-3),
    "07:30",
    "Praktisch",
    "bestätigt",
    9,
  ],
  [
    "Anna Lehmann",
    "0159 33221100",
    "anna.lehmann@gmx.de",
    "Geht am Sonntag eine Theoriestunde?",
    daysFromToday(-1),
    "10:00",
    "Theorie",
    "abgelehnt",
    6,
  ],
  [
    "Felix Neumann",
    "030 4455667",
    "felix.neumann@posteo.de",
    "Beratungsgespräch zum Umstieg von B197 auf B gewünscht.",
    weekdayFromToday(6),
    "15:00",
    "Andere",
    "offen",
    0,
  ],
  // Same person twice (no answer yet) — shows the duplicate hint.
  [
    "Lena Hoffmann",
    "0151 23456701",
    "",
    "Hatte schon angefragt — geht auch ein Termin am Vormittag?",
    weekdayFromToday(4),
    "10:00",
    "Praktisch",
    "offen",
    0,
  ],
];

/* ISO date of a weekday in the current week (0 = Monday … 6 = Sunday) —
   same anchoring as the calendar event seed in db.ts. */
function currentWeekDate(day: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (today.getDay() + 6) % 7;
  const date = new Date(today);
  date.setDate(today.getDate() - offset + day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/* One request deliberately overlapping the seeded Tuesday 09:00–09:45
   calendar event (db.ts), so the conflict warning has demo data. */
const conflictingSeed = (): SeedRow => [
  "Ben Albers",
  "0163 7788990",
  "ben.albers@web.de",
  "Geht Dienstagmorgen eine Fahrstunde? Ich habe erst ab Mittag Uni.",
  currentWeekDate(1),
  "09:15",
  "Praktisch",
  "offen",
  2,
];

/* Lead attribution + conversion links, added after the table shipped.
   No FKs: campaigns/students live in other modules and are optional
   in unit-test schemas; deletes clear the links explicitly. */
function migrateRequestLinks(db: Database): void {
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(appointment_requests)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("campaign_id")) {
    db.exec("ALTER TABLE appointment_requests ADD COLUMN campaign_id INTEGER");
  }
  if (!cols.includes("student_id")) {
    db.exec("ALTER TABLE appointment_requests ADD COLUMN student_id INTEGER");
  }
  // Calendar event created when the request was accepted — lets "Als
  // Fahrschüler anlegen" attach the confirmed Termin to the new student.
  if (!cols.includes("event_id")) {
    db.exec("ALTER TABLE appointment_requests ADD COLUMN event_id INTEGER");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_appointment_requests_campaign ON appointment_requests(campaign_id)",
  );
}

export function ensureAppointmentRequestTables(db: Database): void {
  db.exec(TABLE_DDL);
  migrateRequestLinks(db);

  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM appointment_requests")
    .get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const insert = db.prepare(
    `INSERT INTO appointment_requests
       (name, phone, email, message, requested_date, requested_time, type, status,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
       datetime('now', '-' || ? || ' days', '-' || ? || ' hours'))`,
  );
  const seed = db.transaction(() => {
    [...seedRows(), conflictingSeed()].forEach((row, index) => {
      const [name, phone, email, message, date, time, type, status, daysAgo] = row;
      // Spread the arrival times over the day so the order is stable.
      insert.run(
        name,
        phone,
        email,
        message,
        date,
        time,
        type,
        status,
        daysAgo,
        index + 1,
      );
    });
  });
  seed();
}

/* ------------------------------ reads ----------------------------- */

const toRequest = (row: AppointmentRequestRow): AppointmentRequest => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  message: row.message,
  requestedDate: row.requested_date,
  requestedTime: row.requested_time,
  type: row.type,
  status: row.status,
  createdAt: row.created_at,
  campaignId: row.campaign_id,
  campaignName: row.campaign_name,
  studentId: row.student_name === null ? null : row.student_id,
  studentName: row.student_name,
  appointmentInstructor: row.appointment_instructor || null,
});

const tableExists = (db: Database, name: string) =>
  db
    .query<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(name)!.n > 0;

/* Campaign/student names are joined when their tables exist (the unit
   tests run this module on a bare schema). */
function selectSql(db: Database): string {
  const campaign = tableExists(db, "campaigns")
    ? "(SELECT c.name FROM campaigns c WHERE c.id = r.campaign_id)"
    : "NULL";
  const student = tableExists(db, "students")
    ? "(SELECT trim(s.first_name || ' ' || s.last_name) FROM students s WHERE s.id = r.student_id)"
    : "NULL";
  const instructor =
    tableExists(db, "calendar_events") && tableExists(db, "instructors")
      ? `(SELECT trim(i.first_name || ' ' || i.last_name) FROM calendar_events ce
          JOIN instructors i ON i.id = ce.instructor_id WHERE ce.id = r.event_id)`
      : "NULL";
  return `SELECT r.id, r.name, r.phone, r.email, r.message, r.requested_date,
    r.requested_time, r.type, r.status, r.created_at, r.campaign_id, r.student_id,
    ${campaign} AS campaign_name, ${student} AS student_name,
    ${instructor} AS appointment_instructor
    FROM appointment_requests r`;
}

/* Calendar events overlapping the requested slot, assuming the same
   60min default duration the accept flow uses. */
function findConflictingEvents(
  db: Database,
  date: string,
  time: string,
): AppointmentRequestConflict[] {
  if (!/^\d{2}:\d{2}$/.test(time)) return [];
  const requestStart = toMinutes(time);
  const requestEnd = requestStart + DEFAULT_DURATION_MINUTES;
  return listCalendarEvents(db, { from: date, to: date })
    .filter(
      (event) =>
        !event.cancelledAt &&
        toMinutes(event.start) < requestEnd &&
        toMinutes(event.end) > requestStart,
    )
    .map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      instructor: event.instructor,
    }));
}

export const DUPLICATE_WINDOW_DAYS = 14;

/* "+49 151 234-567" → "0151234567"; too short numbers never match. */
function phoneKey(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0049")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("49") && phone.trim().startsWith("+")) {
    digits = `0${digits.slice(2)}`;
  }
  return digits.length >= 6 ? digits : "";
}

const nameKey = (name: string) =>
  name.trim().toLocaleLowerCase("de").replace(/\s+/g, " ");

const createdMs = (createdAt: string) =>
  new Date(
    `${createdAt.replace(" ", "T")}${createdAt.includes("Z") ? "" : "Z"}`,
  ).getTime();

/** Ids of likely duplicates per request id (same phone digits, e-mail or
    name, received within DUPLICATE_WINDOW_DAYS of each other). */
export function findLikelyDuplicates(
  requests: Pick<AppointmentRequest, "id" | "name" | "phone" | "email" | "createdAt">[],
): Map<number, number[]> {
  const windowMs = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const keyed = requests.map((r) => ({
    id: r.id,
    at: createdMs(r.createdAt),
    phone: phoneKey(r.phone),
    email: r.email.trim().toLowerCase(),
    name: nameKey(r.name),
  }));
  const result = new Map<number, number[]>();
  for (const a of keyed) {
    const matches = keyed
      .filter(
        (b) =>
          b.id !== a.id &&
          Math.abs(a.at - b.at) <= windowMs &&
          ((a.phone !== "" && a.phone === b.phone) ||
            (a.email !== "" && a.email === b.email) ||
            (a.name !== "" && a.name === b.name)),
      )
      .map((b) => b.id);
    result.set(a.id, matches);
  }
  return result;
}

/* Newest received first. Only open requests carry conflicts — accepted
   ones would always collide with the calendar event their own
   acceptance created. */
export function listAppointmentRequests(db: Database): AppointmentRequestWithConflicts[] {
  const requests = db
    .query<AppointmentRequestRow, []>(
      `${selectSql(db)} ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all()
    .map(toRequest);
  const duplicates = findLikelyDuplicates(requests);
  return requests.map((request) => ({
    ...request,
    conflicts:
      request.status === "offen"
        ? findConflictingEvents(db, request.requestedDate, request.requestedTime)
        : [],
    duplicateOf: duplicates.get(request.id) ?? [],
  }));
}

export function getAppointmentRequest(db: Database, id: number): AppointmentRequest {
  const row = db
    .query<AppointmentRequestRow, [number]>(`${selectSql(db)} WHERE r.id = ?`)
    .get(id);
  if (!row) throw new ValidationError("Terminanfrage nicht gefunden.");
  return toRequest(row);
}

/* --------------------------- validation --------------------------- */

/* Duration assumed for a request without an explicit end — used by the
   accept default and the conflict check. */
const DEFAULT_DURATION_MINUTES = 60;

const toMinutes = (value: string): number => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

/* "HH:MM" + minutes → "HH:MM" (used for the default 60min duration). */
const addMinutes = (time: string, minutes: number): string => {
  const total = toMinutes(time) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/* Length caps for the free-text fields — the create endpoint is public
   (/anfrage), so unbounded strings would let a single client bloat the
   DB. Same pattern as ausbildungsnachweis.ts. */
const NAME_MAX_LEN = 200;
const PHONE_MAX_LEN = 50;
const EMAIL_MAX_LEN = 254;
const MESSAGE_MAX_LEN = 2000;

/* Minimal sanity check, not RFC 5322 — empty email stays allowed. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const EMPTY: AppointmentRequestInput = {
  name: "",
  phone: "",
  email: "",
  message: "",
  requestedDate: "",
  requestedTime: "",
  type: "Praktisch",
  status: "offen",
};

/* Merge a partial payload over current values, trimming strings and
   applying the validation rules shared by create and update. */
function normalize(
  input: Partial<AppointmentRequestInput>,
  current: AppointmentRequestInput,
): AppointmentRequestInput {
  const str = (key: keyof AppointmentRequestInput, fallback: string): string => {
    const value = input[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const capped = (
    key: keyof AppointmentRequestInput,
    fallback: string,
    maxLen: number,
  ): string => {
    const value = str(key, fallback);
    if (value.length > maxLen) {
      throw new ValidationError(
        `Feld '${key}' darf maximal ${maxLen} Zeichen lang sein.`,
      );
    }
    return value;
  };

  const name = capped("name", current.name, NAME_MAX_LEN);
  if (!name) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }

  const email = capped("email", current.email, EMAIL_MAX_LEN);
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("Feld 'email' muss eine gültige E-Mail-Adresse sein.");
  }

  const requestedDate = str("requestedDate", current.requestedDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new ValidationError("Feld 'requestedDate' muss ein ISO-Datum sein.");
  }

  const requestedTime = str("requestedTime", current.requestedTime);
  if (!/^\d{2}:\d{2}$/.test(requestedTime)) {
    throw new ValidationError("Wunschzeit muss im Format HH:MM sein.");
  }

  const type = input.type === undefined ? current.type : input.type;
  if (!REQUEST_TYPES.includes(type as CalendarEventType)) {
    throw new ValidationError("Ungültiger Termin-Typ.");
  }

  const status = input.status === undefined ? current.status : input.status;
  if (!STATUSES.includes(status as AppointmentRequestStatus)) {
    throw new ValidationError("Status muss 'offen', 'bestätigt' oder 'abgelehnt' sein.");
  }

  return {
    name,
    phone: capped("phone", current.phone, PHONE_MAX_LEN),
    email,
    message: capped("message", current.message, MESSAGE_MAX_LEN),
    requestedDate,
    requestedTime,
    type: type as CalendarEventType,
    status: status as AppointmentRequestStatus,
  };
}

/* Plausible window for a requested lesson. Branch opening hours are free
   text ("Mo–Fr 14–18 Uhr") and describe the office, not driving hours,
   so the public form checks this fixed window instead. */
export const PUBLIC_EARLIEST_TIME = "06:00";
export const PUBLIC_LATEST_TIME = "21:00";

export type PublicRequestInput = Partial<AppointmentRequestInput> & {
  campaign?: unknown;
  /** Datenschutz consent checkbox of the public form. */
  consent?: unknown;
};

/* Extra rules for the unauthenticated /anfrage form on top of normalize():
   reachable contact, a date from today on, a plausible time and the
   Datenschutz consent. Staff edits (PATCH) keep the looser rules so old
   requests stay editable. */
export function validatePublicRequest(input: PublicRequestInput, today: string): void {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  if (!text(input.name)) throw new ValidationError("Name ist ein Pflichtfeld.");
  if (!text(input.phone) && !text(input.email)) {
    throw new ValidationError(
      "Bitte Telefonnummer oder E-Mail-Adresse angeben, damit wir Sie erreichen können.",
    );
  }
  const phone = text(input.phone);
  if (phone && phone.replace(/\D/g, "").length < 6) {
    throw new ValidationError("Bitte eine gültige Telefonnummer angeben.");
  }
  const date = text(input.requestedDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < today) {
    throw new ValidationError("Das Wunschdatum darf nicht in der Vergangenheit liegen.");
  }
  const time = text(input.requestedTime);
  if (
    /^\d{2}:\d{2}$/.test(time) &&
    (time < PUBLIC_EARLIEST_TIME || time > PUBLIC_LATEST_TIME)
  ) {
    throw new ValidationError(
      `Bitte eine Uhrzeit zwischen ${PUBLIC_EARLIEST_TIME} und ${PUBLIC_LATEST_TIME} Uhr wählen.`,
    );
  }
  if (input.consent !== true) {
    throw new ValidationError(
      "Bitte der Verarbeitung Ihrer Angaben gemäß Datenschutzerklärung zustimmen.",
    );
  }
}

/* ------------------------------ writes ---------------------------- */

/* Tracking code sent by the public form (?kampagne= / utm_campaign).
   Unknown or malformed codes are ignored — a stale flyer link must
   never make the request itself fail. */
function resolveCampaign(db: Database, code: unknown): number | null {
  if (typeof code !== "string" || !code.trim() || code.length > 100) return null;
  if (!tableExists(db, "campaigns")) return null;
  return campaignIdByTrackingCode(db, code);
}

export function createAppointmentRequest(
  db: Database,
  input: Partial<AppointmentRequestInput> & { campaign?: unknown },
): AppointmentRequest {
  const data = normalize(input, EMPTY);
  const row = db
    .query<
      { id: number },
      [string, string, string, string, string, string, string, string, number | null]
    >(
      `INSERT INTO appointment_requests
         (name, phone, email, message, requested_date, requested_time, type, status,
          campaign_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.name,
      data.phone,
      data.email,
      data.message,
      data.requestedDate,
      data.requestedTime,
      data.type,
      data.status,
      resolveCampaign(db, input.campaign),
    )!;
  return getAppointmentRequest(db, row.id);
}

/* "Als Fahrschüler anlegen": link the request to the student created
   from it (null unlinks). The link turns a tracked lead into a signup
   for the campaign statistics. */
export function linkAppointmentRequestStudent(
  db: Database,
  id: number,
  studentId: unknown,
): AppointmentRequest {
  getAppointmentRequest(db, id); // 404 → ValidationError
  if (studentId !== null) {
    if (typeof studentId !== "number" || !Number.isInteger(studentId) || studentId <= 0) {
      throw new ValidationError(
        "Feld 'studentId' muss eine Fahrschüler-ID oder null sein.",
      );
    }
    const exists =
      tableExists(db, "students") &&
      db
        .query<{ n: number }, [number]>("SELECT count(*) AS n FROM students WHERE id = ?")
        .get(studentId)!.n > 0;
    if (!exists) throw new ValidationError("Fahrschüler/in nicht gefunden.");
  }
  const run = db.transaction(() => {
    const previous = db
      .query<{ student_id: number | null }, [number]>(
        "SELECT student_id FROM appointment_requests WHERE id = ?",
      )
      .get(id)!.student_id;
    db.prepare("UPDATE appointment_requests SET student_id = ? WHERE id = ?").run(
      studentId as number | null,
      id,
    );
    const eventIds = requestEventIds(db, id);
    if (eventIds.length === 0) return;
    const placeholders = eventIds.map(() => "?").join(", ");
    if (studentId === null) {
      // Unlinking gives the Termin back to the inbox, but only when it
      // still belongs to the student this request pointed at.
      if (previous !== null) {
        db.prepare(
          `UPDATE calendar_events SET student_id = NULL
           WHERE id IN (${placeholders}) AND student_id = ?`,
        ).run(...eventIds, previous);
      }
      return;
    }
    // Never steal a Termin that was assigned to someone else by hand.
    db.prepare(
      `UPDATE calendar_events SET student_id = ?
       WHERE id IN (${placeholders}) AND (student_id IS NULL OR student_id = ?)`,
    ).run(studentId as number, ...eventIds, previous ?? -1);
    adoptEventInstructor(db, studentId as number, eventIds);
  });
  run();
  return getAppointmentRequest(db, id);
}

const columnExists = (db: Database, table: string, column: string): boolean =>
  tableExists(db, table) &&
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);

/* Calendar events created by accepting this request. Requests accepted
   before event_id existed are matched the way the accept flow creates
   them: title = requester name, subtitle "Terminanfrage", no student. */
function requestEventIds(db: Database, id: number): number[] {
  if (!columnExists(db, "calendar_events", "student_id")) return [];
  const row = db
    .query<{ event_id: number | null; name: string; status: string }, [number]>(
      "SELECT event_id, name, status FROM appointment_requests WHERE id = ?",
    )
    .get(id);
  if (!row) return [];
  if (row.event_id !== null) {
    const exists = db
      .query<{ id: number }, [number]>("SELECT id FROM calendar_events WHERE id = ?")
      .get(row.event_id);
    return exists ? [exists.id] : [];
  }
  if (row.status !== "bestätigt") return [];
  return db
    .query<{ id: number }, [string]>(
      `SELECT id FROM calendar_events
       WHERE subtitle = 'Terminanfrage' AND title = ? AND student_id IS NULL
       ORDER BY date, start`,
    )
    .all(row.name)
    .map((r) => r.id);
}

/* The instructor chosen when confirming the Termin becomes the student's
   instructor — unless the office already assigned one. */
function adoptEventInstructor(db: Database, studentId: number, eventIds: number[]): void {
  if (eventIds.length === 0) return;
  if (!columnExists(db, "students", "instructor_id")) return;
  if (!columnExists(db, "calendar_events", "instructor_id")) return;
  const placeholders = eventIds.map(() => "?").join(", ");
  const instructor = db
    .query<{ instructor_id: number }, number[]>(
      `SELECT instructor_id FROM calendar_events
       WHERE id IN (${placeholders}) AND instructor_id IS NOT NULL
       ORDER BY date, start LIMIT 1`,
    )
    .get(...eventIds);
  if (!instructor) return;
  db.prepare(
    "UPDATE students SET instructor_id = ? WHERE id = ? AND instructor_id IS NULL",
  ).run(instructor.instructor_id, studentId);
}

export function updateAppointmentRequest(
  db: Database,
  id: number,
  input: Partial<AppointmentRequestInput>,
): AppointmentRequest {
  const current = getAppointmentRequest(db, id);
  const data = normalize(input, current);
  db.prepare(
    `UPDATE appointment_requests
     SET name = ?, phone = ?, email = ?, message = ?,
         requested_date = ?, requested_time = ?, type = ?, status = ?
     WHERE id = ?`,
  ).run(
    data.name,
    data.phone,
    data.email,
    data.message,
    data.requestedDate,
    data.requestedTime,
    data.type,
    data.status,
    id,
  );
  return getAppointmentRequest(db, id);
}

export function deleteAppointmentRequest(db: Database, id: number): void {
  getAppointmentRequest(db, id); // 404 → ValidationError
  db.prepare("DELETE FROM appointment_requests WHERE id = ?").run(id);
}

/* ---------------------- accept / decline -------------------------- */

/* Confirm a request: mark it 'bestätigt' and create the matching
   calendar event. `overrides` lets the caller adjust the slot or
   assign instructor/vehicle/location; with no `end` given the event
   defaults to 60 minutes. Runs in one transaction — if the event is
   invalid the status stays untouched. */
export function acceptAppointmentRequest(
  db: Database,
  id: number,
  overrides: AcceptOverrides = {},
): { request: AppointmentRequest; event: CalendarEvent } {
  const request = getAppointmentRequest(db, id);
  if (request.status === "bestätigt") {
    throw new ValidationError("Terminanfrage wurde bereits bestätigt.");
  }

  const date = overrides.date ?? request.requestedDate;
  const start = overrides.start ?? request.requestedTime;
  const end =
    overrides.end ??
    (typeof start === "string" && /^\d{2}:\d{2}$/.test(start)
      ? addMinutes(start, DEFAULT_DURATION_MINUTES)
      : "");

  const run = db.transaction(() => {
    const event = createCalendarEvent(db, {
      date,
      start,
      end,
      title: request.name,
      subtitle: "Terminanfrage",
      location: overrides.location ?? "",
      instructor: overrides.instructor ?? "Nicht zugeteilt",
      vehicle: overrides.vehicle ?? "",
      type: request.type,
      // Already converted ("Als Fahrschüler anlegen" before accepting):
      // the Termin belongs to that student right away.
      ...(request.studentId !== null ? { studentId: request.studentId } : {}),
      allowConflicts: overrides.allowConflicts === true,
    });
    db.prepare(
      "UPDATE appointment_requests SET status = 'bestätigt', event_id = ? WHERE id = ?",
    ).run(Number(event.id), id);
    if (request.studentId !== null) {
      adoptEventInstructor(db, request.studentId, [Number(event.id)]);
    }
    // Confirmation mail (only with an e-mail address and the toggle on) —
    // same transaction, so a failed accept never leaves a stray mail.
    notifyAppointmentRequestConfirmed(db, request, event);
    return event;
  });
  const event = run();
  return { request: getAppointmentRequest(db, id), event };
}

export function declineAppointmentRequest(db: Database, id: number): AppointmentRequest {
  const request = getAppointmentRequest(db, id); // 404 → ValidationError
  const run = db.transaction(() => {
    db.prepare("UPDATE appointment_requests SET status = 'abgelehnt' WHERE id = ?").run(
      id,
    );
    // Declining twice must not mail the requester twice.
    if (request.status !== "abgelehnt") notifyAppointmentRequestDeclined(db, request);
  });
  run();
  return getAppointmentRequest(db, id);
}

/* ------------------------------ routes ---------------------------- */

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new ValidationError("Ungültige Terminanfrage-ID.");
  }
  return id;
}

/* Abuse guard for the public create endpoint (/anfrage form): in-memory,
   per-IP, per-process — must be replaced by a shared store if the app is
   ever load-balanced. Admin routes (PATCH/accept/decline/DELETE) stay
   unlimited. */
const RATE_LIMIT_MAX = 10; // requests
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // per hour per IP

export type AppointmentRequestRouteOptions = {
  rateLimit?: { max: number; windowMs: number } | false;
};

/* Structural subset of Bun's Server the create handler needs — keeps the
   handler assignable to Bun.serve()'s generic route-handler type. */
type RequestIPSource = {
  requestIP(req: Request): { address: string } | null;
};

export function appointmentRequestRoutes(
  db: Database,
  options: AppointmentRequestRouteOptions = {},
) {
  // Self-provision: the table lives outside the db.ts schema, so make
  // sure it exists (and is seeded once) before the first request.
  ensureAppointmentRequestTables(db);

  const rateLimit =
    options.rateLimit === undefined
      ? { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }
      : options.rateLimit;
  const recentByIp = new Map<string, number[]>();

  function rateLimited(ip: string, now: number): boolean {
    if (!rateLimit) return false;
    const cutoff = now - rateLimit.windowMs;
    const recent = (recentByIp.get(ip) ?? []).filter((t) => t > cutoff);
    const limited = recent.length >= rateLimit.max;
    if (!limited) recent.push(now);
    recentByIp.set(ip, recent);
    return limited;
  }

  return {
    "/api/appointment-requests": {
      GET: (req: BunRequest) =>
        handle(() => json({ requests: listAppointmentRequests(db) }))(),
      POST: (req: BunRequest, server?: RequestIPSource) =>
        handle(async () => {
          const ip = server?.requestIP(req)?.address ?? "unknown";
          if (rateLimited(ip, Date.now())) {
            return json(
              { error: "Zu viele Anfragen. Bitte später erneut versuchen." },
              429,
            );
          }
          const body = (await req.json()) as PublicRequestInput;
          const { consent: _consent, ...input } = body;
          // The public form never sets a status — every lead starts "offen".
          const data = { ...input, status: undefined };
          validatePublicRequest(body, schoolToday());
          return json(createAppointmentRequest(db, data), 201);
        })(),
    },

    "/api/appointment-requests/:id": {
      PATCH: (req: BunRequest<"/api/appointment-requests/:id">) =>
        handle(async () =>
          json(
            updateAppointmentRequest(
              db,
              parseId(req.params.id),
              (await req.json()) as Partial<AppointmentRequestInput>,
            ),
          ),
        )(),
      DELETE: (req: BunRequest<"/api/appointment-requests/:id">) =>
        handle(() => {
          deleteAppointmentRequest(db, parseId(req.params.id));
          return json({ ok: true });
        })(),
    },

    "/api/appointment-requests/:id/accept": {
      POST: (req: BunRequest<"/api/appointment-requests/:id/accept">) =>
        handle(async () => {
          // Body is optional — accept with the requested slot by default.
          const body = (await req.json().catch(() => ({}))) as AcceptOverrides;
          return json(acceptAppointmentRequest(db, parseId(req.params.id), body));
        })(),
    },

    "/api/appointment-requests/:id/student": {
      PUT: (req: BunRequest<"/api/appointment-requests/:id/student">) =>
        handle(async () => {
          const body = (await req.json().catch(() => ({}))) as { studentId?: unknown };
          return json(
            linkAppointmentRequestStudent(
              db,
              parseId(req.params.id),
              body.studentId ?? null,
            ),
          );
        })(),
    },

    "/api/appointment-requests/:id/decline": {
      POST: (req: BunRequest<"/api/appointment-requests/:id/decline">) =>
        handle(() => json(declineAppointmentRequest(db, parseId(req.params.id))))(),
    },
  };
}
