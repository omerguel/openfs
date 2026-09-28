/* ------------------------------------------------------------------ */
/* "Als Fahrschüler anlegen" after (or before) confirming a request:  */
/* the confirmed Termin moves to the new student and the instructor    */
/* chosen at confirmation becomes the student's instructor. Plus the   */
/* extra rules of the public /anfrage POST. Full schema via openDb.    */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  acceptAppointmentRequest,
  appointmentRequestRoutes,
  createAppointmentRequest,
  ensureAppointmentRequestTables,
  getAppointmentRequest,
  linkAppointmentRequestStudent,
  schoolToday,
  validatePublicRequest,
} from "./appointment-requests";
import { getCalendarEvent } from "./calendar-events";
import { openDb } from "./db";
import type { Database } from "./sqlite";
import { deriveStudentFacts } from "./student-facts";
import { createStudent, getStudent, updateStudent } from "./students";

let db: Database;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:", { demoData: false });
  ensureAppointmentRequestTables(db);
  db.prepare("INSERT INTO instructors (first_name, last_name) VALUES (?, ?)").run(
    "Martin",
    "Weber",
  );
});

const REQUEST = {
  name: "Mia Schneider",
  phone: "0152 7654321",
  email: "mia@example.de",
  requestedDate: "2031-05-05",
  requestedTime: "15:00",
};

function newStudent() {
  seq += 1;
  return createStudent(db, {
    firstName: "Mia",
    lastName: "Schneider",
    contractNumber: `V-C-${seq}`,
    customerNumber: `K-C-${seq}`,
  });
}

describe("linking a confirmed request to a student", () => {
  test("attaches the calendar event and adopts the instructor", () => {
    const request = createAppointmentRequest(db, REQUEST);
    const { event } = acceptAppointmentRequest(db, request.id, {
      instructor: "Martin Weber",
    });
    expect(getCalendarEvent(db, Number(event.id)).studentId).toBeUndefined();
    // The new-student form prefills the instructor from this.
    expect(getAppointmentRequest(db, request.id).appointmentInstructor).toBe(
      "Martin Weber",
    );

    const mia = newStudent();
    expect(mia.instructorId).toBeNull();
    linkAppointmentRequestStudent(db, request.id, mia.id);

    expect(getCalendarEvent(db, Number(event.id)).studentId).toBe(mia.id);
    const linked = getStudent(db, mia.id);
    expect(linked.instructor).toBe("Martin Weber");
    const facts = deriveStudentFacts(
      db,
      [{ id: mia.id, customerNumber: mia.customerNumber }],
      new Date(2031, 4, 1),
    ).get(mia.id)!;
    expect(facts.nextLesson).toBe("05.05.2031, 15:00");
  });

  test("keeps an instructor the office already assigned", () => {
    db.prepare("INSERT INTO instructors (first_name, last_name) VALUES (?, ?)").run(
      "Nadine",
      "Aksoy",
    );
    const request = createAppointmentRequest(db, REQUEST);
    acceptAppointmentRequest(db, request.id, { instructor: "Martin Weber" });
    const mia = updateStudent(db, newStudent().id, { instructor: "Nadine Aksoy" });
    linkAppointmentRequestStudent(db, request.id, mia.id);
    expect(getStudent(db, mia.id).instructor).toBe("Nadine Aksoy");
  });

  test("accepting an already converted request books the Termin for the student", () => {
    const request = createAppointmentRequest(db, REQUEST);
    const mia = newStudent();
    linkAppointmentRequestStudent(db, request.id, mia.id);
    const { event } = acceptAppointmentRequest(db, request.id, {
      instructor: "Martin Weber",
    });
    expect(getCalendarEvent(db, Number(event.id)).studentId).toBe(mia.id);
    expect(getStudent(db, mia.id).instructor).toBe("Martin Weber");
  });

  test("legacy confirmations without event_id are matched by name", () => {
    const request = createAppointmentRequest(db, REQUEST);
    const { event } = acceptAppointmentRequest(db, request.id);
    db.prepare("UPDATE appointment_requests SET event_id = NULL WHERE id = ?").run(
      request.id,
    );
    const mia = newStudent();
    linkAppointmentRequestStudent(db, request.id, mia.id);
    expect(getCalendarEvent(db, Number(event.id)).studentId).toBe(mia.id);
  });

  test("unlinking hands the Termin back; other students' Termine stay", () => {
    const request = createAppointmentRequest(db, REQUEST);
    const { event } = acceptAppointmentRequest(db, request.id);
    const mia = newStudent();
    linkAppointmentRequestStudent(db, request.id, mia.id);
    linkAppointmentRequestStudent(db, request.id, null);
    expect(getCalendarEvent(db, Number(event.id)).studentId).toBeUndefined();

    // Re-assigned by hand to someone else → relinking must not steal it.
    const other = newStudent();
    db.prepare("UPDATE calendar_events SET student_id = ? WHERE id = ?").run(
      other.id,
      Number(event.id),
    );
    linkAppointmentRequestStudent(db, request.id, mia.id);
    expect(getCalendarEvent(db, Number(event.id)).studentId).toBe(other.id);
  });
});

describe("public request rules", () => {
  const today = "2031-05-01";
  const valid = { ...REQUEST, consent: true };

  test("valid input passes", () => {
    expect(() => validatePublicRequest(valid, today)).not.toThrow();
    expect(() => validatePublicRequest({ ...valid, email: "" }, today)).not.toThrow();
    expect(() => validatePublicRequest({ ...valid, phone: "" }, today)).not.toThrow();
  });

  test("needs a phone number or an e-mail address", () => {
    expect(() =>
      validatePublicRequest({ ...valid, phone: "", email: " " }, today),
    ).toThrow("Telefonnummer oder E-Mail-Adresse");
    expect(() =>
      validatePublicRequest({ ...valid, phone: "12", email: "" }, today),
    ).toThrow("gültige Telefonnummer");
  });

  test("rejects past dates, today is fine", () => {
    expect(() =>
      validatePublicRequest({ ...valid, requestedDate: "2020-01-01" }, today),
    ).toThrow("Vergangenheit");
    expect(() =>
      validatePublicRequest({ ...valid, requestedDate: today }, today),
    ).not.toThrow();
  });

  test("rejects times outside 06:00–21:00", () => {
    expect(() =>
      validatePublicRequest({ ...valid, requestedTime: "03:00" }, today),
    ).toThrow("zwischen 06:00 und 21:00");
    expect(() =>
      validatePublicRequest({ ...valid, requestedTime: "21:30" }, today),
    ).toThrow("zwischen");
  });

  test("requires the Datenschutz consent", () => {
    expect(() => validatePublicRequest({ ...REQUEST }, today)).toThrow("Datenschutz");
    expect(() => validatePublicRequest({ ...REQUEST, consent: "yes" }, today)).toThrow(
      "Datenschutz",
    );
  });

  test("schoolToday is an ISO date", () => {
    expect(schoolToday(new Date("2026-09-27T22:30:00Z"))).toBe("2026-09-28");
  });

  test("POST enforces the rules and ignores a client-sent status", async () => {
    const server = Bun.serve({
      port: 0,
      routes: appointmentRequestRoutes(db, { rateLimit: false }),
      fetch: () => new Response("not found", { status: 404 }),
    });
    try {
      const post = (body: unknown) =>
        fetch(new URL("/api/appointment-requests", server.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const noContact = await post({ ...valid, phone: "", email: "" });
      expect(noContact.status).toBe(400);
      const past = await post({ ...valid, requestedDate: "2020-01-01" });
      expect(past.status).toBe(400);
      const ok = await post({ ...valid, status: "bestätigt" });
      expect(ok.status).toBe(201);
      expect(((await ok.json()) as { status: string }).status).toBe("offen");
    } finally {
      server.stop(true);
    }
  });
});
