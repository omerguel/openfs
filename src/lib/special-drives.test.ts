import { describe, expect, test } from "bun:test";

import {
  computeSpecialDriveProgress,
  isLessonKind,
  SPECIAL_DRIVE_REQUIREMENTS_B,
  type SpecialDriveEvent,
} from "./special-drives";

const lesson = (overrides: Partial<SpecialDriveEvent> = {}): SpecialDriveEvent => ({
  type: "Praktisch",
  date: "2026-06-01",
  start: "10:00",
  end: "10:45",
  lessonKind: "Überlandfahrt",
  ...overrides,
});

const byKind = (events: SpecialDriveEvent[], today = "2026-06-10") =>
  Object.fromEntries(
    computeSpecialDriveProgress(events, today).map((row) => [row.kind, row]),
  );

describe("computeSpecialDriveProgress", () => {
  test("requirements are 225 / 180 / 135 minutes for class B", () => {
    expect(SPECIAL_DRIVE_REQUIREMENTS_B).toEqual({
      Überlandfahrt: 225,
      Autobahnfahrt: 180,
      Nachtfahrt: 135,
    });
    const rows = byKind([]);
    expect(rows.Überlandfahrt!.remainingMinutes).toBe(225);
    expect(rows.Autobahnfahrt!.done).toBe(false);
  });

  test("sums minutes per kind", () => {
    const rows = byKind([
      lesson(),
      lesson({ start: "11:00", end: "12:30" }),
      lesson({ lessonKind: "Nachtfahrt", start: "20:00", end: "22:15" }),
    ]);
    expect(rows.Überlandfahrt!.completedMinutes).toBe(135);
    expect(rows.Überlandfahrt!.remainingMinutes).toBe(90);
    expect(rows.Nachtfahrt!.completedMinutes).toBe(135);
    expect(rows.Nachtfahrt!.done).toBe(true);
    expect(rows.Autobahnfahrt!.completedMinutes).toBe(0);
  });

  test("today counts, future does not", () => {
    const rows = byKind(
      [lesson({ date: "2026-06-10" }), lesson({ date: "2026-06-11" })],
      "2026-06-10",
    );
    expect(rows.Überlandfahrt!.completedMinutes).toBe(45);
  });

  test("ignores cancelled lessons, other types and other kinds", () => {
    const rows = byKind([
      lesson({ cancelledAt: "2026-06-01T08:00:00.000Z" }),
      lesson({ type: "Theorie" }),
      lesson({ lessonKind: "Übungsfahrt" }),
      lesson({ lessonKind: undefined }),
      lesson({ lessonKind: null }),
    ]);
    expect(rows.Überlandfahrt!.completedMinutes).toBe(0);
  });

  test("never reports negative remaining minutes", () => {
    const rows = byKind([lesson({ lessonKind: "Autobahnfahrt", end: "15:00" })]);
    expect(rows.Autobahnfahrt!.remainingMinutes).toBe(0);
    expect(rows.Autobahnfahrt!.done).toBe(true);
  });
});

describe("isLessonKind", () => {
  test("accepts the five kinds only", () => {
    expect(isLessonKind("Nachtfahrt")).toBe(true);
    expect(isLessonKind("Grundfahraufgaben")).toBe(true);
    expect(isLessonKind("Stadtfahrt")).toBe(false);
    expect(isLessonKind(null)).toBe(false);
  });
});
