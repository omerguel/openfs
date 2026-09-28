/* ------------------------------------------------------------------ */
/* Unit tests for the price-plans module.                              */
/* Fixture pattern: openDb(":memory:") — same as crud.test.ts.          */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { openDb } from "./db";
import { ValidationError } from "./engine";
import {
  createPricePlan,
  deletePricePlan,
  getPricePlan,
  listPricePlans,
  updatePricePlan,
} from "./price-plans";
import { listArchive } from "./archive";
import { createStudent, getStudent } from "./students";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

let counter = 0;
function uniq(prefix = "") {
  return `${prefix}${++counter}-${Date.now()}`;
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    name: "Basispaket",
    guaranteedMonths: 6,
    components: [{ label: "Fahrstunde", durationMin: 45, priceCents: 7500 }],
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

/* ================================================================== */
/* normalizeComponents                                                  */
/* ================================================================== */

describe("normalizeComponents (via createPricePlan)", () => {
  test("components not an array → ValidationError", () => {
    expect(() => createPricePlan(db, makePlan({ components: "not-an-array" }))).toThrow(
      ValidationError,
    );
  });

  test("empty components array → ValidationError", () => {
    expect(() => createPricePlan(db, makePlan({ components: [] }))).toThrow(
      ValidationError,
    );
  });

  test("component without label → ValidationError", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "", durationMin: 45, priceCents: 7500 }] }),
      ),
    ).toThrow(ValidationError);
  });

  test("component with non-object entry → ValidationError", () => {
    expect(() => createPricePlan(db, makePlan({ components: ["string-entry"] }))).toThrow(
      ValidationError,
    );
  });

  test("component with durationMin = 0 → ValidationError (must be positive)", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "Test", durationMin: 0, priceCents: 500 }] }),
      ),
    ).toThrow(ValidationError);
  });

  test("component with negative durationMin → ValidationError", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "Test", durationMin: -5, priceCents: 500 }] }),
      ),
    ).toThrow(ValidationError);
  });

  test("component with negative priceCents → ValidationError", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "Test", durationMin: 45, priceCents: -100 }] }),
      ),
    ).toThrow(ValidationError);
  });

  test("component with durationMin = null → allowed (optional)", () => {
    const plan = createPricePlan(
      db,
      makePlan({
        components: [{ label: "Einschreibgebühr", durationMin: null, priceCents: 5000 }],
      }),
    );
    expect(plan.components[0]!.durationMin).toBeNull();
    expect(plan.components[0]!.priceCents).toBe(5000);
  });

  test("component with priceCents = 0 → allowed (free component)", () => {
    const plan = createPricePlan(
      db,
      makePlan({
        components: [{ label: "Gratisstunde", durationMin: 45, priceCents: 0 }],
      }),
    );
    expect(plan.components[0]!.priceCents).toBe(0);
  });

  test("label gets trimmed by normalizeComponents", () => {
    const plan = createPricePlan(
      db,
      makePlan({
        components: [{ label: "  Sonderstunde  ", durationMin: 60, priceCents: 9000 }],
      }),
    );
    expect(plan.components[0]!.label).toBe("Sonderstunde");
  });
});

/* ================================================================== */
/* create / get / update roundtrip                                      */
/* ================================================================== */

describe("createPricePlan", () => {
  test("happy path: returns record with id, name, and components", () => {
    const plan = createPricePlan(db, makePlan());
    expect(plan.id).toBeGreaterThan(0);
    expect(plan.name).toBe("Basispaket");
    expect(plan.guaranteedMonths).toBe(6);
    expect(plan.components.length).toBe(1);
    expect(plan.components[0]!.label).toBe("Fahrstunde");
    expect(plan.components[0]!.priceCents).toBe(7500);
  });

  test("missing name → ValidationError", () => {
    expect(() => createPricePlan(db, makePlan({ name: "" }))).toThrow(ValidationError);
  });

  test("whitespace-only name → ValidationError", () => {
    expect(() => createPricePlan(db, makePlan({ name: "   " }))).toThrow(ValidationError);
  });

  test("multiple components are persisted and roundtripped correctly", () => {
    const plan = createPricePlan(
      db,
      makePlan({
        components: [
          { label: "Fahrstunde", durationMin: 45, priceCents: 7500 },
          { label: "Überlandfahrt", durationMin: 90, priceCents: 14000 },
        ],
      }),
    );
    expect(plan.components.length).toBe(2);
    expect(plan.components[1]!.label).toBe("Überlandfahrt");
    expect(plan.components[1]!.durationMin).toBe(90);
  });

  test("getPricePlan with unknown id → ValidationError", () => {
    expect(() => getPricePlan(db, 999999)).toThrow(ValidationError);
  });
});

describe("updatePricePlan", () => {
  test("updates name and preserves components", () => {
    const plan = createPricePlan(db, makePlan());
    const updated = updatePricePlan(db, plan.id, { name: "Intensivpaket" });
    expect(updated.name).toBe("Intensivpaket");
    expect(updated.components[0]!.label).toBe("Fahrstunde");
  });

  test("updates components and preserves name", () => {
    const plan = createPricePlan(db, makePlan());
    const updated = updatePricePlan(db, plan.id, {
      components: [{ label: "Intensivstunde", durationMin: 60, priceCents: 9000 }],
    });
    expect(updated.name).toBe("Basispaket");
    expect(updated.components[0]!.label).toBe("Intensivstunde");
    expect(updated.components[0]!.priceCents).toBe(9000);
  });

  test("updates guaranteedMonths", () => {
    const plan = createPricePlan(db, makePlan({ guaranteedMonths: 3 }));
    const updated = updatePricePlan(db, plan.id, { guaranteedMonths: 12 });
    expect(updated.guaranteedMonths).toBe(12);
  });

  test("unknown id → ValidationError", () => {
    expect(() => updatePricePlan(db, 999999, { name: "X" })).toThrow(ValidationError);
  });
});

/* ================================================================== */
/* delete behavior                                                      */
/* ================================================================== */

describe("deletePricePlan", () => {
  test("removes the plan from listPricePlans", () => {
    const before = listPricePlans(db).length;
    const plan = createPricePlan(db, makePlan());
    expect(listPricePlans(db).length).toBe(before + 1);
    deletePricePlan(db, plan.id);
    expect(listPricePlans(db).length).toBe(before);
  });

  test("students referencing the plan get price_plan_id = NULL after delete", () => {
    const plan = createPricePlan(db, makePlan());
    const student = createStudent(db, makeStudent({ pricePlanId: plan.id }));
    expect(student.pricePlanId).toBe(plan.id);

    deletePricePlan(db, plan.id);

    const updatedStudent = getStudent(db, student.id);
    expect(updatedStudent.pricePlanId).toBeNull();
  });

  test("writes archive entry with correct entity and plan name", () => {
    const plan = createPricePlan(db, makePlan({ name: "Archivpaket" }));
    const archiveBefore = listArchive(db).length;

    deletePricePlan(db, plan.id);

    const archiveAfter = listArchive(db);
    expect(archiveAfter.length).toBe(archiveBefore + 1);
    expect(archiveAfter[0]!.entity).toBe("price_plan");
    expect(archiveAfter[0]!.label).toBe("Archivpaket");
  });

  test("unknown id → ValidationError", () => {
    expect(() => deletePricePlan(db, 999999)).toThrow(ValidationError);
  });

  test("getPricePlan on deleted id → ValidationError", () => {
    const plan = createPricePlan(db, makePlan());
    deletePricePlan(db, plan.id);
    expect(() => getPricePlan(db, plan.id)).toThrow(ValidationError);
  });
});

describe("component billing metadata", () => {
  test("erloesKonto and eventType survive a save round-trip", () => {
    const plan = createPricePlan(
      db,
      makePlan({
        components: [
          {
            label: "TÜV-Gebühr Praxis",
            priceCents: 12983,
            erloesKonto: "1370",
            eventType: "Vorstellung zur prakt. Prüfung",
          },
        ],
      }),
    );
    const updated = updatePricePlan(db, plan.id, { name: "Neu" });
    expect(updated.components[0]).toMatchObject({
      erloesKonto: "1370",
      eventType: "Vorstellung zur prakt. Prüfung",
    });
  });

  test("an account that is not Erlös/durchlaufend is rejected", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "X", priceCents: 1, erloesKonto: "1600" }] }),
      ),
    ).toThrow(ValidationError);
  });

  test("an unknown event type is rejected", () => {
    expect(() =>
      createPricePlan(
        db,
        makePlan({ components: [{ label: "X", priceCents: 1, eventType: "Theorie" }] }),
      ),
    ).toThrow(ValidationError);
  });
});

/* ================================================================== */
/* classes + guaranteed period                                          */
/* ================================================================== */

describe("plan classes", () => {
  test("stores the classes a plan is offered for (trimmed, deduplicated)", () => {
    const plan = createPricePlan(db, makePlan({ classes: [" A ", "A2", "a", "A1"] }));
    expect(plan.classes).toEqual(["A", "A2", "A1"]);
    expect(getPricePlan(db, plan.id).classes).toEqual(["A", "A2", "A1"]);
    expect(updatePricePlan(db, plan.id, { classes: [] }).classes).toEqual([]);
  });

  test("invalid classes are rejected", () => {
    expect(() => createPricePlan(db, makePlan({ classes: "B" }))).toThrow(
      ValidationError,
    );
    expect(() => createPricePlan(db, makePlan({ classes: [""] }))).toThrow(
      ValidationError,
    );
  });

  test("demo seed: realistic 12-month guarantee, Rabatt only for B/B197", () => {
    const [standard, rabatt] = listPricePlans(db);
    expect(standard).toMatchObject({ guaranteedMonths: 12, classes: [] });
    expect(rabatt).toMatchObject({ guaranteedMonths: 12, classes: ["B", "B197"] });
  });

  test("an empty guaranteed period means none (0)", () => {
    const plan = createPricePlan(db, makePlan({ guaranteedMonths: "" }));
    expect(plan.guaranteedMonths).toBe(0);
    expect(
      updatePricePlan(db, plan.id, { guaranteedMonths: null as never }).guaranteedMonths,
    ).toBe(0);
  });

  test("a new student gets the first plan offered for the class", () => {
    const motorrad = createPricePlan(db, makePlan({ name: "Motorrad", classes: ["A"] }));
    const pkw = createPricePlan(db, makePlan({ name: "Pkw", classes: ["B"] }));
    // The seeded Standard plan (all classes) comes first in list order.
    const standard = listPricePlans(db)[0]!;
    expect(createStudent(db, makeStudent({ classes: "A" })).pricePlanId).toBe(
      standard.id,
    );
    updatePricePlan(db, standard.id, { classes: ["BE"] });
    expect(createStudent(db, makeStudent({ classes: "A" })).pricePlanId).toBe(
      motorrad.id,
    );
    expect(createStudent(db, makeStudent({ classes: "B" })).pricePlanId).not.toBe(
      motorrad.id,
    );
    // An explicit choice wins over the default.
    expect(
      createStudent(db, makeStudent({ classes: "A", pricePlanId: pkw.id })).pricePlanId,
    ).toBe(pkw.id);
  });
});
