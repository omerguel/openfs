/* ------------------------------------------------------------------ */
/* Ausbildungsnachweis — per-lesson attestation with drawn signature.   */
/*                                                                     */
/* FahrSchAusbO obliges driving schools to document each practical     */
/* lesson (Fahrstunde) signed by the student. This module stores one   */
/* attestation record per calendar event. Attestations are IMMUTABLE   */
/* compliance records: no UPDATE, no DELETE.                           */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import { ValidationError } from "./engine";

/* ------------------------------------------------------------------ */
/* DDL                                                                 */
/* ------------------------------------------------------------------ */

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS lesson_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES calendar_events(id),
  student_id INTEGER NOT NULL,
  instructor TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL,
  signature_data_url TEXT NOT NULL,
  signed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lesson_attestations_student ON lesson_attestations(student_id);
`;

export function ensureAttestationTables(db: Database): void {
  db.exec(TABLE_DDL);
}

/* ------------------------------------------------------------------ */
/* Wire shape                                                          */
/* ------------------------------------------------------------------ */

export type Attestation = {
  id: number;
  eventId: number;
  studentId: number;
  instructor: string;
  content: string;
  durationMin: number;
  /** PNG data-URL of the student's drawn signature. */
  signatureDataUrl: string;
  signedAt: string;
  /** Read-time extras from the calendar event (not part of the record):
      the lesson's date and its Fahrtart (Übungs-, Überland-, …fahrt). */
  lessonDate?: string | null;
  lessonKind?: string | null;
};

type AttestationRow = {
  id: number;
  event_id: number;
  student_id: number;
  instructor: string;
  content: string;
  duration_min: number;
  signature_data_url: string;
  signed_at: string;
};

function toAttestation(row: AttestationRow): Attestation {
  return {
    id: row.id,
    eventId: row.event_id,
    studentId: row.student_id,
    instructor: row.instructor,
    content: row.content,
    durationMin: row.duration_min,
    signatureDataUrl: row.signature_data_url,
    signedAt: row.signed_at,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export function getAttestationForEvent(
  db: Database,
  eventId: number,
): Attestation | null {
  const row = db
    .query<AttestationRow, [number]>(
      `SELECT id, event_id, student_id, instructor, content, duration_min,
              signature_data_url, signed_at
       FROM lesson_attestations WHERE event_id = ?`,
    )
    .get(eventId);
  return row ? toAttestation(row) : null;
}

export function listAttestationsForStudent(
  db: Database,
  studentId: number,
): Attestation[] {
  const hasKind = db
    .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
    .all()
    .some((c) => c.name === "lesson_kind");
  return db
    .query<
      AttestationRow & { lesson_date: string | null; lesson_kind: string | null },
      [number]
    >(
      `SELECT la.id, la.event_id, la.student_id, la.instructor, la.content,
              la.duration_min, la.signature_data_url, la.signed_at,
              ce.date AS lesson_date,
              ${hasKind ? "ce.lesson_kind" : "NULL"} AS lesson_kind
       FROM lesson_attestations la
       LEFT JOIN calendar_events ce ON ce.id = la.event_id
       WHERE la.student_id = ?
       ORDER BY la.signed_at DESC`,
    )
    .all(studentId)
    .map((row) => ({
      ...toAttestation(row),
      lessonDate: row.lesson_date,
      lessonKind: row.lesson_kind,
    }));
}

/* ------------------------------------------------------------------ */
/* Create (immutable — no update, no delete)                           */
/* ------------------------------------------------------------------ */

const SIG_PREFIX = "data:image/png;base64,";
const SIG_MAX_LEN = 200_000; // chars
const CONTENT_MAX_LEN = 2000; // chars

export type CreateAttestationInput = {
  eventId: number;
  studentId: number;
  instructor: string;
  content: string;
  durationMin: number;
  signatureDataUrl: string;
};

export function createAttestation(
  db: Database,
  input: CreateAttestationInput,
): Attestation {
  /* ── event must exist ─────────────────────────────────────────── */
  const event = db
    .query<
      {
        id: number;
        type: string;
        student_id: number | null;
        cancelled_at: string | null;
      },
      [number]
    >(
      `SELECT ce.id, ce.type, ce.student_id, ce.cancelled_at
       FROM calendar_events ce WHERE ce.id = ?`,
    )
    .get(input.eventId);

  if (!event) {
    throw new ValidationError(`Termin mit ID ${input.eventId} existiert nicht.`);
  }

  /* ── a cancelled lesson did not take place ─────────────────────── */
  if (event.cancelled_at) {
    throw new ValidationError(
      "Für abgesagte Termine kann kein Ausbildungsnachweis erstellt werden.",
    );
  }

  /* ── event must be type "Praktisch" ───────────────────────────── */
  if (event.type !== "Praktisch") {
    throw new ValidationError(
      "Ein Ausbildungsnachweis kann nur für Fahrstunden (Typ 'Praktisch') erstellt werden.",
    );
  }

  /* ── event student_id must match ──────────────────────────────── */
  if (event.student_id == null || event.student_id !== input.studentId) {
    throw new ValidationError(
      "Der Fahrschüler des Termins stimmt nicht mit dem angegebenen Fahrschüler überein.",
    );
  }

  /* ── no duplicate ─────────────────────────────────────────────── */
  const existing = getAttestationForEvent(db, input.eventId);
  if (existing) {
    throw new ValidationError(
      "Für diesen Termin existiert bereits ein Ausbildungsnachweis.",
    );
  }

  /* ── duration must be a positive integer ─────────────────────── */
  if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) {
    throw new ValidationError("Die Dauer muss eine positive ganze Zahl in Minuten sein.");
  }

  /* ── signature data-URL ───────────────────────────────────────── */
  if (!input.signatureDataUrl.startsWith(SIG_PREFIX)) {
    throw new ValidationError(
      "Die Unterschrift muss eine PNG-Datei im Format 'data:image/png;base64,...' sein.",
    );
  }
  if (input.signatureDataUrl.length > SIG_MAX_LEN) {
    throw new ValidationError(
      `Die Unterschrift darf maximal ${SIG_MAX_LEN} Zeichen groß sein.`,
    );
  }

  /* ── content length ───────────────────────────────────────────── */
  if (input.content.length > CONTENT_MAX_LEN) {
    throw new ValidationError(
      `Der Inhalt darf maximal ${CONTENT_MAX_LEN} Zeichen lang sein.`,
    );
  }

  /* ── insert ───────────────────────────────────────────────────── */
  db
    .query<{ id: number }, [number, number, string, string, number, string]>(
      `INSERT INTO lesson_attestations
         (event_id, student_id, instructor, content, duration_min, signature_data_url)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      input.eventId,
      input.studentId,
      input.instructor.trim(),
      input.content.trim(),
      input.durationMin,
      input.signatureDataUrl,
    )!;

  return getAttestationForEvent(db, input.eventId)!;
}

/* ------------------------------------------------------------------ */
/* HTTP route factory                                                  */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";
import { err, handle, json } from "./http";

export function attestationRoutes(db: Database) {
  return {
    "/api/attestations": {
      /* GET /api/attestations?studentId=123 */
      GET: handle(async (req: BunRequest): Promise<Response> => {
        const url = new URL(req.url);
        const raw = url.searchParams.get("studentId");
        if (!raw) return err("studentId ist erforderlich.");
        const studentId = Number(raw);
        if (!Number.isInteger(studentId) || studentId <= 0) {
          return err("studentId muss eine positive ganze Zahl sein.");
        }
        const attestations = listAttestationsForStudent(db, studentId);
        return json({ attestations });
      }),
    },

    "/api/calendar-events/:id/attestation": {
      GET: handle(
        async (
          req: BunRequest<"/api/calendar-events/:id/attestation">,
        ): Promise<Response> => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id) || id <= 0) return err("Ungültige ID.");
          const attestation = getAttestationForEvent(db, id);
          if (!attestation) return err("Kein Ausbildungsnachweis gefunden.", 404);
          return json({ attestation });
        },
      ),

      POST: handle(
        async (
          req: BunRequest<"/api/calendar-events/:id/attestation">,
        ): Promise<Response> => {
          const eventId = Number(req.params.id);
          if (!Number.isInteger(eventId) || eventId <= 0) return err("Ungültige ID.");
          let body: Record<string, unknown>;
          try {
            body = (await req.json()) as Record<string, unknown>;
          } catch {
            return err("Ungültiger JSON-Body.");
          }
          try {
            const attestation = createAttestation(db, {
              eventId,
              studentId: body.studentId as number,
              instructor: String(body.instructor ?? ""),
              content: String(body.content ?? ""),
              durationMin: body.durationMin as number,
              signatureDataUrl: String(body.signatureDataUrl ?? ""),
            });
            return json({ attestation }, 201);
          } catch (e) {
            if (e instanceof ValidationError) return err(e.message);
            throw e;
          }
        },
      ),
    },
  } as const;
}
