/* ------------------------------------------------------------------ */
/* Wiederherstellung: set / archive / legacy sources, the safety       */
/* checks (database open elsewhere, server answering, wrong school,    */
/* damaged backup), moving current data aside, per-school restores     */
/* and the rollback on failure. Temp directories only.                 */
/* ------------------------------------------------------------------ */

import { afterAll, describe, expect, test } from "bun:test";
import { serve } from "bun";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupArchiveSources, createBackup, readManifest } from "./backups";
import { openDb } from "./db";
import { DiskFileStore, type FileStore, PrefixedFileStore } from "./file-store";
import { healthRoutes } from "./health";
import {
  openRestoreSource,
  processesUsing,
  RestoreError,
  restoreBackup,
  type RestoreTarget,
} from "./restore";
import { openSqlite } from "./sqlite";
import { ensureStudentFileTables, uploadStudentFile } from "./student-files";
import { createStudent } from "./students";
import { saveStream, tarStream } from "./tar";

const root = mkdtempSync(join(tmpdir(), "openfs-restore-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let seq = 0;
const fresh = () => join(root, `r${++seq}`);

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);

const studentNames = (dbPath: string) => {
  const db = openSqlite(dbPath);
  try {
    return db
      .query<{ last_name: string }, []>("SELECT last_name FROM students ORDER BY id")
      .all()
      .map((row) => row.last_name);
  } finally {
    db.close();
  }
};

/** A school on disk (file DB + disk store) with one student and `n`
 *  documents, backed up once. */
async function schoolOnDisk(options: { tenant?: string; n?: number } = {}) {
  const dir = fresh();
  const tenant = options.tenant ?? null;
  const dbPath = join(dir, tenant ? `tenants/${tenant}.db` : "fahrschule.db");
  const filesRoot = join(dir, "files");
  const disk = new DiskFileStore(filesRoot);
  const store: FileStore = tenant ? new PrefixedFileStore(disk, `${tenant}/`) : disk;
  const backupDir = join(dir, "backups", ...(tenant ? [tenant] : []));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = openDb(dbPath, { demoData: false });
  ensureStudentFileTables(db);
  const student = createStudent(db, {
    firstName: "Gesichert",
    lastName: "Vorher",
    contractNumber: `R-V-${seq}`,
    customerNumber: `R-K-${seq}`,
  });
  const files = [];
  for (let i = 0; i < (options.n ?? 2); i++) {
    files.push(
      await uploadStudentFile(db, store, student.id, {
        name: `d${i}.pdf`,
        bytes: pdf(`${tenant ?? "single"} ${i}`),
      }),
    );
  }
  const backup = await createBackup(db, backupDir, { fileStore: store, tenant });
  const target: RestoreTarget = {
    dbPath,
    fileStore: store,
    filesDir: tenant ? join(filesRoot, tenant) : filesRoot,
    tenant,
  };
  return {
    dir,
    db,
    dbPath,
    store,
    disk,
    filesRoot,
    backupDir,
    backup,
    files,
    student,
    target,
  };
}

type School = Awaited<ReturnType<typeof schoolOnDisk>>;

/** Changes after the backup: a new student and one more document. */
async function changeAfterBackup(school: School) {
  createStudent(school.db, {
    firstName: "Nach",
    lastName: "Nachher",
    contractNumber: `R-N-${seq}`,
    customerNumber: `R-NK-${seq}`,
  });
  await uploadStudentFile(school.db, school.store, school.student.id, {
    name: "neu.pdf",
    bytes: pdf("nachher"),
  });
}

const source = (school: School, input?: string) =>
  openRestoreSource(input ?? school.backup.name, {
    backupDir: school.backupDir,
    workDir: school.dir,
  });

async function storedBytes(store: FileStore, key: string) {
  const bytes = await store.get(key);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

describe("restoreBackup", () => {
  test("restores database + documents and keeps the current data aside", async () => {
    const school = await schoolOnDisk();
    await changeAfterBackup(school);
    school.db.close();

    const report = await restoreBackup(await source(school), school.target, {
      now: new Date(2026, 8, 28, 12, 0, 0),
    });
    expect(report.fileCount).toBe(2);
    expect(report.databaseOnly).toBe(false);
    expect(studentNames(school.dbPath)).toEqual(["Vorher"]);
    const manifest = await readManifest(join(school.backupDir, school.backup.name));
    for (const file of manifest.files) {
      const bytes = (await school.store.get(file.key))!;
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
        file.sha256,
      );
    }
    // The document uploaded after the backup is gone from the live store …
    expect(
      readdirSync(join(school.filesRoot, "students", String(school.student.id))),
    ).toHaveLength(2);
    // … but kept aside together with the newer database.
    const aside = `${school.filesRoot}.before-restore-20260928-120000`;
    expect(report.movedAside).toContain(aside);
    expect(report.movedAside).toContain(
      `${school.dbPath}.before-restore-20260928-120000`,
    );
    expect(readdirSync(join(aside, "students", String(school.student.id)))).toHaveLength(
      3,
    );
    expect(studentNames(`${school.dbPath}.before-restore-20260928-120000`)).toEqual([
      "Vorher",
      "Nachher",
    ]);
  });

  test("restores into an empty data directory (after a disaster)", async () => {
    const school = await schoolOnDisk();
    school.db.close();
    for (const path of [school.dbPath, `${school.dbPath}-wal`, `${school.dbPath}-shm`]) {
      rmSync(path, { force: true });
    }
    rmSync(school.filesRoot, { recursive: true });
    const report = await restoreBackup(await source(school), school.target);
    expect(report.movedAside).toEqual([]);
    expect(studentNames(school.dbPath)).toEqual(["Vorher"]);
    expect(
      readdirSync(join(school.filesRoot, "students", String(school.student.id))),
    ).toHaveLength(2);
  });

  test("restores from the downloaded .tar archive", async () => {
    const school = await schoolOnDisk();
    await changeAfterBackup(school);
    school.db.close();
    const archive = join(school.dir, `${school.backup.name}.tar`);
    const sources = await backupArchiveSources(
      join(school.backupDir, school.backup.name),
    );
    await saveStream(tarStream(sources), archive);
    // The backup directory itself is lost — only the download is left.
    rmSync(join(school.dir, "backups"), { recursive: true });

    const from = await source(school, archive);
    try {
      const report = await restoreBackup(from, school.target);
      expect(report.fileCount).toBe(2);
    } finally {
      await from.cleanup();
    }
    expect(studentNames(school.dbPath)).toEqual(["Vorher"]);
    // The extraction scratch dir is cleaned up.
    expect(readdirSync(school.dir).some((n) => n.startsWith(".restore-extract"))).toBe(
      false,
    );
  });

  test("a legacy .db backup restores the database only", async () => {
    const school = await schoolOnDisk();
    const legacy = join(school.backupDir, "openfs-2020-01-01-000000.db");
    await Bun.write(legacy, school.db.serialize());
    await changeAfterBackup(school);
    school.db.close();
    const from = await source(school, "openfs-2020-01-01-000000.db");
    expect(from.kind).toBe("legacy");
    const report = await restoreBackup(from, school.target);
    expect(report.databaseOnly).toBe(true);
    expect(studentNames(school.dbPath)).toEqual(["Vorher"]);
    // Documents are left alone.
    expect(
      readdirSync(join(school.filesRoot, "students", String(school.student.id))),
    ).toHaveLength(3);
  });

  test("restoring one school leaves the other school untouched", async () => {
    // Two schools sharing one file store root and data dir layout.
    const a = await schoolOnDisk({ tenant: "fs-a" });
    const bStore = new PrefixedFileStore(a.disk, "fs-b/");
    await bStore.put("students/1/keep", pdf("fs-b bleibt"), "application/pdf");
    await changeAfterBackup(a);
    a.db.close();

    const report = await restoreBackup(await source(a), a.target);
    expect(report.tenant).toBe("fs-a");
    expect(studentNames(a.dbPath)).toEqual(["Vorher"]);
    expect(await storedBytes(bStore, "students/1/keep")).toContain("fs-b bleibt");
    // Only fs-a's document directory was moved aside.
    const asideDirs = report.movedAside.filter((p) => p.startsWith(a.filesRoot));
    expect(asideDirs).toHaveLength(1);
    expect(asideDirs[0]!.startsWith(`${join(a.filesRoot, "fs-a")}.before-restore-`)).toBe(
      true,
    );
  });
});

describe("safety checks", () => {
  test("refuses while another process holds the database open", async () => {
    const school = await schoolOnDisk();
    school.db.close();
    const holder = Bun.spawn(
      [
        "bun",
        "-e",
        `const { Database } = require("bun:sqlite"); const db = new Database(${JSON.stringify(
          school.dbPath,
        )}); db.query("SELECT 1").get(); console.log("open"); setTimeout(() => {}, 30000);`,
      ],
      { stdout: "pipe" },
    );
    try {
      const reader = holder.stdout.getReader();
      await reader.read(); // "open"
      expect((await processesUsing(school.dbPath)).pids).toContain(holder.pid);
      const from = await source(school);
      await expect(restoreBackup(from, school.target)).rejects.toThrow("noch geöffnet");
      // Nothing was moved.
      expect(existsSync(school.dbPath)).toBe(true);
      expect(readdirSync(school.dir).some((n) => n.includes("before-restore"))).toBe(
        false,
      );
    } finally {
      holder.kill();
      await holder.exited;
    }
  });

  test("refuses while the server answers its health URL", async () => {
    const school = await schoolOnDisk();
    school.db.close();
    const server = serve({
      port: 0,
      routes: healthRoutes(),
      fetch: () => new Response("", { status: 404 }),
    });
    try {
      await expect(
        restoreBackup(await source(school), school.target, {
          checkUrl: `http://127.0.0.1:${server.port}/api/health`,
        }),
      ).rejects.toThrow("antwortet noch");
    } finally {
      server.stop(true);
    }
  });

  test("refuses a damaged backup", async () => {
    const school = await schoolOnDisk();
    const manifest = await readManifest(join(school.backupDir, school.backup.name));
    writeFileSync(
      join(
        school.backupDir,
        school.backup.name,
        "files",
        ...manifest.files[0]!.key.split("/"),
      ),
      "kaputt",
    );
    await expect(source(school)).rejects.toThrow(RestoreError);
    await expect(source(school)).rejects.toThrow("fehlerhaft");
  });

  test("refuses a backup of another school (even with --force)", async () => {
    const a = await schoolOnDisk({ tenant: "fs-a" });
    a.db.close();
    const wrong = { ...a.target, tenant: "fs-b" };
    await expect(restoreBackup(await source(a), wrong)).rejects.toThrow("fs-a");
    await expect(restoreBackup(await source(a), wrong, { force: true })).rejects.toThrow(
      "fs-a",
    );
    // Single-school target: refused, --force allows it (e.g. moving a school out).
    const single = { ...a.target, tenant: null };
    await expect(restoreBackup(await source(a), single)).rejects.toThrow("Einzelbetrieb");
  });

  test("rolls back when writing the documents fails", async () => {
    const school = await schoolOnDisk();
    await changeAfterBackup(school);
    school.db.close();
    const failing: FileStore = {
      put: async () => {
        throw new Error("Platte voll");
      },
      get: async () => null,
      delete: async () => {},
    };
    await expect(
      restoreBackup(await source(school), { ...school.target, fileStore: failing }),
    ).rejects.toThrow("Platte voll");
    // Current data is back in place, nothing left aside.
    expect(studentNames(school.dbPath)).toEqual(["Vorher", "Nachher"]);
    expect(
      readdirSync(join(school.filesRoot, "students", String(school.student.id))),
    ).toHaveLength(3);
    expect(readdirSync(school.dir).some((n) => n.includes("before-restore"))).toBe(false);
  });

  test("unknown sources are refused", async () => {
    const school = await schoolOnDisk();
    await expect(source(school, join(school.dir, "nope"))).rejects.toThrow(
      "nicht gefunden",
    );
    const junk = join(school.dir, "junk.bin");
    writeFileSync(junk, "hallo");
    await expect(source(school, junk)).rejects.toThrow("keine OpenFS-Sicherung");
  });
});
