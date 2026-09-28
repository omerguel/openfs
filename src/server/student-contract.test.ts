/* ------------------------------------------------------------------ */
/* Contract-related student fields: per-student contract prices        */
/* (§ 32 FahrlG, stored on the server instead of browser storage), the */
/* BF17 Begleitperson, open checklist entries and archiving with a     */
/* reason (the contract stays listed under "Archiviert").              */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import { listArchivedContracts, restoreArchived } from "./archive";
import { openDb } from "./db";
import { ValidationError } from "./engine";
import type { Database } from "./sqlite";
import { createStudent, deleteStudent, getStudent, updateStudent } from "./students";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:", { demoData: false });
});

const base = {
  firstName: "Mia",
  lastName: "Schneider",
  classes: "B",
  registrationDate: "28.09.2026",
  contractNumber: "V-2026-0001",
  customerNumber: "1001",
};

describe("contract prices", () => {
  test("overrides persist per student; other students are untouched", () => {
    const mia = createStudent(db, base);
    const tom = createStudent(db, {
      ...base,
      firstName: "Tom",
      contractNumber: "V-2026-0002",
      customerNumber: "1002",
    });
    expect(mia.contractPrices).toEqual({});
    const updated = updateStudent(db, mia.id, {
      contractPrices: { grundbetrag: 450_00, fahrstunde: 68_00 },
    });
    expect(updated.contractPrices).toEqual({ grundbetrag: 450_00, fahrstunde: 68_00 });
    expect(getStudent(db, tom.id).contractPrices).toEqual({});
    // Clearing = back to the plan.
    expect(updateStudent(db, mia.id, { contractPrices: {} }).contractPrices).toEqual({});
  });

  test("invalid prices are rejected", () => {
    const mia = createStudent(db, base);
    expect(() =>
      updateStudent(db, mia.id, { contractPrices: { grundbetrag: "450" } as never }),
    ).toThrow(ValidationError);
    expect(() =>
      updateStudent(db, mia.id, { contractPrices: { trinkgeld: 1 } as never }),
    ).toThrow(ValidationError);
  });
});

describe("Begleitperson (BF17) and checklist", () => {
  test("companion is stored trimmed; empty → null", () => {
    const lena = createStudent(db, {
      ...base,
      companion: { name: " Petra Braun ", phone: "0151 123" },
    });
    expect(lena.companion).toEqual({ name: "Petra Braun", phone: "0151 123" });
    expect(
      updateStudent(db, lena.id, { companion: { name: "", phone: "" } }).companion,
    ).toBeNull();
    expect(() => updateStudent(db, lena.id, { companion: "Petra" as never })).toThrow(
      ValidationError,
    );
  });

  test("open checklist entries are stored next to the handed-in ones", () => {
    const mia = createStudent(db, {
      ...base,
      documents: ["Sehtest"],
      openDocuments: ["Erste-Hilfe-Nachweis", " Passbild ", "Passbild"],
    });
    expect(mia.documents).toEqual(["Sehtest"]);
    expect(mia.openDocuments).toEqual(["Erste-Hilfe-Nachweis", "Passbild"]);
  });
});

describe("archiving", () => {
  test("keeps the contract listed with its reason until restored", () => {
    const mia = createStudent(db, base);
    deleteStudent(db, mia.id, { reason: "abgeschlossen" });
    const [contract] = listArchivedContracts(db);
    expect(contract).toMatchObject({
      studentId: mia.id,
      firstName: "Mia",
      lastName: "Schneider",
      contractNumber: "V-2026-0001",
      customerNumber: "1001",
      classes: "B",
      reason: "Ausbildung abgeschlossen",
    });
    restoreArchived(db, contract!.archiveId);
    expect(listArchivedContracts(db)).toEqual([]);
    expect(getStudent(db, mia.id).lastName).toBe("Schneider");
  });

  test("an unknown reason is rejected, no reason is fine", () => {
    const mia = createStudent(db, base);
    expect(() => deleteStudent(db, mia.id, { reason: "keine Lust" })).toThrow(
      ValidationError,
    );
    deleteStudent(db, mia.id);
    expect(listArchivedContracts(db)[0]!.reason).toBeNull();
  });
});
