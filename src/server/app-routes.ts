/* ------------------------------------------------------------------ */
/* All API route factories merged into one routes object.              */
/* Consumed by the Bun.serve() entry point in src/index.ts.            */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import {
  type AuthRouteOptions,
  authRoutes,
  protectApiRoutes,
  type ProtectOptions,
} from "./auth";

import { absenceRoutes } from "./absences";
import { appointmentRequestRoutes } from "./appointment-requests";
import { attestationRoutes } from "./ausbildungsnachweis";
import { backupRoutes, type BackupConfig } from "./backups";
import { branchRoutes } from "./branches";
import { calendarConflictRoutes } from "./calendar-conflicts";
import { calendarSeriesRoutes } from "./calendar-series";
import { cancellationRoutes } from "./cancellations";
import { campaignRoutes } from "./campaigns";
import { chatRoutes } from "./chat";
import { instalmentRoutes } from "./instalments";
import { inviteRoutes } from "./invites";
import { reportRoutes } from "./instructor-hours";
import { invoiceRoutes } from "./invoices";
import { legalRoutes } from "./legal";
import { MemoryFileStore, type FileStore } from "./file-store";
import { err } from "./http";
import { mailRoutes, type MailRouteOptions } from "./mail";
import { portalRoutes } from "./portal";
import { theoryGroupRoutes } from "./theory-groups";
import { reviewRoutes } from "./reviews";
import { schoolProfileRoutes } from "./school-profile";
import { sepaRoutes } from "./sepa";
import { statisticsRoutes } from "./statistics";
import { fileRoutes } from "./student-files";
import { importRoutes } from "./student-import";
import {
  accountingRoutes,
  archiveRoutes,
  calendarEventRoutes,
  exportRoutes,
  instructorRoutes,
  pricePlanRoutes,
  studentRoutes,
  vehicleRoutes,
} from "./routes";

export type ApiRouteOptions = {
  mail?: MailRouteOptions;
  auth?: AuthRouteOptions;
  /** Per-request database (multi-tenant mode). */
  resolveDb?: ProtectOptions["resolveDb"];
  /** Where uploaded documents live; defaults to memory (tests). */
  fileStore?: FileStore;
  /** Datensicherung settings; null/undefined = disabled (demo, tests). */
  backups?: BackupConfig | null;
};

/* Unknown /api/* paths answer with a JSON 404 instead of falling through
   to the SPA index.html ("/*"), which would be a misleading 200. */
export const API_NOT_FOUND = {
  "/api/*": () => err("Unbekannter API-Endpunkt.", 404),
};

/* Every route below is wrapped by the session/role guard (auth.ts);
   only PUBLIC_ROUTES are reachable without signing in. */
export function buildApiRoutes(db: Database, options: ApiRouteOptions = {}) {
  return protectApiRoutes(db, buildUnprotectedRoutes(db, options), {
    resolveDb: options.resolveDb,
  });
}

function buildUnprotectedRoutes(db: Database, options: ApiRouteOptions) {
  const fileStore = options.fileStore ?? new MemoryFileStore();
  return {
    ...authRoutes(db, options.auth),
    ...inviteRoutes(db, { mailConfigured: Boolean(options.mail?.config) }),
    ...accountingRoutes(db),
    ...archiveRoutes(db, fileStore),
    ...calendarEventRoutes(db),
    ...calendarSeriesRoutes(db),
    ...cancellationRoutes(db),
    ...calendarConflictRoutes(db),
    ...absenceRoutes(db),
    ...reportRoutes(db),
    ...instructorRoutes(db),
    ...pricePlanRoutes(db),
    ...studentRoutes(db),
    ...vehicleRoutes(db),
    ...exportRoutes(db),
    ...appointmentRequestRoutes(db),
    ...branchRoutes(db),
    ...campaignRoutes(db),
    ...chatRoutes(db),
    ...reviewRoutes(db),
    ...theoryGroupRoutes(db),
    ...schoolProfileRoutes(db),
    ...statisticsRoutes(db),
    ...attestationRoutes(db),
    ...invoiceRoutes(db),
    ...instalmentRoutes(db),
    ...sepaRoutes(db),
    ...importRoutes(db),
    ...mailRoutes(db, options.mail),
    ...fileRoutes(db, fileStore),
    // Admin-only: /api/admin/*.
    ...backupRoutes(db, options.backups ?? null),
    // Second deliberate public surface besides /anfrage: token-gated,
    // rate-limited Schülerportal endpoints (/api/portal/:token…).
    ...portalRoutes(db),
    // Third public surface: read-only Impressum/Datenschutz data
    // (/api/public/legal) for the public legal pages.
    ...legalRoutes(db),
  };
}
