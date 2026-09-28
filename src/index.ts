import { serve } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import index from "./index.html";

import { API_NOT_FOUND, buildApiRoutes } from "./server/app-routes";
import { backupConfigFromEnv } from "./server/backups";
import { DEMO_LOGIN, prepareSchoolDb, startSchoolJobs } from "./server/bootstrap";
import { openDb } from "./server/db";
import { createFileStoreFromEnv } from "./server/file-store";
import { healthRoutes } from "./server/health";
import { MAX_REQUEST_BODY_BYTES } from "./server/request-guards";
import { hstsFromEnv, secureRoutes } from "./server/security-headers";
import { applySetup } from "./server/setup";
import { buildSpaRoutes } from "./server/spa";

import { smsConfigFromEnv } from "./server/sms";
import { smtpConfigFromEnv } from "./server/smtp";
import {
  buildTenantApiRoutes,
  platformRoutes,
  Registry,
  TenantFileStore,
  TenantManager,
  tenancyConfigFromEnv,
  tenantBackupConfig,
} from "./server/tenancy";

// Demo mode keeps the full persistence layer intact but points it at an
// in-memory database, so every visitor starts from the freshly seeded state
// and changes are discarded on restart instead of being written to disk.
const demoMode = process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";
// A real school starts empty (first-run wizard); SEED_DEMO=1 fills a file
// database with the demo school for trying things out locally.
const seedDemo = process.env.SEED_DEMO === "1" || process.env.SEED_DEMO === "true";
// MULTI_TENANT=1: one portal per school at <slug>.<BASE_DOMAIN>.
const tenancy = demoMode ? null : tenancyConfigFromEnv();
// Hot reloading and the browser-console echo only when explicitly asked
// for (`bun run dev` sets NODE_ENV=development) — never by omission.
const development = process.env.NODE_ENV === "development";
// Strict-Transport-Security on every response (only behind HTTPS!).
const headerOptions = { hsts: hstsFromEnv() };

if (!demoMode && !tenancy) {
  // SQLite needs the directory to exist before it can create the file.
  // Only this one: the working directory may be read-only (systemd
  // ProtectSystem=strict) when DB_PATH points elsewhere.
  mkdirSync(dirname(process.env.DB_PATH || "data/fahrschule.db"), { recursive: true });
}

/* Uploaded documents: S3 when configured, else data/files (memory in
   demo mode). Datensicherung: off in demo mode. E-Mail: demo never sends
   (mails are only marked 'nicht_konfiguriert' so the UI shows them). */
const { store: baseFileStore } = createFileStoreFromEnv({ demoMode });
// Backup sets hold the database plus the documents from the file store.
const backupConfig = demoMode
  ? null
  : backupConfigFromEnv(process.env, undefined, baseFileStore);
const smtpConfig = demoMode ? null : smtpConfigFromEnv();
const smsConfig = demoMode ? null : smsConfigFromEnv();

// `bun --hot` re-runs this module — stop the previous jobs first.
const hot = globalThis as { __openfsStopJobs?: () => void };
hot.__openfsStopJobs?.();

/* The API (guarded, see server/auth.ts) plus the platform endpoints. */
let apiRoutes: ReturnType<typeof buildApiRoutes> & ReturnType<typeof platformRoutes>;

if (tenancy) {
  const fileStore = new TenantFileStore(baseFileStore);
  const manager = new TenantManager(
    Registry.open(tenancy.registryPath),
    tenancy,
    (slug) => ({
      smtp: smtpConfig,
      sms: smsConfig,
      backups: backupConfig ? tenantBackupConfig(backupConfig, slug) : null,
    }),
    fileStore,
  );
  await manager.openAll();
  hot.__openfsStopJobs = () => manager.closeAll();

  apiRoutes = buildTenantApiRoutes(manager, {
    smtp: smtpConfig,
    sms: smsConfig,
    backups: backupConfig,
    fileStore,
    signup: tenancy.signup,
  });
  console.log(
    `🏫 Mehrmandantenbetrieb: ${manager.registry.list().length} Fahrschule(n) unter *.${tenancy.baseDomain}`,
  );
} else {
  const db = openDb(demoMode ? ":memory:" : (process.env.DB_PATH ?? undefined), {
    demoData: demoMode || seedDemo,
  });
  await prepareSchoolDb(db, { demoLogin: demoMode, fileStore: baseFileStore });
  hot.__openfsStopJobs = startSchoolJobs(db, {
    smtp: smtpConfig,
    sms: smsConfig,
    backups: backupConfig,
  });
  apiRoutes = {
    ...buildApiRoutes(db, {
      mail: { config: smtpConfig, sms: smsConfig },
      auth: {
        demo: demoMode ? DEMO_LOGIN : null,
        onSetup: (setupDb, body) => applySetup(setupDb, body),
      },
      fileStore: baseFileStore,
      backups: backupConfig,
    }),
    ...platformRoutes(null),
  };
}

/* The SPA: in development Bun's HTML import (hot reloading); otherwise a
   bundle built once at startup and served with the security headers
   (Content-Security-Policy, X-Frame-Options, …; see security-headers.ts). */
type SpaRoute = typeof index | (() => Response);
const spaRoutes: { "/*": SpaRoute; [path: string]: SpaRoute } = development
  ? { "/*": index }
  : ((await buildSpaRoutes(headerOptions)) as { "/*": SpaRoute });

const server = serve({
  // Loopback by default: put a TLS-terminating reverse proxy in front (or
  // set HOST=0.0.0.0 on a trusted network) to reach it from elsewhere.
  hostname: process.env.HOST ?? "127.0.0.1",

  // Uploads are max. 12 MB; larger bodies are refused with 413 before a
  // handler buffers them (chunked ones by the API guard, request-guards.ts).
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,

  routes: {
    // Serve index.html for all unmatched routes ...
    ...spaRoutes,
    // ... except unknown API paths: JSON 404 (single- and multi-tenant).
    ...secureRoutes(API_NOT_FOUND, headerOptions),

    // Public liveness/version probe (answers on every host).
    ...secureRoutes(healthRoutes(), headerOptions),

    ...secureRoutes(apiRoutes, headerOptions),
  },

  development: development && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(
  `🚀 Server running at ${server.url} — ${development ? "Entwicklungsmodus (Hot Reload, Browser-Konsole)" : "Produktionsmodus"}${demoMode ? " (demo mode: in-memory DB, changes are not persisted)" : ""}`,
);
