/* ------------------------------------------------------------------ */
/* Integration tests for the HTTP route layer.                         */
/* Spins up a real Bun.serve() server on a random free port and sends  */
/* actual HTTP requests.                                               */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "./db";
import {
  accountingRoutes,
  calendarEventRoutes,
  exportRoutes,
  instructorRoutes,
  pricePlanRoutes,
  studentRoutes,
  vehicleRoutes,
} from "./routes";
import { openSqlite } from "./sqlite";
import { attestationRoutes, ensureAttestationTables } from "./ausbildungsnachweis";
import { getSchoolProfile } from "./school-profile";

/* ------------------------------------------------------------------ */
/* Server setup — one server for the whole file.                       */
/* Unique counter ensures no conflicting contract/customer numbers.    */
/* ------------------------------------------------------------------ */

const db = openDb(":memory:");
let server: ReturnType<typeof serve>;

beforeAll(() => {
  ensureAttestationTables(db);
  server = serve({
    port: 0,
    routes: {
      ...accountingRoutes(db),
      ...attestationRoutes(db),
      ...calendarEventRoutes(db),
      ...exportRoutes(db),
      ...instructorRoutes(db),
      ...pricePlanRoutes(db),
      ...studentRoutes(db),
      ...vehicleRoutes(db),
    },
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => server.stop(true));

let seq = 0;
function uniq(prefix = "") {
  return `${prefix}${++seq}-rt-${Date.now()}`;
}

function url(path: string): string {
  return new URL(path, server.url).href;
}

/* ================================================================== */
/* Students                                                             */
/* ================================================================== */

describe("GET /api/students", () => {
  test("returns 200 with students array", async () => {
    const res = await fetch(url("/api/students"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { students: unknown[] };
    expect(Array.isArray(body.students)).toBe(true);
  });
});

describe("POST /api/students", () => {
  test("valid body → 201, returns record with id", async () => {
    const id = uniq();
    const res = await fetch(url("/api/students"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Rudi",
        lastName: "Route",
        contractNumber: `V-${id}`,
        customerNumber: `K-${id}`,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(typeof body.id).toBe("number");
    expect(body.id).toBeGreaterThan(0);
  });

  test("empty body {} → 400, German error message", async () => {
    const res = await fetch(url("/api/students"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("PATCH /api/students/:id", () => {
  test("non-numeric id 'abc' → 400 with Ungültige message", async () => {
    const res = await fetch(url("/api/students/abc"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "123" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ungültige");
  });

  test("valid numeric id that doesn't exist → 400 with nicht gefunden", async () => {
    const res = await fetch(url("/api/students/999999"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "123" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("nicht gefunden");
  });
});

describe("DELETE /api/students/:id", () => {
  test("valid id → 200 { ok: true }, then GET list no longer contains it", async () => {
    const id = uniq();
    const postRes = await fetch(url("/api/students"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Delete",
        lastName: "Me",
        contractNumber: `V-DEL-${id}`,
        customerNumber: `K-DEL-${id}`,
      }),
    });
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as { id: number };
    expect(created.id).toBeGreaterThan(0);

    const delRes = await fetch(url(`/api/students/${created.id}`), {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);

    const listRes = await fetch(url("/api/students"));
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { students: { id: number }[] };
    const ids = list.students.map((s) => s.id);
    expect(ids).not.toContain(created.id);
  });

  test("non-numeric id 'abc' → 400", async () => {
    const res = await fetch(url("/api/students/abc"), {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ungültige");
  });
});

/* ================================================================== */
/* Instructors                                                          */
/* ================================================================== */

describe("POST /api/instructors + DELETE /api/instructors/:id", () => {
  test("POST valid instructor → 201; DELETE → 200 { ok: true }", async () => {
    const postRes = await fetch(url("/api/instructors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Route",
        lastName: "Lehrer",
        phone: "",
        email: "",
        classes: "B",
        vehicle: "",
        since: "2025-01-01",
        status: "aktiv",
      }),
    });
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as { id: number };
    expect(created.id).toBeGreaterThan(0);

    const delRes = await fetch(url(`/api/instructors/${created.id}`), {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);
  });
});

/* ================================================================== */
/* Vehicles                                                             */
/* ================================================================== */

describe("POST /api/vehicles", () => {
  test("valid body → 201", async () => {
    const plate = uniq("PLATE-");
    const res = await fetch(url("/api/vehicles"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "RouteAuto",
        plate,
        klass: "B",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBeGreaterThan(0);
  });

  test("missing plate → 400", async () => {
    const res = await fetch(url("/api/vehicles"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "RouteAuto",
        klass: "B",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});

describe("GET /api/vehicle-options", () => {
  test("returns 200 with vehicleOptions array ending with 'Nicht zugeteilt'", async () => {
    const res = await fetch(url("/api/vehicle-options"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vehicleOptions: string[] };
    expect(Array.isArray(body.vehicleOptions)).toBe(true);
    const options = body.vehicleOptions;
    expect(options[options.length - 1]).toBe("Nicht zugeteilt");
  });
});

/* ================================================================== */
/* Calendar events                                                      */
/* ================================================================== */

const validEvent = {
  date: "2026-06-10",
  start: "09:00",
  end: "10:00",
  title: "Route-Test Termin",
  instructor: "Martin Weber",
  type: "Praktisch",
};

describe("GET /api/calendar-events", () => {
  test("returns 200 with events array (9 seeded)", async () => {
    const res = await fetch(url("/api/calendar-events"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(9);
  });
});

describe("POST /api/calendar-events", () => {
  test("valid body → 201 with string id", async () => {
    const res = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
  });

  test("end before start → 400", async () => {
    const res = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validEvent, start: "12:00", end: "11:00" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ende");
  });
});

describe("DELETE /api/calendar-events/:id", () => {
  test("valid id → 200 { ok: true }", async () => {
    const postRes = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });
    const created = (await postRes.json()) as { id: string };
    const delRes = await fetch(url(`/api/calendar-events/${created.id}`), {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);
  });

  test("non-numeric id 'abc' → 400 with Ungültige message", async () => {
    const res = await fetch(url("/api/calendar-events/abc"), {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ungültige");
  });
});

/* ================================================================== */
/* Student balances                                                     */
/* ================================================================== */

describe("GET /api/student-balances", () => {
  test("returns 200 with balances array; deposit shows correct balance", async () => {
    // Post a payment for a fresh student.
    const id = uniq();
    await fetch(url("/api/accounting/transactions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "zahlung_guthaben",
        date: "2026-06-09",
        amountCents: 50000,
        geldkonto: "1600",
        paymentMethod: "bar",
        student: {
          customerNo: `B-${id}`,
          name: `Balance Tester ${id}`,
          address: "",
          contractNo: "",
          classes: "B",
        },
      }),
    });

    const res = await fetch(url("/api/student-balances"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balances: { customerNo: string; balanceCents: number }[];
    };
    expect(Array.isArray(body.balances)).toBe(true);
    const entry = body.balances.find((b) => b.customerNo === `B-${id}`);
    expect(entry).toBeDefined();
    expect(entry!.balanceCents).toBe(50000);
  });
});

/* ================================================================== */
/* Accounting                                                           */
/* ================================================================== */

describe("PATCH /api/accounting/accounts/:number", () => {
  test("{ active: 'yes' } → 400 with German error message", async () => {
    const res = await fetch(url("/api/accounting/accounts/1600"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("active");
    expect(body.error).toContain("boolean");
  });
});

/* ================================================================== */
/* Profile                                                              */
/* ================================================================== */

describe("GET /api/profile", () => {
  test("returns 200 with name field", async () => {
    const res = await fetch(url("/api/profile"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(typeof body.name).toBe("string");
    expect(body.name.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/profile", () => {
  test("name with whitespace comes back trimmed", async () => {
    const res = await fetch(url("/api/profile"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  Neue Fahrschule  " }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Neue Fahrschule");
  });

  test("synchronizes the website with the public school profile", async () => {
    const res = await fetch(url("/api/profile"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: " https://neue-seite.example " }),
    });
    expect(res.status).toBe(200);

    expect(getSchoolProfile(db).website).toBe("https://neue-seite.example");
  });
});

/* ================================================================== */
/* Database export                                                       */
/* ================================================================== */

describe("GET /api/export/database", () => {
  test("200, .db in content-disposition, non-empty body with SQLite magic header", async () => {
    const res = await fetch(url("/api/export/database"));
    expect(res.status).toBe(200);

    // content-disposition must mention .db
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(".db");

    // body must be non-empty
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);

    // first 16 bytes: "SQLite format 3\0"
    const header = new TextDecoder().decode(new Uint8Array(buf, 0, 15));
    expect(header).toBe("SQLite format 3");
  });

  test("bonus: serialized bytes open as a valid SQLite db with a students table", async () => {
    const res = await fetch(url("/api/export/database"));
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // write to a temp file outside of data/
    const tmpPath = join(tmpdir(), `openfs-test-export-${Date.now()}.db`);
    await Bun.write(tmpPath, bytes);

    const tmpDb = openSqlite(tmpPath);
    const row = tmpDb
      .query<{ n: number }, []>("SELECT count(*) AS n FROM students")
      .get();
    tmpDb.close();

    expect(row).not.toBeNull();
    expect(typeof row!.n).toBe("number");
  });
});

/* ================================================================== */
/* POST /api/calendar-events/:id/bill                                  */
/* ================================================================== */

/** Create a student via the API, return the created student. */
async function createTestStudent(): Promise<{
  id: number;
  customerNumber: string;
  contractNumber: string;
}> {
  const tag = uniq("bill");
  const res = await fetch(url("/api/students"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Bill",
      lastName: "Test",
      contractNumber: `V-${tag}`,
      customerNumber: `K-${tag}`,
      classes: "B",
      address: "Teststr. 1",
    }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{
    id: number;
    customerNumber: string;
    contractNumber: string;
  }>;
}

/** Create a Praktisch event linked to a student. */
async function createPraktischEvent(studentId: number): Promise<{ id: string }> {
  const res = await fetch(url("/api/calendar-events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-06-15",
      start: "09:00",
      end: "09:45",
      title: "Fahrstunde",
      instructor: "Martin Weber",
      type: "Praktisch",
      studentId,
    }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

describe("POST /api/calendar-events/:id/bill", () => {
  test("happy path: bills event, returns transaction + updated event with billedActive=true", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const billBody = {
      type: "guthaben_uebertragung",
      date: "2026-06-15",
      amountCents: 6500,
      habenKonto: "4400",
      student: {
        customerNo: student.customerNumber,
        name: "Bill Test",
        address: "Teststr. 1",
        contractNo: student.contractNumber,
        classes: "B",
      },
      description: "FS Bill Test - B, Fahrübungsstunde (45)",
    };

    const res = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(billBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      transaction: { id: number };
      event: { billedTransactionId: number; billedActive: boolean };
    };
    expect(typeof body.transaction.id).toBe("number");
    expect(body.event.billedTransactionId).toBe(body.transaction.id);
    expect(body.event.billedActive).toBe(true);
  });

  test("batch flow: two sequential bill calls on two events of the same student → two distinct transactions, both events billedActive", async () => {
    const student = await createTestStudent();
    const eventA = await createPraktischEvent(student.id);
    const eventB = await createPraktischEvent(student.id);

    const billBody = {
      type: "guthaben_uebertragung",
      date: "2026-06-15",
      amountCents: 6500,
      habenKonto: "4400",
      student: {
        customerNo: student.customerNumber,
        name: "Bill Test",
        address: "Teststr. 1",
        contractNo: student.contractNumber,
        classes: "B",
      },
      description: "FS Bill Test - B, Fahrübungsstunde (45)",
    };

    type BillResponse = {
      transaction: { id: number; belegNr: string | null };
      event: { billedTransactionId: number; billedActive: boolean };
    };

    const results: BillResponse[] = [];
    for (const event of [eventA, eventB]) {
      const res = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(billBody),
      });
      expect(res.status).toBe(201);
      results.push((await res.json()) as BillResponse);
    }

    const [first, second] = results as [BillResponse, BillResponse];
    // Each lesson is its own attributable transaction.
    expect(second.transaction.id).not.toBe(first.transaction.id);
    // guthaben_uebertragung carries no Beleg number by design (the receipt
    // was issued at the Anzahlung) — distinct transaction ids are the
    // per-lesson attribution guarantee here.
    expect(first.transaction.belegNr).toBeNull();
    expect(second.transaction.belegNr).toBeNull();
    expect(first.event.billedTransactionId).toBe(first.transaction.id);
    expect(second.event.billedTransactionId).toBe(second.transaction.id);
    expect(first.event.billedActive).toBe(true);
    expect(second.event.billedActive).toBe(true);
  });

  test("billing an already-billed event → 400 'bereits abgerechnet'", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const billBody = {
      type: "guthaben_uebertragung",
      date: "2026-06-15",
      amountCents: 6500,
      habenKonto: "4400",
      student: {
        customerNo: student.customerNumber,
        name: "Bill Test",
        address: "Teststr. 1",
        contractNo: student.contractNumber,
        classes: "B",
      },
      description: "FS Bill Test - B, Fahrübungsstunde (45)",
    };

    const first = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(billBody),
    });
    expect(first.status).toBe(201);

    // Second billing attempt must fail.
    const second = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(billBody),
    });
    expect(second.status).toBe(400);
    const errBody = (await second.json()) as { error: string };
    expect(errBody.error).toContain("abgerechnet");
  });

  test("billing a Theorie (lesson) event → 400 'praktische Fahrstunden'", async () => {
    const res1 = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-06-15",
        start: "10:00",
        end: "11:30",
        title: "Theorieunterricht",
        instructor: "Martin Weber",
        type: "Theorie",
      }),
    });
    expect(res1.status).toBe(201);
    const theoryEvent = (await res1.json()) as { id: string };

    const res = await fetch(url(`/api/calendar-events/${theoryEvent.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "guthaben_uebertragung",
        date: "2026-06-15",
        amountCents: 5000,
        habenKonto: "4400",
        student: {
          customerNo: "X",
          name: "X",
          address: "",
          contractNo: "X",
          classes: "B",
        },
        description: "Test",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("praktische");
  });

  test("billing a practical exam books service + TÜV fee as one two-line transaction", async () => {
    const student = await createTestStudent();
    const created = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-06-20",
        start: "09:00",
        end: "10:00",
        title: "Praktische Prüfung",
        instructor: "Martin Weber",
        type: "Vorstellung zur prakt. Prüfung",
        studentId: student.id,
      }),
    });
    expect(created.status).toBe(201);
    const exam = (await created.json()) as { id: string };

    const res = await fetch(url(`/api/calendar-events/${exam.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "guthaben_uebertragung",
        date: "2026-06-20",
        amountCents: 28000 + 12983,
        student: {
          customerNo: student.customerNumber,
          name: "Bill Test",
          address: "",
          contractNo: student.contractNumber,
          classes: "B",
        },
        description: "",
        lines: [
          { habenKonto: "4400", amountCents: 28000, description: "Praktische Prüfung" },
          { habenKonto: "1370", amountCents: 12983, description: "TÜV-Gebühr Praxis" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      transaction: { id: number; bookings: { haben: string }[] };
      event: { billedActive: boolean };
    };
    expect(body.transaction.bookings.map((b) => b.haben)).toEqual(["4400", "1370"]);
    expect(body.event.billedActive).toBe(true);
  });

  test("billing event without studentId → 400 'Kein Fahrschüler'", async () => {
    const res1 = await fetch(url("/api/calendar-events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-06-15",
        start: "11:00",
        end: "11:45",
        title: "Fahrstunde ohne Student",
        instructor: "Martin Weber",
        type: "Praktisch",
        // No studentId
      }),
    });
    expect(res1.status).toBe(201);
    const evt = (await res1.json()) as { id: string };

    const res = await fetch(url(`/api/calendar-events/${evt.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "guthaben_uebertragung",
        date: "2026-06-15",
        amountCents: 5000,
        habenKonto: "4400",
        student: {
          customerNo: "X",
          name: "X",
          address: "",
          contractNo: "X",
          classes: "B",
        },
        description: "Test",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Fahrschüler");
  });

  test("body with wrong type 'zahlung_guthaben' → 400, no transaction linked to event", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "zahlung_guthaben",
        date: "2026-06-15",
        amountCents: 6500,
        habenKonto: "4400",
        student: {
          customerNo: student.customerNumber,
          name: "Bill Test",
          address: "Teststr. 1",
          contractNo: student.contractNumber,
          classes: "B",
        },
        description: "FS Bill Test - B, Fahrübungsstunde (45)",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("guthaben_uebertragung");

    // Verify no transaction was linked: the event is still not billed.
    const eventRes = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "guthaben_uebertragung",
        date: "2026-06-15",
        amountCents: 6500,
        habenKonto: "4400",
        student: {
          customerNo: student.customerNumber,
          name: "Bill Test",
          address: "Teststr. 1",
          contractNo: student.contractNumber,
          classes: "B",
        },
        description: "FS Bill Test - B, Fahrübungsstunde (45)",
      }),
    });
    // A successful re-bill (201) confirms the event was never marked billed.
    expect(eventRes.status).toBe(201);
  });

  test("storno the transaction, then re-bill succeeds with a new transaction id", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const billBody = {
      type: "guthaben_uebertragung",
      date: "2026-06-15",
      amountCents: 6500,
      habenKonto: "4400",
      student: {
        customerNo: student.customerNumber,
        name: "Bill Test",
        address: "Teststr. 1",
        contractNo: student.contractNumber,
        classes: "B",
      },
      description: "FS Bill Test - B, Fahrübungsstunde (45)",
    };

    const billRes = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(billBody),
    });
    expect(billRes.status).toBe(201);
    const billData = (await billRes.json()) as {
      transaction: { id: number };
      event: { billedTransactionId: number };
    };
    const txId = billData.transaction.id;

    // Storno the transaction.
    const stornoRes = await fetch(url(`/api/accounting/transactions/${txId}/storno`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Test-Storno", date: "2026-06-10" }),
    });
    expect(stornoRes.status).toBe(201);

    // Now re-bill should succeed.
    const rebillRes = await fetch(url(`/api/calendar-events/${event.id}/bill`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(billBody),
    });
    expect(rebillRes.status).toBe(201);
    const rebillData = (await rebillRes.json()) as {
      transaction: { id: number };
      event: { billedTransactionId: number };
    };
    expect(rebillData.transaction.id).not.toBe(txId);
    expect(rebillData.event.billedTransactionId).toBe(rebillData.transaction.id);
  });
});

/* ================================================================== */
/* Attestation routes (Ausbildungsnachweis)                            */
/* ================================================================== */

const VALID_SIGNATURE = "data:image/png;base64,iVBORw0KGgo=";

/** Create a calendar event of the given type linked to a student. */
async function createEventOfType(
  type: string,
  studentId: number,
): Promise<{ id: number }> {
  const res = await fetch(url("/api/calendar-events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-06-16",
      start: "10:00",
      end: "10:45",
      title: type,
      instructor: "Martin Weber",
      type,
      studentId,
    }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: number }>;
}

function attestationBody(studentId: number) {
  return {
    studentId,
    instructor: "Martin Weber",
    content: "Grundfahraufgaben, Einparken, Autobahn",
    durationMin: 45,
    signatureDataUrl: VALID_SIGNATURE,
  };
}

describe("GET /api/attestations", () => {
  test("without studentId → 400 with error", async () => {
    const res = await fetch(url("/api/attestations"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("with studentId → 200, empty list for fresh student", async () => {
    const student = await createTestStudent();
    const res = await fetch(url(`/api/attestations?studentId=${student.id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attestations: unknown[] };
    expect(body.attestations).toEqual([]);
  });
});

describe("POST /api/calendar-events/:id/attestation", () => {
  test("happy path → 201 with attestation matching eventId/studentId", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(student.id)),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attestation: { eventId: number; studentId: number };
    };
    expect(body.attestation.eventId).toBe(Number(event.id));
    expect(body.attestation.studentId).toBe(student.id);

    // List for the student is now non-empty.
    const listRes = await fetch(url(`/api/attestations?studentId=${student.id}`));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { attestations: unknown[] };
    expect(listBody.attestations.length).toBe(1);
  });

  test("non-Praktisch event → 400", async () => {
    const student = await createTestStudent();
    const event = await createEventOfType("Theorie", student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(student.id)),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("mismatched studentId → 400", async () => {
    const student = await createTestStudent();
    const other = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(other.id)),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("duplicate attestation for the same event → 400", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const first = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(student.id)),
    });
    expect(first.status).toBe(201);

    const second = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(student.id)),
    });
    expect(second.status).toBe(400);
  });

  test("invalid JSON body → 400", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/calendar-events/:id/attestation", () => {
  test("404 before create, 200 after", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const before = await fetch(url(`/api/calendar-events/${event.id}/attestation`));
    expect(before.status).toBe(404);

    const create = await fetch(url(`/api/calendar-events/${event.id}/attestation`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestationBody(student.id)),
    });
    expect(create.status).toBe(201);

    const after = await fetch(url(`/api/calendar-events/${event.id}/attestation`));
    expect(after.status).toBe(200);
    const body = (await after.json()) as { attestation: { eventId: number } };
    expect(body.attestation.eventId).toBe(Number(event.id));
  });
});

/* ================================================================== */
/* POST /api/calendar-events/:id/exam-result                           */
/* ================================================================== */

describe("POST /api/calendar-events/:id/exam-result", () => {
  test("'bestanden' on Theorieprüfung → 200, re-GET shows examResult", async () => {
    const student = await createTestStudent();
    const event = await createEventOfType("Theorieprüfung", student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/exam-result`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "bestanden" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { examResult?: string };
    expect(body.examResult).toBe("bestanden");

    // Re-GET via the list endpoint shows the persisted result.
    const listRes = await fetch(
      url("/api/calendar-events?from=2026-06-16&to=2026-06-16"),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      events: { id: string; examResult?: string }[];
    };
    // Calendar event ids are serialized as strings.
    const found = listBody.events.find((e) => String(e.id) === String(event.id));
    expect(found?.examResult).toBe("bestanden");
  });

  test("result null clears a previously set result", async () => {
    const student = await createTestStudent();
    const event = await createEventOfType("Theorieprüfung", student.id);

    const set = await fetch(url(`/api/calendar-events/${event.id}/exam-result`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "nicht_bestanden" }),
    });
    expect(set.status).toBe(200);

    const clear = await fetch(url(`/api/calendar-events/${event.id}/exam-result`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: null }),
    });
    expect(clear.status).toBe(200);
    const body = (await clear.json()) as { examResult?: string };
    expect(body.examResult).toBeUndefined();
  });

  test("invalid result 'vielleicht' → 400", async () => {
    const student = await createTestStudent();
    const event = await createEventOfType("Theorieprüfung", student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/exam-result`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "vielleicht" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("non-exam (Praktisch) event → 400", async () => {
    const student = await createTestStudent();
    const event = await createPraktischEvent(student.id);

    const res = await fetch(url(`/api/calendar-events/${event.id}/exam-result`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "bestanden" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });
});
