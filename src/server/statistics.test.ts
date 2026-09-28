/* ------------------------------------------------------------------ */
/* Unit tests for the Statistik aggregations: per-section fixtures in  */
/* an in-memory DB with only the tables the module reads. DDL strings  */
/* are copied from src/server/db.ts (no seeds — deterministic counts). */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";
import type { BunRequest } from "bun";

import {
  examStatistics,
  getStatistics,
  instructorStatistics,
  lessonStatistics,
  registrationMonth,
  revenueStatistics,
  statisticsRoutes,
  studentStatistics,
  vehicleStatistics,
} from "./statistics";

/* DDL copied from db.ts — only the tables statistics.ts queries. */
const TEST_DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  vat_rate INTEGER,
  vat_label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  opening_cents INTEGER,
  opening_date TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_nr TEXT UNIQUE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  payment_method TEXT,
  description TEXT NOT NULL DEFAULT '',
  student_customer_no TEXT,
  student_name TEXT,
  student_address TEXT,
  student_contract_no TEXT,
  student_classes TEXT,
  storno_of INTEGER REFERENCES transactions(id),
  storno_reason TEXT,
  storniert_by INTEGER REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  buchung_nr TEXT NOT NULL UNIQUE,
  soll_account TEXT NOT NULL REFERENCES accounts(number),
  haben_account TEXT NOT NULL REFERENCES accounts(number),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  vat_rate INTEGER,
  net_cents INTEGER,
  vat_cents INTEGER,
  line_description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birthday TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  classes TEXT NOT NULL DEFAULT '',
  driving_school TEXT NOT NULL DEFAULT '',
  registration_date TEXT NOT NULL DEFAULT '',
  contract_number TEXT NOT NULL UNIQUE,
  customer_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'inaktiv')),
  instructor_id INTEGER,
  vehicle_id INTEGER,
  balance TEXT NOT NULL DEFAULT '0,00 EUR',
  last_lesson TEXT NOT NULL DEFAULT 'Nicht geplant',
  next_lesson TEXT NOT NULL DEFAULT 'Nicht geplant',
  progress INTEGER NOT NULL DEFAULT 0,
  lessons TEXT NOT NULL DEFAULT '[]',
  documents TEXT NOT NULL DEFAULT '[]',
  theory TEXT NOT NULL DEFAULT '{}',
  price_plan_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  classes TEXT NOT NULL DEFAULT '',
  vehicle_id INTEGER,
  since TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'inaktiv')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  plate TEXT NOT NULL UNIQUE,
  klass TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'wartung')),
  accent TEXT NOT NULL DEFAULT 'bg-slate-500/10 text-slate-600',
  details TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  instructor_id INTEGER,
  vehicle_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('Praktisch','Theorie','Vorstellung zur prakt. Prüfung','Theorieprüfung','Andere')),
  tentative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  student_id INTEGER,
  billed_transaction_id INTEGER,
  exam_result TEXT,
  cancelled_at TEXT
);
`;

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(TEST_DDL);
});

/* ------------------------------ fixtures --------------------------- */

let studentSeq = 0;
function insertStudent(status: "aktiv" | "inaktiv", registrationDate: string) {
  studentSeq += 1;
  db.prepare(
    `INSERT INTO students (first_name, last_name, registration_date, contract_number, customer_number, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "Test",
    `Schüler${studentSeq}`,
    registrationDate,
    `V-${studentSeq}`,
    `K-${studentSeq}`,
    status,
  );
}

const FIRST_NAMES: Record<string, string> = {
  Weber: "Martin",
  Aksoy: "Nadine",
  Kappel: "Sven",
};

function insertInstructor(status: "aktiv" | "inaktiv", lastName: string) {
  db.prepare(
    "INSERT INTO instructors (first_name, last_name, status) VALUES (?, ?, ?)",
  ).run(FIRST_NAMES[lastName] ?? "Test", lastName, status);
}

let vehicleSeq = 0;
function insertVehicle(status: "aktiv" | "wartung") {
  vehicleSeq += 1;
  db.prepare(
    "INSERT INTO vehicles (model, plate, klass, status) VALUES (?, ?, ?, ?)",
  ).run("VW Golf", `DA-FS ${vehicleSeq}`, "B", status);
}

function insertEvent(
  date: string,
  start: string,
  end: string,
  type: string,
  instructor = "Martin Weber",
) {
  const [first = "", last = ""] = instructor.split(" ");
  let row = db
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM instructors WHERE first_name = ? AND last_name = ?",
    )
    .get(first, last);
  if (!row) {
    row = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO instructors (first_name, last_name) VALUES (?, ?) RETURNING id",
      )
      .get(first, last)!;
  }
  db.prepare(
    `INSERT INTO calendar_events (date, start, "end", title, instructor_id, type)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(date, start, end, "Termin", row.id, type);
}

function insertAccounts() {
  const insert = db.prepare(
    "INSERT INTO accounts (number, name, kind, vat_rate, vat_label) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("1600", "Kasse", "geldkonto", null, "Nicht zutreffend");
  insert.run("4400", "Erlöse 19 % USt", "erloes", 19, "19%");
  insert.run("3272", "Erhaltene Anzahlungen 19 % USt", "anzahlung", 19, "19%");
}

let belegSeq = 0;
function insertRevenue(
  date: string,
  amountCents: number,
  options: { haben?: string; stornoOf?: number } = {},
): number {
  belegSeq += 1;
  const tx = db
    .query<{ id: number }, [string, string, number | null]>(
      `INSERT INTO transactions (beleg_nr, date, type, storno_of)
       VALUES (?, ?, 'zahlung', ?) RETURNING id`,
    )
    .get(`T${belegSeq}`, date, options.stornoOf ?? null)!;
  db.prepare(
    `INSERT INTO bookings (transaction_id, buchung_nr, soll_account, haben_account, amount_cents)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tx.id, `B${belegSeq}`, "1600", options.haben ?? "4400", amountCents);
  if (options.stornoOf) {
    db.prepare("UPDATE transactions SET storniert_by = ? WHERE id = ?").run(
      tx.id,
      options.stornoOf,
    );
  }
  return tx.id;
}

/* --------------------------- registrationMonth --------------------- */

describe("registrationMonth", () => {
  test("parses the German seed format DD.MM.YYYY", () => {
    expect(registrationMonth("12.05.2026")).toBe("2026-05");
  });

  test("parses ISO dates", () => {
    expect(registrationMonth("2026-05-12")).toBe("2026-05");
    expect(registrationMonth("2026-05")).toBe("2026-05");
  });

  test("returns null for empty or free text", () => {
    expect(registrationMonth("")).toBeNull();
    expect(registrationMonth("unbekannt")).toBeNull();
  });
});

/* --------------------------- studentStatistics --------------------- */

describe("studentStatistics", () => {
  test("counts statuses and groups registrations per month", () => {
    insertStudent("aktiv", "12.05.2026");
    insertStudent("aktiv", "03.05.2026");
    insertStudent("aktiv", "2026-04-21");
    insertStudent("inaktiv", "09.03.2026");
    insertStudent("aktiv", ""); // no date — counted in totals, not per month

    const stats = studentStatistics(db, new Date(2026, 4, 20));
    expect(stats.total).toBe(5);
    expect(stats.aktiv).toBe(4);
    expect(stats.inaktiv).toBe(1);
    expect(stats.registrationsPerMonth).toEqual([
      { month: "2026-03", count: 1 },
      { month: "2026-04", count: 1 },
      { month: "2026-05", count: 2 },
    ]);
  });

  test("months without signups count as 0 up to the current month", () => {
    insertStudent("aktiv", "12.05.2026");
    insertStudent("aktiv", "03.09.2026");
    const stats = studentStatistics(db, new Date(2026, 10, 2));
    expect(stats.registrationsPerMonth).toEqual([
      { month: "2026-05", count: 1 },
      { month: "2026-06", count: 0 },
      { month: "2026-07", count: 0 },
      { month: "2026-08", count: 0 },
      { month: "2026-09", count: 1 },
      { month: "2026-10", count: 0 },
      { month: "2026-11", count: 0 },
    ]);
  });

  test("year boundaries roll over", () => {
    insertStudent("aktiv", "15.11.2025");
    const stats = studentStatistics(db, new Date(2026, 1, 1));
    expect(stats.registrationsPerMonth.map((r) => r.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  test("no registrations → empty list", () => {
    expect(studentStatistics(db).registrationsPerMonth).toEqual([]);
  });
});

/* ---------------------------- lessonStatistics --------------------- */

describe("lessonStatistics", () => {
  test("totals by type and pivots months into stacked buckets", () => {
    insertEvent("2026-05-04", "09:00", "10:00", "Praktisch");
    insertEvent("2026-05-05", "09:00", "10:00", "Praktisch");
    insertEvent("2026-05-06", "18:00", "19:30", "Theorie");
    insertEvent("2026-06-01", "10:00", "10:45", "Theorieprüfung");
    insertEvent("2026-06-02", "14:00", "15:30", "Vorstellung zur prakt. Prüfung");
    insertEvent("2026-06-03", "09:00", "11:00", "Andere");

    const stats = lessonStatistics(db);
    expect(stats.total).toBe(6);
    expect(stats.byType[0]).toEqual({ type: "Praktisch", count: 2 });
    expect(stats.byType).toHaveLength(5);
    expect(stats.perMonth).toEqual([
      { month: "2026-05", praktisch: 2, theorie: 1, pruefung: 0, andere: 0, total: 3 },
      { month: "2026-06", praktisch: 0, theorie: 0, pruefung: 2, andere: 1, total: 3 },
    ]);
  });

  test("empty calendar yields zeroed statistics", () => {
    const stats = lessonStatistics(db);
    expect(stats.total).toBe(0);
    expect(stats.byType).toEqual([]);
    expect(stats.perMonth).toEqual([]);
  });
});

/* -------------------------- instructorStatistics ------------------- */

describe("instructorStatistics", () => {
  test("counts instructors and sums event minutes per instructor", () => {
    insertInstructor("aktiv", "Weber");
    insertInstructor("aktiv", "Aksoy");
    insertInstructor("inaktiv", "Kappel");

    insertEvent("2026-06-01", "09:00", "09:45", "Praktisch", "Nadine Aksoy");
    insertEvent("2026-06-02", "10:00", "11:30", "Praktisch", "Martin Weber");
    insertEvent("2026-06-03", "18:00", "19:30", "Theorie", "Martin Weber");

    const stats = instructorStatistics(db);
    expect(stats.total).toBe(3);
    expect(stats.aktiv).toBe(2);
    // Sorted by minutes descending.
    expect(stats.utilization).toEqual([
      { instructor: "Martin Weber", events: 2, minutes: 180 },
      { instructor: "Nadine Aksoy", events: 1, minutes: 45 },
    ]);
  });
});

/* ---------------------------- vehicleStatistics -------------------- */

describe("vehicleStatistics", () => {
  test("splits the fleet into aktiv and wartung", () => {
    insertVehicle("aktiv");
    insertVehicle("aktiv");
    insertVehicle("wartung");

    expect(vehicleStatistics(db)).toEqual({ total: 3, aktiv: 2, wartung: 1 });
  });

  test("empty fleet yields zeros", () => {
    expect(vehicleStatistics(db)).toEqual({ total: 0, aktiv: 0, wartung: 0 });
  });
});

/* ---------------------------- revenueStatistics -------------------- */

describe("revenueStatistics", () => {
  test("sums Erlös bookings per month and excludes storno pairs", () => {
    insertAccounts();
    insertRevenue("2026-05-10", 10000);
    insertRevenue("2026-05-20", 5000);
    insertRevenue("2026-06-01", 20000);

    // Storno pair: original + reversal both drop out of the revenue sums.
    const storniert = insertRevenue("2026-06-05", 7000);
    insertRevenue("2026-06-06", 7000, { stornoOf: storniert });

    // Anzahlung (Guthaben) is not revenue yet — must not be counted.
    insertRevenue("2026-06-10", 3000, { haben: "3272" });

    const stats = revenueStatistics(db);
    expect(stats.perMonth).toEqual([
      { month: "2026-05", cents: 15000 },
      { month: "2026-06", cents: 20000 },
    ]);
    expect(stats.totalCents).toBe(35000);
  });
});

/* ------------------------------- routes ---------------------------- */

describe("statisticsRoutes", () => {
  test("GET /api/statistics returns the combined payload", async () => {
    insertStudent("aktiv", "12.05.2026");
    insertVehicle("aktiv");
    insertInstructor("aktiv", "Weber");
    insertEvent("2026-06-01", "09:00", "10:00", "Praktisch");
    insertAccounts();
    insertRevenue("2026-06-01", 10000);

    const routes = statisticsRoutes(db);
    const response = await routes["/api/statistics"].GET(
      new Request("http://localhost/api/statistics") as BunRequest,
    );
    expect(response.status).toBe(200);

    const payload = (await response.json()) as ReturnType<typeof getStatistics>;
    expect(payload.students.total).toBe(1);
    expect(payload.lessons.total).toBe(1);
    expect(payload.instructors.aktiv).toBe(1);
    expect(payload.vehicles.aktiv).toBe(1);
    expect(payload.revenue.totalCents).toBe(10000);
  });

  test("payload matches getStatistics on an empty database", () => {
    const stats = getStatistics(db);
    expect(stats.students).toEqual({
      total: 0,
      aktiv: 0,
      inaktiv: 0,
      registrationsPerMonth: [],
    });
    expect(stats.revenue).toEqual({ totalCents: 0, perMonth: [] });
    expect(stats.instructors.utilization).toEqual([]);
  });

  test("getStatistics includes exams section", () => {
    const stats = getStatistics(db);
    expect(stats.exams).toBeDefined();
    expect(Array.isArray(stats.exams.byType)).toBe(true);
    expect(stats.exams.byType).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* examStatistics                                                       */
/* ------------------------------------------------------------------ */

function insertStudent2(seq: number): number {
  return db
    .query<{ id: number }, [string, string, string, string]>(
      `INSERT INTO students (first_name, last_name, contract_number, customer_number)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get("Test", `Schüler${seq}`, `V-ES-${seq}`, `K-ES-${seq}`)!.id;
}

function insertExamEvent(
  type: "Theorieprüfung" | "Vorstellung zur prakt. Prüfung",
  date: string,
  examResult: string | null,
  studentId: number | null,
): void {
  db.prepare(
    `INSERT INTO calendar_events (date, start, "end", title, type, exam_result, student_id)
     VALUES (?, '09:00', '11:00', 'Prüfung', ?, ?, ?)`,
  ).run(date, type, examResult, studentId);
}

describe("examStatistics", () => {
  test("empty DB: totals zero, firstAttemptPassRate null for each exam type", () => {
    const result = examStatistics(db);
    expect(result.byType).toHaveLength(2);
    for (const row of result.byType) {
      expect(row.total).toBe(0);
      expect(row.bestanden).toBe(0);
      expect(row.nicht_bestanden).toBe(0);
      expect(row.offen).toBe(0);
      expect(row.firstAttemptPassRate).toBeNull();
    }
  });

  test("counts bestanden / nicht_bestanden / offen correctly", () => {
    const s1 = insertStudent2(100);
    const s2 = insertStudent2(101);
    insertExamEvent("Theorieprüfung", "2026-01-01", "bestanden", s1);
    insertExamEvent("Theorieprüfung", "2026-01-10", "nicht_bestanden", s2);
    insertExamEvent("Theorieprüfung", "2026-01-20", null, null); // offen, no student
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    expect(theorie.total).toBe(3);
    expect(theorie.bestanden).toBe(1);
    expect(theorie.nicht_bestanden).toBe(1);
    expect(theorie.offen).toBe(1);
  });

  test("first-attempt pass rate: single pass = 100%", () => {
    const s1 = insertStudent2(200);
    insertExamEvent("Theorieprüfung", "2026-02-01", "bestanden", s1);
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    expect(theorie.firstAttemptPassRate).toBeCloseTo(1.0);
  });

  test("first-attempt pass rate: fail-then-pass counts as NOT first-attempt passed", () => {
    const s1 = insertStudent2(300);
    insertExamEvent("Theorieprüfung", "2026-03-01", "nicht_bestanden", s1); // first
    insertExamEvent("Theorieprüfung", "2026-03-15", "bestanden", s1); // second — ignored for rate
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    // first attempt = nicht_bestanden → rate 0
    expect(theorie.firstAttemptPassRate).toBeCloseTo(0.0);
  });

  test("first attempt is the earliest DATE, not the earliest id (insert order reversed)", () => {
    const s1 = insertStudent2(350);
    const s2 = insertStudent2(351);
    // s1: later date inserted FIRST (lower id), earlier date inserted second.
    insertExamEvent("Theorieprüfung", "2026-03-20", "bestanden", s1); // lower id, later date
    insertExamEvent("Theorieprüfung", "2026-03-05", "nicht_bestanden", s1); // higher id, earlier date → first attempt
    insertExamEvent("Theorieprüfung", "2026-03-10", "bestanden", s2);
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    // s1 first attempt = nicht_bestanden (earlier date), s2 = bestanden → 1/2
    expect(theorie.firstAttemptPassRate).toBeCloseTo(0.5);
  });

  test("events with NULL student_id excluded from first-attempt rate but counted in totals", () => {
    insertExamEvent("Theorieprüfung", "2026-04-01", "bestanden", null); // no student_id
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    expect(theorie.total).toBe(1);
    expect(theorie.bestanden).toBe(1);
    expect(theorie.firstAttemptPassRate).toBeNull(); // excluded
  });

  test("Vorstellung zur prakt. Prüfung tracked separately from Theorieprüfung", () => {
    const s1 = insertStudent2(400);
    insertExamEvent("Theorieprüfung", "2026-05-01", "bestanden", s1);
    insertExamEvent(
      "Vorstellung zur prakt. Prüfung",
      "2026-05-10",
      "nicht_bestanden",
      s1,
    );
    const result = examStatistics(db);
    const theorie = result.byType.find((r) => r.type === "Theorieprüfung")!;
    const praktisch = result.byType.find(
      (r) => r.type === "Vorstellung zur prakt. Prüfung",
    )!;
    expect(theorie.total).toBe(1);
    expect(theorie.bestanden).toBe(1);
    expect(praktisch.total).toBe(1);
    expect(praktisch.nicht_bestanden).toBe(1);
  });
});

describe("cancelled Termine", () => {
  test("are left out of lesson counts and instructor utilization", () => {
    insertEvent("2026-06-01", "09:00", "09:45", "Praktisch");
    insertEvent("2026-06-02", "09:00", "09:45", "Praktisch");
    db.prepare(
      "UPDATE calendar_events SET cancelled_at = '2026-05-30' WHERE date = ?",
    ).run("2026-06-02");
    expect(lessonStatistics(db).total).toBe(1);
    expect(instructorStatistics(db).utilization[0]).toMatchObject({
      events: 1,
      minutes: 45,
    });
  });
});
