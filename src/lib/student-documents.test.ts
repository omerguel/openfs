/* ------------------------------------------------------------------ */
/* Unit tests for src/lib/student-documents.ts — pure helper functions */
/* No DB, no side effects. Pattern: src/lib/money.test.ts              */
/* ------------------------------------------------------------------ */

import { describe, expect, test } from "bun:test";
import {
  formatStudentDocumentSize,
  formatStudentDocumentUploadedAt,
  getStudentFileMeta,
  buildChecklist,
  hasStudentDocumentNamed,
  toggleChecklistEntry,
  MAX_STUDENT_DOCUMENT_BYTES,
  validateStudentFile,
} from "./student-documents";

describe("hasStudentDocumentNamed", () => {
  test("matches case- and whitespace-insensitively", () => {
    expect(hasStudentDocumentNamed(["Sehtest", "Passbild"], "  sehtest ")).toBe(true);
  });

  test("no match → false", () => {
    expect(hasStudentDocumentNamed(["Sehtest"], "Passbild")).toBe(false);
  });
});

describe("validateStudentFile", () => {
  test("allowed extension within the limit → null", () => {
    expect(validateStudentFile({ name: "Ausweis.PDF", size: 1000 })).toBeNull();
    expect(validateStudentFile({ name: "foto.heic", size: 1000 })).toBeNull();
  });

  test("too large → error mentions 12 MB", () => {
    expect(
      validateStudentFile({ name: "a.pdf", size: MAX_STUDENT_DOCUMENT_BYTES + 1 }),
    ).toContain("12 MB");
  });

  test("disallowed type → error", () => {
    expect(validateStudentFile({ name: "vertrag.docx", size: 10 })).toContain("nur PDF");
    expect(validateStudentFile({ name: "ohne-endung", size: 10 })).not.toBeNull();
  });
});

describe("getStudentFileMeta", () => {
  test("size and upload time joined by a middle dot", () => {
    const meta = getStudentFileMeta({ size: 2048, uploadedAt: "2026-01-15T10:30:00Z" });
    expect(meta).toStartWith("2 KB · ");
    expect(meta).toContain("2026");
  });
});

/* ================================================================== */
/* formatStudentDocumentSize                                            */
/* ================================================================== */

describe("formatStudentDocumentSize", () => {
  test("0 bytes → '0 KB'", () => {
    expect(formatStudentDocumentSize(0)).toBe("0 KB");
  });

  test("negative number → '0 KB'", () => {
    expect(formatStudentDocumentSize(-500)).toBe("0 KB");
  });

  test("Infinity → '0 KB'", () => {
    expect(formatStudentDocumentSize(Infinity)).toBe("0 KB");
  });

  test("512 bytes → '1 KB' (ceiled)", () => {
    // Math.ceil(512/1024) = 1
    expect(formatStudentDocumentSize(512)).toBe("1 KB");
  });

  test("1024 bytes (1 KB exact) → '1 KB'", () => {
    expect(formatStudentDocumentSize(1024)).toBe("1 KB");
  });

  test("1048576 bytes (1 MB) → contains 'MB'", () => {
    const result = formatStudentDocumentSize(1048576);
    expect(result).toContain("MB");
    expect(result).toContain("1");
  });

  test("2621440 bytes (2.5 MB) → contains 'MB' and '2'", () => {
    const result = formatStudentDocumentSize(2.5 * 1024 * 1024);
    expect(result).toContain("MB");
    expect(result).toContain("2");
  });

  test("below 1 MB → result ends with 'KB'", () => {
    expect(formatStudentDocumentSize(500000)).toMatch(/KB$/);
  });
});

/* ================================================================== */
/* formatStudentDocumentUploadedAt                                      */
/* ================================================================== */

describe("formatStudentDocumentUploadedAt", () => {
  test("valid ISO string → does not return the fallback message", () => {
    const result = formatStudentDocumentUploadedAt("2026-01-15T10:30:00.000Z");
    expect(result).not.toBe("Uploadzeit unbekannt");
    // Should be a non-empty string with some date-like content
    expect(result.length).toBeGreaterThan(0);
  });

  test("'not a date' → 'Uploadzeit unbekannt'", () => {
    expect(formatStudentDocumentUploadedAt("not a date")).toBe("Uploadzeit unbekannt");
  });

  test("empty string → 'Uploadzeit unbekannt'", () => {
    expect(formatStudentDocumentUploadedAt("")).toBe("Uploadzeit unbekannt");
  });

  test("valid date '2025-06-01T00:00:00Z' → formatted string contains year", () => {
    const result = formatStudentDocumentUploadedAt("2025-06-01T00:00:00Z");
    expect(result).toContain("2025");
  });
});

describe("checklist", () => {
  test("default entries are listed open until handed in; custom ones follow", () => {
    const list = buildChecklist(["sehtest", "Führungszeugnis"], ["Arztattest"]);
    expect(list.find((e) => e.name === "Sehtest")).toMatchObject({ done: true });
    expect(list.find((e) => e.name === "Passbild")).toMatchObject({ done: false });
    expect(list.slice(-2)).toEqual([
      { name: "Führungszeugnis", done: true, custom: true },
      { name: "Arztattest", done: false, custom: true },
    ]);
  });

  test("ticking moves an entry to handed in, unticking back to open", () => {
    const done = toggleChecklistEntry([], ["Arztattest"], "Arztattest", true);
    expect(done).toEqual({ documents: ["Arztattest"], openDocuments: [] });
    expect(toggleChecklistEntry(done.documents, [], "Arztattest", false)).toEqual({
      documents: [],
      openDocuments: ["Arztattest"],
    });
    // Default entries need no open marker.
    expect(toggleChecklistEntry(["Passbild"], [], "Passbild", false)).toEqual({
      documents: [],
      openDocuments: [],
    });
  });
});
