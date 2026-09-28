/* ------------------------------------------------------------------ */
/* Datensicherung: VACUUM INTO copies in a temp dir, integrity check,  */
/* retention (local + fake S3), scheduling and the admin routes.       */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "bun";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backupConfigFromEnv,
  backupFileName,
  type BackupConfig,
  backupRoutes,
  createBackup,
  isBackupName,
  listBackups,
  runBackupIfDue,
  verifyBackup,
} from "./backups";
import { openDb } from "./db";
import { openSqlite } from "./sqlite";
import { FakeS3Client } from "./testing/fake-s3";

const root = mkdtempSync(join(tmpdir(), "openfs-backups-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let dirSeq = 0;
const freshDir = () => join(root, `run-${++dirSeq}`);

const db = openDb(":memory:");

describe("backup names", () => {
  test("timestamped local-time name matches the pattern", () => {
    const name = backupFileName(new Date(2026, 8, 28, 3, 4, 5));
    expect(name).toBe("openfs-2026-09-28-030405.db");
    expect(isBackupName(name)).toBe(true);
  });

  test("rejects anything else, including traversal attempts", () => {
    for (const name of [
      "../fahrschule.db",
      "openfs-2026-09-28-030405.db/../../x",
      "openfs-2026-09-28-030405.db.partial",
      "fahrschule.db",
      "openfs-2026-9-28-030405.db",
      "",
    ]) {
      expect(isBackupName(name)).toBe(false);
    }
  });
});

describe("createBackup", () => {
  test("writes a verified copy of the in-memory database", async () => {
    const dir = freshDir();
    const backup = await createBackup(db, dir, { now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(backup.name).toBe("openfs-2026-01-02-030405.db");
    expect(backup.size).toBeGreaterThan(0);
    expect(backup.offsite).toBe(false);

    const path = join(dir, backup.name);
    expect(() => verifyBackup(path)).not.toThrow();
    const copy = openSqlite(path);
    const count = (table: string) =>
      copy.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
    const live = (table: string) =>
      db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
    expect(count("students")).toBe(live("students"));
    expect(count("accounts")).toBe(live("accounts"));
    copy.close();
  });

  test("two backups in the same second get distinct names", async () => {
    const dir = freshDir();
    const now = new Date(2026, 0, 2, 3, 4, 5);
    const a = await createBackup(db, dir, { now });
    const b = await createBackup(db, dir, { now });
    expect(a.name).not.toBe(b.name);
    expect(b.name).toBe("openfs-2026-01-02-030406.db");
  });

  test("keeps only the newest `keep` backups locally", async () => {
    const dir = freshDir();
    for (let i = 0; i < 5; i++) {
      await createBackup(db, dir, { keep: 3, now: new Date(2026, 0, 1 + i, 12) });
    }
    const names = (await listBackups(dir)).map((b) => b.name);
    expect(names).toEqual([
      "openfs-2026-01-05-120000.db",
      "openfs-2026-01-04-120000.db",
      "openfs-2026-01-03-120000.db",
    ]);
  });

  test("uploads offsite and applies the same retention there", async () => {
    const dir = freshDir();
    const client = new FakeS3Client();
    const offsite = {
      client,
      prefix: "schule/backups/",
      label: "bucket/schule/backups/",
    };
    client.objects.set("schule/backups/notes.txt", { bytes: new Uint8Array(1) });
    for (let i = 0; i < 4; i++) {
      const backup = await createBackup(db, dir, {
        keep: 2,
        offsite,
        now: new Date(2026, 1, 1 + i, 8),
      });
      expect(backup.offsite).toBe(true);
    }
    expect([...client.objects.keys()].sort()).toEqual([
      "schule/backups/notes.txt",
      "schule/backups/openfs-2026-02-03-080000.db",
      "schule/backups/openfs-2026-02-04-080000.db",
    ]);
    const listed = await listBackups(dir, offsite);
    expect(listed.map((b) => b.offsite)).toEqual([true, true]);
  });

  test("a failing offsite upload keeps the local backup", async () => {
    const dir = freshDir();
    const client = new FakeS3Client();
    client.failWrites = true;
    const original = console.error;
    console.error = () => {};
    try {
      const backup = await createBackup(db, dir, {
        offsite: { client, prefix: "backups/", label: "x" },
      });
      expect(backup.offsite).toBe(false);
      expect(backup.offsiteError).toContain("S3");
      expect(await Bun.file(join(dir, backup.name)).exists()).toBe(true);
    } finally {
      console.error = original;
    }
  });

  test("verifyBackup rejects a corrupt file", () => {
    const path = join(root, "corrupt.db");
    writeFileSync(path, "definitely not sqlite".repeat(100));
    expect(() => verifyBackup(path)).toThrow();
  });

  test("listBackups ignores foreign files and a missing dir", async () => {
    const dir = freshDir();
    await createBackup(db, dir);
    writeFileSync(join(dir, "fahrschule.db"), "x");
    writeFileSync(join(dir, "openfs-2026-01-01-000000.db.partial"), "x");
    expect(await listBackups(dir)).toHaveLength(1);
    expect(await listBackups(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("runBackupIfDue", () => {
  const config = (dir: string): BackupConfig => ({
    dir,
    keep: 14,
    intervalHours: 24,
    offsite: null,
  });

  test("creates one when none exists, skips while the newest is fresh", async () => {
    const dir = freshDir();
    expect(await runBackupIfDue(db, config(dir))).not.toBeNull();
    expect(await runBackupIfDue(db, config(dir))).toBeNull();
  });

  test("creates a new one once the newest is older than the interval", async () => {
    const dir = freshDir();
    const first = (await runBackupIfDue(db, config(dir)))!;
    const old = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(join(dir, first.name), old, old);
    expect(await runBackupIfDue(db, config(dir))).not.toBeNull();
    expect(await listBackups(dir)).toHaveLength(2);
  });
});

describe("backupConfigFromEnv", () => {
  test("defaults", () => {
    const config = backupConfigFromEnv({});
    expect(config).toMatchObject({
      dir: join("data", "backups"),
      keep: 14,
      intervalHours: 24,
      offsite: null,
    });
  });

  test("reads BACKUP_* and S3_* (client injected)", () => {
    const client = new FakeS3Client();
    const config = backupConfigFromEnv(
      {
        BACKUP_DIR: "/srv/backups",
        BACKUP_KEEP: "7",
        BACKUP_INTERVAL_HOURS: "6",
        S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
        S3_BUCKET: "fs",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
        S3_PREFIX: "muster",
      },
      () => client,
    );
    expect(config.dir).toBe("/srv/backups");
    expect(config.keep).toBe(7);
    expect(config.intervalHours).toBe(6);
    expect(config.offsite?.prefix).toBe("muster/backups/");
    expect(config.offsite?.label).toBe("fs/muster/backups/");
  });

  test("invalid numbers fall back to the defaults", () => {
    const config = backupConfigFromEnv({
      BACKUP_KEEP: "0",
      BACKUP_INTERVAL_HOURS: "abc",
    });
    expect(config.keep).toBe(14);
    expect(config.intervalHours).toBe(24);
  });
});

describe("/api/admin/backups", () => {
  const dir = join(root, "routes");
  let server: ReturnType<typeof serve>;
  let disabled: ReturnType<typeof serve>;

  beforeAll(() => {
    const config: BackupConfig = { dir, keep: 14, intervalHours: 24, offsite: null };
    const notFound = () => new Response("not found", { status: 404 });
    server = serve({ port: 0, routes: backupRoutes(db, config), fetch: notFound });
    disabled = serve({ port: 0, routes: backupRoutes(db, null), fetch: notFound });
  });

  afterAll(() => {
    server.stop(true);
    disabled.stop(true);
  });

  const url = (path: string, target = server) => new URL(path, target.url).href;

  test("POST creates, GET lists with config summary", async () => {
    const created = await fetch(url("/api/admin/backups"), { method: "POST" });
    expect(created.status).toBe(201);
    const backup = await created.json();
    expect(isBackupName(backup.name)).toBe(true);

    const list = await (await fetch(url("/api/admin/backups"))).json();
    expect(list.enabled).toBe(true);
    expect(list.backups[0]).toMatchObject({ name: backup.name, offsite: false });
    expect(list.config).toMatchObject({ keep: 14, intervalHours: 24, offsite: null });
  });

  test("GET :name downloads a valid backup as attachment", async () => {
    const { backups } = await (await fetch(url("/api/admin/backups"))).json();
    const res = await fetch(url(`/api/admin/backups/${backups[0].name}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${backups[0].name}"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe("SQLite format 3");
  });

  test("GET :name rejects invalid names and 404s unknown ones", async () => {
    for (const name of ["fahrschule.db", "..%2Ffahrschule.db", "openfs-x.db"]) {
      expect((await fetch(url(`/api/admin/backups/${name}`))).status).toBe(400);
    }
    expect(
      (await fetch(url("/api/admin/backups/openfs-1999-01-01-000000.db"))).status,
    ).toBe(404);
  });

  test("disabled (demo mode): GET reports it, POST and download refuse", async () => {
    const list = await (await fetch(url("/api/admin/backups", disabled))).json();
    expect(list.enabled).toBe(false);
    expect(list.message).toContain("Demo-Modus");
    expect(
      (await fetch(url("/api/admin/backups", disabled), { method: "POST" })).status,
    ).toBe(409);
  });
});
