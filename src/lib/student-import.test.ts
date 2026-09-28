import { describe, expect, test } from "bun:test";

import {
  autoMapHeaders,
  composeAddress,
  mapImportRow,
  normalizeClasses,
  normalizeDate,
  normalizeHeader,
  normalizeStatus,
  parseImportMapping,
  studentImportTemplate,
  type ImportMapping,
} from "./student-import";

const NOW = new Date(2026, 8, 28); // 28.09.2026

describe("normalizeHeader", () => {
  test("lower-cases, transliterates umlauts and drops punctuation", () => {
    expect(normalizeHeader("Geb.-Datum")).toBe("gebdatum");
    expect(normalizeHeader("E-Mail")).toBe("email");
    expect(normalizeHeader("Führerschein­klasse")).toBe("fuehrerscheinklasse");
    expect(normalizeHeader(" Straße ")).toBe("strasse");
  });
});

describe("autoMapHeaders", () => {
  test("maps German export headers", () => {
    const headers = [
      "Kd.-Nr.",
      "Name",
      "Vorname",
      "Geb.-Datum",
      "Straße",
      "PLZ",
      "Ort",
      "Handy",
      "E-Mail",
      "Führerscheinklasse",
      "Fahrlehrer/in",
      "Fahrzeug",
      "Anmeldedatum",
      "Vertragsnummer",
      "Status",
      "Bemerkung",
    ];
    expect(autoMapHeaders(headers)).toEqual({
      0: "customerNumber",
      1: "lastName",
      2: "firstName",
      3: "birthday",
      4: "street",
      5: "postalCode",
      6: "city",
      7: "phone",
      8: "email",
      9: "classes",
      10: "instructor",
      11: "vehicle",
      12: "registrationDate",
      13: "contractNumber",
      14: "status",
    });
  });

  test("maps English headers", () => {
    expect(
      autoMapHeaders(["First name", "Last name", "Date of birth", "Mobile", "Email"]),
    ).toEqual({
      0: "firstName",
      1: "lastName",
      2: "birthday",
      3: "phone",
      4: "email",
    });
  });

  test("prefix matches and assigns each field once", () => {
    expect(
      autoMapHeaders(["Telefon (mobil)", "Telefon privat", "Vertragsbeginn"]),
    ).toEqual({ 0: "phone", 2: "registrationDate" });
  });

  test("the template maps completely", () => {
    const [header] = studentImportTemplate();
    const mapping = autoMapHeaders(header!);
    expect(Object.keys(mapping)).toHaveLength(header!.length);
  });
});

describe("parseImportMapping", () => {
  test("accepts string keys and skips empty entries", () => {
    expect(parseImportMapping({ "0": "firstName", "1": null, "2": "" })).toEqual({
      0: "firstName",
    });
  });

  test("rejects unknown fields, bad columns and duplicate fields", () => {
    expect(() => parseImportMapping({ "0": "iban" })).toThrow("Unbekanntes Feld");
    expect(() => parseImportMapping({ x: "firstName" })).toThrow("Ungültige Spalte");
    expect(() => parseImportMapping({ "0": "firstName", "1": "firstName" })).toThrow(
      "mehreren Spalten",
    );
    expect(() => parseImportMapping(null)).toThrow("Spaltenzuordnung fehlt");
  });
});

describe("normalizeDate", () => {
  test("keeps and pads German dates", () => {
    expect(normalizeDate("11.08.1999", NOW)).toBe("11.08.1999");
    expect(normalizeDate("1.8.1999", NOW)).toBe("01.08.1999");
    expect(normalizeDate("01/08/1999", NOW)).toBe("01.08.1999");
    expect(normalizeDate("01.08.1999 00:00", NOW)).toBe("01.08.1999");
  });

  test("converts ISO dates", () => {
    expect(normalizeDate("1999-08-11", NOW)).toBe("11.08.1999");
    expect(normalizeDate("2026-05-12T00:00:00", NOW)).toBe("12.05.2026");
  });

  test("pivots two-digit years on the current year", () => {
    expect(normalizeDate("11.08.99", NOW)).toBe("11.08.1999");
    expect(normalizeDate("12.05.26", NOW)).toBe("12.05.2026");
    expect(normalizeDate("12.05.27", NOW)).toBe("12.05.1927");
  });

  test("empty → empty, nonsense → null", () => {
    expect(normalizeDate("  ", NOW)).toBe("");
    expect(normalizeDate("31.02.2000", NOW)).toBeNull();
    expect(normalizeDate("13.13.2000", NOW)).toBeNull();
    expect(normalizeDate("gestern", NOW)).toBeNull();
    expect(normalizeDate("29.02.2024", NOW)).toBe("29.02.2024");
  });
});

describe("value helpers", () => {
  test("normalizeClasses", () => {
    expect(normalizeClasses("b, be")).toBe("B, BE");
    expect(normalizeClasses("B/BE;A1")).toBe("B, BE, A1");
    expect(normalizeClasses("B197")).toBe("B197");
    expect(normalizeClasses("")).toBe("");
  });

  test("normalizeStatus", () => {
    expect(normalizeStatus("")).toBe("aktiv");
    expect(normalizeStatus("Aktiv")).toBe("aktiv");
    expect(normalizeStatus("inactive")).toBe("inaktiv");
    expect(normalizeStatus("Abgeschlossen")).toBe("inaktiv");
    expect(normalizeStatus("vielleicht")).toBeNull();
  });

  test("composeAddress", () => {
    expect(
      composeAddress({
        street: "Weidingweg",
        houseNumber: "31",
        postalCode: "64297",
        city: "Darmstadt",
      }),
    ).toBe("Weidingweg 31, 64297 Darmstadt");
    expect(
      composeAddress({ street: "", houseNumber: "", postalCode: "", city: "Darmstadt" }),
    ).toBe("Darmstadt");
  });
});

describe("mapImportRow", () => {
  const mapping: ImportMapping = {
    0: "firstName",
    1: "lastName",
    2: "birthday",
    3: "street",
    4: "postalCode",
    5: "city",
    6: "classes",
    7: "email",
    8: "status",
    9: "registrationDate",
    10: "instructor",
  };

  test("normalises a complete row", () => {
    const { draft, errors, warnings } = mapImportRow(
      [
        " Lena ",
        "Braun",
        "1999-08-11",
        "Weidingweg 31",
        "64297",
        "Darmstadt",
        "b",
        "lena@example.com",
        "inaktiv",
        "12.05.26",
        "Nadine Aksoy",
      ],
      mapping,
      NOW,
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      firstName: "Lena",
      lastName: "Braun",
      birthday: "11.08.1999",
      address: "Weidingweg 31, 64297 Darmstadt",
      classes: "B",
      status: "inaktiv",
      registrationDate: "12.05.2026",
      instructor: "Nadine Aksoy",
      customerNumber: "",
    });
  });

  test("reports missing names and bad dates in German", () => {
    const { errors } = mapImportRow(["", "", "31.02.2000"], mapping, NOW);
    expect(errors).toEqual([
      "Vorname fehlt.",
      "Nachname fehlt.",
      "Geburtsdatum „31.02.2000“ ist kein gültiges Datum (erwartet TT.MM.JJJJ).",
    ]);
  });

  test("rejects birthdays in the future", () => {
    const { errors } = mapImportRow(["A", "B", "01.01.2030"], mapping, NOW);
    expect(errors).toEqual(["Geburtsdatum liegt in der Zukunft."]);
  });

  test("warns about odd e-mail, unknown status and missing class", () => {
    const { draft, errors, warnings } = mapImportRow(
      ["A", "B", "", "", "", "", "", "kaputt", "vielleicht"],
      mapping,
      NOW,
    );
    expect(errors).toEqual([]);
    expect(draft.status).toBe("aktiv");
    expect(warnings).toEqual([
      "E-Mail „kaputt“ sieht ungültig aus.",
      "Status „vielleicht“ unbekannt – wird als aktiv importiert.",
      "Keine Führerscheinklasse angegeben.",
    ]);
  });

  test("a full address column wins over split parts; short rows are fine", () => {
    const { draft } = mapImportRow(["A", "B", "", "Weg 1"], {
      ...mapping,
      11: "address",
    });
    expect(draft.address).toBe("Weg 1");
    const withFull = mapImportRow(
      ["A", "B", "", "", "", "", "", "", "", "", "", "Hauptstr. 1, 12345 Ort"],
      { ...mapping, 11: "address" },
    );
    expect(withFull.draft.address).toBe("Hauptstr. 1, 12345 Ort");
  });
});
