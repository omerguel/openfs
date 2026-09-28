/* ------------------------------------------------------------------ */
/* Demo mode only: two former students and an old enquiry, so the      */
/* Löschvorschau (Fahrschule → Datenschutz) has something to show —    */
/* one archived six years ago (master data, Ausbildungsnachweis, chat   */
/* and mails are due) and one archived three months ago (nothing due     */
/* yet; Löschen auf Antrag shows what must be kept until when).         */
/* Dates are relative to today so the demo never goes stale.           */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { subtractMonths } from "../lib/retention";
import { tableExists } from "./archive";
import { archivedStudents } from "./retention";
import { schoolToday } from "./school-time";
import { createStudent, deleteStudent } from "./students";

const FORMER = [
  {
    firstName: "Jonas",
    lastName: "Altmann",
    monthsAgo: 74,
    email: "jonas.altmann@example.de",
    phone: "0151 23456789",
  },
  {
    firstName: "Lea",
    lastName: "Brandt",
    monthsAgo: 3,
    email: "lea.brandt@example.de",
    phone: "0160 98765432",
  },
];

/** Idempotent: does nothing once any student has been archived. */
export function seedRetentionDemo(db: Database, today = schoolToday()): void {
  if (archivedStudents(db).size > 0) return;
  if (!tableExists(db, "lesson_attestations") || !tableExists(db, "outbox")) return;
  FORMER.forEach((person, index) => {
    const archivedOn = subtractMonths(today, person.monthsAgo);
    const lessonDate = subtractMonths(archivedOn, 1);
    const name = `${person.firstName} ${person.lastName}`;
    const student = createStudent(db, {
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      phone: person.phone,
      address: "Lindenweg 4, 64283 Darmstadt",
      birthday: `${Number(archivedOn.slice(0, 4)) - 18}-05-12`,
      contractNumber: `V-ARCH-${index + 1}`,
      customerNumber: `K-ARCH-${index + 1}`,
    });
    const event = db
      .query<{ id: number }, [string, string, number]>(
        `INSERT INTO calendar_events (date, start, "end", title, subtitle, type, student_id)
         VALUES (?1, '10:00', '11:30', 'Fahrstunde', ?2, 'Praktisch', ?3) RETURNING id`,
      )
      .get(lessonDate, name, student.id)!;
    db.prepare(
      `INSERT INTO lesson_attestations (event_id, student_id, instructor, content, duration_min, signature_data_url, signed_at)
       VALUES (?, ?, 'Martin Weber', 'Autobahnfahrt', 90, 'data:image/png;base64,iVBORw0KGgo=', ?)`,
    ).run(event.id, student.id, `${lessonDate} 11:30:00`);
    if (tableExists(db, "conversations")) {
      const thread = db
        .query<{ id: number }, [number, string, string]>(
          `INSERT INTO conversations (student_id, student_name, last_message_at, created_at)
           VALUES (?1, ?2, ?3, ?3) RETURNING id`,
        )
        .get(student.id, name, `${lessonDate} 18:00:00`)!;
      db.prepare(
        `INSERT INTO chat_messages (conversation_id, sender, text, sent_at)
         VALUES (?, 'schueler', 'Danke für die Fahrstunde heute!', ?)`,
      ).run(thread.id, `${lessonDate} 18:00:00`);
    }
    db.prepare(
      `INSERT INTO outbox (recipient, subject, body_text, kind, status, created_at, sent_at)
       VALUES (?1, 'Erinnerung: Fahrstunde morgen', 'Hallo, morgen um 10:00 Uhr ist Ihre Fahrstunde.',
               'lesson_reminder', 'gesendet', ?2, ?2)`,
    ).run(person.email, `${lessonDate} 09:00:00`);
    deleteStudent(db, student.id, { reason: "abgeschlossen" });
    db.prepare(
      `UPDATE archive SET deleted_at = ? WHERE id = (SELECT max(id) FROM archive WHERE entity = 'student')`,
    ).run(`${archivedOn} 12:00:00`);
  });
  if (tableExists(db, "appointment_requests")) {
    const received = subtractMonths(today, 8);
    db.prepare(
      `INSERT INTO appointment_requests (name, phone, email, message, requested_date, requested_time, type, status, created_at)
       VALUES ('Tim Reuter', '0171 5550123', 'tim.reuter@example.de', 'Ich hätte gern eine Probestunde.', ?1, '15:00', 'Praktisch', 'abgelehnt', ?2)`,
    ).run(received, `${received} 17:20:00`);
  }
}
