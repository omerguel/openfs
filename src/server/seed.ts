/* ------------------------------------------------------------------ */
/* Demo seed — re-creates the previous hard-coded Buchhaltung rows     */
/* through the booking engine with CORRECT SKR 04 bookings:            */
/*   Zahlung auf Guthaben      1600 Kasse  an 3272 Erh. Anzahlungen    */
/*   Fahrstunde/Prüfung        3272        an 4400 Erlöse 19 %         */
/*   TÜV Prüfungsgebühr        3272        an 1370 Durchlaufende P.    */
/*   Transfer Kasse → Bank     via 1460 Geldtransit                    */
/* Students are mapped to the real demo students in student-data.ts    */
/* so Quittungen can show recipient name + address.                    */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { StudentRef } from "../lib/accounting-types";
import { students, type Student } from "../lib/student-data";
import { createTransaction } from "./engine";
import { demoDataEnabled } from "./db";

function ref(student: Student): StudentRef {
  return {
    customerNo: student.customerNumber,
    name: `${student.firstName} ${student.lastName}`,
    address: student.address,
    contractNo: student.contractNumber,
    classes: student.classes,
  };
}

function byName(lastName: string): Student {
  const student = students.find((s) => s.lastName === lastName);
  if (!student) throw new Error(`Seed: Fahrschüler ${lastName} fehlt.`);
  return student;
}

export function seedTransactions(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM transactions")
    .get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const aylin = byName("Demir");
  const lena = byName("Braun");
  const tom = byName("Richter");
  const mara = byName("Köhler");

  // 06.06.2026 — Belege T0000124A ff.
  createTransaction(db, {
    type: "zahlung_guthaben",
    date: "2026-06-06",
    amountCents: 40983,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: ref(aylin),
  });
  createTransaction(db, {
    type: "zahlung_guthaben",
    date: "2026-06-06",
    amountCents: 40983,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: ref(lena),
  });
  createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-06-06",
    amountCents: 15000,
    habenKonto: "4400",
    student: ref(aylin),
    description: `FS ${ref(aylin).name} - ${aylin.classes}, Praktische Prüfung (55)`,
  });
  createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-06-06",
    amountCents: 12983,
    habenKonto: "1370",
    student: ref(aylin),
    description: `FS ${ref(aylin).name} - ${aylin.classes}, TÜV Prüfungsgebühr (durchlaufender Posten)`,
  });
  createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-06-06",
    amountCents: 13000,
    habenKonto: "4400",
    student: ref(aylin),
    description: `FS ${ref(aylin).name} - ${aylin.classes}, Fahrübungsstunde (90)`,
  });
  createTransaction(db, {
    type: "transfer",
    date: "2026-06-06",
    amountCents: 125000,
    fromKonto: "1600",
    toKonto: "1800",
    description: "Bareinzahlung auf Bankkonto",
  });

  // 08.06.2026
  createTransaction(db, {
    type: "zahlung_guthaben",
    date: "2026-06-08",
    amountCents: 45000,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: ref(tom),
  });
  createTransaction(db, {
    type: "zahlung_guthaben",
    date: "2026-06-08",
    amountCents: 40983,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: ref(mara),
  });
  createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-06-08",
    amountCents: 12983,
    habenKonto: "1370",
    student: ref(mara),
    description: `FS ${ref(mara).name} - ${mara.classes}, TÜV Prüfungsgebühr (durchlaufender Posten)`,
  });
  createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-06-08",
    amountCents: 13000,
    habenKonto: "4400",
    student: ref(mara),
    description: `FS ${ref(mara).name} - ${mara.classes}, Fahrübungsstunde (90)`,
  });
  createTransaction(db, {
    type: "transfer",
    date: "2026-06-08",
    amountCents: 80000,
    fromKonto: "1600",
    toKonto: "1800",
    description: "Bareinzahlung auf Bankkonto",
  });
}
