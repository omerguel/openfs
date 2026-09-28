/* ------------------------------------------------------------------ */
/* Automatic e-mail notifications — turns domain events into outbox     */
/* entries (mail.ts) using the German templates (mail-templates.ts).    */
/* Every trigger respects the 'notifications' settings toggles and      */
/* silently does nothing when the recipient has no e-mail address.      */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { AppointmentRequest } from "./appointment-requests";
import { tableExists } from "./archive";
import { getCalendarEvent, type CalendarEvent } from "./calendar-events";
import { getNotificationSettings, isValidEmail, mailSchool, queueMail } from "./mail";
import type { OutboxEntry } from "./mail";
import {
  lessonCancelledMail,
  lessonReminderMail,
  requestConfirmedMail,
  requestDeclinedMail,
} from "./mail-templates";

/** Event types that get a reminder the day before. */
export const REMINDER_TYPES = [
  "Praktisch",
  "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung",
] as const;

/* --------------------- appointment requests ----------------------- */

export function notifyAppointmentRequestConfirmed(
  db: Database,
  request: AppointmentRequest,
  event: CalendarEvent,
): OutboxEntry | null {
  if (!isValidEmail(request.email)) return null;
  if (!getNotificationSettings(db).appointmentMails) return null;
  const mail = requestConfirmedMail(
    {
      name: request.name,
      type: event.type,
      date: event.date,
      start: event.start,
      end: event.end,
      instructor: event.instructor,
      location: event.location,
    },
    mailSchool(db),
  );
  return queueMail(db, {
    recipient: request.email,
    subject: mail.subject,
    bodyText: mail.body,
    kind: "request_confirmed",
    relatedType: "appointment_request",
    relatedId: request.id,
  });
}

export function notifyAppointmentRequestDeclined(
  db: Database,
  request: AppointmentRequest,
): OutboxEntry | null {
  if (!isValidEmail(request.email)) return null;
  if (!getNotificationSettings(db).appointmentMails) return null;
  const mail = requestDeclinedMail(
    {
      name: request.name,
      type: request.type,
      date: request.requestedDate,
      time: request.requestedTime,
    },
    mailSchool(db),
  );
  return queueMail(db, {
    recipient: request.email,
    subject: mail.subject,
    bodyText: mail.body,
    kind: "request_declined",
    relatedType: "appointment_request",
    relatedId: request.id,
  });
}

/* --------------------------- lessons ------------------------------ */

type StudentContact = { first_name: string; email: string };

function studentContact(db: Database, studentId: number | undefined) {
  if (studentId === undefined || !tableExists(db, "students")) return null;
  const row = db
    .query<StudentContact, [number]>(
      "SELECT first_name, email FROM students WHERE id = ?",
    )
    .get(studentId);
  if (!row || !isValidEmail(row.email)) return null;
  return { firstName: row.first_name, email: row.email.trim() };
}

const lessonData = (event: CalendarEvent, firstName: string) => ({
  firstName,
  type: event.type,
  date: event.date,
  start: event.start,
  end: event.end,
  instructor: event.instructor,
  location: event.location,
});

/** Hook for the lesson-cancel flow: queues an "abgesagt" mail to the
 *  event's linked student. Call it BEFORE the event row is deleted.
 *  Returns null when there is no linked student with an e-mail or the
 *  toggle is off. Throws ValidationError for an unknown event id. */
export function notifyLessonCancelled(db: Database, eventId: number): OutboxEntry | null {
  const event = getCalendarEvent(db, eventId);
  if (!getNotificationSettings(db).lessonCancellations) return null;
  const student = studentContact(db, event.studentId);
  if (!student) return null;
  const mail = lessonCancelledMail(lessonData(event, student.firstName), mailSchool(db));
  return queueMail(db, {
    recipient: student.email,
    subject: mail.subject,
    bodyText: mail.body,
    kind: "lesson_cancelled",
    relatedType: "calendar_event",
    relatedId: eventId,
  });
}

/** ISO date + n days (calendar arithmetic in UTC, no DST drift). */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Local calendar date of `now` as ISO "YYYY-MM-DD". */
export function localIsoDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Queues one reminder per Praktisch/Theorieprüfung/Vorstellung event of
 *  the day after `today` whose linked student has an e-mail. Idempotent:
 *  the unique index on (related_type, related_id) for kind
 *  'lesson_reminder' makes repeated runs no-ops. Tentative events are
 *  skipped. Returns the number of newly queued reminders. */
export function queueLessonReminders(db: Database, today: string): number {
  if (!getNotificationSettings(db).lessonReminders) return 0;
  const tomorrow = addDays(today, 1);
  const placeholders = REMINDER_TYPES.map(() => "?").join(", ");
  const rows = db
    .query<{ id: number }, string[]>(
      `SELECT ce.id FROM calendar_events ce
       JOIN students s ON s.id = ce.student_id
       WHERE ce.date = ? AND ce.tentative = 0 AND ce.cancelled_at IS NULL
         AND trim(s.email) != ''
         AND ce.type IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM outbox o
           WHERE o.kind = 'lesson_reminder' AND o.related_type = 'calendar_event'
             AND o.related_id = ce.id
         )
       ORDER BY ce.start, ce.id`,
    )
    .all(tomorrow, ...REMINDER_TYPES);

  const school = mailSchool(db);
  let queued = 0;
  for (const { id } of rows) {
    const event = getCalendarEvent(db, id);
    const student = studentContact(db, event.studentId);
    if (!student) continue;
    const mail = lessonReminderMail(lessonData(event, student.firstName), school);
    const entry = queueMail(db, {
      recipient: student.email,
      subject: mail.subject,
      bodyText: mail.body,
      kind: "lesson_reminder",
      relatedType: "calendar_event",
      relatedId: id,
    });
    if (entry) queued += 1;
  }
  return queued;
}
