/* ------------------------------------------------------------------ */
/* Ratenpläne — agreed Anzahlungen with due dates (e.g. Führerschein   */
/* in 6 Monatsraten). A plan books nothing by itself; paying a rate    */
/* books a normal zahlung_guthaben through the engine and links it.    */
/* Plans are cancelled, never deleted.                                 */
/*                                                                     */
/* Payment status is derived, never stored (like invoices): a rate is  */
/* covered by its linked payment plus the student's other payments     */
/* on the Ausbildungskonto made after the plan started, allocated      */
/* oldest rate first (FIFO) — so a cash payment at the counter counts  */
/* even when nobody pressed "Als bezahlt buchen".                      */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type { PaymentMethod } from "../lib/accounting-types";
import type {
  CreateInstalmentPlanInput,
  Instalment,
  InstalmentPlan,
} from "../lib/payment-plan-types";
import { createTransaction, ValidationError } from "./engine";
import { handle, json } from "./http";
import { getStudent } from "./students";

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Feld '${field}' muss ein Datum (JJJJ-MM-TT) sein.`);
  }
  return value;
}

/** Same day n months later, clamped to the month's last day (31.01. → 28.02.). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

type PlanRow = {
  id: number;
  student_id: number;
  customer_no: string;
  title: string;
  total_cents: number;
  cancelled_on: string | null;
  created_at: string;
};

type InstalmentRow = {
  id: number;
  plan_id: number;
  seq: number;
  due_date: string;
  amount_cents: number;
  payment_transaction_id: number | null;
  tx_storniert_by: number | null;
  in_collection: number;
};

/* A rate counts as paid while its linked payment is not storniert. */
const INSTALMENT_SELECT = `
  SELECT r.id, r.plan_id, r.seq, r.due_date, r.amount_cents, r.payment_transaction_id,
    (SELECT t.storniert_by FROM transactions t WHERE t.id = r.payment_transaction_id)
      AS tx_storniert_by,
    EXISTS (SELECT 1 FROM sepa_collection_items i
            WHERE i.source_type = 'instalment' AND i.source_id = r.id
              AND i.status = 'exportiert') AS in_collection
  FROM instalments r`;

const toInstalment = (row: InstalmentRow, covered: Map<number, number>): Instalment => {
  const linked = row.payment_transaction_id != null && row.tx_storniert_by == null;
  const paidCents = Math.min(covered.get(row.id) ?? 0, row.amount_cents);
  return {
    id: row.id,
    planId: row.plan_id,
    seq: row.seq,
    dueDate: row.due_date,
    amountCents: row.amount_cents,
    paid: paidCents >= row.amount_cents,
    paidCents,
    openCents: row.amount_cents - paidCents,
    paymentTransactionId: linked ? row.payment_transaction_id : null,
    inCollection: row.in_collection === 1,
  };
};

/** First day a payment counts for the plan: the day it was agreed, or the
 *  first due date if that is earlier (a plan entered after the fact). */
function planStart(plan: { created_at: string }, firstDue: string | undefined): string {
  const created = plan.created_at.slice(0, 10);
  return firstDue && firstDue < created ? firstDue : created;
}

/**
 * Covered cents per rate (instalment id) for all plans of one student.
 *
 * 1. A rate's linked payment (not storniert) counts for that rate.
 * 2. Every other active zahlung_guthaben of the student — in date order —
 *    fills the oldest still-open rate of a plan that had started and was
 *    not yet cancelled on the payment date (FIFO by due date). Payments
 *    earmarked for something else (a Lastschrift collected for an
 *    invoice) do not count.
 */
export function instalmentCoverage(
  db: Database,
  customerNo: string,
): Map<number, number> {
  const plans = db
    .query<PlanRow, [string]>("SELECT * FROM instalment_plans WHERE customer_no = ?")
    .all(customerNo);
  const covered = new Map<number, number>();
  if (plans.length === 0) return covered;
  type Rate = {
    id: number;
    plan_id: number;
    due_date: string;
    amount_cents: number;
    linked_cents: number | null;
  };
  const rates = db
    .query<Rate, [string]>(
      `SELECT r.id, r.plan_id, r.due_date, r.amount_cents,
         (SELECT SUM(b.amount_cents) FROM transactions t
            JOIN bookings b ON b.transaction_id = t.id
          WHERE t.id = r.payment_transaction_id AND t.storniert_by IS NULL) AS linked_cents
       FROM instalments r JOIN instalment_plans p ON p.id = r.plan_id
       WHERE p.customer_no = ?
       ORDER BY r.due_date, r.plan_id, r.seq`,
    )
    .all(customerNo);
  const window = new Map(
    plans.map((plan) => [
      plan.id,
      {
        start: planStart(plan, rates.find((rate) => rate.plan_id === plan.id)?.due_date),
        end: plan.cancelled_on,
      },
    ]),
  );
  for (const rate of rates) covered.set(rate.id, rate.linked_cents ?? 0);

  const payments = db
    .query<{ date: string; amount_cents: number }, [string]>(
      `SELECT t.date, SUM(b.amount_cents) AS amount_cents
       FROM transactions t JOIN bookings b ON b.transaction_id = t.id
       WHERE t.type = 'zahlung_guthaben' AND t.student_customer_no = ?
         AND t.storno_of IS NULL AND t.storniert_by IS NULL
         AND t.id NOT IN (SELECT payment_transaction_id FROM instalments
                          WHERE payment_transaction_id IS NOT NULL)
         AND t.id NOT IN (SELECT payment_transaction_id FROM sepa_collection_items
                          WHERE source_type = 'invoice'
                            AND payment_transaction_id IS NOT NULL)
       GROUP BY t.id
       ORDER BY t.date, t.id`,
    )
    .all(customerNo);
  for (const payment of payments) {
    let rest = payment.amount_cents;
    for (const rate of rates) {
      if (rest <= 0) break;
      const span = window.get(rate.plan_id)!;
      if (payment.date < span.start || (span.end != null && payment.date > span.end)) {
        continue;
      }
      const open = rate.amount_cents - covered.get(rate.id)!;
      if (open <= 0) continue;
      const take = Math.min(open, rest);
      covered.set(rate.id, covered.get(rate.id)! + take);
      rest -= take;
    }
  }
  return covered;
}

function toPlan(
  db: Database,
  row: PlanRow,
  coverage?: Map<number, number>,
): InstalmentPlan {
  const covered = coverage ?? instalmentCoverage(db, row.customer_no);
  const instalments = db
    .query<InstalmentRow, [number]>(
      `${INSTALMENT_SELECT} WHERE r.plan_id = ? ORDER BY r.seq`,
    )
    .all(row.id)
    .map((rate) => toInstalment(rate, covered));
  const student = db
    .query<{ name: string }, [number]>(
      "SELECT trim(first_name || ' ' || last_name) AS name FROM students WHERE id = ?",
    )
    .get(row.student_id);
  return {
    id: row.id,
    studentId: row.student_id,
    customerNo: row.customer_no,
    studentName: student?.name ?? row.customer_no,
    title: row.title,
    totalCents: row.total_cents,
    paidCents: instalments.reduce((s, r) => s + r.paidCents, 0),
    cancelledOn: row.cancelled_on,
    instalments,
  };
}

export function getInstalmentPlan(db: Database, id: number): InstalmentPlan {
  const row = db
    .query<PlanRow, [number]>("SELECT * FROM instalment_plans WHERE id = ?")
    .get(id);
  if (!row) throw new ValidationError("Ratenplan nicht gefunden.");
  return toPlan(db, row);
}

export function listInstalmentPlans(
  db: Database,
  filter: { studentId?: number } = {},
): InstalmentPlan[] {
  const rows = filter.studentId
    ? db
        .query<PlanRow, [number]>(
          "SELECT * FROM instalment_plans WHERE student_id = ? ORDER BY id DESC",
        )
        .all(filter.studentId)
    : db.query<PlanRow, []>("SELECT * FROM instalment_plans ORDER BY id DESC").all();
  const coverage = new Map<string, Map<number, number>>();
  return rows.map((row) => {
    if (!coverage.has(row.customer_no)) {
      coverage.set(row.customer_no, instalmentCoverage(db, row.customer_no));
    }
    return toPlan(db, row, coverage.get(row.customer_no));
  });
}

export function getInstalment(db: Database, id: number): Instalment {
  const row = db
    .query<InstalmentRow, [number]>(`${INSTALMENT_SELECT} WHERE r.id = ?`)
    .get(id);
  if (!row) throw new ValidationError("Rate nicht gefunden.");
  return toInstalment(row, instalmentCoverage(db, customerNoOfPlan(db, row.plan_id)));
}

function customerNoOfPlan(db: Database, planId: number): string {
  return (
    db
      .query<{ customer_no: string }, [number]>(
        "SELECT customer_no FROM instalment_plans WHERE id = ?",
      )
      .get(planId)?.customer_no ?? ""
  );
}

export function createInstalmentPlan(
  db: Database,
  input: CreateInstalmentPlanInput,
): InstalmentPlan {
  if (!input || typeof input !== "object")
    throw new ValidationError("Ungültige Anfrage.");
  const student = getStudent(db, Number(input.studentId));
  const total = Number(input.totalCents);
  if (!Number.isInteger(total) || total <= 0) {
    throw new ValidationError("Gesamtbetrag muss ein positiver Betrag in Cent sein.");
  }
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 2 || count > 60) {
    throw new ValidationError("Anzahl der Raten muss zwischen 2 und 60 liegen.");
  }
  const interval = input.intervalMonths === undefined ? 1 : Number(input.intervalMonths);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) {
    throw new ValidationError("Abstand der Raten muss 1 bis 12 Monate betragen.");
  }
  const first = requireDate(input.firstDueDate, "firstDueDate");
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : "Ratenzahlung Führerscheinausbildung";

  // Even split; the cents that do not divide go onto the last rate.
  const base = Math.floor(total / count);
  const write = db.transaction((): number => {
    const planId = Number(
      db
        .prepare(
          `INSERT INTO instalment_plans (student_id, customer_no, title, total_cents)
           VALUES (?, ?, ?, ?)`,
        )
        .run(student.id, student.customerNumber, title, total).lastInsertRowid,
    );
    const insert = db.prepare(
      "INSERT INTO instalments (plan_id, seq, due_date, amount_cents) VALUES (?, ?, ?, ?)",
    );
    for (let i = 0; i < count; i++) {
      const amount = i === count - 1 ? total - base * (count - 1) : base;
      insert.run(planId, i + 1, addMonths(first, i * interval), amount);
    }
    return planId;
  });
  return getInstalmentPlan(db, write());
}

export function cancelInstalmentPlan(db: Database, id: number, date: string) {
  const plan = getInstalmentPlan(db, id);
  if (plan.cancelledOn) throw new ValidationError("Der Ratenplan ist bereits beendet.");
  db.prepare("UPDATE instalment_plans SET cancelled_on = ? WHERE id = ?").run(
    requireDate(date, "date"),
    id,
  );
  return getInstalmentPlan(db, id);
}

/* Book a rate as received: one zahlung_guthaben (Beleg + Quittung like
   every Anzahlung) linked to the rate. Runs inside the caller's
   transaction when called from the SEPA booking. */
export function payInstalment(
  db: Database,
  id: number,
  input: {
    date?: unknown;
    geldkonto?: unknown;
    paymentMethod?: unknown;
    /** Amount actually received (SEPA item); defaults to the open part. */
    amountCents?: unknown;
  },
): Instalment {
  const rate = getInstalment(db, id);
  if (rate.paid) throw new ValidationError("Die Rate ist bereits bezahlt.");
  if (rate.paymentTransactionId != null) {
    throw new ValidationError("Für diese Rate ist bereits eine Zahlung gebucht.");
  }
  const amountCents =
    input.amountCents === undefined ? rate.openCents : Number(input.amountCents);
  const plan = getInstalmentPlan(db, rate.planId);
  const student = getStudent(db, plan.studentId);
  const date = requireDate(input.date, "date");
  const write = db.transaction(() => {
    const tx = createTransaction(db, {
      type: "zahlung_guthaben",
      date,
      amountCents,
      geldkonto: typeof input.geldkonto === "string" ? input.geldkonto : "1800",
      paymentMethod: (input.paymentMethod as PaymentMethod) ?? "ueberweisung",
      student: {
        customerNo: student.customerNumber,
        name: `${student.firstName} ${student.lastName}`.trim(),
        address: student.address,
        contractNo: student.contractNumber,
        classes: student.classes,
      },
      description: `${plan.title}, Rate ${rate.seq}/${plan.instalments.length}`,
    });
    db.prepare("UPDATE instalments SET payment_transaction_id = ? WHERE id = ?").run(
      tx.id,
      id,
    );
  });
  write();
  return getInstalment(db, id);
}

/** Unpaid rates of active plans due on or before `date`. */
export function listDueInstalments(db: Database, date: string): Instalment[] {
  return db
    .query<InstalmentRow, [string]>(
      `${INSTALMENT_SELECT}
       JOIN instalment_plans p ON p.id = r.plan_id
       WHERE p.cancelled_on IS NULL AND r.due_date <= ?
       ORDER BY r.due_date, r.id`,
    )
    .all(date)
    .map((row) =>
      toInstalment(row, instalmentCoverage(db, customerNoOfPlan(db, row.plan_id))),
    )
    .filter((rate) => !rate.paid && rate.paymentTransactionId == null);
}

function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Ungültige ${label}.`);
  return id;
}

export function instalmentRoutes(db: Database) {
  return {
    "/api/instalment-plans": {
      GET: (req: BunRequest) =>
        handle(() => {
          const raw = new URL(req.url).searchParams.get("studentId");
          return json({
            plans: listInstalmentPlans(db, {
              studentId: raw ? parseId(raw, "Fahrschüler-ID") : undefined,
            }),
          });
        })(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(
            createInstalmentPlan(db, (await req.json()) as CreateInstalmentPlanInput),
            201,
          ),
        )(),
    },
    "/api/instalment-plans/:id/cancel": {
      POST: (req: BunRequest<"/api/instalment-plans/:id/cancel">) =>
        handle(async () => {
          const body = (await req.json()) as { date?: unknown };
          return json(
            cancelInstalmentPlan(
              db,
              parseId(req.params.id, "Ratenplan-ID"),
              String(body.date ?? ""),
            ),
          );
        })(),
    },
    "/api/instalments/:id/pay": {
      POST: (req: BunRequest<"/api/instalments/:id/pay">) =>
        handle(async () =>
          json(
            payInstalment(db, parseId(req.params.id, "Raten-ID"), await req.json()),
            201,
          ),
        )(),
    },
  };
}
