/* ------------------------------------------------------------------ */
/* Wiederherstellung — puts a backup set (database + documents) back   */
/* in place. Used by scripts/restore.ts; the steps:                    */
/*                                                                     */
/*  1. verify the set (manifest checksums, PRAGMA integrity_check,     */
/*     every document) — a damaged backup is never restored;           */
/*  2. refuse while a process holds the target database open (Linux    */
/*     /proc scan) or the server answers its health URL, and when the  */
/*     set belongs to another school than the target;                  */
/*  3. move the current database (+ -wal/-shm) and, for the disk       */
/*     store, the school's document directory aside with a             */
/*     ".before-restore-<timestamp>" suffix — nothing is deleted;      */
/*  4. copy the database in, write the documents to the store, verify  */
/*     both again. On any error the moved-aside data is put back.      */
/*                                                                     */
/* Legacy single-file backups (openfs-…db) restore the database only.  */
/* ------------------------------------------------------------------ */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readlink, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  DATABASE_FILE,
  FILES_DIR,
  type BackupManifest,
  isBackupName,
  sha256File,
  verifyBackup,
  verifyBackupSet,
} from "./backups";
import type { FileStore } from "./file-store";
import { openSqlite } from "./sqlite";
import { extractTar } from "./tar";

export class RestoreError extends Error {}

export type RestoreSource =
  | { kind: "set"; dir: string; manifest: BackupManifest; cleanup: () => Promise<void> }
  | { kind: "legacy"; file: string; cleanup: () => Promise<void> };

export type RestoreTarget = {
  /** The live database file that gets replaced. */
  dbPath: string;
  /** Where the documents go (disk, S3 or a school's prefix of either). */
  fileStore: FileStore | null;
  /** Disk store only: the directory holding exactly this school's
   *  documents — moved aside before the restore. null for S3. */
  filesDir: string | null;
  /** School slug in multi-tenant mode, else null. */
  tenant: string | null;
};

export type RestoreOptions = {
  /** Skip the "database in use" and health checks (never the verification). */
  force?: boolean;
  /** Health URL of the server; if it answers, the restore is refused. */
  checkUrl?: string | null;
  now?: Date;
  log?: (line: string) => void;
};

export type RestoreReport = {
  name: string;
  tenant: string | null;
  dbPath: string;
  movedAside: string[];
  fileCount: number;
  fileBytes: number;
  missingFiles: string[];
  databaseOnly: boolean;
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/* ------------------------------------------------------------------ */
/* Source: a name in the backup dir, a set directory, a .tar archive    */
/* (the download from /datensicherung) or a legacy .db file.            */
/* ------------------------------------------------------------------ */

/** A damaged backup is never restored: every check must pass. */
async function verifiedManifest(dir: string): Promise<BackupManifest> {
  const result = await verifyBackupSet(dir);
  if (!result.ok || !result.manifest) {
    throw new RestoreError(
      `Sicherung ${dir} ist fehlerhaft — keine Wiederherstellung:\n  ${result.problems.join("\n  ")}`,
    );
  }
  return result.manifest;
}

export async function openRestoreSource(
  input: string,
  options: { backupDir: string; workDir: string },
): Promise<RestoreSource> {
  const noop = async () => {};
  const path = isBackupName(input) ? join(options.backupDir, input) : input;
  const info = await stat(path).catch(() => null);
  if (!info) throw new RestoreError(`Sicherung nicht gefunden: ${path}`);

  if (info.isDirectory()) {
    return {
      kind: "set",
      dir: path,
      manifest: await verifiedManifest(path),
      cleanup: noop,
    };
  }
  if (path.endsWith(".tar")) {
    const work = join(options.workDir, `.restore-extract-${process.pid}-${Date.now()}`);
    await mkdir(work, { recursive: true });
    const cleanup = () => rm(work, { recursive: true, force: true });
    try {
      await extractTar(Bun.file(path).stream(), work);
      const [top, ...rest] = await readdir(work);
      if (!top || rest.length > 0) {
        throw new RestoreError("Das Archiv muss genau einen Sicherungsordner enthalten.");
      }
      const dir = join(work, top);
      return { kind: "set", dir, manifest: await verifiedManifest(dir), cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  const head = new Uint8Array(await Bun.file(path).slice(0, 16).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, 15)) === "SQLite format 3") {
    return { kind: "legacy", file: path, cleanup: noop };
  }
  throw new RestoreError(
    `${path}: keine OpenFS-Sicherung (Ordner mit manifest.json, .tar-Archiv oder .db-Datei).`,
  );
}

/* ------------------------------------------------------------------ */
/* Safety checks                                                        */
/* ------------------------------------------------------------------ */

/** PIDs of other processes holding `path` (or its -wal) open. Linux
 *  only; `unreadable` counts processes we may not inspect (other user). */
export async function processesUsing(
  path: string,
): Promise<{ pids: number[]; unreadable: number; supported: boolean }> {
  const targets = new Set([resolve(path), resolve(`${path}-wal`)]);
  const entries = await readdir("/proc").catch(() => null);
  if (!entries) return { pids: [], unreadable: 0, supported: false };
  const pids: number[] = [];
  let unreadable = 0;
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    const fds = await readdir(`/proc/${pid}/fd`).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EACCES") unreadable++;
      return [] as string[];
    });
    for (const fd of fds) {
      const target = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "");
      if (targets.has(target)) {
        pids.push(pid);
        break;
      }
    }
  }
  return { pids, unreadable, supported: true };
}

async function serverAnswers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Throws a RestoreError when restoring into `target` is unsafe. */
export async function assertSafeToRestore(
  source: RestoreSource,
  target: RestoreTarget,
  options: RestoreOptions = {},
): Promise<void> {
  if (source.kind === "set") {
    const from = source.manifest.tenant;
    if (from !== target.tenant) {
      const describe = (slug: string | null) =>
        slug ? `Fahrschule „${slug}“` : "Einzelbetrieb";
      if (!options.force || (from && target.tenant)) {
        throw new RestoreError(
          `Die Sicherung gehört zu ${describe(from)}, das Ziel ist ${describe(target.tenant)}.` +
            (from && target.tenant ? "" : " (--force übergeht das)"),
        );
      }
    }
  }
  if (options.force) return;
  const usage = await processesUsing(target.dbPath);
  if (usage.pids.length > 0) {
    throw new RestoreError(
      `Die Datenbank ${target.dbPath} ist noch geöffnet (Prozess ${usage.pids.join(", ")}). ` +
        "Bitte zuerst den Server stoppen (z. B. systemctl stop openfs).",
    );
  }
  if (options.checkUrl && (await serverAnswers(options.checkUrl))) {
    throw new RestoreError(
      `Der Server antwortet noch unter ${options.checkUrl}. Bitte zuerst stoppen ` +
        "(oder --force, falls dort ein anderer Server läuft).",
    );
  }
  if (usage.unreadable > 0) {
    options.log?.(
      `Hinweis: ${usage.unreadable} Prozess(e) anderer Benutzer konnten nicht geprüft werden.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Restore                                                              */
/* ------------------------------------------------------------------ */

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (date: Date) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

function contentTypes(dbPath: string): Map<string, string> {
  const db = openSqlite(dbPath);
  try {
    const table = db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'student_files'",
      )
      .get();
    if (!table) return new Map();
    return new Map(
      db
        .query<{ storage_key: string; mime_type: string }, []>(
          "SELECT storage_key, mime_type FROM student_files",
        )
        .all()
        .map((row) => [row.storage_key, row.mime_type]),
    );
  } finally {
    db.close();
  }
}

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/* Nothing else holds the database here (assertSafeToRestore). */
function checkpoint(dbPath: string): void {
  if (!existsSync(dbPath)) return;
  const db = openSqlite(dbPath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

export async function restoreBackup(
  source: RestoreSource,
  target: RestoreTarget,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const log = options.log ?? (() => {});
  await assertSafeToRestore(source, target, options);

  const databaseOnly = source.kind === "legacy" || !source.manifest.filesIncluded;
  const suffix = `.before-restore-${stamp(options.now ?? new Date())}`;
  const moved: [from: string, to: string][] = [];
  const moveAside = async (path: string, to = `${path}${suffix}`) => {
    if (!(await exists(path))) return;
    if (await exists(to)) throw new RestoreError(`${to} existiert bereits.`);
    await rename(path, to);
    moved.push([path, to]);
  };

  const dbPath = resolve(target.dbPath);
  const incoming = source.kind === "set" ? join(source.dir, DATABASE_FILE) : source.file;
  const restoreFiles = !databaseOnly && source.kind === "set";

  try {
    // Fold the WAL into the database first so the set-aside copy is
    // complete on its own; then keep any -wal/-shm next to it under the
    // names SQLite pairs with it ("<aside>-wal", not "<db>-wal<suffix>").
    checkpoint(dbPath);
    const aside = `${dbPath}${suffix}`;
    await moveAside(dbPath, aside);
    await moveAside(`${dbPath}-wal`, `${aside}-wal`);
    await moveAside(`${dbPath}-shm`, `${aside}-shm`);
    if (restoreFiles && target.filesDir) await moveAside(resolve(target.filesDir));

    await mkdir(dirname(dbPath), { recursive: true });
    const partial = `${dbPath}.restoring`;
    await copyFile(incoming, partial);
    if (
      source.kind === "set" &&
      (await sha256File(partial)) !== source.manifest.database.sha256
    ) {
      await rm(partial, { force: true });
      throw new RestoreError(
        "Die kopierte Datenbank stimmt nicht mit dem Manifest überein.",
      );
    }
    verifyBackup(partial);
    await rename(partial, dbPath);
    log(`Datenbank wiederhergestellt: ${dbPath}`);

    let fileCount = 0;
    let fileBytes = 0;
    if (restoreFiles) {
      if (!target.fileStore)
        throw new RestoreError("Kein Dateispeicher für die Dokumente.");
      const types = contentTypes(dbPath);
      for (const file of source.manifest.files) {
        const bytes = await Bun.file(
          join(source.dir, FILES_DIR, ...file.key.split("/")),
        ).bytes();
        if (sha256(bytes) !== file.sha256) {
          throw new RestoreError(`Dokument ${file.key} ist beschädigt.`);
        }
        await target.fileStore.put(
          file.key,
          bytes,
          types.get(file.key) ?? "application/octet-stream",
        );
        const back = await target.fileStore.get(file.key);
        if (!back || sha256(back) !== file.sha256) {
          throw new RestoreError(`Dokument ${file.key} wurde nicht korrekt geschrieben.`);
        }
        fileCount++;
        fileBytes += bytes.byteLength;
      }
      log(`${fileCount} Dokument(e) wiederhergestellt.`);
    }

    return {
      name: source.kind === "set" ? source.manifest.name : source.file,
      tenant: target.tenant,
      dbPath,
      movedAside: moved.map(([, to]) => to),
      fileCount,
      fileBytes,
      missingFiles: source.kind === "set" ? source.manifest.missingFiles : [],
      databaseOnly,
    };
  } catch (error) {
    // Put everything back the way it was.
    await rm(`${dbPath}.restoring`, { force: true });
    for (const [from, to] of moved.reverse()) {
      await rm(from, { recursive: true, force: true });
      await rename(to, from).catch((rollbackError) => {
        log(`Zurücksetzen von ${from} fehlgeschlagen: ${String(rollbackError)}`);
      });
    }
    // Nothing was there before: do not leave a half restore behind.
    if (!moved.some(([from]) => from === dbPath)) await rm(dbPath, { force: true });
    const filesDir = target.filesDir ? resolve(target.filesDir) : null;
    if (restoreFiles && filesDir && !moved.some(([from]) => from === filesDir)) {
      await rm(filesDir, { recursive: true, force: true });
    }
    throw error;
  }
}
