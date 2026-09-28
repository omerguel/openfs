import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CANCELLATION_POLICY,
  isLateCancellation,
  suggestCancellationFee,
} from "./cancellation";

describe("isLateCancellation", () => {
  const now = new Date(2026, 5, 10, 9, 0); // 10.06.2026 09:00 local

  test("more than hoursBefore ahead → not late", () => {
    expect(isLateCancellation("2026-06-11", "09:01", 24, now)).toBe(false);
  });

  test("exactly at the boundary → not late; one minute inside → late", () => {
    expect(isLateCancellation("2026-06-11", "09:00", 24, now)).toBe(false);
    expect(isLateCancellation("2026-06-11", "08:59", 24, now)).toBe(true);
  });

  test("a lesson that already started is late", () => {
    expect(isLateCancellation("2026-06-10", "08:00", 24, now)).toBe(true);
  });

  test("hoursBefore 0 only flags started lessons", () => {
    expect(isLateCancellation("2026-06-10", "09:30", 0, now)).toBe(false);
  });
});

describe("suggestCancellationFee", () => {
  const now = new Date(2026, 5, 10, 9, 0);
  const event = { date: "2026-06-20", start: "10:00" };

  test("no-show always suggests a fee", () => {
    expect(
      suggestCancellationFee("nicht_erschienen", event, DEFAULT_CANCELLATION_POLICY, now),
    ).toBe(true);
  });

  test("timely cancellation suggests none, late one does", () => {
    expect(
      suggestCancellationFee("abgesagt", event, DEFAULT_CANCELLATION_POLICY, now),
    ).toBe(false);
    expect(
      suggestCancellationFee(
        "abgesagt",
        { date: "2026-06-10", start: "18:00" },
        DEFAULT_CANCELLATION_POLICY,
        now,
      ),
    ).toBe(true);
  });
});
