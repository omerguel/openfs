import { describe, expect, test } from "bun:test";

import {
  DEFAULT_RETENTION_POLICY,
  formatPeriod,
  normalizeRetentionPolicy,
  periodError,
  periodOver,
} from "./retention";

describe("retention helpers", () => {
  test("formats periods in German", () => {
    expect(formatPeriod(0)).toBe("sofort");
    expect(formatPeriod(1)).toBe("1 Monat");
    expect(formatPeriod(6)).toBe("6 Monate");
    expect(formatPeriod(12)).toBe("1 Jahr");
    expect(formatPeriod(120)).toBe("10 Jahre");
  });

  test("stored settings are clamped to the legal ranges", () => {
    expect(normalizeRetentionPolicy(null)).toEqual(DEFAULT_RETENTION_POLICY);
    const policy = normalizeRetentionPolicy({
      mode: "automatisch",
      months: { buchhaltung: 12, anfragen: 3, unbekannt: 1 },
    });
    expect(policy.mode).toBe("automatisch");
    expect(policy.months.buchhaltung).toBe(120);
    expect(policy.months.anfragen).toBe(3);
    expect(periodError("ausbildungsnachweis", 60)).toBeNull();
    expect(periodError("ausbildungsnachweis", 72)).toContain("Gesetzlich");
    expect(periodError("anfragen", 1.5)).toContain("ganze");
  });

  test("periods from the end of the year start on 1 January", () => {
    expect(periodOver("2020-03-01", 60, true, "2025-12-31")).toBe(false);
    expect(periodOver("2020-03-01", 60, true, "2026-01-01")).toBe(true);
    expect(periodOver("2026-01-15", 6, false, "2026-07-15")).toBe(false);
    expect(periodOver("2026-01-15", 6, false, "2026-07-16")).toBe(true);
  });
});
