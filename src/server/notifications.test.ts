/* ------------------------------------------------------------------ */
/* Notification triggers: appointment accept/decline mails, lesson     */
/* reminders (idempotent) and the lesson-cancelled hook. Full in-memory */
/* schema via openDb(":memory:"); dates far in the future so the        */
/* current-week seed events never interfere.                           */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  acceptAppointmentRequest,
  createAppointmentRequest,
  declineAppointmentRequest,
  ensureAppointmentRequestTables,
} from "./appointment-requests";
import { createCalendarEvent } from "./calendar-events";
import { openDb, setCompany, getCompany } from "./db";
import { listOutbox, setNotificationSettings } from "./mail";
import {
  formatGermanDate,
  lessonReminderMail,
  requestConfirmedMail,
  signature,
} from "./mail-templates";
import { addDays, notifyLessonCancelled, queueLessonReminders } from "./notifications";
import type { Database } from "./sqlite";
import { createStudent } from "./students";

let db: Database;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  ensureAppointmentRequestTables(db);
  setCompany(db, {
    ...getCompany(db),
    name: "Fahrschule Sonnenschein",
    address: "Hauptstraße 1, 12345 Musterstadt",
    phone: "0123 456789",
    email: "info@sonnenschein.example",
  });
});

function student(email = "mia@example.de") {
  seq += 1;
  return createStudent(db, {
    firstName: "Mia",
    lastName: "Muster",
    email,
    contractNumber: `V-N-${seq}`,
    customerNumber: `K-N-${seq}`,
  });
}

function lesson(studentId: number | undefined, date: string, type = "Praktisch") {
  return createCalendarEvent(db, {
    date,
    start: "10:00",
    end: "11:30",
    title: "Mia Muster",
    instructor: "Nicht zugeteilt",
    type: type as "Praktisch",
    studentId,
  });
}

const TODAY = "2031-03-10";
const TOMORROW = "2031-03-11";

describe("templates", () => {
  test("German date formatting with weekday", () => {
    expect(formatGermanDate("2031-03-11")).toBe("Dienstag, 11.03.2031");
    expect(addDays("2031-12-31", 1)).toBe("2032-01-01");
  });

  test("signature carries the school name, address and phone", () => {
    const text = signature({
      name: "Fahrschule X",
      address: "Weg 1",
      phone: "0123",
      email: "a@b.de",
    });
    expect(text).toContain("Fahrschule X");
    expect(text).toContain("Weg 1");
    expect(text).toContain("Tel. 0123");
  });

  test("confirmation lists date, time and instructor", () => {
    const mail = requestConfirmedMail(
      {
        name: "Lena Hoffmann",
        type: "Praktisch",
        date: "2031-03-11",
        start: "14:00",
        end: "15:00",
        instructor: "Martin Weber",
      },
      { name: "FS", address: "", phone: "", email: "" },
    );
    expect(mail.subject).toBe("Terminbestätigung: Fahrstunde am Dienstag, 11.03.2031");
    expect(mail.body).toStartWith("Hallo Lena,");
    expect(mail.body).toContain("14:00–15:00 Uhr");
    expect(mail.body).toContain("Fahrlehrer/in: Martin Weber");
  });

  test("reminder for exams mentions the ID card", () => {
    const mail = lessonReminderMail(
      {
        firstName: "Mia",
        type: "Theorieprüfung",
        date: TOMORROW,
        start: "09:00",
        end: "10:00",
      },
      { name: "FS", address: "", phone: "", email: "" },
    );
    expect(mail.subject).toContain("morgen um 09:00 Uhr");
    expect(mail.body).toContain("Personalausweis");
  });
});

describe("appointment request mails", () => {
  const REQUEST = {
    name: "Lena Hoffmann",
    email: "lena@example.de",
    requestedDate: TOMORROW,
    requestedTime: "14:00",
    type: "Praktisch" as const,
  };

  test("accept queues a confirmation with date/time", () => {
    const request = createAppointmentRequest(db, REQUEST);
    acceptAppointmentRequest(db, request.id);
    const [mail] = listOutbox(db);
    expect(mail).toMatchObject({
      recipient: "lena@example.de",
      kind: "request_confirmed",
      relatedType: "appointment_request",
      relatedId: request.id,
      status: "wartend",
    });
    expect(mail!.bodyText).toContain("11.03.2031");
    expect(mail!.bodyText).toContain("14:00–15:00 Uhr");
    expect(mail!.bodyText).toContain("Fahrschule Sonnenschein");
  });

  test("decline queues one rejection mail, even when declined twice", () => {
    const request = createAppointmentRequest(db, REQUEST);
    declineAppointmentRequest(db, request.id);
    declineAppointmentRequest(db, request.id);
    const mails = listOutbox(db);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.kind).toBe("request_declined");
  });

  test("no mail without an e-mail address or with the toggle off", () => {
    const noEmail = createAppointmentRequest(db, { ...REQUEST, email: "" });
    acceptAppointmentRequest(db, noEmail.id);
    setNotificationSettings(db, { appointmentMails: false });
    const withEmail = createAppointmentRequest(db, REQUEST);
    declineAppointmentRequest(db, withEmail.id);
    expect(listOutbox(db)).toHaveLength(0);
  });

  test("a failed accept leaves no mail behind", () => {
    const request = createAppointmentRequest(db, REQUEST);
    expect(() => acceptAppointmentRequest(db, request.id, { end: "13:00" })).toThrow();
    expect(listOutbox(db)).toHaveLength(0);
  });
});

describe("queueLessonReminders", () => {
  test("queues one reminder per qualifying event of tomorrow", () => {
    const mia = student();
    const drive = lesson(mia.id, TOMORROW, "Praktisch");
    const exam = lesson(mia.id, TOMORROW, "Theorieprüfung");
    lesson(mia.id, TOMORROW, "Theorie"); // not a reminder type
    lesson(mia.id, addDays(TOMORROW, 1)); // day after tomorrow
    lesson(undefined, TOMORROW); // no linked student
    const noMail = student("");
    lesson(noMail.id, TOMORROW);

    expect(queueLessonReminders(db, TODAY)).toBe(2);
    const reminders = listOutbox(db).filter((m) => m.kind === "lesson_reminder");
    expect(reminders.map((m) => m.relatedId).sort()).toEqual(
      [Number(drive.id), Number(exam.id)].sort(),
    );
    expect(reminders[0]!.recipient).toBe("mia@example.de");
  });

  test("is idempotent — a second run queues nothing", () => {
    const mia = student();
    lesson(mia.id, TOMORROW);
    expect(queueLessonReminders(db, TODAY)).toBe(1);
    expect(queueLessonReminders(db, TODAY)).toBe(0);
    expect(listOutbox(db)).toHaveLength(1);
  });

  test("skips tentative events and respects the toggle", () => {
    const mia = student();
    createCalendarEvent(db, {
      date: TOMORROW,
      start: "08:00",
      end: "09:00",
      title: "Vorläufig",
      instructor: "Nicht zugeteilt",
      type: "Praktisch",
      tentative: true,
      studentId: mia.id,
    });
    expect(queueLessonReminders(db, TODAY)).toBe(0);
    lesson(mia.id, TOMORROW);
    setNotificationSettings(db, { lessonReminders: false });
    expect(queueLessonReminders(db, TODAY)).toBe(0);
  });
});

describe("notifyLessonCancelled", () => {
  test("queues a cancellation for the linked student", () => {
    const mia = student();
    const event = lesson(mia.id, TOMORROW);
    const entry = notifyLessonCancelled(db, Number(event.id))!;
    expect(entry).toMatchObject({
      kind: "lesson_cancelled",
      recipient: "mia@example.de",
      relatedType: "calendar_event",
      relatedId: Number(event.id),
    });
    expect(entry.subject).toContain("Terminabsage");
    expect(entry.bodyText).toContain("10:00–11:30 Uhr");
  });

  test("returns null without student/e-mail or with the toggle off", () => {
    expect(notifyLessonCancelled(db, Number(lesson(undefined, TOMORROW).id))).toBeNull();
    const mia = student();
    const event = lesson(mia.id, TOMORROW);
    setNotificationSettings(db, { lessonCancellations: false });
    expect(notifyLessonCancelled(db, Number(event.id))).toBeNull();
    expect(listOutbox(db)).toHaveLength(0);
  });

  test("unknown event id throws", () => {
    expect(() => notifyLessonCancelled(db, 999_999)).toThrow("Termin nicht gefunden");
  });
});
