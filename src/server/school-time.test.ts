import { describe, expect, test } from "bun:test";

import { schoolNow, schoolToday } from "./school-time";

describe("school time", () => {
  test("wall clock of Europe/Berlin regardless of the process zone", () => {
    // 12:30 UTC in summer = 14:30 in Germany (CEST).
    const summer = schoolNow(new Date("2026-09-28T12:30:00Z"));
    expect([summer.getHours(), summer.getMinutes()]).toEqual([14, 30]);
    // Winter: CET = UTC+1.
    const winter = schoolNow(new Date("2026-12-01T12:30:00Z"));
    expect(winter.getHours()).toBe(13);
  });

  test("the school day starts at local midnight", () => {
    expect(schoolToday(new Date("2026-09-27T22:30:00Z"))).toBe("2026-09-28");
    expect(schoolToday(new Date("2026-09-27T21:30:00Z"))).toBe("2026-09-27");
  });
});
