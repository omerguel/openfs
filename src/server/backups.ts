/* ------------------------------------------------------------------ */
/* Datensicherung — scheduled SQLite backups.                          */
/*                                                                     */
/* A backup is a consistent copy made with `VACUUM INTO` (safe while   */
/* the server keeps writing, WAL included), verified with PRAGMA       */
/* integrity_check, kept under data/backups (BACKUP_DIR) and — when S3 */
/* is configured — copied offsite to <S3_PREFIX>backups/. The newest   */
/* BACKUP_KEEP copies survive in both places. Uploaded document bytes  */
/* are not part of the database; see file-store.ts.                    */
/* ------------------------------------------------------------------ */

import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { createS3Client, s3ConfigFromEnv, type S3ClientLike } from "./file-store";
import { err, handle, json } from "./http";
import { openSqlite, type Database } from "./sqlite";

/** openfs-YYYY-MM-DD-HHMMSS.db — the only names the API ever serves. */
export const BACKUP_NAME_PATTERN = /^openfs-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

export function isBackupName(name: string): boolean {
  return BACKUP_NAME_PATTERN.test(name);
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** Local-time timestamped name, e.g. openfs-2026-09-28-031500.db. */
export function backupFileName(date: Date): string {
  return `openfs-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.db`;
}

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
};

export type BackupInfo = {
  name: string;
  size: number;
  createdAt: string;
  offsite: boolean;
};

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function backupConfigFromEnv(
  env: Env = process.env,
  createClient: typeof createS3Client = createS3Client,
): BackupConfig {
  const s3 = s3ConfigFromEnv(env);
  return {
    dir: env.BACKUP_DIR?.trim() || join("data", "backups"),
    keep: positiveInt(env.BACKUP_KEEP, 14),
    intervalHours: positiveInt(env.BACKUP_INTERVAL_HOURS, 24),
    // Same rule as createFileStoreFromEnv (file-store.ts).
    files: s3
      ? `S3: ${s3.bucket}/${s3.prefix}files/`
      : env.FILE_STORE_DIR?.trim() || join("data", "files"),
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
/* Create / verify / prune                                              */
/* ------------------------------------------------------------------ */

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

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export type CreateBackupOptions = {
  keep?: number;
  offsite?: OffsiteTarget | null;
  now?: Date;
};

export type CreateBackupResult = BackupInfo & {
  /** Set when the offsite upload failed (the local backup still exists). */
  offsiteError?: string;
};

export async function createBackup(
  db: Database,
  dir: string,
  options: CreateBackupOptions = {},
): Promise<CreateBackupResult> {
  await mkdir(dir, { recursive: true });
  // Two backups within the same second get consecutive names.
  const when = new Date(options.now ?? Date.now());
  let name = backupFileName(when);
  while (await exists(join(dir, name))) {
    when.setSeconds(when.getSeconds() + 1);
    name = backupFileName(when);
  }
  const path = join(dir, name);
  const partial = `${path}.partial`;
  await rm(partial, { force: true });

  try {
    db.run("VACUUM INTO ?", resolve(partial));
    verifyBackup(partial);
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }

  const info = await stat(path);
  const result: CreateBackupResult = {
    name,
    size: info.size,
    createdAt: info.mtime.toISOString(),
    offsite: false,
  };

  const offsite = options.offsite ?? null;
  if (offsite) {
    try {
      await offsite.client.write(`${offsite.prefix}${name}`, Bun.file(path), {
        type: "application/vnd.sqlite3",
      });
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

async function localBackupNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  // Names sort chronologically; newest first.
  return entries.filter(isBackupName).sort().reverse();
}

export async function pruneLocalBackups(dir: string, keep: number): Promise<string[]> {
  const stale = (await localBackupNames(dir)).slice(keep);
  for (const name of stale) await rm(join(dir, name), { force: true });
  return stale;
}

async function offsiteBackupNames(offsite: OffsiteTarget): Promise<string[]> {
  const names: string[] = [];
  let startAfter: string | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await offsite.client.list({ prefix: offsite.prefix, startAfter });
    const contents = response.contents ?? [];
    for (const object of contents) {
      const name = object.key.slice(offsite.prefix.length);
      if (isBackupName(name)) names.push(name);
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
  for (const name of stale) await offsite.client.delete(`${offsite.prefix}${name}`);
  return stale;
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
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info) continue;
    backups.push({
      name,
      size: info.size,
      createdAt: info.mtime.toISOString(),
      offsite: remote.has(name),
    });
  }
  return backups;
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                            */
/* ------------------------------------------------------------------ */

/** Creates a backup when the newest local one is older than the
 *  interval (or none exists). Returns the new backup, or null. */
export async function runBackupIfDue(
  db: Database,
  config: BackupConfig,
  now = new Date(),
): Promise<CreateBackupResult | null> {
  const newest = (await localBackupNames(config.dir))[0];
  if (newest) {
    const info = await stat(join(config.dir, newest)).catch(() => null);
    const ageMs = info ? now.getTime() - info.mtime.getTime() : Number.POSITIVE_INFINITY;
    if (ageMs < config.intervalHours * 3_600_000) return null;
  }
  return createBackup(db, config.dir, {
    keep: config.keep,
    offsite: config.offsite,
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
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const backup = await runBackupIfDue(db, config);
      if (backup) console.log(`💾 Datensicherung erstellt: ${backup.name}`);
    } catch (error) {
      console.error("Datensicherung fehlgeschlagen:", error);
    } finally {
      running = false;
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
            },
          });
        })(),
      POST: (_req: BunRequest) =>
        handle(async () => {
          if (!config) return err(DISABLED_MESSAGE, 409);
          const backup = await createBackup(db, config.dir, {
            keep: config.keep,
            offsite: config.offsite,
          });
          return json(backup, 201);
        })(),
    },

    "/api/admin/backups/:name": {
      GET: (req: BunRequest<"/api/admin/backups/:name">) =>
        handle(async () => {
          if (!config) return err(DISABLED_MESSAGE, 409);
          const name = req.params.name;
          if (!isBackupName(name))
            throw new ValidationError("Ungültiger Sicherungsname.");
          const file = Bun.file(join(config.dir, name));
          if (!(await file.exists())) return err("Sicherung nicht gefunden.", 404);
          return new Response(file, {
            headers: {
              "Content-Type": "application/vnd.sqlite3",
              "Content-Disposition": `attachment; filename="${name}"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        })(),
    },
  };
}
