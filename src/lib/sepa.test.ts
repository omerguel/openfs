import { describe, expect, test } from "bun:test";

import {
  buildPain008,
  formatIban,
  isValidBic,
  isValidCreditorId,
  isValidIban,
  toSepaText,
} from "@/lib/sepa";

describe("IBAN / BIC / Gläubiger-ID", () => {
  test("valid German IBAN passes, a changed digit fails", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("DE8937040044053201300")).toBe(false); // too short
    expect(isValidIban("AT611904300234573201")).toBe(true);
  });

  test("formatIban groups by four", () => {
    expect(formatIban("de89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });

  test("BIC format", () => {
    expect(isValidBic("COBADEFFXXX")).toBe(true);
    expect(isValidBic("COBADEFF")).toBe(true);
    expect(isValidBic("COBA")).toBe(false);
  });

  test("Gläubiger-ID checksum ignores the business code", () => {
    expect(isValidCreditorId("DE98ZZZ09999999999")).toBe(true);
    expect(isValidCreditorId("DE98ABC09999999999")).toBe(true);
    expect(isValidCreditorId("DE97ZZZ09999999999")).toBe(false);
  });
});

describe("toSepaText", () => {
  test("transliterates umlauts and drops unsupported characters", () => {
    expect(toSepaText("Jürgen Müßig & Söhne <GmbH>", 70)).toBe(
      "Juergen Muessig Soehne GmbH",
    );
    expect(toSepaText("x".repeat(80), 70)).toHaveLength(70);
  });
});

describe("buildPain008", () => {
  const xml = buildPain008({
    msgId: "OPENFS-20260610-1",
    createdAt: "2026-06-10T09:30:00",
    collectionDate: "2026-06-15",
    creditor: {
      name: "Fahrschule Müller",
      iban: "DE89370400440532013000",
      creditorId: "DE98ZZZ09999999999",
    },
    transactions: [
      {
        endToEndId: "R-2026-00001",
        amountCents: 12345,
        mandateRef: "FS-10051-1",
        mandateSignedOn: "2026-01-02",
        debtorName: "Aylin Demir",
        debtorIban: "DE02120300000000202051",
        remittance: "Rechnung R-2026-00001",
        sequenceType: "FRST",
      },
      {
        endToEndId: "RATE-3-2",
        amountCents: 5000,
        mandateRef: "FS-10052-1",
        mandateSignedOn: "2026-01-02",
        debtorName: "Tom Richter",
        debtorIban: "DE02500105170137075030",
        debtorBic: "INGDDEFFXXX",
        remittance: "Rate 2/6",
        sequenceType: "RCUR",
      },
    ],
  });

  test("group header carries count and control sum over all transactions", () => {
    expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.008.001.02");
    expect(xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(xml).toContain("<CtrlSum>173.45</CtrlSum>");
  });

  test("one PmtInf per sequence type with CORE and the creditor id", () => {
    expect(xml.match(/<PmtInf>/g)).toHaveLength(2);
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
    expect(xml).toContain("<SeqTp>RCUR</SeqTp>");
    expect(xml).toContain("<Cd>CORE</Cd>");
    expect(xml).toContain("<Id>DE98ZZZ09999999999</Id>");
    expect(xml).toContain("<Nm>Fahrschule Mueller</Nm>");
  });

  test("missing BIC is sent as NOTPROVIDED, a given one as BIC", () => {
    expect(xml).toContain("<Othr><Id>NOTPROVIDED</Id></Othr>");
    expect(xml).toContain("<BIC>INGDDEFFXXX</BIC>");
    expect(xml).toContain('<InstdAmt Ccy="EUR">123.45</InstdAmt>');
  });
});
