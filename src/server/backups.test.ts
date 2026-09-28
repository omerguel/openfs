/* ------------------------------------------------------------------ */
/* Datensicherung: backup sets (VACUUM INTO copy + documents +         */
/* manifest) in a temp dir, hard-linked unchanged documents, integrity */
/* verification, retention incl. documents (local + fake S3), legacy   */
/* single-file backups, per-school sets, scheduling and admin routes.  */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backupConfigFromEnv,
  backupFileName,
  backupSetName,
  type BackupConfig,
  backupRoutes,
  createBackup,
  databaseFile,
  isBackupName,
  isBackupSetName,
  listBackups,
  readManifest,
  runBackupIfDue,
  verifyBackup,
  verifyBackupSet,
} from "./backups";
import { openDb } from "./db";
import { DiskFileStore, MemoryFileStore } from "./file-store";
import { openSqlite } from "./sqlite";
import { ensureStudentFileTables, uploadStudentFile } from "./student-files";
import { createStudent } from "./students";
import { extractTar } from "./tar";
import { tenantBackupConfig } from "./tenancy";
import { requestContext } from "./request-context";
import { FakeS3Client } from "./testing/fake-s3";
import { TenantFileStore } from "./tenancy";

const root = mkdtempSync(join(tmpdir(), "openfs-backups-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let dirSeq = 0;
const freshDir = () => join(root, `run-${++dirSeq}`);

const db = openDb(":memory:");

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);

let studentSeq = 0;
function newStudent(target = db) {
  studentSeq += 1;
  return createStudent(target, {
    firstName: "Sicher",
    lastName: `Ung${studentSeq}`,
    contractNumber: `BK-V-${studentSeq}`,
    customerNumber: `BK-K-${studentSeq}`,
  });
}

/** A school database with `n` uploaded documents in `store`. */
async function schoolWithFiles(store: DiskFileStore | MemoryFileStore, n = 2) {
  const school = openDb(":memory:");
  ensureStudentFileTables(school);
  const student = newStudent(school);
  const files = [];
  for (let i = 0; i < n; i++) {
    files.push(
      await uploadStudentFile(school, store, student.id, {
        name: `dok-${i}.pdf`,
        bytes: pdf(`Dokument ${i} ${"x".repeat(i * 100)}`),
      }),
    );
  }
  return { school, student, files };
}

const inode = (path: string) => statSync(path).ino;

describe("backup names", () => {
  test("timestamped local-time names match the patterns", () => {
    const date = new Date(2026, 8, 28, 3, 4, 5);
    expect(backupSetName(date)).toBe("openfs-2026-09-28-030405");
    expect(backupFileName(date)).toBe("openfs-2026-09-28-030405.db");
    expect(isBackupName(backupSetName(date))).toBe(true);
    expect(isBackupName(backupFileName(date))).toBe(true);
    expect(isBackupSetName(backupFileName(date))).toBe(false);
  });

  test("rejects anything else, including traversal attempts", () => {
    for (const name of [
      "../fahrschule.db",
      "openfs-2026-09-28-030405.db/../../x",
      "openfs-2026-09-28-030405.db.partial",
      "openfs-2026-09-28-030405.partial",
      "openfs-2026-09-28-030405/files",
      "fahrschule.db",
      "openfs-2026-9-28-030405.db",
      "",
    ]) {
      expect(isBackupName(name)).toBe(false);
    }
  });
});

describe("createBackup", () => {
  test("a set holds a verified database copy and a manifest", async () => {
    const dir = freshDir();
    const backup = await createBackup(db, dir, { now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(backup.name).toBe("openfs-2026-01-02-030405");
    expect(backup.kind).toBe("set");
    expect(backup.databaseSize).toBeGreaterThan(0);
    expect(backup.filesIncluded).toBe(false);
    expect(backup.offsite).toBe(false);

    const set = join(dir, backup.name);
    expect(readdirSync(set).sort()).toEqual(["database.db", "manifest.json"]);
    const manifest = await readManifest(set);
    expect(manifest).toMatchObject({
      kind: "openfs-backup",
      format: 1,
      name: backup.name,
      tenant: null,
      fileCount: 0,
      database: { path: "database.db", size: backup.databaseSize },
    });
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.app.version).toBeTruthy();

    const path = join(set, "database.db");
    expect(() => verifyBackup(path)).not.toThrow();
    const copy = openSqlite(path);
    const count = (target: typeof db, table: string) =>
      target.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
    expect(count(copy, "students")).toBe(count(db, "students"));
    expect(count(copy, "accounts")).toBe(count(db, "accounts"));
    copy.close();
    expect((await verifyBackupSet(set)).ok).toBe(true);
  });

  test("copies the referenced documents and records them in the manifest", async () => {
    const store = new DiskFileStore(freshDir());
    const { school, files } = await schoolWithFiles(store, 3);
    const dir = freshDir();
    const backup = await createBackup(school, dir, { fileStore: store });
    expect(backup.fileCount).toBe(3);
    expect(backup.fileBytes).toBe(files.reduce((sum, f) => sum + f.size, 0));
    expect(backup.size).toBe(backup.databaseSize + backup.fileBytes);

    const manifest = await readManifest(join(dir, backup.name));
    expect(manifest.filesIncluded).toBe(true);
    expect(manifest.files.map((f) => f.sha256).sort()).toEqual(
      files.map((f) => f.sha256).sort(),
    );
    for (const entry of manifest.files) {
      const copy = join(dir, backup.name, "files", ...entry.key.split("/"));
      expect(Buffer.from(await Bun.file(copy).bytes())).toEqual(
        Buffer.from((await store.get(entry.key))!),
      );
    }
    expect(await verifyBackupSet(join(dir, backup.name))).toMatchObject({
      ok: true,
      problems: [],
    });
  });

  test("unchanged documents are hard-linked from the previous set", async () => {
    const store = new DiskFileStore(freshDir());
    const { school, student } = await schoolWithFiles(store, 2);
    const dir = freshDir();
    const first = await createBackup(school, dir, {
      fileStore: store,
      now: new Date(2026, 0, 1, 10),
    });
    await uploadStudentFile(school, store, student.id, {
      name: "neu.pdf",
      bytes: pdf("neu"),
    });
    const second = await createBackup(school, dir, {
      fileStore: store,
      now: new Date(2026, 0, 2, 10),
    });
    expect(second.fileCount).toBe(3);
    const a = await readManifest(join(dir, first.name));
    for (const entry of a.files) {
      const parts = entry.key.split("/");
      expect(inode(join(dir, second.name, "files", ...parts))).toBe(
        inode(join(dir, first.name, "files", ...parts)),
      );
    }
    // Deleting the older set (retention) leaves the newer one complete.
    rmSync(join(dir, first.name), { recursive: true });
    expect((await verifyBackupSet(join(dir, second.name))).ok).toBe(true);
  });

  test("a document missing from the store is recorded, not fatal", async () => {
    const store = new MemoryFileStore();
    const { school, files } = await schoolWithFiles(store, 2);
    const lost = school
      .query<{ storage_key: string }, [number]>(
        "SELECT storage_key FROM student_files WHERE id = ?",
      )
      .get(files[0]!.id)!.storage_key;
    await store.delete(lost);
    const original = console.warn;
    console.warn = () => {};
    try {
      const dir = freshDir();
      const backup = await createBackup(school, dir, { fileStore: store });
      expect(backup.fileCount).toBe(1);
      expect(backup.missingFiles).toBe(1);
      const manifest = await readManifest(join(dir, backup.name));
      expect(manifest.missingFiles).toEqual([lost]);
      // Known-missing documents do not fail the verification.
      expect((await verifyBackupSet(join(dir, backup.name))).ok).toBe(true);
    } finally {
      console.warn = original;
    }
  });

  test("two backups in the same second get distinct names", async () => {
    const dir = freshDir();
    const now = new Date(2026, 0, 2, 3, 4, 5);
    const a = await createBackup(db, dir, { now });
    const b = await createBackup(db, dir, { now });
    expect(a.name).not.toBe(b.name);
    expect(b.name).toBe("openfs-2026-01-02-030406");
  });

  test("concurrent backups of one directory run one after the other", async () => {
    const dir = freshDir();
    const now = new Date(2026, 0, 3, 3, 4, 5);
    const names = (
      await Promise.all([
        createBackup(db, dir, { now }),
        createBackup(db, dir, { now }),
        createBackup(db, dir, { now }),
      ])
    ).map((b) => b.name);
    expect(new Set(names).size).toBe(3);
    expect(readdirSync(dir).filter((n) => n.endsWith(".partial"))).toEqual([]);
  });

  test("retention keeps the newest `keep` sets — with their documents", async () => {
    const store = new DiskFileStore(freshDir());
    const { school } = await schoolWithFiles(store, 1);
    const dir = freshDir();
    // A legacy single-file backup counts towards the same retention.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "openfs-2025-12-31-120000.db"), "old");
    for (let i = 0; i < 5; i++) {
      await createBackup(school, dir, {
        keep: 3,
        fileStore: store,
        now: new Date(2026, 0, 1 + i, 12),
      });
    }
    expect(readdirSync(dir).sort()).toEqual([
      "openfs-2026-01-03-120000",
      "openfs-2026-01-04-120000",
      "openfs-2026-01-05-120000",
    ]);
    for (const name of readdirSync(dir)) {
      expect((await verifyBackupSet(join(dir, name))).ok).toBe(true);
    }
  });

  test("uploads database + manifest offsite and applies retention there", async () => {
    const dir = freshDir();
    const client = new FakeS3Client();
    const offsite = {
      client,
      prefix: "schule/backups/",
      label: "bucket/schule/backups/",
    };
    client.objects.set("schule/backups/notes.txt", { bytes: new Uint8Array(1) });
    // An offsite copy from the single-file era.
    client.objects.set("schule/backups/openfs-2026-01-01-080000.db", {
      bytes: new Uint8Array(1),
    });
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
      "schule/backups/openfs-2026-02-03-080000.manifest.json",
      "schule/backups/openfs-2026-02-04-080000.db",
      "schule/backups/openfs-2026-02-04-080000.manifest.json",
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
      expect(existsSync(join(dir, backup.name, "database.db"))).toBe(true);
    } finally {
      console.error = original;
    }
  });

  test("verifyBackup rejects a corrupt file", () => {
    const path = join(root, "corrupt.db");
    writeFileSync(path, "definitely not sqlite".repeat(100));
    expect(() => verifyBackup(path)).toThrow();
  });

  test("listBackups: sets and legacy files, ignores foreign entries and a missing dir", async () => {
    const dir = freshDir();
    await createBackup(db, dir, { now: new Date(2026, 5, 1, 9) });
    writeFileSync(join(dir, "openfs-2026-01-01-000000.db"), "legacy");
    writeFileSync(join(dir, "fahrschule.db"), "x");
    writeFileSync(join(dir, "openfs-2026-01-01-000000.db.partial"), "x");
    mkdirSync(join(dir, "openfs-2026-07-01-000000")); // no manifest: incomplete
    const listed = await listBackups(dir);
    expect(listed.map((b) => [b.name, b.kind])).toEqual([
      ["openfs-2026-06-01-090000", "set"],
      ["openfs-2026-01-01-000000.db", "legacy"],
    ]);
    expect(await listBackups(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("verifyBackupSet", () => {
  async function setWithFiles() {
    const store = new DiskFileStore(freshDir());
    const { school } = await schoolWithFiles(store, 2);
    const dir = freshDir();
    const backup = await createBackup(school, dir, { fileStore: store });
    const set = join(dir, backup.name);
    const manifest = await readManifest(set);
    return { set, manifest };
  }

  test("detects a changed database", async () => {
    const { set } = await setWithFiles();
    const path = join(set, "database.db");
    const copy = openSqlite(path);
    copy.run("UPDATE students SET first_name = 'Manipuliert'");
    copy.close();
    const result = await verifyBackupSet(set);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("Prüfsumme");
  });

  test("detects a changed and a missing document", async () => {
    const { set, manifest } = await setWithFiles();
    const [a, b] = manifest.files;
    writeFileSync(join(set, "files", ...a!.key.split("/")), "kaputt");
    rmSync(join(set, "files", ...b!.key.split("/")));
    const result = await verifyBackupSet(set);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(`Dokument beschädigt: ${a!.key}`);
    expect(result.problems).toContain(`Dokument fehlt: ${b!.key}`);
  });

  test("detects a manifest that leaves out a referenced document", async () => {
    const { set, manifest } = await setWithFiles();
    const trimmed = { ...manifest, files: manifest.files.slice(1), fileCount: 1 };
    writeFileSync(join(set, "manifest.json"), JSON.stringify(trimmed));
    const result = await verifyBackupSet(set);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `Nicht in der Sicherung: ${manifest.files[0]!.key}`,
    );
  });

  test("rejects a directory without manifest and unsafe keys", async () => {
    const empty = freshDir();
    mkdirSync(empty);
    expect((await verifyBackupSet(empty)).problems).toEqual(["manifest.json fehlt."]);

    const { set, manifest } = await setWithFiles();
    const evil = {
      ...manifest,
      files: [...manifest.files, { key: "../../etc/passwd", size: 1, sha256: "x" }],
      fileCount: manifest.files.length + 1,
    };
    writeFileSync(join(set, "manifest.json"), JSON.stringify(evil));
    expect((await verifyBackupSet(set)).problems).toContain(
      "Ungültiger Dateiname im Manifest: ../../etc/passwd",
    );
  });
});

describe("multi-tenant", () => {
  test("a school's set holds only that school's documents", async () => {
    const base = new MemoryFileStore();
    const tenantStore = new TenantFileStore(base);
    const schools: Record<string, ReturnType<typeof openDb>> = {};
    for (const slug of ["fs-a", "fs-b"]) {
      const school = openDb(":memory:");
      ensureStudentFileTables(school);
      schools[slug] = school;
      await requestContext.run({ db: school, tenant: slug }, async () => {
        const student = newStudent(school);
        await uploadStudentFile(school, tenantStore, student.id, {
          name: `${slug}.pdf`,
          bytes: pdf(slug),
        });
      });
    }
    expect([...base.files.keys()].every((k) => /^fs-[ab]\/students\//.test(k))).toBe(
      true,
    );

    const dir = freshDir();
    const config = tenantBackupConfig(
      { dir, keep: 3, intervalHours: 24, offsite: null, fileStore: base },
      "fs-a",
    );
    expect(config.dir).toBe(join(dir, "fs-a"));
    const backup = (await runBackupIfDue(schools["fs-a"]!, config))!;
    const manifest = await readManifest(join(config.dir, backup.name));
    expect(manifest.tenant).toBe("fs-a");
    expect(manifest.fileCount).toBe(1);
    const copy = join(
      config.dir,
      backup.name,
      "files",
      ...manifest.files[0]!.key.split("/"),
    );
    expect(new TextDecoder().decode(await Bun.file(copy).bytes())).toContain("fs-a");
    expect(existsSync(join(dir, "fs-b"))).toBe(false);
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
    const start = new Date(2026, 3, 1, 8);
    expect(await runBackupIfDue(db, config(dir), start)).not.toBeNull();
    const later = new Date(start.getTime() + 23 * 3_600_000);
    expect(await runBackupIfDue(db, config(dir), later)).toBeNull();
    const due = new Date(start.getTime() + 25 * 3_600_000);
    expect(await runBackupIfDue(db, config(dir), due)).not.toBeNull();
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

  test("names where uploaded documents live (FILE_STORE_DIR, default, S3)", () => {
    expect(backupConfigFromEnv({}).files).toBe(join("data", "files"));
    expect(backupConfigFromEnv({ FILE_STORE_DIR: "/srv/files" }).files).toBe(
      "/srv/files",
    );
  });

  test("documents are included unless BACKUP_FILES=0", () => {
    const store = new MemoryFileStore();
    expect(backupConfigFromEnv({}, undefined, store).fileStore).toBe(store);
    expect(backupConfigFromEnv({ BACKUP_FILES: "0" }, undefined, store).fileStore).toBe(
      null,
    );
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
  const store = new MemoryFileStore();
  let school: ReturnType<typeof openDb>;
  let server: ReturnType<typeof serve>;
  let disabled: ReturnType<typeof serve>;

  beforeAll(async () => {
    ({ school } = await schoolWithFiles(store, 2));
    const config: BackupConfig = {
      dir,
      keep: 14,
      intervalHours: 24,
      offsite: null,
      fileStore: store,
    };
    const notFound = () => new Response("not found", { status: 404 });
    server = serve({ port: 0, routes: backupRoutes(school, config), fetch: notFound });
    disabled = serve({ port: 0, routes: backupRoutes(db, null), fetch: notFound });
  });

  afterAll(() => {
    server.stop(true);
    disabled.stop(true);
  });

  const url = (path: string, target = server) => new URL(path, target.url).href;

  test("POST creates, GET lists with contents and config summary", async () => {
    const created = await fetch(url("/api/admin/backups"), { method: "POST" });
    expect(created.status).toBe(201);
    const backup = await created.json();
    expect(isBackupName(backup.name)).toBe(true);
    expect(backup.fileCount).toBe(2);

    const list = await (await fetch(url("/api/admin/backups"))).json();
    expect(list.enabled).toBe(true);
    expect(list.backups[0]).toMatchObject({
      name: backup.name,
      kind: "set",
      offsite: false,
      fileCount: 2,
    });
    expect(list.config).toMatchObject({
      keep: 14,
      intervalHours: 24,
      offsite: null,
      filesIncluded: true,
    });
    // In-memory test DB: no file — the restore steps then name no path.
    expect(list.config.dbPath).toBe("");
  });

  test("the configured database file is reported for the restore steps", () => {
    const path = join(root, "custom-name.db");
    const fileDb = openSqlite(path);
    try {
      expect(databaseFile(fileDb)).toBe(path);
    } finally {
      fileDb.close();
    }
  });

  test("GET :name downloads the whole set as a verifiable tar archive", async () => {
    const { backups } = await (await fetch(url("/api/admin/backups"))).json();
    const name = backups[0].name;
    const res = await fetch(url(`/api/admin/backups/${name}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${name}.tar"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    const out = freshDir();
    const extracted = await extractTar(new Response(bytes).body!, out);
    expect(extracted.slice(0, 2)).toEqual([
      `${name}/manifest.json`,
      `${name}/database.db`,
    ]);
    expect(extracted).toHaveLength(4);
    expect((await verifyBackupSet(join(out, name))).ok).toBe(true);
  });

  test("POST :name/verify re-checks a set", async () => {
    const { backups } = await (await fetch(url("/api/admin/backups"))).json();
    const res = await fetch(url(`/api/admin/backups/${backups[0].name}/verify`), {
      method: "POST",
    });
    expect(await res.json()).toEqual({ ok: true, problems: [] });
  });

  test("legacy .db backups still download as the bare file", async () => {
    const legacy = "openfs-2020-01-01-000000.db";
    await Bun.write(join(dir, legacy), school.serialize());
    const res = await fetch(url(`/api/admin/backups/${legacy}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${legacy}"`,
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
    expect((await fetch(url("/api/admin/backups/openfs-1999-01-01-000000"))).status).toBe(
      404,
    );
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
