/* ------------------------------------------------------------------ */
/* Unit tests for the calendar-events DB module: seed, CRUD, validation */
/* and the optional date-range filter. In-memory DB per test.          */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  markEventBilled,
  recordExamResult,
  updateCalendarEvent,
} from "./calendar-events";
import { openDb } from "./db";
import { createTransaction, stornoTransaction, ValidationError } from "./engine";
import { createAttestation, ensureAttestationTables } from "./ausbildungsnachweis";
import type { StudentRef } from "@/lib/accounting-types";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const VALID = {
  date: "2026-06-10",
  start: "09:00",
  end: "10:00",
  title: "Fahrstunde",
  instructor: "Martin Weber",
  type: "Praktisch" as const,
};

describe("seed", () => {
  test("a fresh DB seeds 9 calendar events", () => {
    expect(listCalendarEvents(db)).toHaveLength(9);
  });

  test("seeded events are ordered by date then start", () => {
    const events = listCalendarEvents(db);
    for (let i = 1; i < events.length; i++) {
      const prev = `${events[i - 1]!.date} ${events[i - 1]!.start}`;
      const curr = `${events[i]!.date} ${events[i]!.start}`;
      expect(prev <= curr).toBe(true);
    }
  });
});

describe("createCalendarEvent", () => {
  test("happy path returns event with string id and omits empty optionals", () => {
    const event = createCalendarEvent(db, VALID);
    expect(typeof event.id).toBe("string");
    expect(event.title).toBe("Fahrstunde");
    expect(event.instructor).toBe("Martin Weber");
    expect(event.subtitle).toBeUndefined();
    expect(event.location).toBeUndefined();
    expect(event.vehicle).toBeUndefined();
    expect(event.tentative).toBeUndefined();
  });

  test("preserves provided optionals and tentative flag", () => {
    const event = createCalendarEvent(db, {
      ...VALID,
      subtitle: "Lena Braun",
      location: "Innenstadt",
      vehicle: "VW Golf",
      tentative: true,
    });
    expect(event.subtitle).toBe("Lena Braun");
    expect(event.location).toBe("Innenstadt");
    expect(event.vehicle).toBe("VW Golf");
    expect(event.vehicleId).toBeGreaterThan(0);
    expect(event.tentative).toBe(true);
  });

  test("trims string fields", () => {
    const event = createCalendarEvent(db, { ...VALID, title: "  Spaced  " });
    expect(event.title).toBe("Spaced");
  });

  test("missing/invalid date → ValidationError", () => {
    expect(() => createCalendarEvent(db, { ...VALID, date: "10.06.2026" })).toThrow(
      ValidationError,
    );
  });

  test("end before start → ValidationError 'Ende muss nach Beginn liegen.'", () => {
    expect(() =>
      createCalendarEvent(db, { ...VALID, start: "12:00", end: "11:00" }),
    ).toThrow("Ende muss nach Beginn liegen.");
  });

  test("equal start and end → ValidationError", () => {
    expect(() =>
      createCalendarEvent(db, { ...VALID, start: "09:00", end: "09:00" }),
    ).toThrow(ValidationError);
  });

  test("malformed time → ValidationError", () => {
    expect(() => createCalendarEvent(db, { ...VALID, start: "9:00" })).toThrow(
      ValidationError,
    );
  });

  test("empty title → ValidationError 'Titel ist ein Pflichtfeld.'", () => {
    expect(() => createCalendarEvent(db, { ...VALID, title: "   " })).toThrow(
      "Titel ist ein Pflichtfeld.",
    );
  });

  test("invalid type → ValidationError 'Ungültiger Termin-Typ.'", () => {
    expect(() => createCalendarEvent(db, { ...VALID, type: "Quatsch" as never })).toThrow(
      "Ungültiger Termin-Typ.",
    );
  });

  test("non-boolean tentative → ValidationError", () => {
    expect(() =>
      createCalendarEvent(db, { ...VALID, tentative: "yes" as never }),
    ).toThrow(ValidationError);
  });
});

describe("getCalendarEvent", () => {
  test("missing id → ValidationError 'Termin nicht gefunden.'", () => {
    expect(() => getCalendarEvent(db, 999999)).toThrow("Termin nicht gefunden.");
  });
});

describe("updateCalendarEvent", () => {
  test("partial update merges over current values", () => {
    const created = createCalendarEvent(db, { ...VALID, subtitle: "Lena" });
    const updated = updateCalendarEvent(db, Number(created.id), {
      title: "Geändert",
    });
    expect(updated.title).toBe("Geändert");
    expect(updated.subtitle).toBe("Lena"); // unchanged field preserved
    expect(updated.start).toBe("09:00");
  });

  test("can move date/time", () => {
    const created = createCalendarEvent(db, VALID);
    const updated = updateCalendarEvent(db, Number(created.id), {
      date: "2026-06-11",
      start: "14:00",
      end: "15:00",
    });
    expect(updated.date).toBe("2026-06-11");
    expect(updated.start).toBe("14:00");
    expect(updated.end).toBe("15:00");
  });

  test("invalid update is rejected", () => {
    const created = createCalendarEvent(db, VALID);
    expect(() => updateCalendarEvent(db, Number(created.id), { end: "08:00" })).toThrow(
      "Ende muss nach Beginn liegen.",
    );
  });

  test("update on missing id → ValidationError", () => {
    expect(() => updateCalendarEvent(db, 999999, { title: "x" })).toThrow(
      "Termin nicht gefunden.",
    );
  });
});

describe("deleteCalendarEvent", () => {
  test("removes the event", () => {
    const created = createCalendarEvent(db, VALID);
    const before = listCalendarEvents(db).length;
    deleteCalendarEvent(db, Number(created.id));
    expect(listCalendarEvents(db).length).toBe(before - 1);
    expect(() => getCalendarEvent(db, Number(created.id))).toThrow(
      "Termin nicht gefunden.",
    );
  });

  test("delete on missing id → ValidationError", () => {
    expect(() => deleteCalendarEvent(db, 999999)).toThrow("Termin nicht gefunden.");
  });

  test("delete on event with lesson_attestation → ValidationError", () => {
    ensureAttestationTables(db);
    const sid = insertStudent(db);
    const event = createCalendarEvent(db, { ...VALID, studentId: sid });
    createAttestation(db, {
      eventId: Number(event.id),
      studentId: sid,
      instructor: VALID.instructor,
      content: "Stadtfahrt",
      durationMin: 45,
      signatureDataUrl: "data:image/png;base64,abc123",
    });
    expect(() => deleteCalendarEvent(db, Number(event.id))).toThrow(
      /Ausbildungsnachweis/,
    );
    // The event must still exist.
    expect(getCalendarEvent(db, Number(event.id)).id).toBe(event.id);
  });
});

/* ------------------------------------------------------------------ */
/* studentId + billed_transaction_id new tests                        */
/* ------------------------------------------------------------------ */

/** Inserts a minimal student and returns their id. */
function insertStudent(db: Database, firstName = "Lena", lastName = "Braun"): number {
  const row = db
    .query<{ id: number }, [string, string]>(
      `INSERT INTO students
         (first_name, last_name, birthday, phone, email, address, classes,
          driving_school, registration_date, contract_number, customer_number)
       VALUES (?, ?, '', '', '', '', 'B', 'Fahrschule', '01.01.2026', 'V-TEST-001', 'C001')
       RETURNING id`,
    )
    .get(firstName, lastName)!;
  return row.id;
}

function makeStudentRef(db: Database, studentId: number): StudentRef {
  const s = db
    .query<
      {
        contract_number: string;
        customer_number: string;
        first_name: string;
        last_name: string;
        classes: string;
      },
      [number]
    >(
      "SELECT contract_number, customer_number, first_name, last_name, classes FROM students WHERE id = ?",
    )
    .get(studentId)!;
  return {
    customerNo: s.customer_number,
    name: `${s.first_name} ${s.last_name}`,
    address: "",
    contractNo: s.contract_number,
    classes: s.classes,
  };
}

describe("studentId wire shape", () => {
  test("createCalendarEvent with valid studentId carries through", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const event = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    expect(event.studentId).toBe(sid);
  });

  test("optional studentId is omitted when not set", () => {
    const event = createCalendarEvent(db, VALID);
    expect(event.studentId).toBeUndefined();
  });

  test("createCalendarEvent with unknown studentId → ValidationError", () => {
    expect(() => createCalendarEvent(db, { ...VALID, studentId: 999999 })).toThrow(
      ValidationError,
    );
  });

  test("createCalendarEvent with non-integer studentId → ValidationError", () => {
    expect(() =>
      createCalendarEvent(db, { ...VALID, studentId: 1.5 as unknown as number }),
    ).toThrow(ValidationError);
  });

  test("updateCalendarEvent can set studentId", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const created = createCalendarEvent(fresh, VALID);
    const updated = updateCalendarEvent(fresh, Number(created.id), { studentId: sid });
    expect(updated.studentId).toBe(sid);
  });

  test("updateCalendarEvent with studentId: null clears the link", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const created = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    expect(created.studentId).toBe(sid);
    // The UI sends an explicit null over the wire to unlink (JSON drops
    // undefined keys, which would keep the stored value instead).
    const updated = updateCalendarEvent(fresh, Number(created.id), {
      studentId: null as unknown as number,
    });
    expect(updated.studentId).toBeUndefined();
  });
});

describe("markEventBilled + delete-guard", () => {
  test("markEventBilled sets billedTransactionId and billedActive=true", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const event = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    const ref = makeStudentRef(fresh, sid);
    const tx = createTransaction(fresh, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: ref,
      description: `FS ${ref.name} - ${ref.classes}, Fahrübungsstunde (45)`,
    });
    const billed = markEventBilled(fresh, Number(event.id), tx.id);
    expect(billed.billedTransactionId).toBe(tx.id);
    expect(billed.billedActive).toBe(true);
  });

  test("delete of billed (active) event → ValidationError 'abgerechnet'", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const event = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    const ref = makeStudentRef(fresh, sid);
    const tx = createTransaction(fresh, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: ref,
      description: `FS ${ref.name} - ${ref.classes}, Fahrübungsstunde (45)`,
    });
    markEventBilled(fresh, Number(event.id), tx.id);
    expect(() => deleteCalendarEvent(fresh, Number(event.id))).toThrow(
      "Termin ist abgerechnet — zuerst stornieren.",
    );
  });

  test("delete allowed after linked transaction is storniert", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const event = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    const ref = makeStudentRef(fresh, sid);
    const tx = createTransaction(fresh, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: ref,
      description: `FS ${ref.name} - ${ref.classes}, Fahrübungsstunde (45)`,
    });
    markEventBilled(fresh, Number(event.id), tx.id);
    stornoTransaction(fresh, tx.id, "Test-Storno", "2026-06-10");

    // After storno the event should be deletable.
    expect(() => deleteCalendarEvent(fresh, Number(event.id))).not.toThrow();
  });

  test("billedActive is false after transaction is storniert", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const sid = insertStudent(fresh);
    const event = createCalendarEvent(fresh, { ...VALID, studentId: sid });
    const ref = makeStudentRef(fresh, sid);
    const tx = createTransaction(fresh, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: ref,
      description: `FS ${ref.name} - ${ref.classes}, Fahrübungsstunde (45)`,
    });
    markEventBilled(fresh, Number(event.id), tx.id);
    stornoTransaction(fresh, tx.id, "Test-Storno", "2026-06-10");

    const reloaded = getCalendarEvent(fresh, Number(event.id));
    expect(reloaded.billedTransactionId).toBe(tx.id);
    expect(reloaded.billedActive).toBe(false);
  });
});

describe("recordExamResult", () => {
  const EXAM_BASE = {
    date: "2026-06-10",
    start: "09:00",
    end: "11:00",
    title: "Theorieprüfung",
    instructor: "Martin Weber",
  };

  test("records 'bestanden' on a Theorieprüfung event", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, {
      ...EXAM_BASE,
      type: "Theorieprüfung",
    });
    const updated = recordExamResult(fresh, Number(event.id), "bestanden");
    expect(updated.examResult).toBe("bestanden");
    // persisted
    expect(getCalendarEvent(fresh, Number(event.id)).examResult).toBe("bestanden");
  });

  test("records 'nicht_bestanden' on a Vorstellung event", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, {
      ...EXAM_BASE,
      title: "Praktische Prüfung",
      type: "Vorstellung zur prakt. Prüfung",
    });
    const updated = recordExamResult(fresh, Number(event.id), "nicht_bestanden");
    expect(updated.examResult).toBe("nicht_bestanden");
  });

  test("clears result by passing null", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, { ...EXAM_BASE, type: "Theorieprüfung" });
    recordExamResult(fresh, Number(event.id), "bestanden");
    const cleared = recordExamResult(fresh, Number(event.id), null);
    expect(cleared.examResult).toBeUndefined();
  });

  test("rejects recording on a non-exam event type (Praktisch)", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, { ...VALID, type: "Praktisch" });
    expect(() => recordExamResult(fresh, Number(event.id), "bestanden")).toThrow(
      ValidationError,
    );
  });

  test("rejects recording on Theorie type", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, {
      ...EXAM_BASE,
      title: "Theoriestunde",
      type: "Theorie",
    });
    expect(() => recordExamResult(fresh, Number(event.id), "bestanden")).toThrow(
      ValidationError,
    );
  });

  test("examResult is omitted on wire when not set", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    const event = createCalendarEvent(fresh, { ...EXAM_BASE, type: "Theorieprüfung" });
    expect(event.examResult).toBeUndefined();
  });
});

describe("listCalendarEvents range filter", () => {
  test("inclusive from/to filters by date", () => {
    const fresh = openDb(":memory:");
    // Remove the seed so we control the dataset.
    fresh.exec("DELETE FROM calendar_events");
    createCalendarEvent(fresh, { ...VALID, date: "2026-01-01" });
    const middle = createCalendarEvent(fresh, { ...VALID, date: "2026-02-01" });
    createCalendarEvent(fresh, { ...VALID, date: "2026-03-01" });

    const filtered = listCalendarEvents(fresh, {
      from: "2026-01-15",
      to: "2026-02-15",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe(middle.id);
  });

  test("from-only and to-only bounds work", () => {
    const fresh = openDb(":memory:");
    fresh.exec("DELETE FROM calendar_events");
    createCalendarEvent(fresh, { ...VALID, date: "2026-01-01" });
    createCalendarEvent(fresh, { ...VALID, date: "2026-03-01" });

    expect(listCalendarEvents(fresh, { from: "2026-02-01" })).toHaveLength(1);
    expect(listCalendarEvents(fresh, { to: "2026-02-01" })).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Lesson kind (Sonderfahrten)                                        */
/* ------------------------------------------------------------------ */

describe("lessonKind", () => {
  test("is stored on practical lessons and omitted when unset", () => {
    const tagged = createCalendarEvent(db, { ...VALID, lessonKind: "Nachtfahrt" });
    expect(tagged.lessonKind).toBe("Nachtfahrt");
    const plain = createCalendarEvent(db, { ...VALID, date: "2026-06-11" });
    expect(plain.lessonKind).toBeUndefined();
  });

  test("unknown kind → ValidationError", () => {
    expect(() =>
      createCalendarEvent(db, {
        ...VALID,
        lessonKind: "Stadtfahrt" as unknown as "Nachtfahrt",
      }),
    ).toThrow("Ungültige Fahrtart.");
  });

  test("explicit kind on a non-practical type → ValidationError", () => {
    expect(() =>
      createCalendarEvent(db, { ...VALID, type: "Theorie", lessonKind: "Nachtfahrt" }),
    ).toThrow(/nur bei praktischen Fahrstunden/);
  });

  test("changing the type away from Praktisch drops the kind; null clears it", () => {
    const event = createCalendarEvent(db, { ...VALID, lessonKind: "Autobahnfahrt" });
    const theory = updateCalendarEvent(db, Number(event.id), { type: "Theorie" });
    expect(theory.lessonKind).toBeUndefined();

    const other = createCalendarEvent(db, {
      ...VALID,
      date: "2026-06-12",
      lessonKind: "Überlandfahrt",
    });
    const kept = updateCalendarEvent(db, Number(other.id), { title: "Neu" });
    expect(kept.lessonKind).toBe("Überlandfahrt");
    const cleared = updateCalendarEvent(db, Number(other.id), { lessonKind: null });
    expect(cleared.lessonKind).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Conflict checks (Überschneidungen)                                 */
/* ------------------------------------------------------------------ */

describe("overlap checks", () => {
  test("same instructor, overlapping time → ValidationError naming the event", () => {
    createCalendarEvent(db, { ...VALID, title: "Erste Stunde" });
    expect(() =>
      createCalendarEvent(db, { ...VALID, start: "09:30", end: "10:30" }),
    ).toThrow(
      "Überschneidung mit „Erste Stunde“ (09:00–10:00) für Fahrlehrer/in Martin Weber.",
    );
  });

  test("same vehicle with different instructors → names the vehicle", () => {
    createCalendarEvent(db, { ...VALID, vehicle: "VW Golf", title: "Golf-Stunde" });
    expect(() =>
      createCalendarEvent(db, {
        ...VALID,
        instructor: "Nadine Aksoy",
        vehicle: "VW Golf",
      }),
    ).toThrow(/Fahrzeug VW Golf ist bereits belegt: „Golf-Stunde“ \(09:00–10:00\)/);
  });

  test("a vehicle double booking cannot be overridden with allowConflicts", () => {
    createCalendarEvent(db, { ...VALID, vehicle: "VW Golf", subtitle: "Lena Braun" });
    expect(() =>
      createCalendarEvent(db, {
        ...VALID,
        instructor: "Nadine Aksoy",
        vehicle: "VW Golf",
        allowConflicts: true,
      }),
    ).toThrow(/Fahrzeug VW Golf ist bereits belegt: „Fahrstunde“ mit Lena Braun/);
    // Moving onto the booked vehicle is blocked as well.
    const other = createCalendarEvent(db, {
      ...VALID,
      instructor: "Nadine Aksoy",
      vehicle: "Audi A3",
    });
    expect(() =>
      updateCalendarEvent(db, Number(other.id), {
        vehicle: "VW Golf",
        allowConflicts: true,
      }),
    ).toThrow(/ist bereits belegt/);
  });

  test("instructor overlap names the student and stays overridable", () => {
    createCalendarEvent(db, { ...VALID, subtitle: "Lena Braun" });
    expect(() => createCalendarEvent(db, { ...VALID, vehicle: "VW Golf" })).toThrow(
      "Überschneidung mit „Fahrstunde“ mit Lena Braun (09:00–10:00) für Fahrlehrer/in Martin Weber.",
    );
    expect(
      createCalendarEvent(db, { ...VALID, vehicle: "VW Golf", allowConflicts: true }).id,
    ).toBeTruthy();
  });

  test("touching edges, other days and other resources do not conflict", () => {
    createCalendarEvent(db, { ...VALID, vehicle: "VW Golf" });
    createCalendarEvent(db, { ...VALID, start: "10:00", end: "10:45" });
    createCalendarEvent(db, { ...VALID, date: "2026-06-11" });
    createCalendarEvent(db, { ...VALID, instructor: "Nadine Aksoy", vehicle: "Audi A3" });
  });

  test("unassigned instructor and no vehicle never conflict", () => {
    createCalendarEvent(db, { ...VALID, instructor: "Nicht zugeteilt" });
    createCalendarEvent(db, { ...VALID, instructor: "Nicht zugeteilt" });
  });

  test("allowConflicts: true skips the check", () => {
    createCalendarEvent(db, VALID);
    const second = createCalendarEvent(db, { ...VALID, allowConflicts: true });
    expect(second.id).toBeTruthy();
  });

  test("cancelled events are ignored", () => {
    const first = createCalendarEvent(db, VALID);
    db.prepare(
      "UPDATE calendar_events SET cancelled_at = '2026-06-01T00:00:00Z', cancellation_kind = 'abgesagt' WHERE id = ?",
    ).run(Number(first.id));
    createCalendarEvent(db, VALID);
  });

  test("moving onto an occupied slot is rejected; the event itself is excluded", () => {
    createCalendarEvent(db, VALID);
    const later = createCalendarEvent(db, { ...VALID, start: "11:00", end: "12:00" });
    // Resizing within its own slot never conflicts with itself.
    updateCalendarEvent(db, Number(later.id), { end: "12:30" });
    expect(() =>
      updateCalendarEvent(db, Number(later.id), { start: "09:45", end: "10:45" }),
    ).toThrow(/Überschneidung/);
    const moved = updateCalendarEvent(db, Number(later.id), {
      start: "09:45",
      end: "10:45",
      allowConflicts: true,
    });
    expect(moved.start).toBe("09:45");
  });

  test("editing only the title of an overlapping event is allowed", () => {
    createCalendarEvent(db, VALID);
    const dup = createCalendarEvent(db, { ...VALID, allowConflicts: true });
    const renamed = updateCalendarEvent(db, Number(dup.id), { title: "Umbenannt" });
    expect(renamed.title).toBe("Umbenannt");
  });
});

/* ------------------------------------------------------------------ */
/* Daily limit warning (495 Min. praktischer Unterricht)              */
/* ------------------------------------------------------------------ */

describe("daily practical limit warnings", () => {
  test("no warning up to 495 minutes, warning above", () => {
    // 8 × 60 = 480 min, then +15 = 495 (still fine), then +45 → 540.
    for (let hour = 7; hour < 15; hour++) {
      const start = `${String(hour).padStart(2, "0")}:00`;
      const end = `${String(hour + 1).padStart(2, "0")}:00`;
      const event = createCalendarEvent(db, { ...VALID, start, end });
      expect(event.warnings).toBeUndefined();
    }
    const edge = createCalendarEvent(db, { ...VALID, start: "15:00", end: "15:15" });
    expect(edge.warnings).toBeUndefined();

    const over = createCalendarEvent(db, {
      ...VALID,
      type: "Vorstellung zur prakt. Prüfung",
      start: "16:00",
      end: "16:45",
    });
    expect(over.warnings).toEqual([
      "Tageshöchstdauer praktischer Unterricht (495 Min.) für Martin Weber am 10.06.2026 überschritten: 540 Min.",
    ]);
    // Warnings are never stored.
    expect(getCalendarEvent(db, Number(over.id)).warnings).toBeUndefined();
  });

  test("theory lessons do not count and get no warning", () => {
    createCalendarEvent(db, { ...VALID, start: "06:00", end: "15:00" });
    const theory = createCalendarEvent(db, {
      ...VALID,
      type: "Theorie",
      start: "18:00",
      end: "19:30",
    });
    expect(theory.warnings).toBeUndefined();
  });
});

describe("vehicle maintenance warning", () => {
  test("booking a vehicle in 'wartung' returns a warning, not an error", () => {
    const event = createCalendarEvent(db, { ...VALID, vehicle: "Audi A3" });
    expect(event.warnings).toEqual(["Fahrzeug Audi A3 ist als „In Wartung“ markiert."]);
    const ok = createCalendarEvent(db, { ...VALID, date: "2026-06-11", vehicle: "VW Golf" });
    expect(ok.warnings).toBeUndefined();
  });

  test("editing only the title does not repeat the warning", () => {
    const event = createCalendarEvent(db, { ...VALID, vehicle: "Audi A3" });
    const renamed = updateCalendarEvent(db, Number(event.id), { title: "Neu" });
    expect(renamed.warnings).toBeUndefined();
  });
});

describe("notes", () => {
  test("are stored, trimmed, updated and omitted when empty", () => {
    const event = createCalendarEvent(db, { ...VALID, notes: "  Abholung Bahnhof " });
    expect(event.notes).toBe("Abholung Bahnhof");
    const kept = updateCalendarEvent(db, Number(event.id), { title: "Neu" });
    expect(kept.notes).toBe("Abholung Bahnhof");
    const cleared = updateCalendarEvent(db, Number(event.id), { notes: "" });
    expect(cleared.notes).toBeUndefined();
  });

  test("longer than 2000 characters → ValidationError", () => {
    expect(() => createCalendarEvent(db, { ...VALID, notes: "x".repeat(2001) })).toThrow(
      /höchstens 2000 Zeichen/,
    );
  });
});
