import { describe, expect, test } from "bun:test";

import { buildDataExport, rowsToCsv } from "./data-export";
import { openDb } from "./db";
import { MemoryFileStore } from "./file-store";
import { ensureStudentFileTables } from "./student-files";
import { createZip, readZip } from "./zip";

describe("ZIP writer", () => {
  test("round-trips entries with UTF-8 names", () => {
    const zip = createZip([
      { name: "a.txt", data: new TextEncoder().encode("hallo") },
      { name: "dokumente/Müller.pdf", data: new Uint8Array([1, 2, 3]) },
    ]);
    // Local header and end-of-central-directory signatures.
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...zip.subarray(zip.length - 22, zip.length - 18)]).toEqual([
      0x50, 0x4b, 0x05, 0x06,
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dokumente/Müller.pdf"]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe("hallo");
  });
});

describe("Datenexport", () => {
  test("CSV cells with ; quotes or line breaks are quoted; BOM for Excel", () => {
    const csv = rowsToCsv([{ a: "x;y", b: 'sagt "hi"', c: null }]);
    expect(csv.startsWith("﻿a;b;c\r\n")).toBe(true);
    expect(csv).toContain('"x;y";"sagt ""hi""";');
    // Formula injection is neutralised, negative numbers stay numbers.
    expect(rowsToCsv([{ a: "=HYPERLINK(1)", b: -12 }])).toContain("'=HYPERLINK(1);-12");
  });

  test("contains the key tables, a LIESMICH and the uploaded documents", async () => {
    const db = openDb(":memory:");
    const store = new MemoryFileStore();
    ensureStudentFileTables(db);
    const student = db
      .query<{ id: number; last_name: string }, []>(
        "SELECT id, last_name FROM students ORDER BY id LIMIT 1",
      )
      .get()!;
    await store.put("students/1/abc", new Uint8Array([9, 9]), "application/pdf");
    db.prepare(
      `INSERT INTO student_files (student_id, name, mime_type, size, sha256, storage_key, uploaded_at)
       VALUES (?, 'Sehtest.pdf', 'application/pdf', 2, 'x', 'students/1/abc', datetime('now'))`,
    ).run(student.id);

    const entries = readZip(await buildDataExport(db, store));
    const names = entries.map((e) => e.name);
    for (const file of [
      "LIESMICH.txt",
      "schueler.csv",
      "rechnungen.csv",
      "buchungen.csv",
      "termine.csv",
      "dokumente.csv",
    ]) {
      expect(names).toContain(file);
    }
    const doc = entries.find((e) => e.name.endsWith("Sehtest.pdf"));
    expect(doc?.name.startsWith(`dokumente/${student.id}-`)).toBe(true);
    expect([...doc!.data]).toEqual([9, 9]);
    const students = new TextDecoder().decode(
      entries.find((e) => e.name === "schueler.csv")!.data,
    );
    expect(students).toContain(student.last_name);
  });
});
