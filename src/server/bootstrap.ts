/* ------------------------------------------------------------------ */
/* One school's database: open + prepare it and run its background     */
/* jobs (mail/reminders, backups). Shared by the single-school server  */
/* and the multi-tenant TenantManager, so both behave identically.     */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { ensureAppointmentRequestTables } from "./appointment-requests";
import { ensureAttestationTables } from "./ausbildungsnachweis";
import { ensureBranchTables } from "./branches";
import { ensureCampaignTables } from "./campaigns";
import { ensureChatTables } from "./chat";
import { ensureReviewTables } from "./reviews";
import { countUsers, createUser } from "./auth";
import { type BackupConfig, startBackupScheduler } from "./backups";
import type { FileStore } from "./file-store";
import { ensureMailTables, startMailScheduler } from "./mail";
import {
  localIsoDate,
  queueLessonReminderSms,
  queueLessonReminders,
} from "./notifications";
import { ensurePortalTables } from "./portal";
import { seedTransactions } from "./seed";
import type { SmtpConfig } from "./smtp";
import { createSmtpTransport } from "./smtp";
import { type SmsConfig, createSmsTransport } from "./sms";
import { ensureStudentFileTables, migrateInlineDocuments } from "./student-files";
import { ensureTheoryGroupTables } from "./theory-groups";

/* Demo mode: a ready-made Inhaber login, shown on the sign-in page. */
export const DEMO_LOGIN = { email: "demo@openfs.de", password: "openfs-demo" };

/** Tables created by self-contained modules + demo seeds (if enabled). */
export async function prepareSchoolDb(
  db: Database,
  options: { demoLogin?: boolean; fileStore?: FileStore } = {},
): Promise<void> {
  seedTransactions(db);
  // Runs after the students/instructors seeds so seed groups pick up real names.
  ensureTheoryGroupTables(db);
  ensureAttestationTables(db);
  ensureMailTables(db);
  ensurePortalTables(db);
  // Route factories create these too, but in multi-tenant mode routes are
  // built once — every school's database must get them here.
  ensureAppointmentRequestTables(db);
  ensureBranchTables(db);
  ensureCampaignTables(db);
  ensureChatTables(db);
  ensureReviewTables(db);
  ensureStudentFileTables(db);
  if (options.demoLogin && countUsers(db) === 0) {
    await createUser(db, { ...DEMO_LOGIN, name: "Sabine Krämer", role: "inhaber" });
  }
  if (options.fileStore) {
    // Older databases kept uploads as base64 in students.documents.
    const moved = await migrateInlineDocuments(db, options.fileStore);
    if (moved > 0)
      console.log(`📎 ${moved} Dokument(e) in den Dateispeicher verschoben.`);
  }
}

/* Lesson reminders are queued from 09:00 local time on, so nobody gets
   a mail at midnight. */
const REMINDER_HOUR = 9;

export type SchoolJobOptions = {
  /** null = never send (demo); mails are marked 'nicht_konfiguriert'. */
  smtp: SmtpConfig | null;
  /** null = SMS stay 'nicht_konfiguriert'. */
  sms?: SmsConfig | null;
  backups: BackupConfig | null;
};

/** Starts the school's background jobs; returns a stop function. */
export function startSchoolJobs(db: Database, options: SchoolJobOptions): () => void {
  const stops: (() => void)[] = [];
  stops.push(
    startMailScheduler(db, {
      transport: options.smtp ? createSmtpTransport(options.smtp) : null,
      smsTransport: options.sms ? createSmsTransport(options.sms) : null,
      intervalMs: 60_000,
      beforeDelivery: (now) => {
        if (now.getHours() < REMINDER_HOUR) return;
        queueLessonReminders(db, localIsoDate(now));
        queueLessonReminderSms(db, localIsoDate(now));
      },
    }),
  );
  if (options.backups) stops.push(startBackupScheduler(db, options.backups));
  return () => {
    for (const stop of stops) stop();
  };
}
