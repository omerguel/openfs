/* ------------------------------------------------------------------ */
/* Wiederherstellung einer Datensicherung (Datenbank + Dokumente).     */
/* Uses the same environment as the server (DB_PATH, FILE_STORE_DIR,   */
/* S3_*, BACKUP_DIR, MULTI_TENANT, TENANTS_DIR, REGISTRY_PATH, PORT).  */
/*                                                                     */
/*   bun run restore list   [--tenant <slug>]                          */
/*   bun run restore verify <sicherung>  [--tenant <slug>]             */
/*   bun run restore restore <sicherung> [--tenant <slug>] [--force]   */
/*                                       [--check-url <url> | --no-url-check] */
/*                                                                     */
/* <sicherung> is a name from `list` (openfs-YYYY-MM-DD-HHMMSS), a     */
/* backup set directory, the .tar archive downloaded on               */
/* /datensicherung, or a legacy .db file. Stop the server first; the   */
/* current data is moved aside (…before-restore-<zeit>), never deleted. */
/* See docs/operations.md.                                             */
/* ------------------------------------------------------------------ */

import { join, resolve } from "node:path";

import {
  backupConfigFromEnv,
  listBackups,
  verifyBackup,
  verifyBackupSet,
} from "../src/server/backups";
import {
  createFileStoreFromEnv,
  type FileStore,
  PrefixedFileStore,
  s3ConfigFromEnv,
} from "../src/server/file-store";
import {
  openRestoreSource,
  RestoreError,
  restoreBackup,
  type RestoreTarget,
} from "../src/server/restore";
import { Registry, tenancyConfigFromEnv } from "../src/server/tenancy";

const env = process.env;
const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): boolean {
  return args.includes(name);
}
function option(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}
const positional = args.slice(1).filter((arg, i, all) => {
  if (arg.startsWith("--")) return false;
  const previous = all[i - 1];
  return !(previous === "--tenant" || previous === "--check-url");
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const tenancy = tenancyConfigFromEnv(env);
const tenant = option("--tenant");
if (tenancy && !tenant && command !== undefined && command !== "help") {
  fail("Mehrmandantenbetrieb (MULTI_TENANT=1): bitte --tenant <slug> angeben.");
}
if (!tenancy && tenant) fail("--tenant gibt es nur mit MULTI_TENANT=1.");

const baseBackups = backupConfigFromEnv(env);
const backupDir = tenant ? join(baseBackups.dir, tenant) : baseBackups.dir;

function target(): RestoreTarget {
  const { store: baseStore, kind } = createFileStoreFromEnv({ demoMode: false, env });
  const filesRoot = resolve(env.FILE_STORE_DIR?.trim() || join("data", "files"));
  if (tenancy && tenant) {
    const registry = Registry.open(tenancy.registryPath);
    const known = registry.get(tenant);
    registry.db.close();
    if (!known) {
      fail(
        `Fahrschule „${tenant}“ ist nicht in ${tenancy.registryPath} registriert. ` +
          `Erst eintragen: bun scripts/tenant.ts register ${tenant} "<Name>" <email>`,
      );
    }
    const store: FileStore = new PrefixedFileStore(baseStore, `${tenant}/`);
    return {
      dbPath: join(tenancy.dir, `${tenant}.db`),
      fileStore: store,
      filesDir: kind === "disk" ? join(filesRoot, tenant) : null,
      tenant,
    };
  }
  return {
    dbPath: env.DB_PATH?.trim() || join("data", "fahrschule.db"),
    fileStore: baseStore,
    filesDir: kind === "disk" ? filesRoot : null,
    tenant: null,
  };
}

const formatBytes = (n: number) =>
  n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  switch (command) {
    case "list": {
      const backups = await listBackups(backupDir);
      if (backups.length === 0) console.log(`Keine Sicherungen in ${backupDir}`);
      for (const backup of backups) {
        const contents =
          backup.kind === "legacy"
            ? "nur Datenbank (altes Format)"
            : `Datenbank + ${backup.fileCount} Dokument(e)`;
        console.log(
          `${backup.name.padEnd(30)} ${backup.createdAt}  ${formatBytes(backup.size).padStart(10)}  ${contents}`,
        );
      }
      return;
    }
    case "verify": {
      const input =
        positional[0] ?? fail("Welche Sicherung? (Name, Ordner, .tar oder .db)");
      const source = await openRestoreSource(input, { backupDir, workDir: backupDir });
      try {
        if (source.kind === "legacy") {
          verifyBackup(source.file);
          console.log(`✓ ${source.file}: Integritätsprüfung ok (nur Datenbank).`);
          return;
        }
        const result = await verifyBackupSet(source.dir);
        if (!result.ok) fail(`Sicherung fehlerhaft:\n  ${result.problems.join("\n  ")}`);
        const m = source.manifest;
        console.log(
          `✓ ${m.name}: Datenbank (${formatBytes(m.database.size)}) + ${m.fileCount} Dokument(e) (${formatBytes(m.fileBytes)}) geprüft` +
            ` — erstellt ${m.createdAt} mit OpenFS ${m.app.version}${m.app.commit ? ` (${m.app.commit})` : ""}` +
            (m.tenant ? `, Fahrschule ${m.tenant}` : ""),
        );
      } finally {
        await source.cleanup();
      }
      return;
    }
    case "restore": {
      const input =
        positional[0] ?? fail("Welche Sicherung? (Name, Ordner, .tar oder .db)");
      const to = target();
      const checkUrl = flag("--no-url-check")
        ? null
        : (option("--check-url") ??
          `http://${env.HOST && env.HOST !== "0.0.0.0" ? env.HOST : "127.0.0.1"}:${env.PORT ?? "3000"}/api/health`);
      const source = await openRestoreSource(input, { backupDir, workDir: backupDir });
      try {
        if (source.kind === "legacy") {
          console.log(
            "Hinweis: altes Format — es wird nur die Datenbank wiederhergestellt.",
          );
        } else if (to.filesDir === null && s3ConfigFromEnv(env)) {
          console.log(
            "Dokumente werden in den S3-Bucket geschrieben (vorhandene bleiben).",
          );
        }
        const report = await restoreBackup(source, to, {
          force: flag("--force"),
          checkUrl,
          log: (line) => console.log(`  ${line}`),
        });
        console.log(
          `✓ Wiederhergestellt: ${report.name}${report.tenant ? ` (Fahrschule ${report.tenant})` : ""}`,
        );
        console.log(`  Datenbank: ${report.dbPath}`);
        console.log(
          `  Dokumente: ${report.fileCount} (${formatBytes(report.fileBytes)})`,
        );
        if (report.missingFiles.length > 0) {
          console.log(
            `  Achtung: ${report.missingFiles.length} Dokument(e) fehlten schon beim Sichern.`,
          );
        }
        for (const path of report.movedAside) console.log(`  Beiseitegelegt: ${path}`);
        console.log("Jetzt den Server starten und die Daten kurz prüfen.");
      } finally {
        await source.cleanup();
      }
      return;
    }
    default:
      console.log(
        [
          "Aufruf:",
          "  bun run restore list    [--tenant <slug>]",
          "  bun run restore verify  <sicherung> [--tenant <slug>]",
          "  bun run restore restore <sicherung> [--tenant <slug>] [--force] [--check-url <url> | --no-url-check]",
        ].join("\n"),
      );
      if (command !== undefined && command !== "help") process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof RestoreError) fail(error.message);
  throw error;
}
