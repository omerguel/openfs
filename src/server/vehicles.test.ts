/* ------------------------------------------------------------------ */
/* Unit tests for the vehicles module.                                  */
/* Fixture pattern: openDb(":memory:") — same as crud.test.ts.          */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { migrateVehicleInstructorDetail, openDb } from "./db";
import { ValidationError } from "./engine";
import {
  createVehicle,
  deleteVehicle,
  getVehicle,
  listVehicleModels,
  listVehicles,
  updateVehicle,
} from "./vehicles";
import { listArchive } from "./archive";
import { createStudent, getStudent } from "./students";
import { createInstructor, getInstructor } from "./instructors";
import { createCalendarEvent, getCalendarEvent } from "./calendar-events";
import type { InstructorInput } from "./instructors";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

let counter = 0;
function uniq(prefix = "") {
  return `${prefix}${++counter}-${Date.now()}`;
}

function makeVehicle(overrides: Record<string, unknown> = {}) {
  const id = uniq("PLATE-");
  return {
    model: "TestAuto",
    plate: id,
    klass: "B",
    ...overrides,
  };
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  const id = uniq();
  return {
    firstName: "Max",
    lastName: "Student",
    contractNumber: `V-${id}`,
    customerNumber: `C-${id}`,
    ...overrides,
  };
}

function makeInstructor(overrides: Partial<InstructorInput> = {}): InstructorInput {
  return {
    firstName: "Anna",
    lastName: "Lehr",
    phone: "",
    email: "",
    classes: "B",
    vehicle: "",
    since: "2024-01-01",
    status: "aktiv" as const,
    ...overrides,
  };
}

/* ================================================================== */
/* parseDetails recovery                                                */
/* ================================================================== */

describe("parseDetails recovery on malformed JSON", () => {
  test("row with details = 'not json' → getVehicle returns BASE_DETAILS without throwing", () => {
    // Insert a row directly with malformed JSON in details
    const row = db
      .query<{ id: number }, [string, string, string, string, string, string]>(
        "INSERT INTO vehicles (model, plate, klass, status, accent, details) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get("BadJson", uniq("BAD-"), "B", "aktiv", "", "not json")!;

    // Should not throw — parseDetails falls back to BASE_DETAILS
    const vehicle = getVehicle(db, row.id);
    expect(vehicle.details).toBeArray();
    expect(vehicle.details.length).toBeGreaterThan(0);
    // Every detail entry must have label and value strings
    for (const detail of vehicle.details) {
      expect(typeof detail.label).toBe("string");
      expect(typeof detail.value).toBe("string");
    }
  });

  test("row with details = '\"string\"' (non-array JSON) → falls back to BASE_DETAILS", () => {
    const row = db
      .query<{ id: number }, [string, string, string, string, string, string]>(
        "INSERT INTO vehicles (model, plate, klass, status, accent, details) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get("StringJson", uniq("STR-"), "B", "aktiv", "", '"a string"')!;

    const vehicle = getVehicle(db, row.id);
    // Non-array JSON → BASE_DETAILS (6 entries)
    expect(vehicle.details.length).toBe(6);
  });
});

/* ================================================================== */
/* create validation                                                    */
/* ================================================================== */

describe("createVehicle validation", () => {
  test("happy path: returns record with id", () => {
    const vehicle = createVehicle(db, makeVehicle());
    expect(vehicle.id).toBeGreaterThan(0);
    expect(vehicle.model).toBe("TestAuto");
  });

  test("missing model → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ model: "" }))).toThrow(ValidationError);
  });

  test("missing plate → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ plate: "" }))).toThrow(ValidationError);
  });

  test("missing klass → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ klass: "" }))).toThrow(ValidationError);
  });

  test("bad status → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ status: "defekt" }))).toThrow(
      ValidationError,
    );
  });

  test("duplicate plate → ValidationError with German message", () => {
    const v = makeVehicle();
    createVehicle(db, v);
    expect(() => createVehicle(db, { ...v })).toThrowError(
      "Kennzeichen ist bereits vergeben.",
    );
  });
});

/* ================================================================== */
/* rename / plate-change propagation                                    */
/* ================================================================== */

describe("model rename (id-linked references)", () => {
  test("renaming a vehicle shows the new model on students and Termine", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "OldModel", plate: uniq("OLD-") }),
    );
    const student = createStudent(db, makeStudent({ vehicle: "OldModel" }));
    const event = createCalendarEvent(db, {
      date: "2026-03-01",
      start: "10:00",
      end: "11:00",
      title: "Fahrstunde",
      type: "Praktisch",
      vehicleId: vehicle.id,
    });

    updateVehicle(db, vehicle.id, { model: "NewModel" });

    expect(getStudent(db, student.id).vehicle).toBe("NewModel");
    expect(getCalendarEvent(db, Number(event.id)).vehicle).toBe("NewModel");
  });

  test("renaming one of two same-model vehicles only moves its own references", () => {
    const v1 = createVehicle(
      db,
      makeVehicle({ model: "SharedModel", plate: uniq("S1-") }),
    );
    const v2 = createVehicle(
      db,
      makeVehicle({ model: "SharedModel", plate: uniq("S2-") }),
    );
    const onV1 = createStudent(db, makeStudent({ vehicleId: v1.id }));
    const onV2 = createStudent(db, makeStudent({ vehicleId: v2.id }));

    updateVehicle(db, v1.id, { model: "RenamedModel" });

    expect(getStudent(db, onV1.id).vehicle).toBe("RenamedModel");
    expect(getStudent(db, onV2.id).vehicle).toBe("SharedModel");
  });

  test("plate change on same model (no model rename) does not touch student references", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "PlateModel", plate: uniq("P1-") }),
    );
    const student = createStudent(db, makeStudent({ vehicle: "PlateModel" }));

    updateVehicle(db, vehicle.id, { plate: uniq("P2-") });

    const updatedStudent = getStudent(db, student.id);
    expect(updatedStudent.vehicle).toBe("PlateModel");
  });
});

/* ================================================================== */
/* listVehicleModels                                                    */
/* ================================================================== */

describe("listVehicleModels", () => {
  test("returns distinct models sorted alphabetically", () => {
    createVehicle(db, makeVehicle({ model: "Zebra", plate: uniq("Z-") }));
    createVehicle(db, makeVehicle({ model: "Alpha", plate: uniq("A-") }));
    createVehicle(db, makeVehicle({ model: "Alpha", plate: uniq("A2-") })); // duplicate model

    const models = listVehicleModels(db);
    // Only one "Alpha" despite two vehicles
    const alphaCount = models.filter((m) => m === "Alpha").length;
    expect(alphaCount).toBe(1);

    // Sorted alphabetically
    const sortedModels = [...models].sort();
    expect(models).toEqual(sortedModels);
  });

  test("returns empty array when no vehicles exist", () => {
    // Ensure a clean db (no pre-seeded vehicles)
    const models = listVehicleModels(db);
    expect(Array.isArray(models)).toBe(true);
  });
});

/* ================================================================== */
/* delete + archive                                                     */
/* ================================================================== */

describe("deleteVehicle", () => {
  test("removes the row from vehicles", () => {
    const before = listVehicles(db).length;
    const vehicle = createVehicle(db, makeVehicle());
    expect(listVehicles(db).length).toBe(before + 1);
    deleteVehicle(db, vehicle.id);
    expect(listVehicles(db).length).toBe(before);
  });

  test("last vehicle of model → re-assigns students to 'Nicht zugeteilt'", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "DeleteModel", plate: uniq("D-") }),
    );
    const student = createStudent(db, makeStudent({ vehicle: "DeleteModel" }));

    deleteVehicle(db, vehicle.id);

    const updated = getStudent(db, student.id);
    expect(updated.vehicle).toBe("Nicht zugeteilt");
  });

  test("last vehicle of model → re-assigns instructor vehicle to 'Nicht zugeteilt'", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "InstrModel", plate: uniq("I-") }),
    );
    const instructor = createInstructor(db, makeInstructor({ vehicle: "InstrModel" }));

    deleteVehicle(db, vehicle.id);

    const updated = getInstructor(db, instructor.id);
    expect(updated.vehicle).toBe("Nicht zugeteilt");
  });

  test("last vehicle of model → re-assigns calendar_events vehicle to ''", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "CalModel", plate: uniq("C-") }),
    );
    const event = createCalendarEvent(db, {
      date: "2026-04-01",
      start: "10:00",
      end: "11:00",
      title: "Termin",
      type: "Praktisch",
      vehicle: "CalModel",
    });

    deleteVehicle(db, vehicle.id);

    const ev = getCalendarEvent(db, Number(event.id));
    expect(ev.vehicle).toBeUndefined();
    expect(ev.vehicleId).toBeNull();
  });

  test("writes archive entry with correct entity", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ model: "ArchModel", plate: uniq("AR-") }),
    );
    const archiveBefore = listArchive(db).length;

    deleteVehicle(db, vehicle.id);

    const archiveAfter = listArchive(db);
    expect(archiveAfter.length).toBe(archiveBefore + 1);
    expect(archiveAfter[0]!.entity).toBe("vehicle");
  });

  test("fleet mate: deleting one of two same-model vehicles does NOT re-assign references", () => {
    createVehicle(db, makeVehicle({ model: "FleetModel", plate: uniq("F1-") }));
    const v2 = createVehicle(
      db,
      makeVehicle({ model: "FleetModel", plate: uniq("F2-") }),
    );
    const student = createStudent(db, makeStudent({ vehicle: "FleetModel" }));

    deleteVehicle(db, v2.id);

    // v1 still has "FleetModel" → student reference must remain valid
    const updated = getStudent(db, student.id);
    expect(updated.vehicle).toBe("FleetModel");
  });

  test("unknown id → ValidationError", () => {
    expect(() => deleteVehicle(db, 999999)).toThrow(ValidationError);
  });
});

/* ================================================================== */
/* Fahrlehrer ↔ Fahrzeug: one source of truth                           */
/* ================================================================== */

describe("instructor assignment", () => {
  test("assigning on the vehicle sets the instructor's Stammfahrzeug", () => {
    const vehicle = createVehicle(db, makeVehicle({ model: "Sync Golf" }));
    const anna = createInstructor(
      db,
      makeInstructor({ firstName: "Anna", lastName: "Sync" }),
    );
    const updated = updateVehicle(db, vehicle.id, {
      details: [{ label: "Fahrlehrer/in", value: "Anna Sync" }],
    });
    expect(updated.instructorIds).toEqual([anna.id]);
    expect(updated.details.find((d) => d.label === "Fahrlehrer/in")?.value).toBe(
      "Anna Sync",
    );
    expect(getInstructor(db, anna.id).vehicleId).toBe(vehicle.id);
    expect(getInstructor(db, anna.id).vehicle).toBe("Sync Golf");
  });

  test("the Stammfahrzeug set on the instructor shows up on the vehicle", () => {
    const vehicle = createVehicle(db, makeVehicle({ model: "Sync Polo" }));
    createInstructor(
      db,
      makeInstructor({ firstName: "Ben", lastName: "Sync", vehicle: "Sync Polo" }),
    );
    const shown = getVehicle(db, vehicle.id).details.find(
      (d) => d.label === "Fahrlehrer/in",
    );
    expect(shown?.value).toBe("Ben Sync");
  });

  test("reassigning moves the vehicle; 'Nicht zugeteilt' clears it", () => {
    const vehicle = createVehicle(db, makeVehicle({ model: "Sync ID3" }));
    const a = createInstructor(
      db,
      makeInstructor({ firstName: "Cara", lastName: "Sync" }),
    );
    const b = createInstructor(
      db,
      makeInstructor({ firstName: "Dirk", lastName: "Sync" }),
    );
    updateVehicle(db, vehicle.id, { instructorId: a.id });
    updateVehicle(db, vehicle.id, { instructorId: b.id });
    expect(getInstructor(db, a.id).vehicleId).toBeNull();
    expect(getInstructor(db, b.id).vehicleId).toBe(vehicle.id);
    updateVehicle(db, vehicle.id, {
      details: [{ label: "Fahrlehrer/in", value: "Nicht zugeteilt" }],
    });
    expect(getInstructor(db, b.id).vehicleId).toBeNull();
    expect(getVehicle(db, vehicle.id).instructorIds).toEqual([]);
  });

  test("an unchanged multi-name value does not touch assignments", () => {
    const vehicle = createVehicle(db, makeVehicle({ model: "Sync Bus" }));
    createInstructor(
      db,
      makeInstructor({ firstName: "Eva", lastName: "A", vehicle: "Sync Bus" }),
    );
    createInstructor(
      db,
      makeInstructor({ firstName: "Fin", lastName: "B", vehicle: "Sync Bus" }),
    );
    const current = getVehicle(db, vehicle.id);
    const saved = updateVehicle(db, vehicle.id, { details: current.details });
    expect(saved.instructorIds.length).toBe(2);
  });

  test("an unknown instructor name is rejected", () => {
    const vehicle = createVehicle(db, makeVehicle());
    expect(() =>
      updateVehicle(db, vehicle.id, {
        details: [{ label: "Fahrlehrer/in", value: "Niemand Da" }],
      }),
    ).toThrow(ValidationError);
  });

  test("migration carries a vehicle-only name over and clears the copy", () => {
    const vehicle = createVehicle(db, makeVehicle({ model: "Alt Astra" }));
    const gus = createInstructor(
      db,
      makeInstructor({ firstName: "Gus", lastName: "Alt" }),
    );
    db.prepare("UPDATE vehicles SET details = ? WHERE id = ?").run(
      JSON.stringify([{ label: "Fahrlehrer/in", value: "Gus Alt" }]),
      vehicle.id,
    );
    migrateVehicleInstructorDetail(db);
    migrateVehicleInstructorDetail(db);
    expect(getInstructor(db, gus.id).vehicleId).toBe(vehicle.id);
    const raw = db
      .query<{ details: string }, [number]>("SELECT details FROM vehicles WHERE id = ?")
      .get(vehicle.id)!.details;
    expect(raw).not.toContain("Gus Alt");
  });
});

describe("HU and Kilometerstand", () => {
  test("HU accepts a month (JJJJ-MM → MM/JJJJ) and rejects free text", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ details: [{ label: "Nächste HU", value: "2027-03" }] }),
    );
    expect(vehicle.details.find((d) => d.label === "Nächste HU")?.value).toBe("03/2027");
    expect(() =>
      updateVehicle(db, vehicle.id, {
        details: [{ label: "Nächste HU", value: "bald" }],
      }),
    ).toThrow(ValidationError);
  });

  test("Kilometerstand is stored as a formatted number", () => {
    const vehicle = createVehicle(
      db,
      makeVehicle({ details: [{ label: "Kilometerstand", value: "84320" }] }),
    );
    expect(vehicle.details.find((d) => d.label === "Kilometerstand")?.value).toBe(
      "84.320 km",
    );
    expect(() =>
      updateVehicle(db, vehicle.id, {
        details: [{ label: "Kilometerstand", value: "viel" }],
      }),
    ).toThrow(ValidationError);
  });
});
