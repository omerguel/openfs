/* ------------------------------------------------------------------ */
/* Unit tests for the appointment-requests module: seed, CRUD,         */
/* validation, accept (creates a calendar event) and decline.          */
/* In-memory DB per test; the calendar_events DDL is copied from       */
/* db.ts so createCalendarEvent works without the full schema.         */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";

import {
  acceptAppointmentRequest,
  appointmentRequestRoutes,
  createAppointmentRequest,
  declineAppointmentRequest,
  deleteAppointmentRequest,
  ensureAppointmentRequestTables,
  getAppointmentRequest,
  listAppointmentRequests,
  updateAppointmentRequest,
} from "./appointment-requests";
import { createCalendarEvent, listCalendarEvents } from "./calendar-events";
import { ValidationError } from "./engine";

/* Same DDL as in src/server/db.ts — keeps the test DB minimal.
   Includes the billing columns added in plan 019 so listCalendarEvents
   (which references them) can run against this minimal schema. */
const CALENDAR_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storniert_by INTEGER REFERENCES transactions(id)
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv'
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv'
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- ISO "YYYY-MM-DD"
  start TEXT NOT NULL,           -- "HH:MM"
  end TEXT NOT NULL,             -- "HH:MM"
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  instructor_id INTEGER,
  vehicle_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('Praktisch','Theorie','Vorstellung zur prakt. Prüfung','Theorieprüfung','Andere')),
  tentative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  student_id INTEGER REFERENCES students(id),
  billed_transaction_id INTEGER REFERENCES transactions(id),
  exam_result TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);
`;

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  db.exec(CALENDAR_EVENTS_DDL);
  const addInstructor = db.prepare(
    "INSERT INTO instructors (first_name, last_name) VALUES (?, ?)",
  );
  for (const name of ["Martin Weber", "Nadine Aksoy", "Emre Yilmaz", "Sven Kappel"]) {
    const [first, last] = name.split(" ");
    addInstructor.run(first!, last!);
  }
  const addVehicle = db.prepare("INSERT INTO vehicles (model, plate) VALUES (?, ?)");
  addVehicle.run("VW Golf", "DA-FS 1");
  addVehicle.run("Audi A3", "DA-FS 2");
  ensureAppointmentRequestTables(db);
});

const VALID = {
  name: "Max Mustermann",
  phone: "0151 0000000",
  email: "max@example.de",
  message: "Bitte eine Fahrstunde.",
  requestedDate: "2026-06-18",
  requestedTime: "10:00",
  type: "Praktisch" as const,
};

describe("ensureAppointmentRequestTables", () => {
  test("a fresh DB seeds 9 requests", () => {
    expect(listAppointmentRequests(db)).toHaveLength(9);
  });

  test("seed is mostly 'offen' with a mix of statuses", () => {
    const requests = listAppointmentRequests(db);
    const offen = requests.filter((r) => r.status === "offen");
    expect(offen.length).toBeGreaterThanOrEqual(5);
    expect(requests.some((r) => r.status === "bestätigt")).toBe(true);
    expect(requests.some((r) => r.status === "abgelehnt")).toBe(true);
  });

  test("is idempotent — calling again does not reseed", () => {
    ensureAppointmentRequestTables(db);
    expect(listAppointmentRequests(db)).toHaveLength(9);
  });

  test("does not reseed a non-empty table after deletes", () => {
    db.exec("DELETE FROM appointment_requests WHERE id > 1");
    ensureAppointmentRequestTables(db);
    expect(listAppointmentRequests(db)).toHaveLength(1);
  });
});

describe("createAppointmentRequest", () => {
  test("happy path returns the stored request with defaults", () => {
    const request = createAppointmentRequest(db, VALID);
    expect(request.id).toBeGreaterThan(0);
    expect(request.name).toBe("Max Mustermann");
    expect(request.status).toBe("offen"); // default
    expect(request.createdAt).toBeTruthy();
  });

  test("trims string fields", () => {
    const request = createAppointmentRequest(db, {
      ...VALID,
      name: "  Max  ",
      message: "  hi  ",
    });
    expect(request.name).toBe("Max");
    expect(request.message).toBe("hi");
  });

  test("missing name → ValidationError 'Name ist ein Pflichtfeld.'", () => {
    expect(() => createAppointmentRequest(db, { ...VALID, name: "   " })).toThrow(
      "Name ist ein Pflichtfeld.",
    );
  });

  test("invalid date → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, requestedDate: "18.06.2026" }),
    ).toThrow(ValidationError);
  });

  test("malformed time → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, requestedTime: "9:00" }),
    ).toThrow("Wunschzeit muss im Format HH:MM sein.");
  });

  test("invalid type → ValidationError 'Ungültiger Termin-Typ.'", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, type: "Quatsch" as never }),
    ).toThrow("Ungültiger Termin-Typ.");
  });

  test("invalid status → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, status: "wartend" as never }),
    ).toThrow(ValidationError);
  });

  test("message at the 2000-char cap passes", () => {
    const request = createAppointmentRequest(db, {
      ...VALID,
      message: "m".repeat(2000),
    });
    expect(request.message).toHaveLength(2000);
  });

  test("message over 2000 chars → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, message: "m".repeat(2001) }),
    ).toThrow("Feld 'message' darf maximal 2000 Zeichen lang sein.");
  });

  test("name over 200 chars → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, name: "n".repeat(201) }),
    ).toThrow("Feld 'name' darf maximal 200 Zeichen lang sein.");
  });

  test("phone over 50 chars → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, phone: "0".repeat(51) }),
    ).toThrow("Feld 'phone' darf maximal 50 Zeichen lang sein.");
  });

  test("email over 254 chars → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, {
        ...VALID,
        email: `${"a".repeat(250)}@b.de`,
      }),
    ).toThrow("Feld 'email' darf maximal 254 Zeichen lang sein.");
  });

  test("malformed email → ValidationError", () => {
    expect(() =>
      createAppointmentRequest(db, { ...VALID, email: "not-an-email" }),
    ).toThrow("Feld 'email' muss eine gültige E-Mail-Adresse sein.");
  });

  test("empty email stays allowed (optional field)", () => {
    const request = createAppointmentRequest(db, { ...VALID, email: "" });
    expect(request.email).toBe("");
  });
});

describe("updateAppointmentRequest", () => {
  test("partial update merges over current values", () => {
    const created = createAppointmentRequest(db, VALID);
    const updated = updateAppointmentRequest(db, created.id, {
      requestedTime: "12:30",
    });
    expect(updated.requestedTime).toBe("12:30");
    expect(updated.name).toBe("Max Mustermann"); // unchanged field preserved
    expect(updated.requestedDate).toBe("2026-06-18");
  });

  test("can change status explicitly", () => {
    const created = createAppointmentRequest(db, VALID);
    const updated = updateAppointmentRequest(db, created.id, {
      status: "abgelehnt",
    });
    expect(updated.status).toBe("abgelehnt");
  });

  test("update on missing id → ValidationError", () => {
    expect(() => updateAppointmentRequest(db, 999999, { name: "x" })).toThrow(
      "Terminanfrage nicht gefunden.",
    );
  });
});

describe("deleteAppointmentRequest", () => {
  test("hard-deletes the request", () => {
    const created = createAppointmentRequest(db, VALID);
    const before = listAppointmentRequests(db).length;
    deleteAppointmentRequest(db, created.id);
    expect(listAppointmentRequests(db).length).toBe(before - 1);
    expect(() => getAppointmentRequest(db, created.id)).toThrow(
      "Terminanfrage nicht gefunden.",
    );
  });

  test("delete on missing id → ValidationError", () => {
    expect(() => deleteAppointmentRequest(db, 999999)).toThrow(
      "Terminanfrage nicht gefunden.",
    );
  });
});

describe("acceptAppointmentRequest", () => {
  test("sets status 'bestätigt' and creates a 60min calendar event", () => {
    const created = createAppointmentRequest(db, VALID);
    const eventsBefore = listCalendarEvents(db).length;

    const { request, event } = acceptAppointmentRequest(db, created.id);

    expect(request.status).toBe("bestätigt");
    expect(listCalendarEvents(db).length).toBe(eventsBefore + 1);
    expect(event.title).toBe("Max Mustermann"); // title = requester name
    expect(event.date).toBe("2026-06-18");
    expect(event.start).toBe("10:00");
    expect(event.end).toBe("11:00"); // default 60min duration
    expect(event.type).toBe("Praktisch");
    expect(event.instructor).toBe("Nicht zugeteilt");
  });

  test("overrides adjust date, time, duration and instructor", () => {
    const created = createAppointmentRequest(db, VALID);
    const { event } = acceptAppointmentRequest(db, created.id, {
      date: "2026-06-20",
      start: "08:00",
      end: "09:30",
      instructor: "Martin Weber",
    });
    expect(event.date).toBe("2026-06-20");
    expect(event.start).toBe("08:00");
    expect(event.end).toBe("09:30");
    expect(event.instructor).toBe("Martin Weber");
  });

  test("already accepted request cannot be accepted again", () => {
    const created = createAppointmentRequest(db, VALID);
    acceptAppointmentRequest(db, created.id);
    expect(() => acceptAppointmentRequest(db, created.id)).toThrow(
      "Terminanfrage wurde bereits bestätigt.",
    );
  });

  test("invalid override keeps the status untouched (transaction)", () => {
    const created = createAppointmentRequest(db, VALID);
    expect(
      () => acceptAppointmentRequest(db, created.id, { end: "09:00" }), // before start
    ).toThrow(ValidationError);
    expect(getAppointmentRequest(db, created.id).status).toBe("offen");
  });

  test("accept on missing id → ValidationError", () => {
    expect(() => acceptAppointmentRequest(db, 999999)).toThrow(
      "Terminanfrage nicht gefunden.",
    );
  });
});

describe("conflict detection", () => {
  /* The request slot is requestedTime + 60min (the accept default). */
  const findRequest = (id: number) =>
    listAppointmentRequests(db).find((r) => r.id === id)!;

  test("open request overlapping an event lists it as conflict", () => {
    createCalendarEvent(db, {
      date: VALID.requestedDate,
      start: "10:30",
      end: "11:30",
      title: "Fahrstunde · Stadt",
      instructor: "Nadine Aksoy",
      type: "Praktisch",
    });
    const created = createAppointmentRequest(db, VALID); // 10:00 → 11:00
    const conflicts = findRequest(created.id).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      title: "Fahrstunde · Stadt",
      start: "10:30",
      end: "11:30",
      instructor: "Nadine Aksoy",
    });
  });

  test("events on the same day without overlap are not conflicts", () => {
    createCalendarEvent(db, {
      date: VALID.requestedDate,
      start: "11:00", // request window ends 11:00 — touching, not overlapping
      end: "12:00",
      title: "Fahrstunde",
      instructor: "Emre Yilmaz",
      type: "Praktisch",
    });
    const created = createAppointmentRequest(db, VALID);
    expect(findRequest(created.id).conflicts).toHaveLength(0);
  });

  test("events on another date are not conflicts", () => {
    createCalendarEvent(db, {
      date: "2026-06-19",
      start: "10:00",
      end: "11:00",
      title: "Fahrstunde",
      instructor: "Emre Yilmaz",
      type: "Praktisch",
    });
    const created = createAppointmentRequest(db, VALID);
    expect(findRequest(created.id).conflicts).toHaveLength(0);
  });

  test("accepted requests carry no conflicts (their own event overlaps)", () => {
    const created = createAppointmentRequest(db, VALID);
    acceptAppointmentRequest(db, created.id);
    expect(findRequest(created.id).conflicts).toHaveLength(0);
  });
});

describe("declineAppointmentRequest", () => {
  test("sets status 'abgelehnt' without creating an event", () => {
    const created = createAppointmentRequest(db, VALID);
    const eventsBefore = listCalendarEvents(db).length;
    const declined = declineAppointmentRequest(db, created.id);
    expect(declined.status).toBe("abgelehnt");
    expect(listCalendarEvents(db).length).toBe(eventsBefore);
  });

  test("decline on missing id → ValidationError", () => {
    expect(() => declineAppointmentRequest(db, 999999)).toThrow(
      "Terminanfrage nicht gefunden.",
    );
  });
});

describe("appointmentRequestRoutes", () => {
  test("exposes all endpoints with the expected methods", () => {
    const routes = appointmentRequestRoutes(db);
    expect(Object.keys(routes["/api/appointment-requests"])).toEqual(["GET", "POST"]);
    expect(Object.keys(routes["/api/appointment-requests/:id"])).toEqual([
      "PATCH",
      "DELETE",
    ]);
    expect(Object.keys(routes["/api/appointment-requests/:id/accept"])).toEqual(["POST"]);
    expect(Object.keys(routes["/api/appointment-requests/:id/decline"])).toEqual([
      "POST",
    ]);
  });

  test("HTTP round-trip: list, create, accept, decline, delete", async () => {
    const server = Bun.serve({
      port: 0,
      routes: appointmentRequestRoutes(db),
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const url = (path: string) => new URL(path, server.url).href;

      // GET list (seeded)
      const listRes = await fetch(url("/api/appointment-requests"));
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { requests: { id: number }[] };
      expect(list.requests.length).toBeGreaterThanOrEqual(8);

      // POST create
      const createRes = await fetch(url("/api/appointment-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: number };

      // POST accept with overrides → calendar event
      const acceptRes = await fetch(
        url(`/api/appointment-requests/${created.id}/accept`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructor: "Martin Weber" }),
        },
      );
      expect(acceptRes.status).toBe(200);
      const accepted = (await acceptRes.json()) as {
        request: { status: string };
        event: { title: string; instructor: string };
      };
      expect(accepted.request.status).toBe("bestätigt");
      expect(accepted.event.title).toBe("Max Mustermann");
      expect(accepted.event.instructor).toBe("Martin Weber");

      // POST decline on another seeded request
      const open = list.requests[0]!;
      const declineRes = await fetch(
        url(`/api/appointment-requests/${open.id}/decline`),
        { method: "POST" },
      );
      expect(declineRes.status).toBe(200);

      // PATCH
      const patchRes = await fetch(url(`/api/appointment-requests/${created.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "030 123456" }),
      });
      expect(patchRes.status).toBe(200);
      expect(((await patchRes.json()) as { phone: string }).phone).toBe("030 123456");

      // DELETE
      const deleteRes = await fetch(url(`/api/appointment-requests/${created.id}`), {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(200);

      // Validation errors surface as 400
      const badRes = await fetch(url("/api/appointment-requests/abc"), {
        method: "DELETE",
      });
      expect(badRes.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });
});

describe("rate limiting on public create", () => {
  const serve = (rateLimit: { max: number; windowMs: number } | false) =>
    Bun.serve({
      port: 0,
      routes: appointmentRequestRoutes(db, { rateLimit }),
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });

  const post = (base: URL) =>
    fetch(new URL("/api/appointment-requests", base).href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID),
    });

  test("third POST from the same IP returns 429 (max 2)", async () => {
    const server = serve({ max: 2, windowMs: 60_000 });
    try {
      expect((await post(server.url)).status).toBe(201);
      expect((await post(server.url)).status).toBe(201);
      const third = await post(server.url);
      expect(third.status).toBe(429);
      expect(((await third.json()) as { error: string }).error).toBe(
        "Zu viele Anfragen. Bitte später erneut versuchen.",
      );

      // Admin/status routes stay unlimited — decline still works.
      const url = (path: string) => new URL(path, server.url).href;
      const listRes = await fetch(url("/api/appointment-requests"));
      const { requests } = (await listRes.json()) as {
        requests: { id: number; status: string }[];
      };
      const open = requests.find((r) => r.status === "offen")!;
      const declineRes = await fetch(
        url(`/api/appointment-requests/${open.id}/decline`),
        { method: "POST" },
      );
      expect(declineRes.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("rateLimit: false disables the limiter", async () => {
    const server = serve(false);
    try {
      for (let i = 0; i < 3; i++) {
        expect((await post(server.url)).status).toBe(201);
      }
    } finally {
      server.stop(true);
    }
  });
});
