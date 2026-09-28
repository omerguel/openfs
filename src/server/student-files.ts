/* ------------------------------------------------------------------ */
/* Student files (Dokumente-Uploads).                                  */
/*                                                                     */
/* Metadata lives in student_files, the bytes in a FileStore           */
/* (file-store.ts). There is deliberately no FK to students: deleting  */
/* a student archives it, and its files must survive until the         */
/* archive entry is purged for good (archive.ts → purgeArchived).      */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";
import type { Database } from "./sqlite";

import { ValidationError } from "./engine";
import type { FileStore } from "./file-store";
import { err, handle, json } from "./http";

export const MAX_STUDENT_FILE_BYTES = 12 * 1024 * 1024;

/* Accepted upload types. The real type is sniffed from the first bytes —
   the browser-reported type is only a hint (and often empty for HEIC). */
export const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
] as const;

/* Types the browser may render in place; everything else is served as an
   attachment (legacy uploads may be Office files, SVG, HTML …). */
const INLINE_TYPES = new Set<string>(ALLOWED_UPLOAD_TYPES);

export type StudentFile = {
  id: number;
  studentId: number;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  url: string;
};

type StudentFileRow = {
  id: number;
  student_id: number;
  name: string;
  mime_type: string;
  size: number;
  sha256: string;
  storage_key: string;
  uploaded_at: string;
};

export function ensureStudentFileTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      uploaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_student_files_student
      ON student_files(student_id);
  `);
}

const toFile = (row: StudentFileRow): StudentFile => ({
  id: row.id,
  studentId: row.student_id,
  name: row.name,
  mimeType: row.mime_type,
  size: row.size,
  sha256: row.sha256,
  uploadedAt: row.uploaded_at,
  url: `/api/files/${row.id}`,
});

const COLUMNS = "id, student_id, name, mime_type, size, sha256, storage_key, uploaded_at";

export function listStudentFiles(db: Database, studentId: number): StudentFile[] {
  return db
    .query<StudentFileRow, [number]>(
      `SELECT ${COLUMNS} FROM student_files WHERE student_id = ? ORDER BY uploaded_at, id`,
    )
    .all(studentId)
    .map(toFile);
}

function getFileRow(db: Database, id: number): StudentFileRow {
  const row = db
    .query<StudentFileRow, [number]>(`SELECT ${COLUMNS} FROM student_files WHERE id = ?`)
    .get(id);
  if (!row) throw new ValidationError("Datei nicht gefunden.");
  return row;
}

function assertStudentExists(db: Database, studentId: number): void {
  const found = db.query("SELECT 1 FROM students WHERE id = ?").get(studentId);
  if (!found) throw new ValidationError("Fahrschüler/in nicht gefunden.");
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Detects the upload types from their magic bytes; null = not allowed. */
export function sniffUploadType(
  bytes: Uint8Array,
): (typeof ALLOWED_UPLOAD_TYPES)[number] | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (
    bytes[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (
      ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)
    ) {
      return "image/heic";
    }
  }
  return null;
}

/** Strips directories and control characters from a client file name. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 200) || "Dokument";
}

function newStorageKey(studentId: number): string {
  return `students/${studentId}/${crypto.randomUUID()}`;
}

export async function uploadStudentFile(
  db: Database,
  store: FileStore,
  studentId: number,
  upload: { name: string; bytes: Uint8Array },
): Promise<StudentFile> {
  assertStudentExists(db, studentId);
  if (upload.bytes.byteLength === 0) {
    throw new ValidationError("Die Datei ist leer.");
  }
  if (upload.bytes.byteLength > MAX_STUDENT_FILE_BYTES) {
    throw new ValidationError("Die Datei ist größer als 12 MB.");
  }
  const mimeType = sniffUploadType(upload.bytes);
  if (!mimeType) {
    throw new ValidationError(
      "Dateityp nicht erlaubt. Erlaubt sind PDF, PNG, JPEG, WebP und HEIC.",
    );
  }
  const key = newStorageKey(studentId);
  await store.put(key, upload.bytes, mimeType);
  try {
    const row = db
      .query<{ id: number }, [number, string, string, number, string, string, string]>(
        `INSERT INTO student_files
           (student_id, name, mime_type, size, sha256, storage_key, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        studentId,
        sanitizeFileName(upload.name),
        mimeType,
        upload.bytes.byteLength,
        sha256Hex(upload.bytes),
        key,
        new Date().toISOString(),
      )!;
    return toFile(getFileRow(db, row.id));
  } catch (error) {
    await store.delete(key).catch(() => {});
    throw error;
  }
}

export async function readStudentFile(
  db: Database,
  store: FileStore,
  id: number,
): Promise<{ file: StudentFile; bytes: Uint8Array }> {
  const row = getFileRow(db, id);
  const bytes = await store.get(row.storage_key);
  if (!bytes) throw new ValidationError("Dateiinhalt nicht gefunden.");
  return { file: toFile(row), bytes };
}

export async function deleteStudentFile(
  db: Database,
  store: FileStore,
  id: number,
): Promise<void> {
  const row = getFileRow(db, id);
  db.prepare("DELETE FROM student_files WHERE id = ?").run(id);
  await store.delete(row.storage_key).catch((error) => {
    console.error(`Datei ${row.storage_key} konnte nicht gelöscht werden:`, error);
  });
}

/** Removes the metadata rows of a student's files and returns their
 *  storage keys — the caller deletes the bytes after its transaction. */
export function removeStudentFileRows(db: Database, studentId: number): string[] {
  const keys = db
    .query<{ storage_key: string }, [number]>(
      "SELECT storage_key FROM student_files WHERE student_id = ?",
    )
    .all(studentId)
    .map((row) => row.storage_key);
  db.prepare("DELETE FROM student_files WHERE student_id = ?").run(studentId);
  return keys;
}

/** Best effort: a failing delete is logged, never thrown. */
export async function deleteStoredFiles(store: FileStore, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      store.delete(key).catch((error) => {
        console.error(`Datei ${key} konnte nicht gelöscht werden:`, error);
      }),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Migration: inline uploads in students.documents → FileStore          */
/* ------------------------------------------------------------------ */

type InlineUpload = {
  kind: "upload";
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  uploadedAt?: unknown;
  dataUrl?: unknown;
};

const isInlineUpload = (entry: unknown): entry is InlineUpload =>
  typeof entry === "object" &&
  entry !== null &&
  (entry as { kind?: unknown }).kind === "upload";

/** Decodes a data: URL (base64 or percent-encoded); null if malformed. */
export function decodeDataUrl(
  dataUrl: string,
): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^,]*?),(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const meta = match[1]!.split(";");
  const mimeType = meta[0]?.trim() || "application/octet-stream";
  try {
    if (meta.includes("base64")) {
      return { mimeType, bytes: Uint8Array.from(Buffer.from(match[2]!, "base64")) };
    }
    return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(match[2]!)) };
  } catch {
    return null;
  }
}

type NewFileRow = Omit<StudentFileRow, "id">;

/* Writes the inline uploads of one documents list to the store; returns
   the checklist strings that stay in the JSON plus the metadata rows. */
async function extractInlineUploads(
  store: FileStore,
  studentId: number,
  documents: unknown[],
): Promise<{ checklist: string[]; files: NewFileRow[] }> {
  const files: NewFileRow[] = [];
  for (const entry of documents.filter(isInlineUpload)) {
    const decoded =
      typeof entry.dataUrl === "string" ? decodeDataUrl(entry.dataUrl) : null;
    if (!decoded) {
      console.warn(
        `Fahrschüler ${studentId}: unlesbares Dokument „${String(entry.name)}" verworfen.`,
      );
      continue;
    }
    const sha256 = sha256Hex(decoded.bytes);
    const legacyId = String(entry.id ?? "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    const key = `students/${studentId}/legacy-${legacyId || "x"}-${sha256.slice(0, 16)}`;
    const mimeType =
      typeof entry.mimeType === "string" && entry.mimeType.trim()
        ? entry.mimeType.trim()
        : decoded.mimeType;
    await store.put(key, decoded.bytes, mimeType);
    files.push({
      student_id: studentId,
      name: sanitizeFileName(typeof entry.name === "string" ? entry.name : ""),
      mime_type: mimeType,
      size: decoded.bytes.byteLength,
      sha256,
      storage_key: key,
      uploaded_at:
        typeof entry.uploadedAt === "string" && entry.uploadedAt
          ? entry.uploadedAt
          : new Date().toISOString(),
    });
  }
  const checklist = documents.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return { checklist, files };
}

function parseDocuments(raw: unknown): unknown[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some(isInlineUpload) ? parsed : null;
  } catch {
    return null;
  }
}

/** Moves every `{kind:"upload", dataUrl}` entry of students.documents —
 *  and of archived student snapshots, so a restore cannot bring them
 *  back — into the store + student_files, leaving only the checklist
 *  strings in the JSON. Idempotent: storage keys derive from the legacy
 *  entry, so a run interrupted between the store write and the DB
 *  rewrite repeats the same writes. Returns the number of files moved. */
export async function migrateInlineDocuments(
  db: Database,
  store: FileStore,
): Promise<number> {
  ensureStudentFileTables(db);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO student_files
       (student_id, name, mime_type, size, sha256, storage_key, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let moved = 0;
  const insertAll = (files: NewFileRow[]) => {
    for (const file of files) {
      moved += insert.run(
        file.student_id,
        file.name,
        file.mime_type,
        file.size,
        file.sha256,
        file.storage_key,
        file.uploaded_at,
      ).changes;
    }
  };

  const students = db
    .query<{ id: number; documents: string }, []>(
      `SELECT id, documents FROM students WHERE documents LIKE '%"upload"%'`,
    )
    .all();
  for (const row of students) {
    const documents = parseDocuments(row.documents);
    if (!documents) continue;
    const { checklist, files } = await extractInlineUploads(store, row.id, documents);
    db.transaction(() => {
      insertAll(files);
      db.prepare("UPDATE students SET documents = ? WHERE id = ?").run(
        JSON.stringify(checklist),
        row.id,
      );
    })();
  }

  const archived = db
    .query<{ id: number; payload: string }, []>(
      `SELECT id, payload FROM archive
       WHERE entity = 'student' AND payload LIKE '%upload%'`,
    )
    .all();
  for (const entry of archived) {
    let payload: { row?: Record<string, unknown> } & Record<string, unknown>;
    try {
      payload = JSON.parse(entry.payload);
    } catch {
      continue;
    }
    // Early snapshots stored the bare row without the { row, links } wrapper.
    const snapshot =
      payload.row && typeof payload.row === "object" ? payload.row : payload;
    const studentId = Number(snapshot.id);
    const documents = parseDocuments(snapshot.documents);
    if (!documents || !Number.isInteger(studentId)) continue;
    const { checklist, files } = await extractInlineUploads(store, studentId, documents);
    snapshot.documents = JSON.stringify(checklist);
    db.transaction(() => {
      insertAll(files);
      db.prepare("UPDATE archive SET payload = ? WHERE id = ?").run(
        JSON.stringify(payload),
        entry.id,
      );
    })();
  }
  return moved;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */

/** RFC 6266/5987 header value: ASCII fallback plus the UTF-8 name. */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function parseId(raw: string, message: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(message);
  return id;
}

export function fileRoutes(db: Database, store: FileStore) {
  ensureStudentFileTables(db);

  return {
    "/api/students/:id/files": {
      GET: (req: BunRequest<"/api/students/:id/files">) =>
        handle(() => {
          const studentId = parseId(req.params.id, "Ungültige Fahrschüler-ID.");
          return json({ files: listStudentFiles(db, studentId) });
        })(),
      POST: (req: BunRequest<"/api/students/:id/files">) =>
        handle(async () => {
          const studentId = parseId(req.params.id, "Ungültige Fahrschüler-ID.");
          // Reject oversized bodies before buffering them (multipart
          // overhead is small; 64 KB headroom).
          const length = Number(req.headers.get("content-length") ?? 0);
          if (length > MAX_STUDENT_FILE_BYTES + 64 * 1024) {
            return err("Die Datei ist größer als 12 MB.", 413);
          }
          const form = await req.formData().catch(() => null);
          const file = form?.get("file");
          if (!file || typeof file === "string") {
            throw new ValidationError(
              "Bitte eine Datei im Feld 'file' senden (multipart/form-data).",
            );
          }
          if (file.size > MAX_STUDENT_FILE_BYTES) {
            return err("Die Datei ist größer als 12 MB.", 413);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          return json(
            await uploadStudentFile(db, store, studentId, { name: file.name, bytes }),
            201,
          );
        })(),
    },

    "/api/files/:id": {
      GET: (req: BunRequest<"/api/files/:id">) =>
        handle(async () => {
          const id = parseId(req.params.id, "Ungültige Datei-ID.");
          let result: Awaited<ReturnType<typeof readStudentFile>>;
          try {
            result = await readStudentFile(db, store, id);
          } catch (error) {
            if (error instanceof ValidationError) return err(error.message, 404);
            throw error;
          }
          const { file, bytes } = result;
          const inline = INLINE_TYPES.has(file.mimeType);
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": file.mimeType || "application/octet-stream",
              "Content-Length": String(bytes.byteLength),
              "Content-Disposition": contentDisposition(
                inline ? "inline" : "attachment",
                file.name,
              ),
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=300",
            },
          });
        })(),
      DELETE: (req: BunRequest<"/api/files/:id">) =>
        handle(async () => {
          await deleteStudentFile(
            db,
            store,
            parseId(req.params.id, "Ungültige Datei-ID."),
          );
          return json({ ok: true });
        })(),
    },
  };
}
