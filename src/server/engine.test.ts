import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { openDb, setCompany, getCompany, DEFAULT_COMPANY, DEMO_COMPANY } from "./db";
import {
  createTransaction,
  getQuittung,
  listAccounts,
  listJournal,
  listLedger,
  listStudentBalances,
  setAccountActive,
  stornoTransaction,
  ValidationError,
} from "./engine";
import { seedTransactions } from "./seed";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const STUDENT = {
  customerNo: "10051",
  name: "Aylin Demir",
  address: "Bleichstraße 9, 64283 Darmstadt",
  contractNo: "V-2026-0987",
  classes: "B197",
};

describe("chart of accounts (SKR 04)", () => {
  test("seeds the verified SKR 04 accounts", () => {
    const accounts = listAccounts(db);
    const byNumber = new Map(accounts.map((a) => [a.number, a]));
    expect(byNumber.get("1600")?.name).toBe("Kasse");
    expect(byNumber.get("1800")?.name).toBe("Bank");
    expect(byNumber.get("1460")?.name).toBe("Geldtransit");
    expect(byNumber.get("1370")?.name).toBe("Durchlaufende Posten");
    expect(byNumber.get("3272")?.name).toBe("Erhaltene Anzahlungen 19 % USt");
    expect(byNumber.get("3272")?.vatRate).toBe(19);
    expect(byNumber.get("4400")?.name).toBe("Erlöse 19 % USt");
    expect(byNumber.get("4300")?.name).toBe("Erlöse 7 % USt");
    expect(byNumber.get("4100")?.kind).toBe("erloes");
    expect(byNumber.get("4100")?.vatRate).toBe(0);
    // The wrong pre-SKR03 demo accounts must be gone.
    expect(byNumber.has("1186")).toBe(false);
    expect(byNumber.has("3305")).toBe(false);
  });
});

describe("createTransaction", () => {
  test("Zahlung auf Guthaben books Geldkonto an 3272 with 19% split", () => {
    const created = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 40983,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    expect(created.belegNr).toBe("T0000124A");
    expect(created.bookings).toHaveLength(1);
    expect(created.bookings[0]).toMatchObject({
      buchungNr: "00000219A",
      soll: "1600",
      haben: "3272",
      amountCents: 40983,
    });
    const journal = listJournal(db, {});
    expect(journal[0]!.vatRate).toBe(19);
    const quittung = getQuittung(db, created.id);
    expect(quittung.lines[0]).toMatchObject({
      netCents: 34439,
      vatCents: 6544,
      grossCents: 40983,
      vatRate: 19,
    });
  });

  test("Guthabenübertragung books 3272 an 4400 (Erlöse), no Beleg", () => {
    const created = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-09",
      amountCents: 13000,
      habenKonto: "4400",
      student: STUDENT,
      description: "Fahrübungsstunde (90)",
    });
    expect(created.belegNr).toBeNull();
    expect(created.bookings[0]).toMatchObject({ soll: "3272", haben: "4400" });
  });

  test("TÜV-Gebühr books 3272 an 1370 without VAT", () => {
    const created = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-09",
      amountCents: 12983,
      habenKonto: "1370",
      student: STUDENT,
      description: "TÜV Prüfungsgebühr",
    });
    expect(created.bookings[0]).toMatchObject({ soll: "3272", haben: "1370" });
    expect(listJournal(db, {})[0]!.vatRate).toBeNull();
  });

  test("multi-line Guthabenübertragung: one transaction, VAT per line, one Storno", () => {
    const created = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-09",
      amountCents: 28000 + 12983,
      student: STUDENT,
      description: "",
      lines: [
        {
          habenKonto: "4400",
          amountCents: 28000,
          description: "Praktische Prüfung (55)",
        },
        {
          habenKonto: "1370",
          amountCents: 12983,
          description: "TÜV Prüfungsgebühr (durchlaufender Posten)",
        },
      ],
    });
    expect(created.belegNr).toBeNull();
    expect(created.bookings.map((b) => [b.soll, b.haben, b.amountCents])).toEqual([
      ["3272", "4400", 28000],
      ["3272", "1370", 12983],
    ]);
    const journal = listJournal(db, {}).filter((r) => r.transactionId === created.id);
    expect(journal.map((r) => r.vatRate).sort()).toEqual([19, null].sort());
    expect(listLedger(db, {}).rows.find((r) => r.id === created.id)?.description).toBe(
      "Praktische Prüfung (55), TÜV Prüfungsgebühr (durchlaufender Posten)",
    );

    const storno = stornoTransaction(db, created.id, "Prüfung abgesagt", "2026-06-10");
    expect(storno.bookings.map((b) => [b.soll, b.haben])).toEqual([
      ["4400", "3272"],
      ["1370", "3272"],
    ]);
  });

  test("multi-line total must match the lines, and every line needs text", () => {
    const base = {
      type: "guthaben_uebertragung" as const,
      date: "2026-06-09",
      student: STUDENT,
      description: "",
    };
    expect(() =>
      createTransaction(db, {
        ...base,
        amountCents: 100,
        lines: [{ habenKonto: "4400", amountCents: 200, description: "A" }],
      }),
    ).toThrow("Summe der Positionen");
    expect(() =>
      createTransaction(db, {
        ...base,
        amountCents: 200,
        lines: [{ habenKonto: "4400", amountCents: 200, description: " " }],
      }),
    ).toThrow("Beschreibung");
    expect(() =>
      createTransaction(db, {
        ...base,
        amountCents: 200,
        lines: [{ habenKonto: "1600", amountCents: 200, description: "A" }],
      }),
    ).toThrow("nicht zulässig");
  });

  test("Transfer goes through 1460 Geldtransit with two bookings", () => {
    const created = createTransaction(db, {
      type: "transfer",
      date: "2026-06-09",
      amountCents: 80000,
      fromKonto: "1600",
      toKonto: "1800",
    });
    expect(created.bookings).toHaveLength(2);
    expect(created.bookings[0]).toMatchObject({ soll: "1460", haben: "1600" });
    expect(created.bookings[1]).toMatchObject({ soll: "1800", haben: "1460" });
  });

  test("Ausgabe books Aufwand an Geldkonto", () => {
    const created = createTransaction(db, {
      type: "ausgabe",
      date: "2026-06-09",
      amountCents: 11900,
      geldkonto: "1800",
      aufwandKonto: "6530",
      description: "Tankrechnung Fahrschulwagen",
    });
    expect(created.bookings[0]).toMatchObject({ soll: "6530", haben: "1800" });
    expect(listJournal(db, {})[0]!.vatRate).toBe(19);
  });

  test("Direktzahlung books Geldkonto an Erlöskonto", () => {
    const created = createTransaction(db, {
      type: "direktzahlung",
      date: "2026-06-09",
      amountCents: 5000,
      geldkonto: "1800",
      habenKonto: "4400",
      paymentMethod: "ec",
      student: STUDENT,
      description: "Lehrmaterial Klasse B",
    });
    expect(created.bookings[0]).toMatchObject({ soll: "1800", haben: "4400" });
    expect(created.belegNr).toBe("T0000124A");
  });

  test("validation rejects bad input", () => {
    const base = {
      type: "zahlung_guthaben" as const,
      date: "2026-06-09",
      amountCents: 1000,
      geldkonto: "1600",
      paymentMethod: "bar" as const,
      student: STUDENT,
    };
    expect(() => createTransaction(db, { ...base, amountCents: 0 })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, amountCents: -100 })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, amountCents: 10.5 })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, date: "09.06.2026" })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, date: "2026-02-30" })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, geldkonto: "4400" })).toThrow(
      ValidationError,
    );
    expect(() => createTransaction(db, { ...base, geldkonto: "9999" })).toThrow(
      ValidationError,
    );
    expect(() =>
      createTransaction(db, { ...base, student: { ...STUDENT, name: " " } }),
    ).toThrow(ValidationError);
    expect(() =>
      createTransaction(db, {
        type: "transfer",
        date: "2026-06-09",
        amountCents: 1000,
        fromKonto: "1600",
        toKonto: "1600",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createTransaction(db, {
        type: "guthaben_uebertragung",
        date: "2026-06-09",
        amountCents: 1000,
        habenKonto: "1800", // Geldkonto is not a valid Erlöskonto
        student: STUDENT,
        description: "x",
      }),
    ).toThrow(ValidationError);
    // no transactions persisted by failed attempts
    expect(listLedger(db, {}).rows).toHaveLength(0);
  });

  test("inactive account is rejected", () => {
    setAccountActive(db, "4300", false);
    expect(() =>
      createTransaction(db, {
        type: "guthaben_uebertragung",
        date: "2026-06-09",
        amountCents: 1000,
        habenKonto: "4300",
        student: STUDENT,
        description: "x",
      }),
    ).toThrow(ValidationError);
  });
});

describe("numbering (GoBD)", () => {
  test("Beleg- and Buchungsnummern are gapless and monotonic", () => {
    const belege: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = createTransaction(db, {
        type: "zahlung_guthaben",
        date: "2026-06-09",
        amountCents: 1000 + i,
        geldkonto: "1600",
        paymentMethod: "bar",
        student: STUDENT,
      });
      belege.push(created.belegNr!);
    }
    expect(belege).toEqual(["T0000124A", "T0000125A", "T0000126A"]);
    const buchungen = listJournal(db, {})
      .map((row) => row.buchungNr)
      .sort();
    expect(buchungen).toEqual(["00000219A", "00000220A", "00000221A"]);
  });

  test("Guthabenübertragung consumes no Belegnummer", () => {
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-09",
      amountCents: 1000,
      habenKonto: "4400",
      student: STUDENT,
      description: "x",
    });
    const next = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 1000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    expect(next.belegNr).toBe("T0000124A");
  });

  test("Quittungsnummer is year-scoped, assigned once, stable", () => {
    const created = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 1000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    const first = getQuittung(db, created.id);
    expect(first.quittungNr).toBe("Q-2026-00001");
    const again = getQuittung(db, created.id);
    expect(again.quittungNr).toBe("Q-2026-00001");
    expect(again.issuedAt).toBe(first.issuedAt);

    const second = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 2000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    expect(getQuittung(db, second.id).quittungNr).toBe("Q-2026-00002");
  });

  test("non-printable transactions get no Quittung", () => {
    const transfer = createTransaction(db, {
      type: "transfer",
      date: "2026-06-09",
      amountCents: 1000,
      fromKonto: "1600",
      toKonto: "1800",
    });
    expect(() => getQuittung(db, transfer.id)).toThrow(ValidationError);
    const uebertragung = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-09",
      amountCents: 1000,
      habenKonto: "4400",
      student: STUDENT,
      description: "x",
    });
    expect(() => getQuittung(db, uebertragung.id)).toThrow(ValidationError);
  });
});

describe("storno", () => {
  test("creates mirrored reversal, marks original, blocks re-storno and print", () => {
    const created = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 40983,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    const storno = stornoTransaction(db, created.id, "Falscher Betrag", "2026-06-10");
    expect(storno.bookings[0]).toMatchObject({
      soll: "3272",
      haben: "1600",
      amountCents: 40983,
    });
    expect(storno.belegNr).toBe("T0000125A");

    const ledger = listLedger(db, {});
    const original = ledger.rows.find((row) => row.id === created.id)!;
    const reversal = ledger.rows.find((row) => row.id === storno.id)!;
    expect(original.storniert).toBe(true);
    expect(original.stornoReason).toBe("Falscher Betrag");
    expect(original.printable).toBe(false);
    expect(reversal.isStorno).toBe(true);
    expect(reversal.printable).toBe(false);

    expect(() => getQuittung(db, created.id)).toThrow(ValidationError);
    expect(() => stornoTransaction(db, created.id, "nochmal", "2026-06-10")).toThrow(
      ValidationError,
    );
    expect(() =>
      stornoTransaction(db, storno.id, "storno vom storno", "2026-06-10"),
    ).toThrow(ValidationError);
    // Net cash effect is zero again.
    expect(ledger.closingCents).toBe(ledger.openingCents);
  });

  test("requires a reason", () => {
    const created = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 1000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    expect(() => stornoTransaction(db, created.id, "  ", "2026-06-10")).toThrow(
      ValidationError,
    );
  });
});

describe("ledger", () => {
  test("opening/closing balances and date filtering", () => {
    // opening base: Kasse 3.484,57 + Bank 16.000,00 = 19.484,57
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-05",
      amountCents: 10000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 20000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-06-09",
      amountCents: 5000,
      geldkonto: "1800",
      aufwandKonto: "6815",
      description: "Druckerpapier",
    });
    // Transfer changes no total balance.
    createTransaction(db, {
      type: "transfer",
      date: "2026-06-09",
      amountCents: 7000,
      fromKonto: "1600",
      toKonto: "1800",
    });

    const all = listLedger(db, {});
    expect(all.openingCents).toBe(1948457);
    expect(all.closingCents).toBe(1948457 + 10000 + 20000 - 5000);

    const filtered = listLedger(db, { from: "2026-06-08", to: "2026-06-30" });
    expect(filtered.openingCents).toBe(1948457 + 10000);
    expect(filtered.closingCents).toBe(1948457 + 10000 + 20000 - 5000);
    expect(filtered.rows).toHaveLength(3);

    const search = listLedger(db, { q: "drucker" });
    expect(search.rows).toHaveLength(1);
    expect(search.rows[0]!.expenseCents).toBe(5000);
  });

  test("transfer shows neither income nor expense", () => {
    createTransaction(db, {
      type: "transfer",
      date: "2026-06-09",
      amountCents: 7000,
      fromKonto: "1600",
      toKonto: "1800",
    });
    const row = listLedger(db, {}).rows[0]!;
    expect(row.incomeCents).toBeNull();
    expect(row.expenseCents).toBeNull();
    expect(row.vatLabel).toBe("Nicht zutreffend");
  });
});

describe("seed", () => {
  test("seeds the demo transactions through the engine, idempotently", () => {
    seedTransactions(db);
    seedTransactions(db); // second call must be a no-op
    const ledger = listLedger(db, {});
    expect(ledger.rows).toHaveLength(11);
    // 4 Zahlungen: 409,83 + 409,83 + 450,00 + 409,83 = 1.679,49 cash in
    expect(ledger.closingCents - ledger.openingCents).toBe(167949);
    const journal = listJournal(db, {});
    // 9 single bookings + 2 transfers à 2 bookings = 13
    expect(journal).toHaveLength(13);
    // Every Fahrstunden consumption is 1718 an 8400.
    const fahrstunden = journal.filter((r) => r.description.includes("Fahrübungsstunde"));
    expect(fahrstunden.length).toBe(2);
    for (const row of fahrstunden) {
      expect(row.sollKonto).toBe("3272");
      expect(row.habenKonto).toBe("4400");
    }
    // TÜV fees are durchlaufende Posten.
    const tuev = journal.filter((r) => r.description.includes("TÜV"));
    for (const row of tuev) {
      expect(row.sollKonto).toBe("3272");
      expect(row.habenKonto).toBe("1370");
      expect(row.vatRate).toBeNull();
    }
    // All Zahlungen are printable.
    const zahlungen = ledger.rows.filter((r) => r.type === "zahlung_guthaben");
    expect(zahlungen.length).toBe(4);
    for (const row of zahlungen) expect(row.printable).toBe(true);
  });
});

describe("company settings", () => {
  test("defaults and round-trip", () => {
    expect(getCompany(db)).toEqual(DEMO_COMPANY);
    const updated = {
      ...DEMO_COMPANY,
      steuernummer: "012 345 67890",
      ustIdNr: "DE123456789",
    };
    setCompany(db, updated);
    expect(getCompany(db)).toEqual(updated);
  });
});

describe("listStudentBalances", () => {
  const STUDENT_A = {
    customerNo: "10051",
    name: "Aylin Demir",
    address: "Bleichstraße 9, 64283 Darmstadt",
    contractNo: "V-2026-0987",
    classes: "B197",
  };
  const STUDENT_B = {
    customerNo: "10052",
    name: "Jonas Keller",
    address: "Rheinstraße 1, 64283 Darmstadt",
    contractNo: "V-2026-0988",
    classes: "B",
  };

  test("deposit 500 € → +50000 for that student", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 50000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT_A,
    });
    const balances = listStudentBalances(db);
    const entry = balances.find((b) => b.customerNo === STUDENT_A.customerNo);
    expect(entry).toBeDefined();
    expect(entry!.balanceCents).toBe(50000);
  });

  test("deposit 500 € then 65 € lesson charge → +43500", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 50000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT_A,
    });
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: STUDENT_A,
      description: "Fahrübungsstunde (90)",
    });
    const balances = listStudentBalances(db);
    const entry = balances.find((b) => b.customerNo === STUDENT_A.customerNo);
    expect(entry!.balanceCents).toBe(43500);
  });

  test("storno of the charge restores the balance to +50000", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 50000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT_A,
    });
    const charge = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: STUDENT_A,
      description: "Fahrübungsstunde (90)",
    });
    stornoTransaction(db, charge.id, "Irrtümliche Buchung", "2026-06-10");
    const balances = listStudentBalances(db);
    const entry = balances.find((b) => b.customerNo === STUDENT_A.customerNo);
    expect(entry!.balanceCents).toBe(50000);
  });

  test("student with no transactions is absent from the list", () => {
    // Post a transaction for STUDENT_B only.
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 10000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT_B,
    });
    const balances = listStudentBalances(db);
    // STUDENT_A has no transactions in this fresh beforeEach db.
    const entryA = balances.find((b) => b.customerNo === STUDENT_A.customerNo);
    expect(entryA).toBeUndefined();
    // STUDENT_B is present.
    const entryB = balances.find((b) => b.customerNo === STUDENT_B.customerNo);
    expect(entryB!.balanceCents).toBe(10000);
  });
});

describe("Quittung payload", () => {
  test("contains every § 368 BGB / § 14 UStG element", () => {
    setCompany(db, {
      ...DEFAULT_COMPANY,
      steuernummer: "012 345 67890",
      ustIdNr: "DE123456789",
    });
    const created = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 40983,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    const quittung = getQuittung(db, created.id);
    expect(quittung.quittungNr).toBe("Q-2026-00001");
    expect(quittung.date).toBe("2026-06-09");
    expect(quittung.belegNr).toBe("T0000124A");
    expect(quittung.paymentMethod).toBe("bar");
    expect(quittung.issuer.name).toBe("Fahrschule Demo");
    expect(quittung.issuer.steuernummer).toBe("012 345 67890");
    expect(quittung.issuer.ustIdNr).toBe("DE123456789");
    expect(quittung.recipient).toEqual({
      name: "Aylin Demir",
      address: "Bleichstraße 9, 64283 Darmstadt",
    });
    expect(quittung.verwendungszweck).toBe(
      "Zahlung auf Ausbildungskonto, Vertrag V-2026-0987, Klasse B197",
    );
    expect(quittung.totalCents).toBe(40983);
    expect(quittung.lines[0]!.netCents + quittung.lines[0]!.vatCents).toBe(40983);
  });
});

describe("ledger customer filter", () => {
  test("customerNo matches the booking's student snapshot exactly", () => {
    const other = { ...STUDENT, customerNo: "10052", name: "Aylin Demir" };
    for (const student of [STUDENT, other]) {
      createTransaction(db, {
        type: "zahlung_guthaben",
        date: "2026-06-09",
        amountCents: 1000,
        geldkonto: "1600",
        paymentMethod: "bar",
        student,
      });
    }
    const rows = listLedger(db, { customerNo: STUDENT.customerNo }).rows;
    expect(rows).toHaveLength(1);
    // A name search cannot tell the namesakes apart.
    expect(listLedger(db, { q: "Aylin Demir" }).rows).toHaveLength(2);
  });
});
