import { describe, expect, test } from "bun:test";

import type { StudentRecord } from "@/hooks/use-students";
import type { PricePlanRecord } from "@/lib/price-plan";
import {
  computeContractKpis,
  deriveArchivedContractRows,
  deriveContractRows,
  filterContractRows,
  isInMonth,
  parseGermanDate,
  resolvePlanName,
  splitClasses,
} from "@/lib/contracts";

const plans: PricePlanRecord[] = [
  { id: 1, name: "Standard Tarif", guaranteedMonths: 240, components: [] },
  { id: 2, name: "Rabatt Tarif", guaranteedMonths: 240, components: [] },
];

function makeStudent(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: 1,
    firstName: "Lena",
    lastName: "Braun",
    birthday: "11.08.1999",
    phone: "+49 151 23456780",
    email: "lena.braun@example.com",
    address: "Weidingweg 31, 64297 Darmstadt",
    classes: "B",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "12.05.2026",
    contractNumber: "V-2026-1042",
    customerNumber: "10057",
    status: "aktiv",
    instructor: "Nicht zugeteilt",
    vehicle: "Nicht zugeteilt",
    balance: "0,00 EUR",
    pricePlanId: null,
    lastLesson: "Nicht geplant",
    nextLesson: "Nicht geplant",
    progress: 0,
    lessons: [],
    documents: [],
    theory: {
      preExams: "0",
      exam: "—",
      status: "Aktiv",
      progress: 0,
      attendedUnits: 0,
      requiredUnits: 14,
      lastSession: "Noch keine",
      lastSessionDate: null,
    },
    ...overrides,
  };
}

describe("parseGermanDate", () => {
  test("parses DD.MM.YYYY", () => {
    expect(parseGermanDate("12.05.2026")).toBe(new Date(2026, 4, 12).getTime());
  });

  test("parses with time tail like the lesson fields", () => {
    expect(parseGermanDate("01.06.2026, 14:30")).toBe(new Date(2026, 5, 1).getTime());
  });

  test("rejects garbage, empty, and rollover dates", () => {
    expect(parseGermanDate("Nicht geplant")).toBeNaN();
    expect(parseGermanDate("")).toBeNaN();
    expect(parseGermanDate("31.02.2026")).toBeNaN();
  });
});

describe("splitClasses", () => {
  test("single class", () => {
    expect(splitClasses("B")).toEqual(["B"]);
  });

  test("comma-separated with spaces and dedupe", () => {
    expect(splitClasses("B, A1, B")).toEqual(["B", "A1"]);
  });

  test("empty string → no badges", () => {
    expect(splitClasses("")).toEqual([]);
  });
});

describe("resolvePlanName", () => {
  test("assigned plan wins", () => {
    expect(resolvePlanName(2, plans)).toBe("Rabatt Tarif");
  });

  test("null falls back to the first (default) plan", () => {
    expect(resolvePlanName(null, plans)).toBe("Standard Tarif");
  });

  test("unknown id falls back to the first plan", () => {
    expect(resolvePlanName(999, plans)).toBe("Standard Tarif");
  });

  test("no plans at all → em dash", () => {
    expect(resolvePlanName(1, [])).toBe("—");
  });
});

describe("deriveContractRows", () => {
  test("maps student fields to contract row", () => {
    const [row] = deriveContractRows(
      [makeStudent({ id: 7, pricePlanId: 2, classes: "B, A1" })],
      plans,
    );
    expect(row).toMatchObject({
      studentId: 7,
      contractNumber: "V-2026-1042",
      customerNumber: "10057",
      name: "Braun, Lena",
      classes: ["B", "A1"],
      planName: "Rabatt Tarif",
      registrationDate: "12.05.2026",
      status: "aktiv",
    });
    expect(row!.registrationTime).toBe(new Date(2026, 4, 12).getTime());
  });

  test("balanceCents is null when student has no ledger activity", () => {
    const [row] = deriveContractRows([makeStudent()], plans);
    expect(row!.balanceCents).toBeNull();
  });

  test("balanceCents is populated when balances map contains the customerNumber", () => {
    const balances = new Map([["10057", 43500]]);
    const [row] = deriveContractRows([makeStudent()], plans, balances);
    expect(row!.balanceCents).toBe(43500);
  });
});

describe("computeContractKpis", () => {
  const rows = deriveContractRows(
    [
      makeStudent({ id: 1, registrationDate: "12.05.2026" }),
      makeStudent({ id: 2, registrationDate: "01.06.2026" }),
      makeStudent({
        id: 3,
        status: "inaktiv",
        registrationDate: "20.06.2026",
      }),
      makeStudent({ id: 4, registrationDate: "Nicht geplant" }),
    ],
    plans,
  );

  test("totals, status split, and this-month count", () => {
    expect(computeContractKpis(rows, new Date(2026, 5, 11))).toEqual({
      total: 4,
      active: 3,
      inactive: 1,
      thisMonth: 2,
    });
  });

  test("same month in another year does not count", () => {
    expect(isInMonth(new Date(2025, 5, 1).getTime(), new Date(2026, 5, 11))).toBe(false);
    expect(isInMonth(Number.NaN, new Date(2026, 5, 11))).toBe(false);
  });
});

describe("filterContractRows", () => {
  const rows = deriveContractRows(
    [
      makeStudent({ id: 1 }),
      makeStudent({
        id: 2,
        firstName: "Jonas",
        lastName: "Keller",
        contractNumber: "V-2026-1100",
        customerNumber: "10090",
        status: "inaktiv",
      }),
    ],
    plans,
  );

  test("status filter", () => {
    expect(filterContractRows(rows, "", "aktiv").map((row) => row.studentId)).toEqual([
      1,
    ]);
    expect(filterContractRows(rows, "", "inaktiv").map((row) => row.studentId)).toEqual([
      2,
    ]);
    expect(filterContractRows(rows, "", "alle")).toHaveLength(2);
  });

  test("search by name (case-insensitive)", () => {
    expect(
      filterContractRows(rows, "keller", "alle").map((row) => row.studentId),
    ).toEqual([2]);
  });

  test("search by contract and customer number", () => {
    expect(
      filterContractRows(rows, "V-2026-1042", "alle").map((row) => row.studentId),
    ).toEqual([1]);
    expect(filterContractRows(rows, "10090", "alle").map((row) => row.studentId)).toEqual(
      [2],
    );
  });

  test("status still applies while searching", () => {
    expect(filterContractRows(rows, "keller", "aktiv")).toHaveLength(0);
  });

  test("archived contracts only appear under Archiviert", () => {
    const archived = deriveArchivedContractRows(
      [
        {
          archiveId: 7,
          deletedAt: "2026-09-28T10:00:00Z",
          reason: "Ausbildung abgeschlossen",
          studentId: 9,
          firstName: "Tom",
          lastName: "Richter",
          contractNumber: "V-2026-1018",
          customerNumber: "10058",
          classes: "A",
          registrationDate: "03.05.2026",
          pricePlanId: 2,
        },
      ],
      plans,
    );
    expect(archived[0]).toMatchObject({
      name: "Richter, Tom",
      planName: "Rabatt Tarif",
      archived: { archiveId: 7, reason: "Ausbildung abgeschlossen" },
    });
    const all = [...rows, ...archived];
    expect(filterContractRows(all, "", "alle")).toHaveLength(2);
    expect(filterContractRows(all, "", "inaktiv").map((row) => row.studentId)).toEqual([
      2,
    ]);
    expect(filterContractRows(all, "", "archiviert").map((row) => row.studentId)).toEqual(
      [9],
    );
  });
});
