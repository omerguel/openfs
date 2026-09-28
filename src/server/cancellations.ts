/* ------------------------------------------------------------------ */
/* Cancellation / no-show (Absage, Nichterscheinen) with optional fee. */
/*                                                                     */
/* A cancelled Termin stays in the calendar as history: it no longer   */
/* blocks the slot, is not billable and does not count towards         */
/* Sonderfahrten or working time. An Ausfallentschädigung is booked    */
/* through createTransaction (GoBD write path) in the same DB          */
/* transaction as the event update; reverting the cancellation         */
/* requires the fee to be storniert first.                             */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type { StudentRef } from "../lib/accounting-types";
import {
  type CancellationKind,
  type CancellationPolicy,
  DEFAULT_CANCELLATION_POLICY,
} from "../lib/cancellation";
import { resolveLessonPrice } from "../lib/price-plan";
import { formatGermanDate } from "../lib/working-time";
import { type CalendarEvent, checkScheduling, getCalendarEvent } from "./calendar-events";
import { type CreatedTransaction, createTransaction, ValidationError } from "./engine";
import { handle, json } from "./http";
import { getPricePlan } from "./price-plans";
import { getStudent } from "./students";

const POLICY_KEY = "cancellation_policy";

export function getCancellationPolicy(db: Database): CancellationPolicy {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(POLICY_KEY);
  if (!row) return { ...DEFAULT_CANCELLATION_POLICY };
  try {
    return { ...DEFAULT_CANCELLATION_POLICY, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_CANCELLATION_POLICY };
  }
}

export function setCancellationPolicy(
  db: Database,
  input: Partial<CancellationPolicy>,
): CancellationPolicy {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const next = { ...getCancellationPolicy(db) };
  if (input.hoursBefore !== undefined) {
    const hours = input.hoursBefore;
    if (
      typeof hours !== "number" ||
      !Number.isInteger(hours) ||
      hours < 0 ||
      hours > 720
    ) {
      throw new ValidationError(
        "Frist muss eine ganze Zahl zwischen 0 und 720 Stunden sein.",
      );
    }
    next.hoursBefore = hours;
  }
  if (input.feeCents !== undefined) {
    const fee = input.feeCents;
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0) {
      throw new ValidationError("Ausfallgebühr muss ein Betrag in Cent (≥ 0) sein.");
    }
    next.feeCents = fee;
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(POLICY_KEY, JSON.stringify(next));
  return next;
}

/* Same StudentRef shape the lesson billing sends from StundenTab. */
function studentRefFor(db: Database, studentId: number): StudentRef {
  const student = getStudent(db, studentId);
  return {
    customerNo: student.customerNumber,
    name: `${student.firstName} ${student.lastName}`,
    address: student.address,
    contractNo: student.contractNumber,
    classes: student.classes,
  };
}

/** Fee in cents: explicit amount > policy fee > the student's
    per-lesson price (Fahrübungsstunde) — null when none resolves. */
export function resolveCancellationFee(
  db: Database,
  studentId: number,
  explicitCents?: number,
): number | null {
  if (explicitCents !== undefined) return explicitCents;
  const policy = getCancellationPolicy(db);
  if (policy.feeCents > 0) return policy.feeCents;
  const planId = getStudent(db, studentId).pricePlanId;
  if (planId == null) return null;
  try {
    return resolveLessonPrice(getPricePlan(db, planId))?.priceCents ?? null;
  } catch {
    return null; // plan deleted in the meantime
  }
}

export type CancelInput = {
  kind?: CancellationKind;
  chargeFee?: boolean;
  feeCents?: number;
  /** Booking date of the fee (ISO); defaults to today. */
  date?: string;
};

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
};

export function cancelCalendarEvent(
  db: Database,
  id: number,
  input: CancelInput,
): { event: CalendarEvent; transaction?: CreatedTransaction } {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const event = getCalendarEvent(db, id);
  if (event.cancelledAt) {
    throw new ValidationError("Termin ist bereits abgesagt.");
  }
  if (event.billedTransactionId != null && event.billedActive) {
    throw new ValidationError("Termin ist abgerechnet — zuerst stornieren.");
  }
  if (input.kind !== "abgesagt" && input.kind !== "nicht_erschienen") {
    throw new ValidationError("Art muss 'abgesagt' oder 'nicht_erschienen' sein.");
  }
  if (input.chargeFee !== undefined && typeof input.chargeFee !== "boolean") {
    throw new ValidationError("Feld 'chargeFee' muss ein Wahrheitswert sein.");
  }
  if (
    input.feeCents !== undefined &&
    (typeof input.feeCents !== "number" ||
      !Number.isInteger(input.feeCents) ||
      input.feeCents <= 0)
  ) {
    throw new ValidationError("Ausfallgebühr muss ein positiver Betrag in Cent sein.");
  }

  let feeCents: number | null = null;
  if (input.chargeFee) {
    if (event.studentId == null) {
      throw new ValidationError(
        "Kein Fahrschüler verknüpft — Ausfallgebühr kann nicht gebucht werden.",
      );
    }
    feeCents = resolveCancellationFee(db, event.studentId, input.feeCents);
    if (feeCents == null) {
      throw new ValidationError(
        "Keine Ausfallgebühr ermittelbar — bitte einen Betrag angeben.",
      );
    }
  }

  let transaction: CreatedTransaction | undefined;
  const run = db.transaction(() => {
    if (feeCents != null) {
      transaction = createTransaction(db, {
        type: "guthaben_uebertragung",
        habenKonto: "4400",
        description: `Ausfallentschädigung ${event.title} ${formatGermanDate(event.date)}`,
        student: studentRefFor(db, event.studentId!),
        amountCents: feeCents,
        date: input.date ?? todayIso(),
      });
    }
    db.prepare(
      `UPDATE calendar_events
       SET cancelled_at = ?, cancellation_kind = ?, cancellation_fee_transaction_id = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), input.kind!, transaction?.id ?? null, id);
  });
  run();

  const updated = getCalendarEvent(db, id);
  return transaction ? { event: updated, transaction } : { event: updated };
}

/** Revert a cancellation — only when no fee was charged or the fee has
    been storniert. The slot is re-checked like a move. */
export function uncancelCalendarEvent(
  db: Database,
  id: number,
  options: { allowConflicts?: boolean } = {},
): CalendarEvent {
  const event = getCalendarEvent(db, id);
  if (!event.cancelledAt) {
    throw new ValidationError("Termin ist nicht abgesagt.");
  }
  if (event.cancellationFeeTransactionId != null && event.cancellationFeeActive) {
    throw new ValidationError("Die Ausfallgebühr ist noch gebucht — zuerst stornieren.");
  }
  if (options.allowConflicts !== true) {
    checkScheduling(db, event, id);
  }
  db.prepare(
    `UPDATE calendar_events
     SET cancelled_at = NULL, cancellation_kind = NULL, cancellation_fee_transaction_id = NULL
     WHERE id = ?`,
  ).run(id);
  return getCalendarEvent(db, id);
}

export function cancellationRoutes(db: Database) {
  const parseId = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id)) throw new ValidationError("Ungültige Termin-ID.");
    return id;
  };

  return {
    "/api/calendar-events/:id/cancel": {
      POST: (req: BunRequest<"/api/calendar-events/:id/cancel">) =>
        handle(async () => {
          const id = parseId(req.params.id);
          const body = (await req.json().catch(() => null)) as CancelInput | null;
          return json(cancelCalendarEvent(db, id, body as CancelInput));
        })(),
    },

    "/api/calendar-events/:id/uncancel": {
      POST: (req: BunRequest<"/api/calendar-events/:id/uncancel">) =>
        handle(async () => {
          const id = parseId(req.params.id);
          const body = (await req.json().catch(() => ({}))) as {
            allowConflicts?: unknown;
          } | null;
          return json(
            uncancelCalendarEvent(db, id, {
              allowConflicts: body?.allowConflicts === true,
            }),
          );
        })(),
    },

    "/api/settings/cancellation-policy": {
      GET: () => handle(() => json(getCancellationPolicy(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () =>
          json(
            setCancellationPolicy(db, (await req.json()) as Partial<CancellationPolicy>),
          ),
        )(),
    },
  };
}
