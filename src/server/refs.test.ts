/* Instructor/vehicle id references: legacy name-column migration,
   name → id resolution at the API boundary, and restore of archive
   snapshots taken before the migration. */

import { beforeEach, describe, expect, test } from "bun:test";

import { restoreArchived } from "./archive";
import { openDb } from "./db";
import { ValidationError } from "./engine";
import { createInstructor } from "./instructors";
import { migrateNameColumn, resolveInstructorId, resolveVehicleId } from "./refs";
import { openSqlite, type Database } from "./sqlite";
import { createStudent, getStudent, updateStudent } from "./students";
import { createVehicle } from "./vehicles";

describe("migrateNameColumn", () => {
  let legacy: Database;

  beforeEach(() => {
    legacy = openSqlite(":memory:");
    legacy.exec(`
      CREATE TABLE instructors (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT,
        status TEXT NOT NULL DEFAULT 'aktiv');
      CREATE TABLE vehicles (id INTEGER PRIMARY KEY, model TEXT, plate TEXT,
        status TEXT NOT NULL DEFAULT 'aktiv');
      CREATE TABLE students (id INTEGER PRIMARY KEY, instructor TEXT NOT NULL
        DEFAULT 'Nicht zugeteilt', vehicle TEXT NOT NULL DEFAULT 'Nicht zugeteilt');
      INSERT INTO instructors (id, first_name, last_name) VALUES (1, 'Nadine', 'Aksoy');
      INSERT INTO vehicles (id, model, plate) VALUES (7, 'VW Golf', 'DA-FS 1');
      INSERT INTO students (id, instructor, vehicle) VALUES
        (1, 'Nadine Aksoy', 'VW Golf'),
        (2, 'Nicht zugeteilt', 'Nicht zugeteilt'),
        (3, 'Geist Lehrer', 'Geist Mobil');
    `);
  });

  test("back-fills ids by display name and drops the text column", () => {
    migrateNameColumn(legacy, "students", { from: "instructor" });
    migrateNameColumn(legacy, "students", { from: "vehicle" });

    const rows = legacy
      .query<{ id: number; instructor_id: number | null; vehicle_id: number | null }, []>(
        "SELECT id, instructor_id, vehicle_id FROM students ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: 1, instructor_id: 1, vehicle_id: 7 },
      { id: 2, instructor_id: null, vehicle_id: null },
      // Phantom names from before the cascades existed become unassigned.
      { id: 3, instructor_id: null, vehicle_id: null },
    ]);
    const columns = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(columns).not.toContain("instructor");
    expect(columns).not.toContain("vehicle");
  });

  test("is idempotent", () => {
    migrateNameColumn(legacy, "students", { from: "instructor" });
    expect(() =>
      migrateNameColumn(legacy, "students", { from: "instructor" }),
    ).not.toThrow();
  });
});

describe("name / id resolution", () => {
  let db: Database;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  test("id wins when the echoed name still matches it", () => {
    const a = createVehicle(db, { model: "Opel Corsa", plate: "X-1", klass: "B" });
    const b = createVehicle(db, { model: "Opel Corsa", plate: "X-2", klass: "B" });
    expect(resolveVehicleId(db, { id: b.id, name: "Opel Corsa" }, null)).toBe(b.id);
    expect(resolveVehicleId(db, { name: "Opel Corsa · X-2" }, null)).toBe(b.id);
    expect(resolveVehicleId(db, { name: "X-1" }, null)).toBe(a.id);
  });

  test("an edited name overrides a stale id sent along with it", () => {
    const anna = createInstructor(db, { firstName: "Anna", lastName: "A", classes: "B" });
    const ben = createInstructor(db, { firstName: "Ben", lastName: "B", classes: "B" });
    expect(resolveInstructorId(db, { id: anna.id, name: "Ben B" }, anna.id)).toBe(ben.id);
    expect(
      resolveInstructorId(db, { id: anna.id, name: "Nicht zugeteilt" }, anna.id),
    ).toBe(null);
  });

  test("unknown ids and names are rejected", () => {
    expect(() => resolveInstructorId(db, { id: 99999 }, null)).toThrow(ValidationError);
    expect(() => resolveVehicleId(db, { name: "Trabant" }, null)).toThrow(
      ValidationError,
    );
  });

  test("absent input keeps the current link", () => {
    expect(resolveInstructorId(db, {}, 3)).toBe(3);
  });
});

describe("restore of a pre-migration archive snapshot", () => {
  test("resolves legacy name columns to ids", () => {
    const db = openDb(":memory:");
    const student = createStudent(db, {
      firstName: "Alt",
      lastName: "Schnappschuss",
      contractNumber: "V-OLD-1",
      customerNumber: "OLD-1",
    });
    const row = db
      .query<Record<string, unknown>, [number]>("SELECT * FROM students WHERE id = ?")
      .get(student.id)!;
    // Shape of a snapshot written before the id migration.
    const { instructor_id: _i, vehicle_id: _v, ...legacyRow } = row;
    const snapshot = { ...legacyRow, instructor: "Nadine Aksoy", vehicle: "VW Golf" };
    db.prepare("DELETE FROM students WHERE id = ?").run(student.id);
    const archiveId = Number(
      db
        .prepare("INSERT INTO archive (entity, label, payload) VALUES ('student', ?, ?)")
        .run("Alt Schnappschuss", JSON.stringify({ row: snapshot })).lastInsertRowid,
    );

    restoreArchived(db, archiveId);

    const restored = getStudent(db, student.id);
    expect(restored.instructor).toBe("Nadine Aksoy");
    expect(restored.vehicle).toBe("VW Golf");
    expect(restored.instructorId).toBeGreaterThan(0);
    // Still a normal, editable record afterwards.
    expect(updateStudent(db, student.id, { phone: "1" }).phone).toBe("1");
  });
});
