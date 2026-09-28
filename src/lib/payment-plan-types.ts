/* ------------------------------------------------------------------ */
/* Ratenpläne + SEPA-Lastschrift — shared API types between the Bun    */
/* server (src/server/instalments.ts, src/server/sepa.ts) and the SPA. */
/* ------------------------------------------------------------------ */

import type { SepaSequenceType } from "./sepa";

export type Instalment = {
  id: number;
  planId: number;
  seq: number;
  dueDate: string;
  amountCents: number;
  paid: boolean;
  paymentTransactionId: number | null;
  /** Currently part of an exported, not yet booked Lastschrift. */
  inCollection: boolean;
};

export type InstalmentPlan = {
  id: number;
  studentId: number;
  customerNo: string;
  studentName: string;
  title: string;
  totalCents: number;
  paidCents: number;
  cancelledOn: string | null;
  instalments: Instalment[];
};

export type CreateInstalmentPlanInput = {
  studentId: number;
  title?: string;
  totalCents: number;
  count: number;
  firstDueDate: string;
  /** Months between two rates (default 1). */
  intervalMonths?: number;
};

export type SepaMandate = {
  id: number;
  studentId: number;
  mandateRef: string;
  accountHolder: string;
  iban: string;
  bic: string;
  signedOn: string;
  revokedOn: string | null;
  /** Date of the last collection that used the mandate (null = never). */
  lastUsedOn: string | null;
  /** Revoked, or unused for 36 months (SEPA rulebook). */
  active: boolean;
};

export type SepaCandidate = {
  sourceType: "invoice" | "instalment";
  sourceId: number;
  studentId: number;
  studentName: string;
  label: string;
  dueDate: string;
  amountCents: number;
  mandateId: number;
  mandateRef: string;
  sequenceType: SepaSequenceType;
};

export type SepaCollectionItem = {
  id: number;
  mandateId: number;
  studentName: string;
  sourceType: "invoice" | "instalment";
  sourceId: number;
  amountCents: number;
  sequenceType: SepaSequenceType;
  endToEndId: string;
  remittance: string;
  status: "exportiert" | "gebucht" | "zurueckgegeben";
  returnReason: string | null;
};

export type SepaCollection = {
  id: number;
  msgId: string;
  collectionDate: string;
  totalCents: number;
  createdAt: string;
  items: SepaCollectionItem[];
};
