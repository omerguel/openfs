import { beforeEach, describe, expect, test } from "bun:test";

import { createCalendarEvent } from "./calendar-events";
import { backfillLessonKinds, migrateDerivedStudentFields, openDb } from "./db";
import { createTransaction } from "./engine";
import { openSqlite, type Database } from "./sqlite";
import { deriveStudentFacts } from "./student-facts";
import { createStudent, getStudent, updateStudent, type StudentRecord } from "./students";
import { ensureTheoryGroupTables } from "./theory-groups";
import { requiredTheoryUnits } from "../lib/theory";

let db: Database;
let student: StudentRecord;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Fakt",
    lastName: "Test",
    contractNumber: `V-F-${seq}`,
    customerNumber: `F-${seq}`,
  });
});

const lesson = (date: string, start: string, end: string, extra = {}) =>
  createCalendarEvent(db, {
    date,
    start,
    end,
    title: "Fahrstunde",
    type: "Praktisch",
    studentId: student.id,
    allowConflicts: true,
    ...extra,
  } as never);

describe("deriveStudentFacts", () => {
  test("balance comes from the ledger", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-01",
      amountCents: 45_000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: {
        customerNo: student.customerNumber,
        name: "Fakt Test",
        address: "",
        contractNo: student.contractNumber,
        classes: "B",
      },
    });
    const fresh = getStudent(db, student.id);
    expect(fresh.balanceCents).toBe(45_000);
    expect(fresh.balance).toBe("450,00 EUR");
  });

  test("last and next lesson from the calendar, cancelled ones skipped", () => {
    lesson("2026-06-01", "09:00", "09:45");
    lesson("2026-06-03", "10:00", "10:45");
    const cancelled = lesson("2026-06-02", "08:00", "08:45");
    db.prepare("UPDATE calendar_events SET cancelled_at = 'x' WHERE id = ?").run(
      Number(cancelled.id),
    );
    const facts = deriveStudentFacts(
      db,
      [{ id: student.id, customerNumber: student.customerNumber }],
      new Date(2026, 5, 2, 12, 0),
    ).get(student.id)!;
    expect(facts.lastLesson).toBe("01.06.2026, 09:00");
    expect(facts.nextLesson).toBe("03.06.2026, 10:00");
  });

  test("Sonderfahrten minutes from tagged practical lessons", () => {
    lesson("2026-06-01", "09:00", "10:30", { lessonKind: "Autobahnfahrt" });
    lesson("2026-06-01", "20:00", "20:45", { lessonKind: "Nachtfahrt" });
    lesson("2026-12-01", "09:00", "10:30", { lessonKind: "Autobahnfahrt" }); // future
    const facts = deriveStudentFacts(
      db,
      [{ id: student.id, customerNumber: student.customerNumber }],
      new Date(2026, 5, 2),
    ).get(student.id)!;
    expect(facts.lessons).toEqual([
      { label: "Überlandfahrt", done: "0/225min" },
      { label: "Autobahnfahrt", done: "90/180min" },
      { label: "Nachtfahrt", done: "45/135min" },
      { label: "Theorieunterricht", done: "0/14 Einheiten" },
    ]);
  });
});

describe("theory from attendance", () => {
  const NOW = new Date(2026, 5, 20, 12, 0); // 20.06.2026

  // The demo seed gives group members some attendance — start clean.
  beforeEach(() => {
    ensureTheoryGroupTables(db);
    db.exec("DELETE FROM theory_attendance");
  });

  function attend(dates: string[], attended = 1) {
    ensureTheoryGroupTables(db);
    const group = db
      .query<{ id: number }, []>("SELECT id FROM theory_groups ORDER BY id LIMIT 1")
      .get()!;
    const insert = db.prepare(
      `INSERT INTO theory_attendance (group_id, student_id, session_date, attended)
       VALUES (?, ?, ?, ?)`,
    );
    for (const date of dates) insert.run(group.id, student.id, date, attended);
  }

  const theoryOf = (classes = "B") =>
    deriveStudentFacts(
      db,
      [{ id: student.id, customerNumber: student.customerNumber, classes }],
      NOW,
    ).get(student.id)!.theory;

  test("required units per class (FahrSchAusbO Anlage 2.2)", () => {
    expect(requiredTheoryUnits("B")).toBe(14);
    expect(requiredTheoryUnits("B197")).toBe(14);
    expect(requiredTheoryUnits("A")).toBe(16);
    expect(requiredTheoryUnits("B, A1")).toBe(16);
    expect(requiredTheoryUnits("CE")).toBe(14); // unlisted → fallback
    expect(requiredTheoryUnits("")).toBe(14);
  });

  test("no attendance: 0 %, Pausiert, no last session", () => {
    expect(theoryOf()).toMatchObject({
      attendedUnits: 0,
      requiredUnits: 14,
      progress: 0,
      status: "Pausiert",
      lastSession: "Noch keine",
      lastSessionDate: null,
      exam: null,
    });
  });

  test("recent attendance counts and makes the learner Aktiv", () => {
    attend(["2026-06-01", "2026-06-08", "2026-06-15"]);
    attend(["2026-06-10"], 0); // absent — does not count
    expect(theoryOf()).toMatchObject({
      attendedUnits: 3,
      progress: 21,
      status: "Aktiv",
      lastSession: "15.06.2026",
      lastSessionDate: "2026-06-15",
    });
  });

  test("older than 30 days → Pausiert; all units → Bereit", () => {
    attend(["2026-04-01", "2026-04-08"]);
    expect(theoryOf().status).toBe("Pausiert");
    attend(
      Array.from({ length: 12 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`),
    );
    expect(theoryOf()).toMatchObject({
      attendedUnits: 14,
      progress: 100,
      status: "Bereit",
    });
  });

  test("a future Theorieprüfung means In Prüfung and fills the exam date", () => {
    lesson("2031-06-25", "10:00", "10:45", { type: "Theorieprüfung" });
    expect(theoryOf()).toMatchObject({ status: "In Prüfung", exam: "25.06.2031" });
    const fresh = getStudent(db, student.id);
    expect(fresh.theory.exam).toBe("25.06.2031");
  });

  test("derived theory fields cannot be written, manual ones can", () => {
    const updated = updateStudent(db, student.id, {
      theory: {
        preExams: "2 bestanden",
        exam: "Nicht geplant",
        status: "Bereit",
        progress: 99,
      } as never,
    });
    expect(updated.theory).toMatchObject({
      preExams: "2 bestanden",
      status: "Pausiert",
      progress: 0,
    });
    const stored = db
      .query<{ theory: string }, [number]>("SELECT theory FROM students WHERE id = ?")
      .get(student.id)!;
    expect(JSON.parse(stored.theory)).toEqual({
      preExams: "2 bestanden",
      exam: "Nicht geplant",
    });
    expect(() =>
      updateStudent(db, student.id, { theory: { preExams: 3 } as never }),
    ).toThrow("theory.preExams");
  });
});

describe("migrateDerivedStudentFields", () => {
  test("tags old lessons by title and drops the hand-typed columns", () => {
    const legacy = openSqlite(":memory:");
    legacy.exec(`
      CREATE TABLE students (id INTEGER PRIMARY KEY, first_name TEXT,
        balance TEXT, last_lesson TEXT, next_lesson TEXT, lessons TEXT);
      CREATE TABLE calendar_events (id INTEGER PRIMARY KEY, title TEXT, type TEXT,
        lesson_kind TEXT);
      INSERT INTO students VALUES (1, 'A', '-85,00 EUR', 'x', 'y', '[]');
      INSERT INTO calendar_events (title, type) VALUES
        ('Fahrstunde · Autobahn', 'Praktisch'),
        ('Überlandfahrt · Klasse B', 'Praktisch'),
        ('Nachtfahrt', 'Theorie'),
        ('Fahrstunde · Stadt', 'Praktisch');
    `);
    migrateDerivedStudentFields(legacy);
    expect(
      legacy
        .query<{ lesson_kind: string | null }, []>(
          "SELECT lesson_kind FROM calendar_events ORDER BY id",
        )
        .all()
        .map((r) => r.lesson_kind),
    ).toEqual(["Autobahnfahrt", "Überlandfahrt", null, null]);
    const cols = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(cols).toEqual(["id", "first_name"]);
    // Idempotent.
    expect(() => migrateDerivedStudentFields(legacy)).not.toThrow();
    expect(() => backfillLessonKinds(legacy)).not.toThrow();
  });
});

describe("demo theory attendance", () => {
  test("seeded students show plausible, past-only theory progress", () => {
    const demo = openDb(":memory:");
    ensureTheoryGroupTables(demo);
    const today = new Date().toISOString().slice(0, 10);
    const rows = demo
      .query<{ student_id: number; n: number; last: string }, []>(
        `SELECT student_id, count(*) AS n, max(session_date) AS last
         FROM theory_attendance WHERE attended = 1 GROUP BY student_id`,
      )
      .all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.n).toBeGreaterThan(0);
      expect(row.n).toBeLessThanOrEqual(14);
      expect(row.last < today).toBe(true);
    }
  });
});
