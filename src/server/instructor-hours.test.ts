import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { createCalendarEvent } from "./calendar-events";
import { cancelCalendarEvent } from "./cancellations";
import { openDb } from "./db";
import { instructorHoursReport } from "./instructor-hours";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const add = (overrides: Record<string, unknown>) =>
  createCalendarEvent(db, {
    date: "2026-06-10",
    title: "Termin",
    instructor: "Martin Weber",
    type: "Praktisch",
    ...overrides,
  });

const martinIn = (report: ReturnType<typeof instructorHoursReport>) =>
  report.instructors.find((row) => row.instructor === "Martin Weber")!;

describe("instructorHoursReport", () => {
  test("splits practical, theory and other minutes per day", () => {
    add({ start: "08:00", end: "09:30" });
    add({ start: "10:00", end: "10:45", type: "Vorstellung zur prakt. Prüfung" });
    add({ start: "18:00", end: "19:30", type: "Theorie" });
    add({ start: "12:00", end: "12:30", type: "Andere" });
    add({ date: "2026-06-11", start: "08:00", end: "08:45" });

    const report = instructorHoursReport(db, "2026-06-08", "2026-06-14");
    expect(report.limitMinutes).toBe(495);
    const martin = martinIn(report);
    expect(martin.days).toEqual([
      {
        date: "2026-06-10",
        practicalMinutes: 135,
        theoryMinutes: 90,
        otherMinutes: 30,
        totalMinutes: 255,
        overLimit: false,
      },
      {
        date: "2026-06-11",
        practicalMinutes: 45,
        theoryMinutes: 0,
        otherMinutes: 0,
        totalMinutes: 45,
        overLimit: false,
      },
    ]);
    expect(martin.practicalMinutes).toBe(180);
    expect(martin.totalMinutes).toBe(300);
    expect(martin.overLimitDays).toBe(0);
  });

  test("flags days above 495 practical minutes; theory does not count", () => {
    add({ start: "07:00", end: "15:00" }); // 480
    add({ start: "15:00", end: "15:15" }); // 495 — still fine
    add({ start: "18:00", end: "21:00", type: "Theorie" });
    let martin = martinIn(instructorHoursReport(db, "2026-06-10", "2026-06-10"));
    expect(martin.days[0]!.overLimit).toBe(false);

    add({ start: "16:00", end: "16:15" }); // 510
    martin = martinIn(instructorHoursReport(db, "2026-06-10", "2026-06-10"));
    expect(martin.days[0]!.practicalMinutes).toBe(510);
    expect(martin.days[0]!.overLimit).toBe(true);
    expect(martin.overLimitDays).toBe(1);
  });

  test("cancelled Termine are excluded; active instructors appear without Termine", () => {
    const event = add({ start: "08:00", end: "09:00" });
    cancelCalendarEvent(db, Number(event.id), { kind: "nicht_erschienen" });
    const report = instructorHoursReport(db, "2026-06-01", "2026-06-30");
    expect(martinIn(report).totalMinutes).toBe(0);
    expect(report.instructors.map((row) => row.instructor)).toContain("Sven Kappel");
  });

  test("range validation", () => {
    expect(() => instructorHoursReport(db, undefined, "2026-06-10")).toThrow(/Zeitraum/);
    expect(() => instructorHoursReport(db, "2026-06-10", "2026-06-01")).toThrow(
      /nicht vor dem Startdatum/,
    );
    expect(() => instructorHoursReport(db, "2026-01-01", "2027-06-01")).toThrow(
      /höchstens ein Jahr/,
    );
  });
});
