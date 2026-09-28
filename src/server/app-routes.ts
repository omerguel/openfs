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
import { invoiceRoutes } from "./invoices";
import { theoryGroupRoutes } from "./theory-groups";
import { reviewRoutes } from "./reviews";
import { schoolProfileRoutes } from "./school-profile";
import { statisticsRoutes } from "./statistics";
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

export function buildApiRoutes(db: Database) {
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
    ...invoiceRoutes(db),
    ...importRoutes(db),
  };
}
