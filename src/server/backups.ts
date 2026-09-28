/* ------------------------------------------------------------------ */
/* Datensicherung — scheduled backup sets (database + documents).      */
/*                                                                     */
/* A backup set is a directory BACKUP_DIR/openfs-YYYY-MM-DD-HHMMSS/:   */
/*                                                                     */
/*   manifest.json   what is in the set: time, app version/commit,     */
/*                   school (multi-tenant), database checksum, every   */
/*                   document with size + SHA-256                      */
/*   database.db     consistent copy via `VACUUM INTO` (safe while the */
/*                   server keeps writing), PRAGMA integrity_check'ed  */
/*   files/<key>     the uploaded documents the copy references        */
/*                   (student_files.storage_key), whatever the store   */
/*                   (disk or S3)                                      */
/*                                                                     */
/* Documents are immutable (every upload gets a new key), so a         */
/* document that the previous set already holds with the same SHA-256  */
/* is hard-linked from there instead of copied (like rsync             */
/* --link-dest): every set is complete on its own, yet unchanged       */
/* documents take disk space once. Deleting an old set (retention)     */
/* only drops its links. Hard links fail across file systems — then    */
/* the file is copied.                                                  */
/*                                                                     */
/* When S3 is configured, database.db and manifest.json also go to     */
/* <S3_PREFIX>backups/<name>.db / <name>.manifest.json. The documents  */
/* themselves already live in that bucket: protect them with bucket    */
/* versioning (see docs/operations.md).                                */
/*                                                                     */
/* Older versions wrote a bare openfs-…db file per backup ("legacy");  */
/* those are still listed, downloadable, restorable and pruned.        */
/* ------------------------------------------------------------------ */

import { copyFile, link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import {
  assertValidKey,
  createS3Client,
  type FileStore,
  s3ConfigFromEnv,
  type S3ClientLike,
} from "./file-store";
import { err, handle, json } from "./http";
import { openSqlite, type Database } from "./sqlite";
import { type TarSource, tarStream } from "./tar";
import { appVersion } from "./version";

/* ------------------------------------------------------------------ */
/* Names                                                                */
/* ------------------------------------------------------------------ */

const STEM = String.raw`openfs-\d{4}-\d{2}-\d{2}-\d{6}`;
/** A backup set directory, e.g. openfs-2026-09-28-031500. */
export const BACKUP_SET_PATTERN = new RegExp(`^${STEM}$`);
/** A legacy single-file backup, e.g. openfs-2026-09-28-031500.db. */
export const LEGACY_BACKUP_PATTERN = new RegExp(`^${STEM}\\.db$`);

export const isBackupSetName = (name: string) => BACKUP_SET_PATTERN.test(name);
export const isLegacyBackupName = (name: string) => LEGACY_BACKUP_PATTERN.test(name);

/** The only names the API ever serves. */
export function isBackupName(name: string): boolean {
  return isBackupSetName(name) || isLegacyBackupName(name);
}

/** openfs-2026-09-28-031500.db → openfs-2026-09-28-031500 */
const stemOf = (name: string) => name.replace(/\.db$/, "");

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** Local-time timestamped set name, e.g. openfs-2026-09-28-031500. */
export function backupSetName(date: Date): string {
  return `openfs-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Legacy single-file name (still used for offsite database copies). */
export function backupFileName(date: Date): string {
  return `${backupSetName(date)}.db`;
}

export const MANIFEST_FILE = "manifest.json";
export const DATABASE_FILE = "database.db";
export const FILES_DIR = "files";

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

export type OffsiteTarget = {
  client: S3ClientLike;
  /** Object key prefix, e.g. "openfs/backups/". */
  prefix: string;
  /** Shown in the UI, e.g. "bucket/openfs/backups/". */
  label: string;
};

export type BackupConfig = {
  dir: string;
  keep: number;
  intervalHours: number;
  offsite: OffsiteTarget | null;
  /** Where uploaded documents live (shown in the restore steps). */
  files?: string;
  /** Source of the document bytes; null/undefined = database only. */
  fileStore?: FileStore | null;
  /** School slug in multi-tenant mode (written into the manifest). */
  tenant?: string | null;
};

export type BackupManifest = {
  kind: "openfs-backup";
  format: 1;
  name: string;
  createdAt: string;
  app: { version: string; commit: string };
  tenant: string | null;
  database: { path: typeof DATABASE_FILE; size: number; sha256: string };
  /** false: this set holds the database only (no file store given). */
  filesIncluded: boolean;
  files: { key: string; size: number; sha256: string }[];
  fileCount: number;
  fileBytes: number;
  /** Referenced by the database but not found in the store at backup time. */
  missingFiles: string[];
  /** e.g. a document whose bytes no longer match the recorded checksum. */
  warnings: string[];
};

export type BackupInfo = {
  name: string;
  kind: "set" | "legacy";
  /** Database + documents in bytes (hard links counted in full). */
  size: number;
  createdAt: string;
  offsite: boolean;
  databaseSize: number;
  fileCount: number;
  fileBytes: number;
  filesIncluded: boolean;
  missingFiles: number;
};

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function backupConfigFromEnv(
  env: Env = process.env,
  createClient: typeof createS3Client = createS3Client,
  fileStore: FileStore | null = null,
): BackupConfig {
  const s3 = s3ConfigFromEnv(env);
  // BACKUP_FILES=0: database only (e.g. huge S3 stores protected by
  // bucket versioning alone).
  const withFiles = env.BACKUP_FILES !== "0" && env.BACKUP_FILES !== "false";
  return {
    dir: env.BACKUP_DIR?.trim() || join("data", "backups"),
    keep: positiveInt(env.BACKUP_KEEP, 14),
    intervalHours: positiveInt(env.BACKUP_INTERVAL_HOURS, 24),
    // Same rule as createFileStoreFromEnv (file-store.ts).
    files: s3
      ? `S3: ${s3.bucket}/${s3.prefix}files/`
      : env.FILE_STORE_DIR?.trim() || join("data", "files"),
    fileStore: withFiles ? fileStore : null,
    tenant: null,
    offsite: s3
      ? {
          client: createClient(s3),
          prefix: `${s3.prefix}backups/`,
          label: `${s3.bucket}/${s3.prefix}backups/`,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Checks                                                               */
/* ------------------------------------------------------------------ */

/** PRAGMA integrity_check on a database file; throws unless "ok". */
export function verifyBackup(path: string): void {
  const copy = openSqlite(path);
  try {
    const rows = copy
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .all();
    const result = rows.map((row) => row.integrity_check).join("; ");
    if (result !== "ok") {
      throw new Error(`Integritätsprüfung fehlgeschlagen: ${result}`);
    }
  } finally {
    copy.close();
  }
}

export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

const sha256Bytes = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

type FileRef = { key: string; sha256: string; size: number };

/** The documents a database (copy) references. */
export function referencedFiles(path: string): FileRef[] {
  const copy = openSqlite(path);
  try {
    const table = copy
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'student_files'",
      )
      .get();
    if (!table) return [];
    return copy
      .query<{ key: string; sha256: string; size: number }, []>(
        "SELECT storage_key AS key, sha256, size FROM student_files ORDER BY id",
      )
      .all();
  } finally {
    copy.close();
  }
}

export async function readManifest(setDir: string): Promise<BackupManifest> {
  const file = Bun.file(join(setDir, MANIFEST_FILE));
  if (!(await file.exists())) throw new Error("manifest.json fehlt.");
  const manifest = (await file.json()) as BackupManifest;
  if (manifest?.kind !== "openfs-backup" || manifest.format !== 1) {
    throw new Error("manifest.json ist keine OpenFS-Sicherung (Format 1).");
  }
  return manifest;
}

export type VerifyResult = {
  ok: boolean;
  problems: string[];
  manifest: BackupManifest | null;
};

/** Full check of a backup set: manifest, database checksum + PRAGMA
 *  integrity_check, every document's size + SHA-256, and that every
 *  document the database references is in the set (or was already
 *  missing when the backup was made). */
export async function verifyBackupSet(setDir: string): Promise<VerifyResult> {
  const problems: string[] = [];
  let manifest: BackupManifest;
  try {
    manifest = await readManifest(setDir);
  } catch (error) {
    return { ok: false, problems: [(error as Error).message], manifest: null };
  }
  const dbPath = join(setDir, DATABASE_FILE);
  if (!(await exists(dbPath))) {
    problems.push("database.db fehlt.");
    return { ok: false, problems, manifest };
  }
  const dbSize = (await stat(dbPath)).size;
  if (dbSize !== manifest.database.size) {
    problems.push(`database.db: Größe ${dbSize} statt ${manifest.database.size}.`);
  }
  if ((await sha256File(dbPath)) !== manifest.database.sha256) {
    problems.push("database.db: Prüfsumme stimmt nicht.");
  } else {
    try {
      verifyBackup(dbPath);
    } catch (error) {
      problems.push(`database.db: ${(error as Error).message}`);
    }
  }
  for (const file of manifest.files) {
    const path = join(setDir, FILES_DIR, ...file.key.split("/"));
    try {
      assertValidKey(file.key);
    } catch {
      problems.push(`Ungültiger Dateiname im Manifest: ${file.key}`);
      continue;
    }
    if (!(await exists(path))) {
      problems.push(`Dokument fehlt: ${file.key}`);
      continue;
    }
    const size = (await stat(path)).size;
    if (size !== file.size || (await sha256File(path)) !== file.sha256) {
      problems.push(`Dokument beschädigt: ${file.key}`);
    }
  }
  if (manifest.filesIncluded && problems.length === 0) {
    const inSet = new Set([
      ...manifest.files.map((f) => f.key),
      ...manifest.missingFiles,
    ]);
    for (const ref of referencedFiles(dbPath)) {
      if (!inSet.has(ref.key)) problems.push(`Nicht in der Sicherung: ${ref.key}`);
    }
  }
  if (manifest.fileCount !== manifest.files.length) {
    problems.push("Manifest: Anzahl der Dokumente stimmt nicht.");
  }
  return { ok: problems.length === 0, problems, manifest };
}

/* ------------------------------------------------------------------ */
/* Create / prune                                                       */
/* ------------------------------------------------------------------ */

export type CreateBackupOptions = {
  keep?: number;
  offsite?: OffsiteTarget | null;
  now?: Date;
  /** Source of the documents; omitted = database-only set. */
  fileStore?: FileStore | null;
  tenant?: string | null;
};

export type CreateBackupResult = BackupInfo & {
  /** Set when the offsite upload failed (the local backup still exists). */
  offsiteError?: string;
};

/* One backup at a time per directory (scheduler + "Jetzt sichern"). */
const running = new Map<string, Promise<unknown>>();
function exclusive<T>(dir: string, job: () => Promise<T>): Promise<T> {
  const key = resolve(dir);
  const previous = running.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(job);
  running.set(key, next);
  void next.finally(() => {
    if (running.get(key) === next) running.delete(key);
  });
  return next;
}

async function newestSet(
  dir: string,
): Promise<{ dir: string; manifest: BackupManifest } | null> {
  for (const name of await localBackupNames(dir)) {
    if (!isBackupSetName(name)) continue;
    const manifest = await readManifest(join(dir, name)).catch(() => null);
    if (manifest) return { dir: join(dir, name), manifest };
  }
  return null;
}

/** Copies the referenced documents into `work/files`, hard-linking the
 *  ones the previous set already holds unchanged. */
async function collectFiles(
  work: string,
  refs: FileRef[],
  store: FileStore,
  previous: { dir: string; manifest: BackupManifest } | null,
) {
  const before = new Map(previous?.manifest.files.map((f) => [f.key, f]) ?? []);
  const files: BackupManifest["files"] = [];
  const missingFiles: string[] = [];
  const warnings: string[] = [];
  for (const ref of refs) {
    assertValidKey(ref.key);
    const target = join(work, FILES_DIR, ...ref.key.split("/"));
    await mkdir(dirname(target), { recursive: true });
    const old = before.get(ref.key);
    if (previous && old && old.sha256 === ref.sha256) {
      const source = join(previous.dir, FILES_DIR, ...ref.key.split("/"));
      const size = await stat(source).then(
        (s) => s.size,
        () => -1,
      );
      if (size === old.size) {
        await link(source, target).catch(() => copyFile(source, target));
        files.push({ key: ref.key, size: old.size, sha256: old.sha256 });
        continue;
      }
    }
    const bytes = await store.get(ref.key);
    if (!bytes) {
      missingFiles.push(ref.key);
      continue;
    }
    const sha256 = sha256Bytes(bytes);
    if (sha256 !== ref.sha256) {
      warnings.push(`${ref.key}: Inhalt passt nicht zur gespeicherten Prüfsumme.`);
    }
    await Bun.write(target, bytes);
    files.push({ key: ref.key, size: bytes.byteLength, sha256 });
  }
  return { files, missingFiles, warnings };
}

export async function createBackup(
  db: Database,
  dir: string,
  options: CreateBackupOptions = {},
): Promise<CreateBackupResult> {
  return exclusive(dir, () => createBackupNow(db, dir, options));
}

async function createBackupNow(
  db: Database,
  dir: string,
  options: CreateBackupOptions,
): Promise<CreateBackupResult> {
  await mkdir(dir, { recursive: true });
  // Leftovers of an interrupted run (only one job per dir runs at a time).
  for (const entry of await readdir(dir)) {
    if (entry.endsWith(".partial"))
      await rm(join(dir, entry), { recursive: true, force: true });
  }
  // Two backups within the same second get consecutive names.
  const when = new Date(options.now ?? Date.now());
  let name = backupSetName(when);
  while ((await exists(join(dir, name))) || (await exists(join(dir, `${name}.db`)))) {
    when.setSeconds(when.getSeconds() + 1);
    name = backupSetName(when);
  }
  const work = join(dir, `${name}.partial`);
  const final = join(dir, name);
  const previous = await newestSet(dir);

  let manifest: BackupManifest;
  try {
    await mkdir(work, { recursive: true });
    const dbPath = join(work, DATABASE_FILE);
    db.run("VACUUM INTO ?", resolve(dbPath));
    verifyBackup(dbPath);
    const refs = referencedFiles(dbPath);
    const collected = options.fileStore
      ? await collectFiles(work, refs, options.fileStore, previous)
      : { files: [], missingFiles: [], warnings: [] };
    manifest = {
      kind: "openfs-backup",
      format: 1,
      name,
      createdAt: new Date(options.now ?? Date.now()).toISOString(),
      app: appVersion(),
      tenant: options.tenant ?? null,
      database: {
        path: DATABASE_FILE,
        size: (await stat(dbPath)).size,
        sha256: await sha256File(dbPath),
      },
      filesIncluded: Boolean(options.fileStore),
      files: collected.files,
      fileCount: collected.files.length,
      fileBytes: collected.files.reduce((sum, f) => sum + f.size, 0),
      missingFiles: collected.missingFiles,
      warnings: collected.warnings,
    };
    await Bun.write(join(work, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(work, final);
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
  for (const warning of [
    ...manifest.warnings,
    ...manifest.missingFiles.map((key) => `Dokument fehlt im Dateispeicher: ${key}`),
  ]) {
    console.warn(`Datensicherung ${name}: ${warning}`);
  }

  const result: CreateBackupResult = { ...infoFromManifest(manifest), offsite: false };

  const offsite = options.offsite ?? null;
  if (offsite) {
    try {
      await offsite.client.write(
        `${offsite.prefix}${name}.db`,
        Bun.file(join(final, DATABASE_FILE)),
        {
          type: "application/vnd.sqlite3",
        },
      );
      await offsite.client.write(
        `${offsite.prefix}${name}.manifest.json`,
        Bun.file(join(final, MANIFEST_FILE)),
        { type: "application/json" },
      );
      result.offsite = true;
    } catch (error) {
      result.offsiteError = error instanceof Error ? error.message : String(error);
      console.error(`Offsite-Sicherung ${name} fehlgeschlagen:`, error);
    }
  }

  const keep = options.keep ?? 14;
  await pruneLocalBackups(dir, keep);
  if (offsite) {
    await pruneOffsiteBackups(offsite, keep).catch((error) => {
      console.error("Alte Offsite-Sicherungen konnten nicht gelöscht werden:", error);
    });
  }
  return result;
}

function infoFromManifest(manifest: BackupManifest): BackupInfo {
  return {
    name: manifest.name,
    kind: "set",
    size: manifest.database.size + manifest.fileBytes,
    createdAt: manifest.createdAt,
    offsite: false,
    databaseSize: manifest.database.size,
    fileCount: manifest.fileCount,
    fileBytes: manifest.fileBytes,
    filesIncluded: manifest.filesIncluded,
    missingFiles: manifest.missingFiles.length,
  };
}

/** Sets and legacy files, newest first (names sort chronologically). */
async function localBackupNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries
    .filter(isBackupName)
    .sort((a, b) => (stemOf(a) < stemOf(b) ? 1 : stemOf(a) > stemOf(b) ? -1 : 0));
}

/** Retention: keeps the newest `keep` backups (sets with their documents,
 *  and legacy files alike); returns the removed names. */
export async function pruneLocalBackups(dir: string, keep: number): Promise<string[]> {
  const stale = (await localBackupNames(dir)).slice(keep);
  for (const name of stale) await rm(join(dir, name), { recursive: true, force: true });
  return stale;
}

/** Offsite backups by stem (<prefix><stem>.db [+ .manifest.json]). */
async function offsiteBackupNames(offsite: OffsiteTarget): Promise<string[]> {
  const names: string[] = [];
  let startAfter: string | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await offsite.client.list({ prefix: offsite.prefix, startAfter });
    const contents = response.contents ?? [];
    for (const object of contents) {
      const name = object.key.slice(offsite.prefix.length);
      if (isLegacyBackupName(name)) names.push(stemOf(name));
    }
    if (!response.isTruncated || contents.length === 0) break;
    startAfter = contents.at(-1)!.key;
  }
  return names.sort().reverse();
}

export async function pruneOffsiteBackups(
  offsite: OffsiteTarget,
  keep: number,
): Promise<string[]> {
  const stale = (await offsiteBackupNames(offsite)).slice(keep);
  for (const stem of stale) {
    await offsite.client.delete(`${offsite.prefix}${stem}.db`);
    await offsite.client.delete(`${offsite.prefix}${stem}.manifest.json`);
  }
  return stale.map((stem) => `${stem}.db`);
}

export async function listBackups(
  dir: string,
  offsite: OffsiteTarget | null = null,
): Promise<BackupInfo[]> {
  const remote = new Set(
    offsite ? await offsiteBackupNames(offsite).catch(() => [] as string[]) : [],
  );
  const backups: BackupInfo[] = [];
  for (const name of await localBackupNames(dir)) {
    const path = join(dir, name);
    if (isBackupSetName(name)) {
      const manifest = await readManifest(path).catch(() => null);
      if (!manifest) continue;
      backups.push({ ...infoFromManifest(manifest), offsite: remote.has(name) });
      continue;
    }
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    backups.push({
      name,
      kind: "legacy",
      size: info.size,
      createdAt: info.mtime.toISOString(),
      offsite: remote.has(stemOf(name)),
      databaseSize: info.size,
      fileCount: 0,
      fileBytes: 0,
      filesIncluded: false,
      missingFiles: 0,
    });
  }
  return backups;
}

/** Files of a set in archive order: manifest first, then database, then
 *  the documents — all below "<name>/". */
export async function backupArchiveSources(setDir: string): Promise<TarSource[]> {
  const manifest = await readManifest(setDir);
  const name = manifest.name;
  const entry = async (relative: string): Promise<TarSource> => {
    const path = join(setDir, ...relative.split("/"));
    const info = await stat(path);
    return { name: `${name}/${relative}`, path, size: info.size, mtime: info.mtime };
  };
  const sources = [await entry(MANIFEST_FILE), await entry(DATABASE_FILE)];
  for (const file of manifest.files)
    sources.push(await entry(`${FILES_DIR}/${file.key}`));
  return sources;
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                            */
/* ------------------------------------------------------------------ */

async function newestCreatedAt(dir: string): Promise<number | null> {
  const newest = (await localBackupNames(dir))[0];
  if (!newest) return null;
  const path = join(dir, newest);
  if (isBackupSetName(newest)) {
    const manifest = await readManifest(path).catch(() => null);
    if (manifest) return Date.parse(manifest.createdAt);
  }
  const info = await stat(path).catch(() => null);
  return info ? info.mtime.getTime() : null;
}

/** Creates a backup when the newest local one is older than the
 *  interval (or none exists). Returns the new backup, or null. */
export async function runBackupIfDue(
  db: Database,
  config: BackupConfig,
  now = new Date(),
): Promise<CreateBackupResult | null> {
  const newest = await newestCreatedAt(config.dir);
  if (newest !== null && now.getTime() - newest < config.intervalHours * 3_600_000) {
    return null;
  }
  return createBackup(db, config.dir, {
    keep: config.keep,
    offsite: config.offsite,
    fileStore: config.fileStore,
    tenant: config.tenant,
    now,
  });
}

/** Checks once right away and then every `checkEveryMs` (default
 *  hourly). Returns a stop function. */
export function startBackupScheduler(
  db: Database,
  config: BackupConfig,
  checkEveryMs = 3_600_000,
): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const backup = await runBackupIfDue(db, config);
      if (backup) {
        console.log(
          `💾 Datensicherung erstellt: ${backup.name} (Datenbank + ${backup.fileCount} Dokument(e))`,
        );
      }
    } catch (error) {
      console.error("Datensicherung fehlgeschlagen:", error);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, checkEveryMs);
  return () => clearInterval(timer);
}

/* ------------------------------------------------------------------ */
/* HTTP — admin only (the auth layer wraps /api/admin/* centrally).     */
/* ------------------------------------------------------------------ */

/** Path of the main database file ("" for in-memory databases). */
export function databaseFile(db: Database): string {
  const rows = db.query<{ name: string; file: string }, []>("PRAGMA database_list").all();
  return rows.find((row) => row.name === "main")?.file ?? "";
}

const DISABLED_MESSAGE =
  "Im Demo-Modus sind Datensicherungen deaktiviert – Änderungen werden ohnehin nicht gespeichert.";

function backupName(raw: string): string {
  if (!isBackupName(raw)) throw new ValidationError("Ungültiger Sicherungsname.");
  return raw;
}

/** `config: null` = backups disabled (demo mode). */
export function backupRoutes(db: Database, config: BackupConfig | null) {
  return {
    "/api/admin/backups": {
      GET: (_req: BunRequest) =>
        handle(async () => {
          if (!config) {
            return json({ enabled: false, message: DISABLED_MESSAGE, backups: [] });
          }
          return json({
            enabled: true,
            backups: await listBackups(config.dir, config.offsite),
            config: {
              dir: config.dir,
              keep: config.keep,
              intervalHours: config.intervalHours,
              offsite: config.offsite?.label ?? null,
              // The live database file (DB_PATH, or the school's file in
              // multi-tenant mode) — what a restore replaces.
              dbPath: databaseFile(db),
              files: config.files ?? null,
              filesIncluded: Boolean(config.fileStore),
              tenant: config.tenant ?? null,
            },
          });
        })(),
      POST: (_req: BunRequest) =>
        handle(async () => {
          if (!config) return err(DISABLED_MESSAGE, 409);
          const backup = await createBackup(db, config.dir, {
            keep: config.keep,
            offsite: config.offsite,
            fileStore: config.fileStore,
            tenant: config.tenant,
          });
          return json(backup, 201);
        })(),
    },

    /* Download: a set as <name>.tar (manifest, database, documents), a
       legacy backup as the bare .db file. */
    "/api/admin/backups/:name": {
      GET: (req: BunRequest<"/api/admin/backups/:name">) =>
        handle(async () => {
          if (!config) return err(DISABLED_MESSAGE, 409);
          const name = backupName(req.params.name);
          const path = join(config.dir, name);
          if (isLegacyBackupName(name)) {
            const file = Bun.file(path);
            if (!(await file.exists())) return err("Sicherung nicht gefunden.", 404);
            return new Response(file, {
              headers: {
                "Content-Type": "application/vnd.sqlite3",
                "Content-Disposition": `attachment; filename="${name}"`,
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
          if (!(await exists(join(path, MANIFEST_FILE)))) {
            return err("Sicherung nicht gefunden.", 404);
          }
          const sources = await backupArchiveSources(path);
          return new Response(tarStream(sources), {
            headers: {
              "Content-Type": "application/x-tar",
              "Content-Disposition": `attachment; filename="${name}.tar"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        })(),
    },

    /* Re-checks a set (checksums, integrity_check, completeness). */
    "/api/admin/backups/:name/verify": {
      POST: (req: BunRequest<"/api/admin/backups/:name/verify">) =>
        handle(async () => {
          if (!config) return err(DISABLED_MESSAGE, 409);
          const name = backupName(req.params.name);
          const path = join(config.dir, name);
          if (isLegacyBackupName(name)) {
            if (!(await exists(path))) return err("Sicherung nicht gefunden.", 404);
            try {
              verifyBackup(path);
              return json({ ok: true, problems: [] });
            } catch (error) {
              return json({ ok: false, problems: [(error as Error).message] });
            }
          }
          if (!(await exists(path))) return err("Sicherung nicht gefunden.", 404);
          const { ok, problems } = await verifyBackupSet(path);
          return json({ ok, problems });
        })(),
    },
  };
}
