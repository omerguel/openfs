import { describe, expect, test } from "bun:test";

import { formatMileage, huState, mileageDigits, parseHuMonth } from "./vehicle-hu";

describe("HU month", () => {
  test("parses MM/JJJJ and JJJJ-MM", () => {
    expect(parseHuMonth("03/2027")).toEqual({ year: 2027, month: 3 });
    expect(parseHuMonth("2027-03")).toEqual({ year: 2027, month: 3 });
    expect(parseHuMonth("3.2027")).toEqual({ year: 2027, month: 3 });
    expect(parseHuMonth("13/2027")).toBeNull();
    expect(parseHuMonth("bald")).toBeNull();
    expect(parseHuMonth("")).toBeNull();
  });

  test("overdue after the HU month, due within 60 days of its end", () => {
    const today = new Date(2026, 8, 28); // 28.09.2026
    expect(huState("08/2026", today)).toBe("overdue");
    expect(huState("09/2026", today)).toBe("due"); // end of this month
    expect(huState("10/2026", today)).toBe("due");
    expect(huState("11/2026", today)).toBe("ok"); // 30.11. is 63 days away
    expect(huState("12/2026", today)).toBe("ok");
    expect(huState("03/2027", today)).toBe("ok");
    expect(huState("", today)).toBeNull();
  });
});

describe("Kilometerstand", () => {
  test("digits in, formatted out", () => {
    expect(mileageDigits("84.320 km")).toBe("84320");
    expect(formatMileage("84320")).toBe("84.320 km");
    expect(formatMileage("")).toBe("");
  });
});
