import { describe, expect, test } from "bun:test";

import { examReadiness, rankForExamPlanning, type ReadinessEvent } from "@/lib/exams";

const student = {
  id: 7,
  firstName: "Aylin",
  lastName: "Demir",
  status: "aktiv" as const,
  progress: 91,
  theory: { status: "Pausiert", progress: 0, attendedUnits: 0, requiredUnits: 14 },
};

const exam = (
  type: "Theorieprüfung" | "Vorstellung zur prakt. Prüfung",
  date: string,
  extra: Partial<ReadinessEvent> = {},
): ReadinessEvent => ({ type, date, start: "10:00", studentId: 7, ...extra });

describe("examReadiness", () => {
  test("a booked practical exam wins — no Theorieprüfung suggestion", () => {
    const result = examReadiness(
      student,
      [exam("Vorstellung zur prakt. Prüfung", "2026-10-01")],
      "2026-09-28",
    );
    expect(result.stage).toBe("gebucht");
    expect(result.suggestion).toBeNull();
    expect(result.status).toBe("Praktische Prüfung am 01.10.2026 gebucht");
  });

  test("past exams without result are not shown as booked", () => {
    const result = examReadiness(
      student,
      [exam("Theorieprüfung", "2026-06-12")],
      "2026-09-28",
    );
    expect(result.booked).toBeNull();
    expect(result.stage).toBe("in_ausbildung");
    expect(result.status).toBe("Theorie: 0 von 14 Doppelstunden");
    expect(result.suggestion).toBeNull();
  });

  test("passed theory → practical exam; complete course → theory exam", () => {
    expect(
      examReadiness(
        student,
        [exam("Theorieprüfung", "2026-09-01", { examResult: "bestanden" })],
        "2026-09-28",
      ).suggestion,
    ).toBe("Vorstellung zur prakt. Prüfung");
    const complete = {
      ...student,
      theory: { ...student.theory, attendedUnits: 14, status: "Bereit" },
    };
    expect(examReadiness(complete, [], "2026-09-28").suggestion).toBe("Theorieprüfung");
  });

  test("events are matched by id, or by name when unlinked", () => {
    const byName = exam("Vorstellung zur prakt. Prüfung", "2026-10-01", {
      studentId: undefined,
      subtitle: "Aylin Demir",
    });
    const other = exam("Vorstellung zur prakt. Prüfung", "2026-10-01", { studentId: 99 });
    expect(examReadiness(student, [byName], "2026-09-28").stage).toBe("gebucht");
    expect(examReadiness(student, [other], "2026-09-28").stage).toBe("in_ausbildung");
  });

  test("licence issued → done; cancelled exams are ignored", () => {
    expect(
      examReadiness({ ...student, licenseDate: "2026-09-01" }, [], "2026-09-28").stage,
    ).toBe("bestanden");
    const cancelled = exam("Vorstellung zur prakt. Prüfung", "2026-10-01", {
      cancelledAt: "2026-09-20T10:00:00Z",
    });
    expect(examReadiness(student, [cancelled], "2026-09-28").booked).toBeNull();
  });
});

describe("rankForExamPlanning", () => {
  test("ready students first, finished and inactive ones dropped", () => {
    const ready = {
      ...student,
      id: 8,
      firstName: "Tom",
      progress: 40,
      theory: { ...student.theory, attendedUnits: 14, status: "Bereit" },
    };
    const done = { ...student, id: 9, firstName: "Lena", licenseDate: "2026-01-01" };
    const inactive = { ...student, id: 10, status: "inaktiv" as const };
    const ranked = rankForExamPlanning(
      [student, ready, done, inactive],
      [],
      "2026-09-28",
    );
    expect(ranked.map(({ student: entry }) => entry.id)).toEqual([8, 7]);
  });
});
