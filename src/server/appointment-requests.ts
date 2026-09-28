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
import { ValidationError } from "./engine";
import { handle, json } from "./http";
import {
  notifyAppointmentRequestConfirmed,
  notifyAppointmentRequestDeclined,
} from "./notifications";

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
};

export type AppointmentRequestInput = Omit<AppointmentRequest, "id" | "createdAt">;

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
];

const SEED: SeedRow[] = [
  [
    "Lena Hoffmann",
    "0151 23456701",
    "lena.hoffmann@web.de",
    "Ich hätte gerne eine Fahrstunde am Nachmittag, gerne auch Autobahn.",
    "2026-06-15",
    "14:00",
    "Praktisch",
    "offen",
  ],
  [
    "Jonas Becker",
    "0160 9876512",
    "jonas.becker@gmx.de",
    "Kann ich am Dienstag am Theorieunterricht teilnehmen?",
    "2026-06-16",
    "18:00",
    "Theorie",
    "offen",
  ],
  [
    "Miriam Schulz",
    "0176 44455566",
    "miriam.schulz@outlook.de",
    "Mein Fahrlehrer meinte, ich bin bereit für die Prüfung.",
    "2026-06-22",
    "09:30",
    "Vorstellung zur prakt. Prüfung",
    "offen",
  ],
  [
    "Tarek Yılmaz",
    "0157 11223344",
    "tarek.yilmaz@gmail.com",
    "Doppelstunde wäre super, am liebsten Schaltwagen.",
    "2026-06-17",
    "16:30",
    "Praktisch",
    "offen",
  ],
  [
    "Sophie Wagner",
    "0152 99887766",
    "sophie.wagner@web.de",
    "Anmeldung zur Theorieprüfung — alle Pflichtstunden sind erledigt.",
    "2026-06-24",
    "11:00",
    "Theorieprüfung",
    "offen",
  ],
  [
    "David Krüger",
    "0171 55667788",
    "david.krueger@gmail.com",
    "Bitte eine Fahrstunde vor der Arbeit, früh morgens.",
    "2026-06-12",
    "07:30",
    "Praktisch",
    "bestätigt",
  ],
  [
    "Anna Lehmann",
    "0159 33221100",
    "anna.lehmann@gmx.de",
    "Geht am Sonntag eine Theoriestunde?",
    "2026-06-14",
    "10:00",
    "Theorie",
    "abgelehnt",
  ],
  [
    "Felix Neumann",
    "030 4455667",
    "felix.neumann@posteo.de",
    "Beratungsgespräch zum Umstieg von B197 auf B gewünscht.",
    "2026-06-19",
    "15:00",
    "Andere",
    "offen",
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
const CONFLICTING_SEED: SeedRow = [
  "Ben Albers",
  "0163 7788990",
  "ben.albers@web.de",
  "Geht Dienstagmorgen eine Fahrstunde? Ich habe erst ab Mittag Uni.",
  currentWeekDate(1),
  "09:15",
  "Praktisch",
  "offen",
];

export function ensureAppointmentRequestTables(db: Database): void {
  db.exec(TABLE_DDL);

  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM appointment_requests")
    .get()!.n;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO appointment_requests
       (name, phone, email, message, requested_date, requested_time, type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seed = db.transaction(() => {
    for (const row of [...SEED, CONFLICTING_SEED]) insert.run(...row);
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
});

const SELECT =
  "SELECT id, name, phone, email, message, requested_date, requested_time, type, status, created_at FROM appointment_requests";

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

/* Only open requests carry conflicts — accepted ones would always
   collide with the calendar event their own acceptance created. */
export function listAppointmentRequests(db: Database): AppointmentRequestWithConflicts[] {
  return db
    .query<AppointmentRequestRow, []>(
      `${SELECT} ORDER BY requested_date, requested_time, id`,
    )
    .all()
    .map(toRequest)
    .map((request) => ({
      ...request,
      conflicts:
        request.status === "offen"
          ? findConflictingEvents(db, request.requestedDate, request.requestedTime)
          : [],
    }));
}

export function getAppointmentRequest(db: Database, id: number): AppointmentRequest {
  const row = db.query<AppointmentRequestRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
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

/* ------------------------------ writes ---------------------------- */

export function createAppointmentRequest(
  db: Database,
  input: Partial<AppointmentRequestInput>,
): AppointmentRequest {
  const data = normalize(input, EMPTY);
  const row = db
    .query<
      { id: number },
      [string, string, string, string, string, string, string, string]
    >(
      `INSERT INTO appointment_requests
         (name, phone, email, message, requested_date, requested_time, type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
    )!;
  return getAppointmentRequest(db, row.id);
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
      allowConflicts: overrides.allowConflicts === true,
    });
    db.prepare("UPDATE appointment_requests SET status = 'bestätigt' WHERE id = ?").run(
      id,
    );
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
          return json(
            createAppointmentRequest(
              db,
              (await req.json()) as Partial<AppointmentRequestInput>,
            ),
            201,
          );
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

    "/api/appointment-requests/:id/decline": {
      POST: (req: BunRequest<"/api/appointment-requests/:id/decline">) =>
        handle(() => json(declineAppointmentRequest(db, parseId(req.params.id))))(),
    },
  };
}
