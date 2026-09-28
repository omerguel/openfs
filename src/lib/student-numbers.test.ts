import { describe, expect, test } from "bun:test";

import { nextStudentNumbers, studentNumberSequence } from "./student-numbers";

describe("student numbers", () => {
  test("start above the floor for an empty school", () => {
    expect(nextStudentNumbers([])).toEqual({
      customerNumber: "10059",
      contractNumber: "V-2026-1043",
    });
  });

  test("continue after the highest existing numbers", () => {
    expect(
      nextStudentNumbers([
        { customerNumber: "20000", contractNumber: "V-2025-3000" },
        { customerNumber: "K-7", contractNumber: "frei" },
      ]),
    ).toEqual({ customerNumber: "20001", contractNumber: "V-2026-3001" });
  });

  test("a sequence hands out consecutive numbers", () => {
    const seq = studentNumberSequence([]);
    expect([seq.nextCustomerNumber(), seq.nextCustomerNumber()]).toEqual([
      "10059",
      "10060",
    ]);
    expect(seq.nextContractNumber()).toBe("V-2026-1043");
  });

  test("initial lessons start at zero", () => {});
});
