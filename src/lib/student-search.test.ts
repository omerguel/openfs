import { describe, expect, test } from "bun:test";

import { matchesStudentQuery, phoneDigits } from "./student-search";

const mia = {
  firstName: "Mia",
  lastName: "Schneider",
  classes: "B",
  phone: "0152 7654321",
  email: "mia.schneider@example.de",
  contractNumber: "V-2026-1043",
  customerNumber: "10058",
};

describe("phoneDigits", () => {
  test("national form", () => {
    expect(phoneDigits("+49 152 765-4321")).toBe("01527654321");
    expect(phoneDigits("0049 152 7654321")).toBe("01527654321");
    expect(phoneDigits("0152/7654321")).toBe("01527654321");
  });
});

describe("matchesStudentQuery", () => {
  test("empty query matches everyone", () => {
    expect(matchesStudentQuery(mia, "  ")).toBe(true);
  });

  test("names in either order, case-insensitive", () => {
    expect(matchesStudentQuery(mia, "mia schneider")).toBe(true);
    expect(matchesStudentQuery(mia, "Schneider Mia")).toBe(true);
    expect(matchesStudentQuery(mia, "Müller")).toBe(false);
  });

  test("phone digits ignore spaces, dashes and +49", () => {
    expect(matchesStudentQuery(mia, "01527654321")).toBe(true);
    expect(matchesStudentQuery(mia, "0152-765 4321")).toBe(true);
    expect(matchesStudentQuery(mia, "+49 1527654321")).toBe(true);
    expect(matchesStudentQuery(mia, "7654321")).toBe(true);
    expect(matchesStudentQuery({ ...mia, phone: "+49 152 7654321" }, "01527654321")).toBe(
      true,
    );
    expect(matchesStudentQuery(mia, "0170")).toBe(false);
  });

  test("e-mail, Kundennummer and Vertragsnummer", () => {
    expect(matchesStudentQuery(mia, "mia.schneider@")).toBe(true);
    expect(matchesStudentQuery(mia, "10058")).toBe(true);
    expect(matchesStudentQuery(mia, "v-2026-1043")).toBe(true);
  });
});
