import { describe, expect, test } from "bun:test";

import { decodeCsvBytes, detectDelimiter, parseCsv, stripBom, toCsv } from "./csv";

describe("parseCsv", () => {
  test("splits simple semicolon rows", () => {
    const { rows, delimiter } = parseCsv("Vorname;Nachname\nLena;Braun\n");
    expect(delimiter).toBe(";");
    expect(rows).toEqual([
      ["Vorname", "Nachname"],
      ["Lena", "Braun"],
    ]);
  });

  test("handles quoted fields with delimiters, escaped quotes and newlines", () => {
    const text = 'a;b;c\r\n"x;y";"sagt ""Hallo""";"Zeile 1\r\nZeile 2"\r\n';
    expect(parseCsv(text).rows).toEqual([
      ["a", "b", "c"],
      ["x;y", 'sagt "Hallo"', "Zeile 1\r\nZeile 2"],
    ]);
  });

  test("accepts CRLF, LF and lone CR line ends and keeps empty fields", () => {
    expect(parseCsv("a;b\r\n1;\n;2\r3;4", ";").rows).toEqual([
      ["a", "b"],
      ["1", ""],
      ["", "2"],
      ["3", "4"],
    ]);
  });

  test("drops blank lines and a missing trailing newline is fine", () => {
    expect(parseCsv("a,b\n\n1,2\n\n", ",").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("strips a UTF-8 BOM", () => {
    const { rows } = parseCsv("﻿Vorname;Nachname\nA;B");
    expect(rows[0]).toEqual(["Vorname", "Nachname"]);
  });

  test("empty input yields no rows", () => {
    expect(parseCsv("").rows).toEqual([]);
  });
});

describe("detectDelimiter", () => {
  test("detects semicolon, comma and tab", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  test("ignores delimiters inside quotes", () => {
    // Commas only inside the quoted address; the real separator is ';'.
    expect(detectDelimiter('Name;Adresse\nBraun;"Weg 1, 64297 Darmstadt"')).toBe(";");
  });

  test("German decimal commas do not win over semicolons", () => {
    expect(detectDelimiter("Name;Saldo;Klasse\nBraun;12,50;B\nRichter;3,00;A")).toBe(";");
  });

  test("falls back to semicolon for a single column", () => {
    expect(detectDelimiter("Name\nBraun")).toBe(";");
  });
});

describe("decodeCsvBytes", () => {
  test("decodes valid UTF-8", () => {
    const bytes = new TextEncoder().encode("Köhler;Straße");
    expect(decodeCsvBytes(bytes)).toEqual({ text: "Köhler;Straße", encoding: "UTF-8" });
  });

  test("falls back to Windows-1252 on invalid UTF-8", () => {
    // "Köhler;Straße" in Windows-1252: ö = 0xF6, ß = 0xDF
    const bytes = new Uint8Array([
      0x4b, 0xf6, 0x68, 0x6c, 0x65, 0x72, 0x3b, 0x53, 0x74, 0x72, 0x61, 0xdf, 0x65,
    ]);
    expect(decodeCsvBytes(bytes.buffer)).toEqual({
      text: "Köhler;Straße",
      encoding: "Windows-1252",
    });
  });

  test("strips the BOM after decoding", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    expect(decodeCsvBytes(bytes).text).toBe("A");
    expect(stripBom("﻿x")).toBe("x");
  });
});

describe("toCsv", () => {
  test("quotes only where needed and round-trips", () => {
    const rows = [
      ["Name", "Adresse"],
      ['Sa"m', "Weg 1; Hof\nHinterhaus"],
    ];
    const text = toCsv(rows);
    expect(text).toBe('Name;Adresse\r\n"Sa""m";"Weg 1; Hof\nHinterhaus"');
    expect(parseCsv(text).rows).toEqual(rows);
  });
});
