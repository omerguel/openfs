/* Cross-entity referential integrity: instructors and vehicles are
   linked by id, so renames show up everywhere without a cascade and
   deletes unassign (restore re-links). repairSoftReferences() heals the
   remaining JSON/soft links (theory-group members, chat threads). */

import { beforeEach, describe, expect, test } from "bun:test";

import { openDb, repairSoftReferences } from "./db";
import type { Database } from "./sqlite";
import { listArchive, restoreArchived } from "./archive";
import { createCalendarEvent, getCalendarEvent } from "./calendar-events";
import { ensureChatTables } from "./chat";
import {
  createInstructor,
  deleteInstructor,
  getInstructor,
  updateInstructor,
} from "./instructors";
import { createStudent, getStudent, updateStudent } from "./students";
import { ensureTheoryGroupTables, getTheoryGroup } from "./theory-groups";
import { createVehicle, deleteVehicle, getVehicle, updateVehicle } from "./vehicles";

const UNASSIGNED = "Nicht zugeteilt";

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

function makeInstructor(first: string, last: string) {
  return createInstructor(db, {
    firstName: first,
    lastName: last,
    classes: "B",
  });
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  return createStudent(db, {
    firstName: "Mia",
    lastName: "Muster",
    contractNumber: `V-IT-${Math.random().toString(36).slice(2, 8)}`,
    customerNumber: `IT-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return createCalendarEvent(db, {
    date: "2026-07-01",
    start: "10:00",
    end: "11:00",
    title: "Fahrstunde",
    type: "Praktisch",
    instructor: UNASSIGNED,
    ...overrides,
  });
}

function insertTheoryGroup(instructorId: number | null, studentIds: number[] = []) {
  return Number(
    db
      .prepare(
        `INSERT INTO theory_groups (name, klass, weekday, time, instructor_id, student_ids)
         VALUES ('Gruppe T', 'B', 'Montag', '18:00', ?, ?)`,
      )
      .run(instructorId, JSON.stringify(studentIds)).lastInsertRowid,
  );
}

describe("instructor rename", () => {
  test("follows into students, calendar events and theory groups", () => {
    ensureTheoryGroupTables(db);
    const instructor = makeInstructor("Anna", "Alt");
    const student = makeStudent({ instructor: "Anna Alt" });
    const event = makeEvent({ instructor: "Anna Alt" });
    const groupId = insertTheoryGroup(instructor.id);

    updateInstructor(db, instructor.id, { lastName: "Neu" });

    expect(getStudent(db, student.id).instructor).toBe("Anna Neu");
    expect(getCalendarEvent(db, Number(event.id)).instructor).toBe("Anna Neu");
    expect(getTheoryGroup(db, groupId).instructor).toBe("Anna Neu");
  });
});

describe("instructor delete", () => {
  test("unassigns calendar events; restore re-links them", () => {
    const instructor = makeInstructor("Bernd", "Weg");
    const event = makeEvent({ instructor: "Bernd Weg" });

    deleteInstructor(db, instructor.id);
    expect(getCalendarEvent(db, Number(event.id)).instructor).toBe(UNASSIGNED);

    const archived = listArchive(db).find((r) => r.entity === "instructor");
    restoreArchived(db, archived!.id);
    expect(getCalendarEvent(db, Number(event.id)).instructor).toBe("Bernd Weg");
  });
});

describe("vehicle model rename", () => {
  test("follows into students, instructors and calendar events", () => {
    const vehicle = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 100",
      klass: "B",
    });
    const student = makeStudent({ vehicle: "Opel Corsa" });
    const instructor = createInstructor(db, {
      firstName: "Carla",
      lastName: "Fahr",
      classes: "B",
      vehicle: "Opel Corsa",
    });
    const event = makeEvent({ vehicle: "Opel Corsa" });

    updateVehicle(db, vehicle.id, { model: "Opel Astra" });

    expect(getStudent(db, student.id).vehicle).toBe("Opel Astra");
    expect(getInstructor(db, instructor.id).vehicle).toBe("Opel Astra");
    expect(getCalendarEvent(db, Number(event.id)).vehicle).toBe("Opel Astra");
  });

  test("leaves the fleet mate's references alone", () => {
    const first = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 101",
      klass: "B",
    });
    const second = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 102",
      klass: "B",
    });
    const student = makeStudent({ vehicleId: second.id });

    updateVehicle(db, first.id, { model: "Opel Astra" });

    expect(getStudent(db, student.id).vehicle).toBe("Opel Corsa");
  });
});

describe("vehicle delete", () => {
  test("clears calendar events when the last of its model goes; restore re-links", () => {
    const vehicle = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 103",
      klass: "B",
    });
    const event = makeEvent({ vehicle: "Opel Corsa" });

    deleteVehicle(db, vehicle.id);
    expect(getCalendarEvent(db, Number(event.id)).vehicle).toBeUndefined();

    const archived = listArchive(db).find((r) => r.entity === "vehicle");
    restoreArchived(db, archived!.id);
    expect(getCalendarEvent(db, Number(event.id)).vehicle).toBe("Opel Corsa");
  });

  test("keeps the fleet mate's references", () => {
    const first = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 104",
      klass: "B",
    });
    const second = createVehicle(db, {
      model: "Opel Corsa",
      plate: "DA-IT 105",
      klass: "B",
    });
    const student = makeStudent({ vehicleId: second.id });

    deleteVehicle(db, first.id);
    expect(getStudent(db, student.id).vehicle).toBe("Opel Corsa");
    expect(getVehicle(db, second.id).model).toBe("Opel Corsa");
  });
});

describe("student rename", () => {
  test("syncs the denormalized conversation name", () => {
    ensureChatTables(db);
    const student = makeStudent({ firstName: "Lara", lastName: "Lang" });
    db.prepare("INSERT INTO conversations (student_id, student_name) VALUES (?, ?)").run(
      student.id,
      "Lara Lang",
    );

    updateStudent(db, student.id, { lastName: "Kurz" });

    expect(
      db
        .query<{ student_name: string }, [number]>(
          "SELECT student_name FROM conversations WHERE student_id = ?",
        )
        .get(student.id)!.student_name,
    ).toBe("Lara Kurz");
  });
});

describe("repairSoftReferences", () => {
  test("drops dead theory-group member ids and orphaned chat links", () => {
    ensureTheoryGroupTables(db);
    ensureChatTables(db);
    const student = makeStudent();

    const groupId = insertTheoryGroup(null, [student.id, 99999]);
    db.prepare("INSERT INTO conversations (student_id, student_name) VALUES (?, ?)").run(
      99999,
      "Geist Schüler",
    );

    repairSoftReferences(db);

    const group = db
      .query<{ student_ids: string }, [number]>(
        "SELECT student_ids FROM theory_groups WHERE id = ?",
      )
      .get(groupId)!;
    expect(JSON.parse(group.student_ids)).toEqual([student.id]);
    expect(
      db
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM conversations WHERE student_id = 99999",
        )
        .get()!.n,
    ).toBe(0);
  });

  test("instructor/vehicle links cannot dangle: the FK rejects unknown ids", () => {
    const student = makeStudent();
    expect(() =>
      db
        .prepare("UPDATE students SET instructor_id = 99999 WHERE id = ?")
        .run(student.id),
    ).toThrow();
    expect(getStudent(db, student.id).instructor).toBe(UNASSIGNED);
  });

  test("leaves valid references untouched", () => {
    makeInstructor("Dora", "Da");
    const student = makeStudent({ instructor: "Dora Da" });
    repairSoftReferences(db);
    expect(getStudent(db, student.id).instructor).toBe("Dora Da");
  });
});
