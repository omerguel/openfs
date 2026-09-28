/* ------------------------------------------------------------------ */
/* Archiv (Papierkorb) — delete → archive → restore round-trips.       */
/* All tests run against an in-memory DB seeded by openDb(":memory:"). */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { listArchive, purgeArchived, restoreArchived } from "./archive";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
} from "./calendar-events";
import { createConversation, ensureChatTables, getConversation } from "./chat";
import { openDb } from "./db";
import { ValidationError } from "./engine";
import { createInstructor, deleteInstructor, listInstructors } from "./instructors";
import { createPricePlan, deletePricePlan } from "./price-plans";
import { createStudent, deleteStudent, getStudent, updateStudent } from "./students";
import {
  createTheoryGroup,
  ensureTheoryGroupTables,
  getTheoryGroup,
  updateTheoryGroup,
} from "./theory-groups";
import { createVehicle, deleteVehicle } from "./vehicles";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

let counter = 0;
function uniq(prefix = "") {
  return `${prefix}${++counter}-${Date.now()}`;
}

function makeStudent() {
  const id = uniq();
  return {
    firstName: "Max",
    lastName: `Muster-${id}`,
    contractNumber: `V-${id}`,
    customerNumber: `K-${id}`,
  };
}

const EVENT = {
  date: "2026-06-15",
  start: "10:00",
  end: "11:00",
  title: "Fahrstunde Archivtest",
  instructor: "Martin Weber",
  type: "Praktisch" as const,
};

describe("archive", () => {
  test("deleting a student archives it; restore brings it back with the same id", () => {
    const student = createStudent(db, makeStudent());
    const before = listArchive(db).length;

    deleteStudent(db, student.id);
    expect(() => getStudent(db, student.id)).toThrow(ValidationError);

    const items = listArchive(db);
    expect(items.length).toBe(before + 1);
    const entry = items[0]!;
    expect(entry.entity).toBe("student");
    expect(entry.label).toContain(student.lastName);

    restoreArchived(db, entry.id);
    const restored = getStudent(db, student.id);
    expect(restored.contractNumber).toBe(student.contractNumber);
    expect(listArchive(db).length).toBe(before);
  });

  test("deleting a calendar event archives it; restore round-trips", () => {
    const event = createCalendarEvent(db, EVENT);
    const countBefore = listCalendarEvents(db).length;

    deleteCalendarEvent(db, Number(event.id));
    expect(listCalendarEvents(db).length).toBe(countBefore - 1);

    const entry = listArchive(db).find((item) => item.entity === "calendar_event")!;
    expect(entry.label).toContain(EVENT.title);

    restoreArchived(db, entry.id);
    expect(listCalendarEvents(db).length).toBe(countBefore);
    expect(getCalendarEvent(db, Number(event.id)).title).toBe(EVENT.title);
  });

  test("restore fails readably when the contract number was reused", () => {
    const input = makeStudent();
    const student = createStudent(db, input);
    deleteStudent(db, student.id);
    // Someone re-registers with the same numbers while the original
    // sits in the archive.
    createStudent(db, input);

    const entry = listArchive(db).find((item) => item.entity === "student")!;
    expect(() => restoreArchived(db, entry.id)).toThrow(ValidationError);
    // The snapshot must survive the failed restore.
    expect(listArchive(db).some((item) => item.id === entry.id)).toBe(true);
  });

  test("restoring an instructor re-links students that were unassigned by the delete", () => {
    const instructor = createInstructor(db, {
      firstName: "Anna",
      lastName: "Relink",
      phone: "",
      email: "",
      classes: "B",
      vehicle: "",
      since: "2024-01-01",
      status: "aktiv",
    });
    const assigned = createStudent(db, {
      ...makeStudent(),
      instructor: "Anna Relink",
    });
    const reassigned = createStudent(db, {
      ...makeStudent(),
      instructor: "Anna Relink",
    });

    deleteInstructor(db, instructor.id);
    expect(getStudent(db, assigned.id).instructor).toBe("Nicht zugeteilt");

    // One student gets a new instructor while Anna sits in the archive —
    // that assignment must survive the restore.
    createInstructor(db, { firstName: "Ben", lastName: "Anders", classes: "B" });
    updateStudent(db, reassigned.id, { instructor: "Ben Anders" });

    const entry = listArchive(db).find((item) => item.entity === "instructor")!;
    restoreArchived(db, entry.id);

    expect(listInstructors(db).some((i) => i.id === instructor.id)).toBe(true);
    expect(getStudent(db, assigned.id).instructor).toBe("Anna Relink");
    expect(getStudent(db, reassigned.id).instructor).toBe("Ben Anders");
  });

  test("restoring a vehicle re-links students and instructors", () => {
    const vehicle = createVehicle(db, {
      model: "Relink-Mobil",
      plate: uniq("plate-"),
      klass: "B",
    });
    const student = createStudent(db, {
      ...makeStudent(),
      vehicle: "Relink-Mobil",
    });
    const instructor = createInstructor(db, {
      firstName: "Karl",
      lastName: "Fahrer",
      phone: "",
      email: "",
      classes: "B",
      vehicle: "Relink-Mobil",
      since: "2024-01-01",
      status: "aktiv",
    });

    deleteVehicle(db, vehicle.id);
    expect(getStudent(db, student.id).vehicle).toBe("Nicht zugeteilt");

    const entry = listArchive(db).find((item) => item.entity === "vehicle")!;
    restoreArchived(db, entry.id);

    expect(getStudent(db, student.id).vehicle).toBe("Relink-Mobil");
    expect(listInstructors(db).find((i) => i.id === instructor.id)!.vehicle).toBe(
      "Relink-Mobil",
    );
  });

  test("restoring a price plan re-links students that fell back to no plan", () => {
    const plan = createPricePlan(db, {
      name: "Relink-Tarif",
      guaranteedMonths: 0,
      components: [{ label: "Grundbetrag", priceCents: 19900 }],
    });
    const student = createStudent(db, {
      ...makeStudent(),
      pricePlanId: plan.id,
    });

    deletePricePlan(db, plan.id);
    expect(getStudent(db, student.id).pricePlanId).toBeNull();

    const entry = listArchive(db).find((item) => item.entity === "price_plan")!;
    restoreArchived(db, entry.id);

    expect(getStudent(db, student.id).pricePlanId).toBe(plan.id);
  });

  test("deleting a student removes it from theory groups and unlinks its chat; restore re-links", () => {
    ensureTheoryGroupTables(db);
    ensureChatTables(db);
    const student = createStudent(db, makeStudent());
    const group = createTheoryGroup(db, {
      name: uniq("Gruppe-"),
      klass: "B",
      weekday: "Montag",
      time: "18:00",
      capacity: 5,
      studentIds: [student.id],
    });
    const conversation = createConversation(db, {
      student_id: student.id,
      student_name: `${student.firstName} ${student.lastName}`,
    });

    deleteStudent(db, student.id);
    // No ghost id left behind — it would keep counting toward capacity.
    expect(getTheoryGroup(db, group.id).studentIds).not.toContain(student.id);
    // The chat thread survives as history, only the live link is cut.
    expect(getConversation(db, conversation.id).studentId).toBeNull();

    const entry = listArchive(db).find((item) => item.entity === "student")!;
    restoreArchived(db, entry.id);

    expect(getTheoryGroup(db, group.id).studentIds).toContain(student.id);
    expect(getConversation(db, conversation.id).studentId).toBe(student.id);
  });

  test("restoring a student does not overfill a theory group that filled up meanwhile", () => {
    ensureTheoryGroupTables(db);
    const original = createStudent(db, makeStudent());
    const replacement = createStudent(db, makeStudent());
    const group = createTheoryGroup(db, {
      name: uniq("Gruppe-"),
      klass: "B",
      weekday: "Dienstag",
      time: "18:00",
      capacity: 1,
      studentIds: [original.id],
    });

    deleteStudent(db, original.id);
    updateTheoryGroup(db, group.id, { studentIds: [replacement.id] });

    const entry = listArchive(db).find((item) => item.entity === "student")!;
    restoreArchived(db, entry.id);

    // The seat is taken — the restored student must not exceed capacity.
    expect(getTheoryGroup(db, group.id).studentIds).toEqual([replacement.id]);
  });

  test("deleting an instructor unassigns their theory groups; restore re-links", () => {
    ensureTheoryGroupTables(db);
    const instructor = createInstructor(db, {
      firstName: "Theo",
      lastName: "Gruppenleiter",
      phone: "",
      email: "",
      classes: "B",
      vehicle: "",
      since: "2024-01-01",
      status: "aktiv",
    });
    const group = createTheoryGroup(db, {
      name: uniq("Gruppe-"),
      klass: "B",
      weekday: "Mittwoch",
      time: "19:00",
      instructor: "Theo Gruppenleiter",
    });

    deleteInstructor(db, instructor.id);
    expect(getTheoryGroup(db, group.id).instructor).toBe("Nicht zugeteilt");

    const entry = listArchive(db).find((item) => item.entity === "instructor")!;
    restoreArchived(db, entry.id);

    expect(getTheoryGroup(db, group.id).instructor).toBe("Theo Gruppenleiter");
  });

  test("purge removes the snapshot for good", () => {
    const student = createStudent(db, makeStudent());
    deleteStudent(db, student.id);

    const entry = listArchive(db)[0]!;
    purgeArchived(db, entry.id);
    expect(listArchive(db).some((item) => item.id === entry.id)).toBe(false);
    expect(() => purgeArchived(db, entry.id)).toThrow(ValidationError);
  });
});
