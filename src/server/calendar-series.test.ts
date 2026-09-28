/* ------------------------------------------------------------------ */
/* Unit tests for recurring lessons: date expansion, atomic create,   */
/* and the guarded "delete from date on". In-memory DB per test.      */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { createAbsence } from "./absences";
import { ensureAttestationTables, createAttestation } from "./ausbildungsnachweis";
import {
  createCalendarEvent,
  listCalendarEvents,
  markEventBilled,
} from "./calendar-events";
import {
  createCalendarEventSeries,
  deleteCalendarEventSeries,
  seriesDates,
} from "./calendar-series";
import { openDb } from "./db";
import { createTransaction, stornoTransaction } from "./engine";
import { instructorIdByName } from "./refs";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const LESSON = {
  date: "2026-07-06",
  start: "16:00",
  end: "16:45",
  title: "Fahrstunde",
  instructor: "Martin Weber",
  type: "Praktisch" as const,
};

const seriesEvents = (seriesId: string) =>
  listCalendarEvents(db).filter((event) => event.seriesId === seriesId);

describe("seriesDates", () => {
  test("weekly with count", () => {
    expect(seriesDates("2026-07-06", { interval: "weekly", count: 3 })).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
    ]);
  });

  test("biweekly until an inclusive end date, across a month boundary", () => {
    expect(
      seriesDates("2026-07-20", { interval: "biweekly", until: "2026-08-17" }),
    ).toEqual(["2026-07-20", "2026-08-03", "2026-08-17"]);
  });

  test("validation", () => {
    const first = "2026-07-06";
    expect(() => seriesDates(first, undefined)).toThrow(/repeat/);
    expect(() => seriesDates(first, { interval: "daily", count: 3 })).toThrow(
      /Intervall/,
    );
    expect(() => seriesDates(first, { interval: "weekly" })).toThrow(/entweder/);
    expect(() =>
      seriesDates(first, { interval: "weekly", count: 3, until: "2026-08-01" }),
    ).toThrow(/entweder/);
    expect(() => seriesDates(first, { interval: "weekly", count: 1 })).toThrow(
      /2 und 52/,
    );
    expect(() => seriesDates(first, { interval: "weekly", count: 53 })).toThrow(
      /2 und 52/,
    );
    expect(() => seriesDates(first, { interval: "weekly", until: "2027-07-07" })).toThrow(
      /ein Jahr/,
    );
    expect(() => seriesDates(first, { interval: "weekly", until: "2026-07-10" })).toThrow(
      /mindestens zwei/,
    );
  });

  test("a full year of weekly lessons is allowed via until", () => {
    expect(
      seriesDates("2026-07-06", { interval: "weekly", until: "2027-07-06" }),
    ).toHaveLength(53);
  });
});

describe("createCalendarEventSeries", () => {
  test("creates all occurrences with one shared series id", () => {
    const result = createCalendarEventSeries(db, {
      ...LESSON,
      lessonKind: "Übungsfahrt",
      repeat: { interval: "weekly", count: 4 },
    });
    expect(result.events).toHaveLength(4);
    expect(result.events.map((event) => event.date)).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
    expect(seriesEvents(result.seriesId)).toHaveLength(4);
    expect(result.events.every((event) => event.lessonKind === "Übungsfahrt")).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  test("a conflict on a later date rolls back the whole series", () => {
    createCalendarEvent(db, { ...LESSON, date: "2026-07-20", title: "Belegt" });
    const before = listCalendarEvents(db).length;
    expect(() =>
      createCalendarEventSeries(db, {
        ...LESSON,
        repeat: { interval: "weekly", count: 4 },
      }),
    ).toThrow("Termin am 20.07.2026: Überschneidung mit „Belegt“");
    expect(listCalendarEvents(db)).toHaveLength(before);
  });

  test("an absence inside the series blocks it unless allowConflicts", () => {
    createAbsence(db, {
      instructorId: instructorIdByName(db, "Martin Weber")!,
      fromDate: "2026-07-13",
      kind: "Urlaub",
    });
    expect(() =>
      createCalendarEventSeries(db, {
        ...LESSON,
        repeat: { interval: "weekly", count: 2 },
      }),
    ).toThrow(/abwesend \(Urlaub\)/);
    const result = createCalendarEventSeries(db, {
      ...LESSON,
      allowConflicts: true,
      repeat: { interval: "weekly", count: 2 },
    });
    expect(result.events).toHaveLength(2);
  });

  test("invalid event data fails before anything is written", () => {
    const before = listCalendarEvents(db).length;
    expect(() =>
      createCalendarEventSeries(db, {
        ...LESSON,
        title: "",
        repeat: { interval: "weekly", count: 2 },
      }),
    ).toThrow("Titel ist ein Pflichtfeld.");
    expect(listCalendarEvents(db)).toHaveLength(before);
  });
});

describe("deleteCalendarEventSeries", () => {
  test("deletes occurrences on/after `from` and archives them", () => {
    const { seriesId } = createCalendarEventSeries(db, {
      ...LESSON,
      repeat: { interval: "weekly", count: 4 },
    });
    expect(deleteCalendarEventSeries(db, seriesId, "2026-07-13")).toEqual({
      deleted: 3,
      skipped: 0,
    });
    expect(seriesEvents(seriesId).map((event) => event.date)).toEqual(["2026-07-06"]);
    const archived = db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM archive WHERE entity = 'calendar_event'",
      )
      .get()!.n;
    expect(archived).toBe(3);
  });

  test("without `from` deletes the whole series", () => {
    const { seriesId } = createCalendarEventSeries(db, {
      ...LESSON,
      repeat: { interval: "biweekly", count: 3 },
    });
    expect(deleteCalendarEventSeries(db, seriesId)).toEqual({ deleted: 3, skipped: 0 });
  });

  test("skips billed and attested occurrences", () => {
    ensureAttestationTables(db);
    const studentId = db
      .query<{ id: number }, []>("SELECT id FROM students ORDER BY id LIMIT 1")
      .get()!.id;
    const { seriesId, events } = createCalendarEventSeries(db, {
      ...LESSON,
      studentId,
      repeat: { interval: "weekly", count: 4 },
    });
    const tx = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-07-13",
      amountCents: 6500,
      habenKonto: "4400",
      student: {
        customerNo: "K1",
        name: "Test",
        address: "",
        contractNo: "V1",
        classes: "B",
      },
      description: "Fahrübungsstunde (45)",
    });
    markEventBilled(db, Number(events[1]!.id), tx.id);
    createAttestation(db, {
      eventId: Number(events[2]!.id),
      studentId,
      instructor: "Martin Weber",
      content: "Stadtfahrt",
      durationMin: 45,
      signatureDataUrl: "data:image/png;base64,abc123",
    });

    expect(deleteCalendarEventSeries(db, seriesId, "2026-07-06")).toEqual({
      deleted: 2,
      skipped: 2,
    });

    // After a storno the billed occurrence can go.
    stornoTransaction(db, tx.id, "Fehler", "2026-07-14");
    expect(deleteCalendarEventSeries(db, seriesId)).toEqual({ deleted: 1, skipped: 1 });
  });

  test("unknown series or bad date → ValidationError", () => {
    expect(() => deleteCalendarEventSeries(db, "nope")).toThrow("Serie nicht gefunden.");
    const { seriesId } = createCalendarEventSeries(db, {
      ...LESSON,
      repeat: { interval: "weekly", count: 2 },
    });
    expect(() => deleteCalendarEventSeries(db, seriesId, "13.07.2026")).toThrow(
      /ISO-Datum/,
    );
  });
});
