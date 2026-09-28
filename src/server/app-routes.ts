/* ------------------------------------------------------------------ */
/* All API route factories merged into one routes object.              */
/* Consumed by the Bun.serve() entry point in src/index.ts.            */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { appointmentRequestRoutes } from "./appointment-requests";
import { attestationRoutes } from "./ausbildungsnachweis";
import { branchRoutes } from "./branches";
import { campaignRoutes } from "./campaigns";
import { chatRoutes } from "./chat";
import { mailRoutes, type MailRouteOptions } from "./mail";
import { portalRoutes } from "./portal";
import { theoryGroupRoutes } from "./theory-groups";
import { reviewRoutes } from "./reviews";
import { schoolProfileRoutes } from "./school-profile";
import { statisticsRoutes } from "./statistics";
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
};

export function buildApiRoutes(db: Database, options: ApiRouteOptions = {}) {
  return {
    ...accountingRoutes(db),
    ...archiveRoutes(db),
    ...calendarEventRoutes(db),
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
    ...mailRoutes(db, options.mail),
    // Second deliberate public surface besides /anfrage: token-gated,
    // rate-limited Schülerportal endpoints (/api/portal/:token…).
    ...portalRoutes(db),
  };
}
