/* ------------------------------------------------------------------ */
/* SEPA-Basislastschrift: Mandate, Sammler (pain.008) und Buchung.     */
/*                                                                     */
/* Flow: open invoices / due rates of students with an active mandate  */
/* are collected into a Sammler; its XML is downloaded and uploaded to */
/* the bank portal (no bank API — the school stays in control). Once   */
/* the bank has credited the amount the Sammler is booked: one         */
/* zahlung_guthaben per item through the engine (Bank 1800). A         */
/* Rücklastschrift storniert that payment again.                       */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type {
  SepaCandidate,
  SepaCollection,
  SepaCollectionItem,
  SepaMandate,
} from "../lib/payment-plan-types";
import {
  buildPain008,
  isValidBic,
  isValidCreditorId,
  isValidIban,
  normalizeIban,
  type SepaSequenceType,
} from "../lib/sepa";
import { getCompany, nextSequence } from "./db";
import { createTransaction, stornoTransaction, ValidationError } from "./engine";
import { handle, json } from "./http";
import { getInstalmentPlan, listDueInstalments, payInstalment } from "./instalments";
import { listInvoices, todayIso } from "./invoices";
import { getStudent } from "./students";

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Feld '${field}' muss ein Datum (JJJJ-MM-TT) sein.`);
  }
  return value;
}

function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Mandate                                                             */
/* ------------------------------------------------------------------ */

type MandateRow = {
  id: number;
  student_id: number;
  mandate_ref: string;
  account_holder: string;
  iban: string;
  bic: string;
  signed_on: string;
  revoked_on: string | null;
  last_used_on: string | null;
};

const MANDATE_SELECT = `
  SELECT m.*, (
    SELECT max(c.collection_date) FROM sepa_collection_items i
    JOIN sepa_collections c ON c.id = i.collection_id
    WHERE i.mandate_id = m.id AND i.status != 'zurueckgegeben'
  ) AS last_used_on
  FROM sepa_mandates m`;

function toMandate(row: MandateRow, today: string): SepaMandate {
  // A mandate unused for 36 months expires (SEPA rulebook).
  const reference = row.last_used_on ?? row.signed_on;
  return {
    id: row.id,
    studentId: row.student_id,
    mandateRef: row.mandate_ref,
    accountHolder: row.account_holder,
    iban: row.iban,
    bic: row.bic,
    signedOn: row.signed_on,
    revokedOn: row.revoked_on,
    lastUsedOn: row.last_used_on,
    active: row.revoked_on == null && reference >= monthsBefore(today, 36),
  };
}

export function listMandates(
  db: Database,
  filter: { studentId?: number } = {},
  today = todayIso(),
): SepaMandate[] {
  const rows = filter.studentId
    ? db
        .query<MandateRow, [number]>(
          `${MANDATE_SELECT} WHERE m.student_id = ? ORDER BY m.id DESC`,
        )
        .all(filter.studentId)
    : db.query<MandateRow, []>(`${MANDATE_SELECT} ORDER BY m.id DESC`).all();
  return rows.map((row) => toMandate(row, today));
}

function getMandate(db: Database, id: number, today = todayIso()): SepaMandate {
  const row = db.query<MandateRow, [number]>(`${MANDATE_SELECT} WHERE m.id = ?`).get(id);
  if (!row) throw new ValidationError("Mandat nicht gefunden.");
  return toMandate(row, today);
}

function activeMandateFor(db: Database, studentId: number, today: string) {
  return listMandates(db, { studentId }, today).find((m) => m.active) ?? null;
}

export function createMandate(
  db: Database,
  input: {
    studentId?: unknown;
    accountHolder?: unknown;
    iban?: unknown;
    bic?: unknown;
    signedOn?: unknown;
    mandateRef?: unknown;
  },
): SepaMandate {
  const student = getStudent(db, Number(input.studentId));
  const holder =
    typeof input.accountHolder === "string" ? input.accountHolder.trim() : "";
  if (!holder) throw new ValidationError("Kontoinhaber/in ist erforderlich.");
  const iban = normalizeIban(String(input.iban ?? ""));
  if (!isValidIban(iban)) throw new ValidationError("Die IBAN ist ungültig.");
  const bic = String(input.bic ?? "")
    .trim()
    .toUpperCase();
  if (bic && !isValidBic(bic)) throw new ValidationError("Die BIC ist ungültig.");
  const signedOn = requireDate(input.signedOn, "signedOn");
  if (signedOn > todayIso()) {
    throw new ValidationError("Das Unterschriftsdatum liegt in der Zukunft.");
  }

  const write = db.transaction((): number => {
    const ref =
      typeof input.mandateRef === "string" && input.mandateRef.trim()
        ? input.mandateRef.trim()
        : `FS-${student.customerNumber}-${nextSequence(db, `mandat:${student.customerNumber}`)}`;
    if (!/^[A-Za-z0-9+?/\-:().,' ]{1,35}$/.test(ref)) {
      throw new ValidationError(
        "Mandatsreferenz: max. 35 Zeichen, nur Buchstaben, Ziffern und + ? / - : ( ) . , '",
      );
    }
    // One active mandate per student: a new signature replaces the old one.
    db.prepare(
      "UPDATE sepa_mandates SET revoked_on = ? WHERE student_id = ? AND revoked_on IS NULL",
    ).run(signedOn, student.id);
    try {
      return Number(
        db
          .prepare(
            `INSERT INTO sepa_mandates
               (student_id, mandate_ref, account_holder, iban, bic, signed_on)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(student.id, ref, holder, iban, bic, signedOn).lastInsertRowid,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ValidationError("Diese Mandatsreferenz ist bereits vergeben.");
      }
      throw error;
    }
  });
  return getMandate(db, write());
}

export function revokeMandate(db: Database, id: number, date: unknown): SepaMandate {
  const mandate = getMandate(db, id);
  if (mandate.revokedOn) throw new ValidationError("Das Mandat ist bereits widerrufen.");
  db.prepare("UPDATE sepa_mandates SET revoked_on = ? WHERE id = ?").run(
    requireDate(date, "date"),
    id,
  );
  return getMandate(db, id);
}

/* ------------------------------------------------------------------ */
/* Candidates + Sammler                                                */
/* ------------------------------------------------------------------ */

/* FRST for a mandate's first collection, RCUR afterwards. */
function sequenceTypeFor(mandate: SepaMandate): SepaSequenceType {
  return mandate.lastUsedOn == null ? "FRST" : "RCUR";
}

function busySources(db: Database): Set<string> {
  return new Set(
    db
      .query<{ key: string }, []>(
        `SELECT source_type || ':' || source_id AS key FROM sepa_collection_items
         WHERE status = 'exportiert'`,
      )
      .all()
      .map((row) => row.key),
  );
}

export function listCandidates(
  db: Database,
  collectionDate: string,
  today = todayIso(),
): SepaCandidate[] {
  requireDate(collectionDate, "collectionDate");
  const busy = busySources(db);
  const mandates = new Map<number, SepaMandate | null>();
  const mandateOf = (studentId: number) => {
    if (!mandates.has(studentId)) {
      mandates.set(studentId, activeMandateFor(db, studentId, today));
    }
    return mandates.get(studentId) ?? null;
  };

  const candidates: SepaCandidate[] = [];
  for (const invoice of listInvoices(db, {}, today)) {
    if (invoice.kind !== "rechnung" || invoice.openCents <= 0) continue;
    if (invoice.studentId == null || busy.has(`invoice:${invoice.id}`)) continue;
    const mandate = mandateOf(invoice.studentId);
    if (!mandate) continue;
    candidates.push({
      sourceType: "invoice",
      sourceId: invoice.id,
      studentId: invoice.studentId,
      studentName: invoice.recipient.name,
      label: `Rechnung ${invoice.invoiceNr}`,
      dueDate: invoice.dueDate,
      amountCents: invoice.openCents,
      mandateId: mandate.id,
      mandateRef: mandate.mandateRef,
      sequenceType: sequenceTypeFor(mandate),
    });
  }
  for (const rate of listDueInstalments(db, collectionDate)) {
    if (rate.inCollection) continue;
    const plan = getInstalmentPlan(db, rate.planId);
    const mandate = mandateOf(plan.studentId);
    if (!mandate) continue;
    candidates.push({
      sourceType: "instalment",
      sourceId: rate.id,
      studentId: plan.studentId,
      studentName: plan.studentName,
      label: `${plan.title}, Rate ${rate.seq}/${plan.instalments.length}`,
      dueDate: rate.dueDate,
      amountCents: rate.amountCents,
      mandateId: mandate.id,
      mandateRef: mandate.mandateRef,
      sequenceType: sequenceTypeFor(mandate),
    });
  }
  return candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

type CollectionRow = {
  id: number;
  msg_id: string;
  collection_date: string;
  total_cents: number;
  created_at: string;
};

type ItemRow = {
  id: number;
  collection_id: number;
  mandate_id: number;
  source_type: "invoice" | "instalment";
  source_id: number;
  amount_cents: number;
  sequence_type: SepaSequenceType;
  end_to_end_id: string;
  remittance: string;
  status: SepaCollectionItem["status"];
  payment_transaction_id: number | null;
  return_reason: string | null;
  account_holder: string;
  student_id: number;
};

const ITEM_SELECT = `
  SELECT i.*, m.account_holder, m.student_id FROM sepa_collection_items i
  JOIN sepa_mandates m ON m.id = i.mandate_id`;

function toItem(db: Database, row: ItemRow): SepaCollectionItem {
  const student = db
    .query<{ name: string }, [number]>(
      "SELECT trim(first_name || ' ' || last_name) AS name FROM students WHERE id = ?",
    )
    .get(row.student_id);
  return {
    id: row.id,
    mandateId: row.mandate_id,
    studentName: student?.name ?? row.account_holder,
    sourceType: row.source_type,
    sourceId: row.source_id,
    amountCents: row.amount_cents,
    sequenceType: row.sequence_type,
    endToEndId: row.end_to_end_id,
    remittance: row.remittance,
    status: row.status,
    returnReason: row.return_reason,
  };
}

export function getCollection(db: Database, id: number): SepaCollection {
  const row = db
    .query<CollectionRow, [number]>(
      "SELECT id, msg_id, collection_date, total_cents, created_at FROM sepa_collections WHERE id = ?",
    )
    .get(id);
  if (!row) throw new ValidationError("Lastschrift-Sammler nicht gefunden.");
  return {
    id: row.id,
    msgId: row.msg_id,
    collectionDate: row.collection_date,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    items: db
      .query<ItemRow, [number]>(`${ITEM_SELECT} WHERE i.collection_id = ? ORDER BY i.id`)
      .all(id)
      .map((item) => toItem(db, item)),
  };
}

export function listCollections(db: Database): SepaCollection[] {
  return db
    .query<{ id: number }, []>("SELECT id FROM sepa_collections ORDER BY id DESC")
    .all()
    .map((row) => getCollection(db, row.id));
}

export function getCollectionXml(
  db: Database,
  id: number,
): { msgId: string; xml: string } {
  const row = db
    .query<{ msg_id: string; xml: string }, [number]>(
      "SELECT msg_id, xml FROM sepa_collections WHERE id = ?",
    )
    .get(id);
  if (!row) throw new ValidationError("Lastschrift-Sammler nicht gefunden.");
  return { msgId: row.msg_id, xml: row.xml };
}

export function createCollection(
  db: Database,
  input: { collectionDate?: unknown; items?: unknown },
  now = new Date(),
): SepaCollection {
  const today = todayIso();
  const collectionDate = requireDate(input.collectionDate, "collectionDate");
  if (collectionDate <= today) {
    throw new ValidationError(
      "Das Fälligkeitsdatum muss mindestens einen Bankarbeitstag in der Zukunft liegen.",
    );
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError("Bitte mindestens eine Position auswählen.");
  }
  const company = getCompany(db);
  if (!isValidCreditorId(company.glaeubigerId)) {
    throw new ValidationError(
      "Im Profil ist keine gültige Gläubiger-ID hinterlegt (z. B. DE98ZZZ09999999999).",
    );
  }
  if (!isValidIban(company.iban)) {
    throw new ValidationError(
      "Im Profil ist keine gültige IBAN der Fahrschule hinterlegt.",
    );
  }

  const candidates = new Map(
    listCandidates(db, collectionDate, today).map((c) => [
      `${c.sourceType}:${c.sourceId}`,
      c,
    ]),
  );
  const selected: SepaCandidate[] = [];
  for (const raw of input.items as { sourceType?: unknown; sourceId?: unknown }[]) {
    const key = `${raw?.sourceType}:${raw?.sourceId}`;
    const candidate = candidates.get(key);
    if (!candidate) {
      throw new ValidationError(
        `Position ${key} kann nicht eingezogen werden (bezahlt, ohne Mandat oder bereits im Einzug).`,
      );
    }
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  const write = db.transaction((): number => {
    const number = nextSequence(db, "sepa");
    const stamp = collectionDate.replaceAll("-", "");
    const msgId = `OPENFS-${stamp}-${number}`;
    const customerNos = new Map<number, string>();
    const withDetails = selected.map((candidate, index) => {
      const mandate = getMandate(db, candidate.mandateId, today);
      if (!customerNos.has(candidate.studentId)) {
        customerNos.set(
          candidate.studentId,
          getStudent(db, candidate.studentId).customerNumber,
        );
      }
      return {
        candidate,
        mandate,
        endToEndId: `OFS${number}-${index + 1}`,
        remittance: `${candidate.label} Kd-Nr ${customerNos.get(candidate.studentId)}`,
      };
    });
    const xml = buildPain008({
      msgId,
      createdAt: now.toISOString().slice(0, 19),
      collectionDate,
      creditor: {
        name: company.name,
        iban: company.iban,
        bic: company.bic,
        creditorId: company.glaeubigerId,
      },
      transactions: withDetails.map(({ candidate, mandate, endToEndId, remittance }) => ({
        endToEndId,
        amountCents: candidate.amountCents,
        mandateRef: mandate.mandateRef,
        mandateSignedOn: mandate.signedOn,
        debtorName: mandate.accountHolder,
        debtorIban: mandate.iban,
        debtorBic: mandate.bic,
        remittance,
        sequenceType: candidate.sequenceType,
      })),
    });
    const total = selected.reduce((sum, c) => sum + c.amountCents, 0);
    const collectionId = Number(
      db
        .prepare(
          `INSERT INTO sepa_collections (msg_id, collection_date, total_cents, xml)
           VALUES (?, ?, ?, ?)`,
        )
        .run(msgId, collectionDate, total, xml).lastInsertRowid,
    );
    const insert = db.prepare(
      `INSERT INTO sepa_collection_items
         (collection_id, mandate_id, source_type, source_id, amount_cents,
          sequence_type, end_to_end_id, remittance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { candidate, endToEndId, remittance } of withDetails) {
      insert.run(
        collectionId,
        candidate.mandateId,
        candidate.sourceType,
        candidate.sourceId,
        candidate.amountCents,
        candidate.sequenceType,
        endToEndId,
        remittance,
      );
    }
    return collectionId;
  });
  return getCollection(db, write());
}

/* The bank has credited the Sammler: book every still-exported item as
   an Anzahlung on Bank 1800 (method Lastschrift). */
export function bookCollection(db: Database, id: number, date: unknown): SepaCollection {
  const bookingDate = requireDate(date, "date");
  const collection = getCollection(db, id);
  const pending = db
    .query<ItemRow, [number]>(
      `${ITEM_SELECT} WHERE i.collection_id = ? AND i.status = 'exportiert' ORDER BY i.id`,
    )
    .all(id);
  if (pending.length === 0) {
    throw new ValidationError("Alle Positionen dieses Sammlers sind bereits verbucht.");
  }
  const write = db.transaction(() => {
    const markBooked = db.prepare(
      "UPDATE sepa_collection_items SET status = 'gebucht', payment_transaction_id = ? WHERE id = ?",
    );
    for (const item of pending) {
      let paymentId: number;
      if (item.source_type === "instalment") {
        const rate = payInstalment(db, item.source_id, {
          date: bookingDate,
          geldkonto: "1800",
          paymentMethod: "lastschrift",
        });
        paymentId = rate.paymentTransactionId!;
      } else {
        const student = getStudent(db, item.student_id);
        paymentId = createTransaction(db, {
          type: "zahlung_guthaben",
          date: bookingDate,
          amountCents: item.amount_cents,
          geldkonto: "1800",
          paymentMethod: "lastschrift",
          student: {
            customerNo: student.customerNumber,
            name: `${student.firstName} ${student.lastName}`.trim(),
            address: student.address,
            contractNo: student.contractNumber,
            classes: student.classes,
          },
          description: `SEPA-Lastschrift ${item.remittance}`,
        }).id;
      }
      markBooked.run(paymentId, item.id);
    }
  });
  write();
  return getCollection(db, collection.id);
}

/* Rücklastschrift: storniert the booked payment (if any); the invoice or
   rate is open again and can be collected or paid otherwise. */
export function returnItem(
  db: Database,
  itemId: number,
  input: { date?: unknown; reason?: unknown },
): SepaCollectionItem {
  const date = requireDate(input.date, "date");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new ValidationError("Bitte den Rückgabegrund angeben.");
  const item = db.query<ItemRow, [number]>(`${ITEM_SELECT} WHERE i.id = ?`).get(itemId);
  if (!item) throw new ValidationError("Position nicht gefunden.");
  if (item.status === "zurueckgegeben") {
    throw new ValidationError("Die Position ist bereits als Rücklastschrift erfasst.");
  }
  const write = db.transaction(() => {
    if (item.payment_transaction_id != null) {
      stornoTransaction(
        db,
        item.payment_transaction_id,
        `Rücklastschrift: ${reason}`,
        date,
      );
    }
    db.prepare(
      "UPDATE sepa_collection_items SET status = 'zurueckgegeben', return_reason = ? WHERE id = ?",
    ).run(reason, itemId);
  });
  write();
  return toItem(
    db,
    db.query<ItemRow, [number]>(`${ITEM_SELECT} WHERE i.id = ?`).get(itemId)!,
  );
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Ungültige ${label}.`);
  return id;
}

export function sepaRoutes(db: Database) {
  return {
    "/api/sepa/mandates": {
      GET: (req: BunRequest) =>
        handle(() => {
          const raw = new URL(req.url).searchParams.get("studentId");
          return json({
            mandates: listMandates(db, {
              studentId: raw ? parseId(raw, "Fahrschüler-ID") : undefined,
            }),
          });
        })(),
      POST: (req: BunRequest) =>
        handle(async () => json(createMandate(db, await req.json()), 201))(),
    },
    "/api/sepa/mandates/:id/revoke": {
      POST: (req: BunRequest<"/api/sepa/mandates/:id/revoke">) =>
        handle(async () => {
          const body = (await req.json()) as { date?: unknown };
          return json(revokeMandate(db, parseId(req.params.id, "Mandats-ID"), body.date));
        })(),
    },
    "/api/sepa/candidates": {
      GET: (req: BunRequest) =>
        handle(() => {
          const date = new URL(req.url).searchParams.get("collectionDate") ?? "";
          return json({ candidates: listCandidates(db, date) });
        })(),
    },
    "/api/sepa/collections": {
      GET: () => handle(() => json({ collections: listCollections(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () => json(createCollection(db, await req.json()), 201))(),
    },
    "/api/sepa/collections/:id/xml": {
      GET: (req: BunRequest<"/api/sepa/collections/:id/xml">) =>
        handle(() => {
          const { msgId, xml } = getCollectionXml(
            db,
            parseId(req.params.id, "Sammler-ID"),
          );
          return new Response(xml, {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Content-Disposition": `attachment; filename="${msgId}.xml"`,
            },
          });
        })(),
    },
    "/api/sepa/collections/:id/book": {
      POST: (req: BunRequest<"/api/sepa/collections/:id/book">) =>
        handle(async () => {
          const body = (await req.json()) as { date?: unknown };
          return json(
            bookCollection(db, parseId(req.params.id, "Sammler-ID"), body.date),
          );
        })(),
    },
    "/api/sepa/items/:id/return": {
      POST: (req: BunRequest<"/api/sepa/items/:id/return">) =>
        handle(async () =>
          json(returnItem(db, parseId(req.params.id, "Positions-ID"), await req.json())),
        )(),
    },
  };
}
