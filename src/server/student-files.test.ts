/* ------------------------------------------------------------------ */
/* Student files: upload/list/download/delete routes, validation, the */
/* inline-document migration and file cleanup on archive purge.        */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { serve } from "bun";

import { listArchive, purgeArchived } from "./archive";
import { openDb } from "./db";
import { MemoryFileStore } from "./file-store";
import { archiveRoutes, studentRoutes } from "./routes";
import {
  contentDisposition,
  decodeDataUrl,
  fileRoutes,
  listStudentFiles,
  migrateInlineDocuments,
  MAX_STUDENT_FILE_BYTES,
  sanitizeFileName,
  sniffUploadType,
} from "./student-files";
import { createStudent, deleteStudent } from "./students";

const db = openDb(":memory:");
const store = new MemoryFileStore();
let server: ReturnType<typeof serve>;

beforeAll(() => {
  server = serve({
    port: 0,
    routes: {
      ...studentRoutes(db),
      ...archiveRoutes(db, store),
      ...fileRoutes(db, store),
    },
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => server.stop(true));

const url = (path: string) => new URL(path, server.url).href;

let seq = 0;
function newStudent(documents: unknown[] = []) {
  seq += 1;
  return createStudent(db, {
    firstName: "Datei",
    lastName: `Test${seq}`,
    contractNumber: `SF-V-${seq}-${Date.now()}`,
    customerNumber: `SF-K-${seq}-${Date.now()}`,
    documents: documents as string[],
  });
}

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(studentId: number, bytes: Uint8Array, name: string, type = "") {
  const body = new FormData();
  body.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return fetch(url(`/api/students/${studentId}/files`), { method: "POST", body });
}

/* ================================================================== */
/* Routes                                                               */
/* ================================================================== */

describe("Dokumentart", () => {
  test("is taken from the upload and can be changed later", async () => {
    const student = newStudent();
    const body = new FormData();
    body.append("file", new File([PDF as Uint8Array<ArrayBuffer>], "scan.pdf"));
    body.append("docType", "Sehtest");
    const res = await fetch(url(`/api/students/${student.id}/files`), {
      method: "POST",
      body,
    });
    const file = await res.json();
    expect(file.docType).toBe("Sehtest");

    const patched = await fetch(url(`/api/files/${file.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docType: " Erste-Hilfe-Nachweis " }),
    });
    expect((await patched.json()).docType).toBe("Erste-Hilfe-Nachweis");
    expect(listStudentFiles(db, student.id)[0]!.docType).toBe("Erste-Hilfe-Nachweis");
  });

  test("defaults to unclassified", async () => {
    const student = newStudent();
    const file = await (await upload(student.id, PNG, "bild.png")).json();
    expect(file.docType).toBe("");
  });
});

describe("POST /api/students/:id/files", () => {
  test("stores a PDF and lists it", async () => {
    const student = newStudent();
    const res = await upload(student.id, PDF, "Sehtest.pdf", "application/pdf");
    expect(res.status).toBe(201);
    const file = await res.json();
    expect(file).toMatchObject({
      studentId: student.id,
      name: "Sehtest.pdf",
      mimeType: "application/pdf",
      size: PDF.byteLength,
      url: `/api/files/${file.id}`,
    });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = await (await fetch(url(`/api/students/${student.id}/files`))).json();
    expect(list.files.map((f: { id: number }) => f.id)).toEqual([file.id]);
    expect(store.files.size).toBeGreaterThan(0);
  });

  test("sniffs the type — a wrong browser type does not matter", async () => {
    const student = newStudent();
    const res = await upload(student.id, PNG, "foto.png", "application/octet-stream");
    expect(res.status).toBe(201);
    expect((await res.json()).mimeType).toBe("image/png");
  });

  test("rejects disallowed content even with an allowed name", async () => {
    const student = newStudent();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await upload(student.id, html, "harmlos.pdf", "application/pdf");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Dateityp nicht erlaubt");
  });

  test("rejects files over 12 MB with 413", async () => {
    const student = newStudent();
    const big = new Uint8Array(MAX_STUDENT_FILE_BYTES + 1);
    big.set(PDF);
    const res = await upload(student.id, big, "gross.pdf", "application/pdf");
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("12 MB");
  });

  test("rejects empty files, missing field and unknown students", async () => {
    const student = newStudent();
    expect((await upload(student.id, new Uint8Array(0), "leer.pdf")).status).toBe(400);

    const noFile = await fetch(url(`/api/students/${student.id}/files`), {
      method: "POST",
      body: new FormData(),
    });
    expect(noFile.status).toBe(400);

    const unknown = await upload(999_999, PDF, "x.pdf");
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("nicht gefunden");
  });

  test("invalid student id → 400", async () => {
    expect((await fetch(url("/api/students/abc/files"))).status).toBe(400);
  });
});

describe("GET /api/files/:id", () => {
  test("serves bytes with type, inline disposition and nosniff", async () => {
    const student = newStudent();
    const file = await (
      await upload(student.id, PDF, "Führerschein (Kopie).pdf", "application/pdf")
    ).json();
    const res = await fetch(url(file.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const disposition = res.headers.get("content-disposition")!;
    expect(disposition).toStartWith("inline;");
    expect(disposition).toContain("filename*=UTF-8''F%C3%BChrerschein%20%28Kopie%29.pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  test("unknown id → 404", async () => {
    expect((await fetch(url("/api/files/987654"))).status).toBe(404);
  });

  test("legacy non-image/pdf types are forced to download", async () => {
    const student = newStudent();
    db.prepare("UPDATE students SET documents = ? WHERE id = ?").run(
      JSON.stringify([
        {
          kind: "upload",
          id: "legacy-html",
          name: "seite.html",
          mimeType: "text/html",
          size: 5,
          uploadedAt: "2025-01-01T00:00:00Z",
          dataUrl: "data:text/html;base64,PGI+eDwvYj4=",
        },
      ]),
      student.id,
    );
    await migrateInlineDocuments(db, store);
    const [file] = listStudentFiles(db, student.id);
    const res = await fetch(url(file!.url));
    expect(res.headers.get("content-disposition")).toStartWith("attachment;");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("DELETE /api/files/:id", () => {
  test("removes metadata and bytes", async () => {
    const student = newStudent();
    const file = await (await upload(student.id, PDF, "weg.pdf")).json();
    const before = store.files.size;
    const res = await fetch(url(file.url), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(store.files.size).toBe(before - 1);
    expect((await fetch(url(file.url))).status).toBe(404);
    expect(listStudentFiles(db, student.id)).toEqual([]);
  });
});

describe("students API — documents", () => {
  test("rejects new inline uploads with a pointer to the upload endpoint", async () => {
    const student = newStudent();
    const res = await fetch(url(`/api/students/${student.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [
          "Sehtest",
          { kind: "upload", id: "x", name: "a.pdf", dataUrl: "data:,x" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("/api/students/:id/files");
  });

  test("rejects non-string entries", async () => {
    const student = newStudent();
    const res = await fetch(url(`/api/students/${student.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [42] }),
    });
    expect(res.status).toBe(400);
  });

  test("checklist strings still save", async () => {
    const student = newStudent();
    const res = await fetch(url(`/api/students/${student.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: ["Personalausweis", "Sehtest"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).documents).toEqual(["Personalausweis", "Sehtest"]);
  });
});

/* ================================================================== */
/* Migration                                                            */
/* ================================================================== */

describe("migrateInlineDocuments", () => {
  const inline = (id: string, name: string, bytes: Uint8Array, mimeType: string) => ({
    kind: "upload",
    id,
    name,
    mimeType,
    size: bytes.byteLength,
    uploadedAt: "2026-01-15T10:30:00.000Z",
    dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  });

  test("moves inline uploads into the store and keeps checklist strings", async () => {
    const migrationDb = openDb(":memory:");
    const migrationStore = new MemoryFileStore();
    const student = createStudent(migrationDb, {
      firstName: "Alt",
      lastName: "Bestand",
      contractNumber: "MIG-V-1",
      customerNumber: "MIG-K-1",
    });
    migrationDb
      .prepare("UPDATE students SET documents = ? WHERE id = ?")
      .run(
        JSON.stringify([
          "Sehtest",
          inline("a-1", "Ausweis.pdf", PDF, "application/pdf"),
          "Passbild",
          inline("b/2", "Foto.png", PNG, "image/png"),
        ]),
        student.id,
      );

    expect(await migrateInlineDocuments(migrationDb, migrationStore)).toBe(2);

    const row = migrationDb
      .query<{ documents: string }, [number]>(
        "SELECT documents FROM students WHERE id = ?",
      )
      .get(student.id)!;
    expect(JSON.parse(row.documents)).toEqual(["Sehtest", "Passbild"]);

    const files = listStudentFiles(migrationDb, student.id);
    expect(files.map((f) => [f.name, f.mimeType, f.size, f.uploadedAt])).toEqual([
      ["Ausweis.pdf", "application/pdf", PDF.byteLength, "2026-01-15T10:30:00.000Z"],
      ["Foto.png", "image/png", PNG.byteLength, "2026-01-15T10:30:00.000Z"],
    ]);
    expect(migrationStore.files.size).toBe(2);
    const stored = [...migrationStore.files.values()].map((f) => f.bytes);
    expect(stored).toContainEqual(PDF);

    // Idempotent: a second run finds nothing and changes nothing.
    expect(await migrateInlineDocuments(migrationDb, migrationStore)).toBe(0);
    expect(listStudentFiles(migrationDb, student.id)).toHaveLength(2);
    expect(migrationStore.files.size).toBe(2);
  });

  test("an interrupted run (bytes stored, JSON not rewritten) does not duplicate", async () => {
    const migrationDb = openDb(":memory:");
    const migrationStore = new MemoryFileStore();
    const student = createStudent(migrationDb, {
      firstName: "Halb",
      lastName: "Fertig",
      contractNumber: "MIG-V-2",
      customerNumber: "MIG-K-2",
    });
    const documents = JSON.stringify([inline("c", "c.pdf", PDF, "application/pdf")]);
    const setDocs = () =>
      migrationDb
        .prepare("UPDATE students SET documents = ? WHERE id = ?")
        .run(documents, student.id);
    setDocs();
    await migrateInlineDocuments(migrationDb, migrationStore);
    setDocs(); // simulate the JSON rewrite having been lost
    expect(await migrateInlineDocuments(migrationDb, migrationStore)).toBe(0);
    expect(listStudentFiles(migrationDb, student.id)).toHaveLength(1);
    expect(migrationStore.files.size).toBe(1);
  });

  test("also migrates archived student snapshots", async () => {
    const migrationDb = openDb(":memory:");
    const migrationStore = new MemoryFileStore();
    const student = createStudent(migrationDb, {
      firstName: "Im",
      lastName: "Archiv",
      contractNumber: "MIG-V-3",
      customerNumber: "MIG-K-3",
    });
    migrationDb
      .prepare("UPDATE students SET documents = ? WHERE id = ?")
      .run(
        JSON.stringify(["Sehtest", inline("d", "d.pdf", PDF, "application/pdf")]),
        student.id,
      );
    deleteStudent(migrationDb, student.id);

    expect(await migrateInlineDocuments(migrationDb, migrationStore)).toBe(1);
    const payload = migrationDb
      .query<{ payload: string }, []>("SELECT payload FROM archive")
      .get()!.payload;
    expect(JSON.parse(JSON.parse(payload).row.documents)).toEqual(["Sehtest"]);
    expect(listStudentFiles(migrationDb, student.id)).toHaveLength(1);
  });
});

/* ================================================================== */
/* Archive purge                                                        */
/* ================================================================== */

describe("files and the Archiv", () => {
  test("archived students keep their files; purge deletes them for good", async () => {
    const student = newStudent();
    await upload(student.id, PDF, "bleibt.pdf");
    await upload(student.id, PNG, "bleibt.png");
    const keys = db
      .query<{ storage_key: string }, [number]>(
        "SELECT storage_key FROM student_files WHERE student_id = ?",
      )
      .all(student.id)
      .map((row) => row.storage_key);
    expect(keys).toHaveLength(2);

    expect(
      (await fetch(url(`/api/students/${student.id}`), { method: "DELETE" })).ok,
    ).toBe(true);
    expect(listStudentFiles(db, student.id)).toHaveLength(2);
    for (const key of keys) expect(store.files.has(key)).toBe(true);

    const entry = listArchive(db).find((item) => item.label.endsWith(student.lastName))!;
    const res = await fetch(url(`/api/archive/${entry.id}`), { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(listStudentFiles(db, student.id)).toEqual([]);
    for (const key of keys) expect(store.files.has(key)).toBe(false);
  });

  test("store failures during a purge are logged, not thrown", async () => {
    const student = newStudent();
    await upload(student.id, PDF, "x.pdf");
    deleteStudent(db, student.id);
    const entry = listArchive(db).find((item) => item.label.endsWith(student.lastName))!;
    const failing = new MemoryFileStore();
    failing.delete = async () => {
      throw new Error("offline");
    };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeArchived(db, entry.id, failing)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(listStudentFiles(db, student.id)).toEqual([]);
  });
});

/* ================================================================== */
/* Helpers                                                              */
/* ================================================================== */

describe("helpers", () => {
  test("sniffUploadType", () => {
    expect(sniffUploadType(PDF)).toBe("application/pdf");
    expect(sniffUploadType(PNG)).toBe("image/png");
    expect(sniffUploadType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffUploadType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(
      "image/webp",
    );
    expect(sniffUploadType(new TextEncoder().encode("\0\0\0\x18ftypheic"))).toBe(
      "image/heic",
    );
    expect(sniffUploadType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  test("sanitizeFileName strips paths and control characters", () => {
    expect(sanitizeFileName("C:\\Users\\x\\Ausweis.pdf")).toBe("Ausweis.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("")).toBe("Dokument");
  });

  test("contentDisposition encodes RFC 5987 and keeps an ASCII fallback", () => {
    expect(contentDisposition("attachment", 'Prüfung "1".pdf')).toBe(
      "attachment; filename=\"Pr_fung _1_.pdf\"; filename*=UTF-8''Pr%C3%BCfung%20%221%22.pdf",
    );
  });

  test("decodeDataUrl handles base64 and percent-encoding", () => {
    expect(
      new TextDecoder().decode(decodeDataUrl("data:text/plain;base64,aGk=")!.bytes),
    ).toBe("hi");
    expect(decodeDataUrl("data:,a%20b")!.mimeType).toBe("application/octet-stream");
    expect(decodeDataUrl("kein data url")).toBeNull();
  });
});
