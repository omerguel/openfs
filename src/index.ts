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
import { createSmsTransport, smsConfigFromEnv } from "./server/sms";
import {
  localIsoDate,
  queueLessonReminderSms,
  queueLessonReminders,
} from "./server/notifications";
import { ensurePortalTables } from "./server/portal";

// Demo mode keeps the full persistence layer intact but points it at an
// in-memory database, so every visitor starts from the freshly seeded state
// and changes are discarded on restart instead of being written to disk.
const demoMode = process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";

if (!demoMode) {
  // SQLite needs the directory to exist before it can create the file.
  mkdirSync("data", { recursive: true });
}
const db = openDb(demoMode ? ":memory:" : undefined);
seedTransactions(db);
// Runs after the students/instructors seeds so seed groups pick up real names.
ensureTheoryGroupTables(db);
ensureAttestationTables(db);
ensureMailTables(db);
ensurePortalTables(db);

/* E-Mail: every minute queue tomorrow's lesson reminders (from 09:00
   local time on, so nobody gets a mail at midnight) and deliver the
   outbox. Demo mode never sends — it runs without a transport, which
   only marks queued mails 'nicht_konfiguriert' so the UI shows them. */
const REMINDER_HOUR = 9;
const smtpConfig = demoMode ? null : smtpConfigFromEnv();
const smsConfig = demoMode ? null : smsConfigFromEnv();
// `bun --hot` re-runs this module — stop the previous interval first.
const hot = globalThis as { __openfsStopMailScheduler?: () => void };
hot.__openfsStopMailScheduler?.();
hot.__openfsStopMailScheduler = startMailScheduler(db, {
  transport: smtpConfig ? createSmtpTransport(smtpConfig) : null,
  smsTransport: smsConfig ? createSmsTransport(smsConfig) : null,
  intervalMs: 60_000,
  beforeDelivery: (now) => {
    if (now.getHours() < REMINDER_HOUR) return;
    queueLessonReminders(db, localIsoDate(now));
    queueLessonReminderSms(db, localIsoDate(now));
  },
});

const server = serve({
  // Keep the development UI reachable from other devices on the local network.
  hostname: "0.0.0.0",

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    ...buildApiRoutes(db, { mail: { config: smtpConfig, sms: smsConfig } }),
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
