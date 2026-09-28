import { describe, expect, test } from "bun:test";

import type { CalEvent } from "./calendar-data";
import {
  dailyLimitWarning,
  eventMatchesSearch,
  formatDuration,
  instructorColorIndex,
  monthRangeLabel,
  moveStartKeepDuration,
  parseTimeInput,
  quarterHourOptions,
  slotIssues,
  weekdayShort,
} from "./scheduling";

describe("parseTimeInput", () => {
  test("accepts common ways of typing a time", () => {
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("9:30")).toBe("09:30");
    expect(parseTimeInput("9.30")).toBe("09:30");
    expect(parseTimeInput("17:45 Uhr")).toBe("17:45");
    expect(parseTimeInput("1745")).toBe("17:45");
    expect(parseTimeInput("9:3")).toBe("09:30");
    expect(parseTimeInput("24:00")).toBe("24:00");
  });

  test("rejects nonsense", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("25")).toBeNull();
    expect(parseTimeInput("9:75")).toBeNull();
    expect(parseTimeInput("24:15")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
  });
});

describe("quarterHourOptions", () => {
  test("steps in 15 minutes", () => {
    expect(quarterHourOptions(7 * 60, 8 * 60)).toEqual([
      "07:00",
      "07:15",
      "07:30",
      "07:45",
    ]);
  });
});

describe("moveStartKeepDuration", () => {
  test("keeps the lesson length when the start moves", () => {
    expect(moveStartKeepDuration({ start: "08:00", end: "08:45" }, "17:00")).toEqual({
      start: "17:00",
      end: "17:45",
    });
  });

  test("caps at midnight", () => {
    expect(moveStartKeepDuration({ start: "08:00", end: "09:30" }, "23:30")).toEqual({
      start: "23:30",
      end: "24:00",
    });
  });
});

describe("slotIssues", () => {
  const now = new Date(2026, 8, 28, 12, 0);

  test("end before start is an error", () => {
    expect(
      slotIssues(
        { date: "2026-09-30", start: "10:00", end: "09:00", type: "Praktisch" },
        now,
      ),
    ).toEqual([{ level: "error", message: "„Bis“ muss nach „Von“ liegen." }]);
  });

  test("warns about implausible practical durations and past slots", () => {
    const issues = slotIssues(
      { date: "2026-09-28", start: "08:00", end: "17:15", type: "Praktisch" },
      now,
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      "Ungewöhnlich lange Fahrstunde (9 Std. 15 Min.) – bitte „Bis“ prüfen.",
      "Der Termin liegt in der Vergangenheit.",
    ]);
    expect(
      slotIssues(
        { date: "2026-09-29", start: "08:00", end: "17:15", type: "Andere" },
        now,
      ),
    ).toEqual([]);
  });
});

describe("formatDuration", () => {
  test("formats hours and minutes", () => {
    expect(formatDuration(45)).toBe("45 Min.");
    expect(formatDuration(120)).toBe("2 Std.");
    expect(formatDuration(555)).toBe("9 Std. 15 Min.");
  });
});

describe("dailyLimitWarning", () => {
  const lesson = (id: string, start: string, end: string): CalEvent => ({
    id,
    date: "2026-09-30",
    start,
    end,
    title: "Fahrstunde",
    instructor: "Sven Kappel",
    type: "Praktisch",
  });
  const day = [lesson("1", "07:00", "11:00"), lesson("2", "12:00", "16:00")]; // 480 min

  test("warns once the day would exceed 495 minutes", () => {
    expect(dailyLimitWarning(day, lesson("new", "16:00", "16:15"))).toBeNull();
    expect(dailyLimitWarning(day, lesson("new", "16:00", "16:45"))).toBe(
      "Sven Kappel käme an diesem Tag auf 525 Min. praktischen Unterricht — erlaubt sind höchstens 495 Min.",
    );
  });

  test("ignores the edited event itself, theory and cancelled lessons", () => {
    expect(dailyLimitWarning(day, lesson("2", "12:00", "16:00"))).toBeNull();
    expect(
      dailyLimitWarning(day, { ...lesson("new", "16:00", "18:00"), type: "Theorie" }),
    ).toBeNull();
    const cancelled = [...day, { ...lesson("3", "17:00", "19:00"), cancelledAt: "x" }];
    expect(dailyLimitWarning(cancelled, lesson("new", "16:00", "16:15"))).toBeNull();
  });
});

describe("instructorColorIndex", () => {
  test("is stable by roster position and wraps around the palette", () => {
    const roster = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    expect(instructorColorIndex("B", roster)).toBe(1);
    expect(instructorColorIndex("I", roster)).toBe(0);
    expect(instructorColorIndex("Nicht zugeteilt", roster)).toBeNull();
    expect(instructorColorIndex(undefined, roster)).toBeNull();
  });
});

describe("monthRangeLabel / weekdayShort", () => {
  test("single month, two months, two years", () => {
    expect(monthRangeLabel(new Date(2026, 8, 7), new Date(2026, 8, 13))).toBe(
      "September 2026",
    );
    expect(monthRangeLabel(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe(
      "Sep – Okt 2026",
    );
    expect(monthRangeLabel(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe(
      "Dez 2026 – Jan 2027",
    );
  });

  test("two-letter weekdays", () => {
    expect(weekdayShort(new Date(2026, 8, 28))).toBe("Mo");
    expect(weekdayShort(new Date(2026, 9, 1))).toBe("Do");
  });
});

describe("eventMatchesSearch", () => {
  test("matches student, title and notes, ignoring case and accents", () => {
    const event = {
      title: "Fahrstunde",
      subtitle: "Mara Köhler",
      instructor: "Nadine Aksoy",
      notes: "Abholung Schule",
    };
    expect(eventMatchesSearch(event, "kohler")).toBe(true);
    expect(eventMatchesSearch(event, "schule")).toBe(true);
    expect(eventMatchesSearch(event, "weber")).toBe(false);
    expect(eventMatchesSearch(event, "  ")).toBe(true);
  });
});
