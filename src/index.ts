import { serve } from "bun";
import { mkdirSync } from "node:fs";
import index from "./index.html";

import { openDb } from "./server/db";
import { seedTransactions } from "./server/seed";
import { ensureTheoryGroupTables } from "./server/theory-groups";
import { ensureAttestationTables } from "./server/ausbildungsnachweis";
import { buildApiRoutes } from "./server/app-routes";
import { ensureMailTables, startMailScheduler } from "./server/mail";
import { createSmtpTransport, smtpConfigFromEnv } from "./server/smtp";
import { localIsoDate, queueLessonReminders } from "./server/notifications";
import { ensurePortalTables } from "./server/portal";
import { countUsers, createUser } from "./server/auth";
import { applySetup } from "./server/setup";
import { createFileStoreFromEnv } from "./server/file-store";
import { migrateInlineDocuments } from "./server/student-files";
import { backupConfigFromEnv, startBackupScheduler } from "./server/backups";

// Demo mode keeps the full persistence layer intact but points it at an
// in-memory database, so every visitor starts from the freshly seeded state
// and changes are discarded on restart instead of being written to disk.
const demoMode = process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";

if (!demoMode) {
  // SQLite needs the directory to exist before it can create the file.
  mkdirSync("data", { recursive: true });
}
// A real school starts empty (first-run wizard); SEED_DEMO=1 fills a file
// database with the demo school for trying things out locally.
const seedDemo = process.env.SEED_DEMO === "1" || process.env.SEED_DEMO === "true";
const db = openDb(demoMode ? ":memory:" : (process.env.DB_PATH ?? undefined), {
  demoData: demoMode || seedDemo,
});
seedTransactions(db);
// Runs after the students/instructors seeds so seed groups pick up real names.
ensureTheoryGroupTables(db);
ensureAttestationTables(db);
ensureMailTables(db);
ensurePortalTables(db);

/* Demo mode: a ready-made Inhaber login, shown on the sign-in page. */
const DEMO_LOGIN = { email: "demo@openfs.de", password: "openfs-demo" };
if (demoMode && countUsers(db) === 0) {
  await createUser(db, { ...DEMO_LOGIN, name: "Demo Inhaber/in", role: "inhaber" });
}

/* Uploaded documents: S3 when configured, else data/files (memory in
   demo mode). Older databases kept uploads as base64 inside
   students.documents — move them out once (idempotent). */
const { store: fileStore, kind: fileStoreKind } = createFileStoreFromEnv({ demoMode });
const migratedFiles = await migrateInlineDocuments(db, fileStore);
if (migratedFiles > 0) {
  console.log(
    `📎 ${migratedFiles} Dokument(e) in den Dateispeicher (${fileStoreKind}) verschoben.`,
  );
}

/* Datensicherung: check at startup and hourly; back up when the newest
   backup is older than BACKUP_INTERVAL_HOURS. Off in demo mode. */
const backupConfig = demoMode ? null : backupConfigFromEnv();
const hotBackup = globalThis as { __openfsStopBackupScheduler?: () => void };
hotBackup.__openfsStopBackupScheduler?.();
hotBackup.__openfsStopBackupScheduler = backupConfig
  ? startBackupScheduler(db, backupConfig)
  : undefined;

/* E-Mail: every minute queue tomorrow's lesson reminders (from 09:00
   local time on, so nobody gets a mail at midnight) and deliver the
   outbox. Demo mode never sends — it runs without a transport, which
   only marks queued mails 'nicht_konfiguriert' so the UI shows them. */
const REMINDER_HOUR = 9;
const smtpConfig = demoMode ? null : smtpConfigFromEnv();
// `bun --hot` re-runs this module — stop the previous interval first.
const hot = globalThis as { __openfsStopMailScheduler?: () => void };
hot.__openfsStopMailScheduler?.();
hot.__openfsStopMailScheduler = startMailScheduler(db, {
  transport: smtpConfig ? createSmtpTransport(smtpConfig) : null,
  intervalMs: 60_000,
  beforeDelivery: (now) => {
    if (now.getHours() >= REMINDER_HOUR) queueLessonReminders(db, localIsoDate(now));
  },
});

const server = serve({
  // Loopback by default: put a TLS-terminating reverse proxy in front (or
  // set HOST=0.0.0.0 on a trusted network) to reach it from elsewhere.
  hostname: process.env.HOST ?? "127.0.0.1",

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    ...buildApiRoutes(db, {
      mail: { config: smtpConfig },
      auth: {
        demo: demoMode ? DEMO_LOGIN : null,
        onSetup: (setupDb, body) => applySetup(setupDb, body),
      },
      fileStore,
      backups: backupConfig,
    }),
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(
  `🚀 Server running at ${server.url}${demoMode ? " (demo mode: in-memory DB, changes are not persisted)" : ""}`,
);
