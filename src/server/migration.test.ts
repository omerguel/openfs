import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import {
  migrateCalendarEventBilling,
  migrateCalendarEventScheduling,
  migrateExamResults,
  migrateSkr03ToSkr04,
  openDb,
} from "./db";
import { listAccounts, listJournal, listLedger } from "./engine";
import { seedTransactions } from "./seed";
import { openSqlite } from "./sqlite";

/* Simulates a database created before the SKR-04 switch: same chart,
   SKR-03 numbers. The migration must remap accounts AND bookings in
   place without losing data — including the collision where the old
   1800 (Privatentnahmen) overlaps the new 1800 (Bank). */

const SKR04_TO_SKR03: [string, string][] = [
  ["1600", "1000"], // Kasse
  ["1800", "1200"], // Bank
  ["1460", "1360"], // Geldtransit
  ["1406", "1576"], // Vorsteuer 19 %
  ["1370", "1590"], // Durchlaufende Posten
  ["3272", "1718"], // Erhaltene Anzahlungen 19 %
  ["3806", "1776"], // Umsatzsteuer 19 %
  ["2100", "1800"], // Privatentnahmen  ← collides with new Bank number
  ["2180", "1890"], // Privateinlagen
  ["7310", "2110"],
  ["6310", "4210"],
  ["7685", "4510"],
  ["6520", "4520"],
  ["6530", "4530"],
  ["6540", "4540"],
  ["6815", "4930"],
  ["4100", "8100"],
  ["4300", "8300"],
  ["4400", "8400"],
];

let db: Database;

/** Build a legacy SKR-03 database: seed normally, then rename back. */
function downgradeToSkr03(db: Database) {
  db.exec("PRAGMA foreign_keys = OFF;");
  const tmp = db.prepare("UPDATE accounts SET number = ? WHERE number = ?");
  for (const [neu] of SKR04_TO_SKR03) tmp.run(`tmp:${neu}`, neu);
  for (const [neu, alt] of SKR04_TO_SKR03) {
    db.prepare("UPDATE accounts SET number = ? WHERE number = ?").run(alt, `tmp:${neu}`);
    db.prepare("UPDATE bookings SET soll_account = ? WHERE soll_account = ?").run(
      alt,
      neu,
    );
    db.prepare("UPDATE bookings SET haben_account = ? WHERE haben_account = ?").run(
      alt,
      neu,
    );
  }
  db.exec("PRAGMA foreign_keys = ON;");
}

beforeEach(() => {
  db = openDb(":memory:");
  seedTransactions(db);
  downgradeToSkr03(db);
});

describe("SKR 03 → SKR 04 migration", () => {
  test("legacy fixture really looks like SKR 03", () => {
    const numbers = new Set(listAccounts(db).map((a) => a.number));
    expect(numbers.has("8400")).toBe(true);
    expect(numbers.has("4400")).toBe(false);
    // legacy 1800 is Privatentnahmen, not Bank
    expect(listAccounts(db).find((a) => a.number === "1800")?.name).toBe(
      "Privatentnahmen allgemein",
    );
  });

  test("remaps accounts and bookings, resolving the 1800 collision", () => {
    const before = listLedger(db, {});
    migrateSkr03ToSkr04(db);

    const accounts = new Map(listAccounts(db).map((a) => [a.number, a]));
    expect(accounts.get("1600")?.name).toBe("Kasse");
    expect(accounts.get("1800")?.name).toBe("Bank"); // not Privatentnahmen
    expect(accounts.get("2100")?.name).toBe("Privatentnahmen allgemein");
    expect(accounts.get("3272")?.name).toBe("Erhaltene Anzahlungen 19 % USt");
    expect(accounts.get("4400")?.name).toBe("Erlöse 19 % USt");
    // no SKR-03 numbers left
    for (const alt of ["1000", "1360", "1590", "1718", "8400", "8300", "8100"]) {
      expect(accounts.has(alt)).toBe(false);
    }
    expect(accounts.size).toBe(19);

    // every booking now references SKR-04 accounts — none dangling
    const journal = listJournal(db, {});
    expect(journal).toHaveLength(13);
    for (const row of journal) {
      expect(accounts.has(row.sollKonto)).toBe(true);
      expect(accounts.has(row.habenKonto)).toBe(true);
    }
    const zahlung = journal.find((r) => r.belegNr === "T0000124A")!;
    expect(zahlung.sollKonto).toBe("1600");
    expect(zahlung.habenKonto).toBe("3272");

    // balances unchanged by the renumbering
    const after = listLedger(db, {});
    expect(after.openingCents).toBe(before.openingCents);
    expect(after.closingCents).toBe(before.closingCents);
    expect(after.rows).toHaveLength(before.rows.length);
  });

  test("is idempotent and leaves fresh SKR-04 databases alone", () => {
    migrateSkr03ToSkr04(db);
    migrateSkr03ToSkr04(db); // second run must be a no-op
    expect(listAccounts(db)).toHaveLength(19);
    expect(listAccounts(db).find((a) => a.number === "1800")?.name).toBe("Bank");

    const fresh = openDb(":memory:");
    seedTransactions(fresh);
    migrateSkr03ToSkr04(fresh);
    expect(listAccounts(fresh).find((a) => a.number === "1800")?.name).toBe("Bank");
  });
});

/* ------------------------------------------------------------------ */
/* calendar_events billing migration                                   */
/* ------------------------------------------------------------------ */

/** Helper: build a bare-bones in-memory DB with calendar_events but
    WITHOUT the new billing columns (simulates a pre-migration schema). */
function openLegacyDb(): Database {
  const legacy = openSqlite(":memory:");
  legacy.exec("PRAGMA foreign_keys = ON;");
  // Minimal DDL — only what migrateCalendarEventBilling needs to exist.
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storniert_by INTEGER REFERENCES transactions(id)
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      "end" TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      instructor TEXT NOT NULL DEFAULT '',
      vehicle TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      tentative INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return legacy;
}

describe("migrateCalendarEventBilling", () => {
  test("adds student_id and billed_transaction_id columns to a legacy DB", () => {
    const legacy = openLegacyDb();
    const colsBefore = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    expect(colsBefore).not.toContain("student_id");
    expect(colsBefore).not.toContain("billed_transaction_id");

    migrateCalendarEventBilling(legacy);

    const colsAfter = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    expect(colsAfter).toContain("student_id");
    expect(colsAfter).toContain("billed_transaction_id");
  });

  test("running migration twice is a no-op (idempotent)", () => {
    const legacy = openLegacyDb();
    migrateCalendarEventBilling(legacy);
    // Second run must not throw or add duplicate columns.
    expect(() => migrateCalendarEventBilling(legacy)).not.toThrow();
    const cols = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    expect(cols.filter((c) => c === "student_id")).toHaveLength(1);
    expect(cols.filter((c) => c === "billed_transaction_id")).toHaveLength(1);
  });

  test("back-fill links event to student when subtitle matches exactly one student name", () => {
    const legacy = openLegacyDb();
    // Insert one student named "Lena Braun".
    legacy.run(
      "INSERT INTO students (first_name, last_name) VALUES (?, ?)",
      "Lena",
      "Braun",
    );
    legacy.run("SELECT last_insert_rowid() as id");
    // Insert an event whose subtitle exactly matches.
    legacy.run(
      `INSERT INTO calendar_events (date, start, "end", title, subtitle, type)
       VALUES ('2026-06-10', '09:00', '10:00', 'Fahrstunde', 'Lena Braun', 'Praktisch')`,
    );
    const row = legacy
      .query<{ id: number }, []>("SELECT id FROM calendar_events LIMIT 1")
      .get()!;

    migrateCalendarEventBilling(legacy);

    const sid = legacy
      .query<{ id: number }, []>(
        "SELECT id FROM students WHERE first_name='Lena' AND last_name='Braun'",
      )
      .get()!.id;
    const linked = legacy
      .query<{ student_id: number | null }, [number]>(
        "SELECT student_id FROM calendar_events WHERE id = ?",
      )
      .get(row.id)!;
    expect(linked.student_id).toBe(sid);
  });

  test("back-fill leaves NULL when subtitle matches zero students", () => {
    const legacy = openLegacyDb();
    legacy.run(
      `INSERT INTO calendar_events (date, start, "end", title, subtitle, type)
       VALUES ('2026-06-10', '09:00', '10:00', 'Fahrstunde', 'Unbekannt Müller', 'Praktisch')`,
    );
    const row = legacy
      .query<{ id: number }, []>("SELECT id FROM calendar_events LIMIT 1")
      .get()!;

    migrateCalendarEventBilling(legacy);

    const linked = legacy
      .query<{ student_id: number | null }, [number]>(
        "SELECT student_id FROM calendar_events WHERE id = ?",
      )
      .get(row.id)!;
    expect(linked.student_id).toBeNull();
  });

  test("back-fill leaves NULL when subtitle matches multiple students (ambiguous)", () => {
    const legacy = openLegacyDb();
    // Two students with the same name.
    legacy.run(
      "INSERT INTO students (first_name, last_name) VALUES (?, ?)",
      "Ali",
      "Yilmaz",
    );
    legacy.run(
      "INSERT INTO students (first_name, last_name) VALUES (?, ?)",
      "Ali",
      "Yilmaz",
    );
    legacy.run(
      `INSERT INTO calendar_events (date, start, "end", title, subtitle, type)
       VALUES ('2026-06-10', '09:00', '10:00', 'Fahrstunde', 'Ali Yilmaz', 'Praktisch')`,
    );
    const row = legacy
      .query<{ id: number }, []>("SELECT id FROM calendar_events LIMIT 1")
      .get()!;

    migrateCalendarEventBilling(legacy);

    const linked = legacy
      .query<{ student_id: number | null }, [number]>(
        "SELECT student_id FROM calendar_events WHERE id = ?",
      )
      .get(row.id)!;
    expect(linked.student_id).toBeNull();
  });

  test("openDb (fresh) already has the billing columns via DDL + migration", () => {
    const fresh = openDb(":memory:");
    const cols = fresh
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    // openDb calls migrateCalendarEventBilling; even a new DB that already
    // has the columns from the DDL seed must pass the idempotency check.
    // (Current DDL does NOT include these columns — they are only added via
    // the migration. A fresh DB gains them from migrateCalendarEventBilling.)
    expect(cols).toContain("student_id");
    expect(cols).toContain("billed_transaction_id");
  });
});

/* Helper: minimal legacy DB without exam-result columns. */
function openLegacyDbNoExamCols(): Database {
  const db = openSqlite(":memory:");
  db.exec(`
    CREATE TABLE calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL,
      title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '', instructor TEXT NOT NULL DEFAULT 'Nicht zugeteilt',
      vehicle TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'Praktisch', tentative INTEGER NOT NULL DEFAULT 0,
      student_id INTEGER, billed_transaction_id INTEGER
    );
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
      birthday TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      classes TEXT NOT NULL DEFAULT '', driving_school TEXT NOT NULL DEFAULT '',
      registration_date TEXT NOT NULL DEFAULT '', contract_number TEXT NOT NULL DEFAULT '',
      customer_number TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aktiv',
      instructor TEXT NOT NULL DEFAULT 'Nicht zugeteilt',
      vehicle TEXT NOT NULL DEFAULT 'Nicht zugeteilt',
      balance TEXT NOT NULL DEFAULT '0,00 EUR',
      last_lesson TEXT NOT NULL DEFAULT '', next_lesson TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      lessons TEXT NOT NULL DEFAULT '[]', documents TEXT NOT NULL DEFAULT '[]',
      theory TEXT NOT NULL DEFAULT '{}', price_plan_id INTEGER
    );
  `);
  return db;
}

describe("migrateExamResults", () => {
  test("adds exam_result to calendar_events and license_date to students", () => {
    const legacy = openLegacyDbNoExamCols();
    const eventColsBefore = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    const studentColsBefore = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(eventColsBefore).not.toContain("exam_result");
    expect(studentColsBefore).not.toContain("license_date");

    migrateExamResults(legacy);

    const eventColsAfter = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    const studentColsAfter = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(eventColsAfter).toContain("exam_result");
    expect(studentColsAfter).toContain("license_date");
  });

  test("running migration twice is a no-op (idempotent)", () => {
    const legacy = openLegacyDbNoExamCols();
    migrateExamResults(legacy);
    expect(() => migrateExamResults(legacy)).not.toThrow();
    const eventCols = legacy
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    const studentCols = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(eventCols.filter((c) => c === "exam_result")).toHaveLength(1);
    expect(studentCols.filter((c) => c === "license_date")).toHaveLength(1);
  });

  test("openDb (fresh) gains both columns from migrateExamResults", () => {
    const fresh = openDb(":memory:");
    const eventCols = fresh
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);
    const studentCols = fresh
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(eventCols).toContain("exam_result");
    expect(studentCols).toContain("license_date");
  });
});

describe("migrateCalendarEventScheduling", () => {
  const SCHEDULING_COLS = [
    "lesson_kind",
    "series_id",
    "cancelled_at",
    "cancellation_kind",
    "cancellation_fee_transaction_id",
  ];
  const eventCols = (db: Database) =>
    db
      .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
      .all()
      .map((c) => c.name);

  test("adds the scheduling columns to a legacy table, idempotently", () => {
    const legacy = openLegacyDbNoExamCols();
    for (const col of SCHEDULING_COLS) expect(eventCols(legacy)).not.toContain(col);
    migrateCalendarEventScheduling(legacy);
    expect(() => migrateCalendarEventScheduling(legacy)).not.toThrow();
    const cols = eventCols(legacy);
    for (const col of SCHEDULING_COLS) {
      expect(cols.filter((c) => c === col)).toHaveLength(1);
    }
  });

  test("CHECK constraints reject unknown lesson / cancellation kinds", () => {
    const fresh = openDb(":memory:");
    const id = fresh
      .query<{ id: number }, []>("SELECT id FROM calendar_events LIMIT 1")
      .get()!.id;
    expect(() =>
      fresh
        .prepare("UPDATE calendar_events SET lesson_kind = 'Stadtfahrt' WHERE id = ?")
        .run(id),
    ).toThrow();
    expect(() =>
      fresh
        .prepare(
          "UPDATE calendar_events SET cancellation_kind = 'vergessen' WHERE id = ?",
        )
        .run(id),
    ).toThrow();
    fresh
      .prepare("UPDATE calendar_events SET lesson_kind = 'Nachtfahrt' WHERE id = ?")
      .run(id);
  });
});
