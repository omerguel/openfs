import { describe, expect, test } from "bun:test";

import { nextStudentNumbers, studentNumberSequence } from "./student-numbers";

describe("student numbers", () => {
  test("an empty school starts low", () => {
    expect(nextStudentNumbers([], 2026)).toEqual({
      customerNumber: "1001",
      contractNumber: "V-2026-0001",
    });
  });

  test("continue after the highest existing numbers (demo numbering)", () => {
    expect(
      nextStudentNumbers(
        [
          { customerNumber: "10058", contractNumber: "V-2026-1042" },
          { customerNumber: "K-7", contractNumber: "frei" },
        ],
        2026,
      ),
    ).toEqual({ customerNumber: "10059", contractNumber: "V-2026-1043" });
  });

  test("the contract prefix carries the current year", () => {
    expect(
      nextStudentNumbers(
        [{ customerNumber: "1001", contractNumber: "V-2026-0001" }],
        2027,
      ).contractNumber,
    ).toBe("V-2027-0002");
  });

  test("a sequence hands out consecutive numbers", () => {
    const seq = studentNumberSequence([], 2026);
    expect([seq.nextCustomerNumber(), seq.nextCustomerNumber()]).toEqual([
      "1001",
      "1002",
    ]);
    expect(seq.nextContractNumber()).toBe("V-2026-0001");
  });
});
