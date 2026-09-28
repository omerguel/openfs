import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { Anfrage } from "./Anfrage";
import { App } from "./App";
import { Archiv } from "./Archiv";
import { Benutzer } from "./Benutzer";
import { Bewertungen } from "./Bewertungen";
import { Buchhaltung } from "./Buchhaltung";
import { Dashboard } from "./Dashboard";
import { Datenschutz } from "./Datenschutz";
import { Datenimport } from "./Datenimport";
import { Datensicherung } from "./Datensicherung";
import { Fahrlehrer } from "./Fahrlehrer";
import { Fahrschule } from "./Fahrschule";
import { Fahrschueler } from "./Fahrschueler";
import { FahrschuelerDetail } from "./FahrschuelerDetail";
import { Fahrzeuge } from "./Fahrzeuge";
import { Impressum } from "./Impressum";
import { Kalendar } from "./Kalendar";
import { Marketing } from "./Marketing";
import { MeinTag } from "./MeinTag";
import { Nachrichten } from "./Nachrichten";
import { NeueSchueler } from "./NeueSchueler";
import { Plaudern } from "./Plaudern";
import { Preisangebot } from "./Preisangebot";
import { Profil } from "./Profil";
import { Rechnungen } from "./Rechnungen";
import { Pruefungsplaner } from "./Pruefungsplaner";
import { Schuelerportal } from "./Schuelerportal";
import { Schulprofil } from "./Schulprofil";
import { Statistik } from "./Statistik";
import { Terminanfragen } from "./Terminanfragen";
import { Theorie } from "./Theorie";
import { TheorieGruppen } from "./TheorieGruppen";
import { Vertraege } from "./Vertraege";
import { queryClient } from "@/lib/query-client";
import { vehiclesQueryOptions } from "@/hooks/use-vehicles";

type RouterContext = {
  queryClient: QueryClient;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-center">
      <div>
        <h1 className="font-heading text-xl font-semibold">Seite nicht gefunden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Die angeforderte Seite existiert nicht.
        </p>
      </div>
    </main>
  ),
});

const portalRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_portal",
  component: App,
});

const dashboardRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/",
  component: Dashboard,
});

const profileRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/profil",
  component: Profil,
});

const theoryRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/theorie",
  component: Theorie,
});

const studentsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrschueler",
  component: Fahrschueler,
});

const studentDetailRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrschueler/$studentId",
  component: FahrschuelerDetail,
});

const accountingRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/buchhaltung",
  component: Buchhaltung,
});

const calendarRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/kalendar",
  validateSearch: (search): { filter?: "non-fahrstunde" } => ({
    filter: search.filter === "non-fahrstunde" ? search.filter : undefined,
  }),
  component: Kalendar,
});

const myDayRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/mein-tag",
  component: MeinTag,
});

const vehiclesRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrzeuge",
  // Preload is best effort: signed out (401) the AuthGate takes over.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(vehiclesQueryOptions).catch(() => undefined),
  component: Fahrzeuge,
});

const instructorsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrlehrer",
  component: Fahrlehrer,
});

const newStudentRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/neue-schueler",
  // ?anfrage=<id>: prefill from a Terminanfrage and link it back on save.
  validateSearch: (search): { anfrage?: number } => {
    const id = Number(search.anfrage);
    return { anfrage: Number.isInteger(id) && id > 0 ? id : undefined };
  },
  component: NeueSchueler,
});

const offerRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/preisangebot",
  component: Preisangebot,
});

const chatRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/plaudern",
  component: Plaudern,
});

const marketingRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/marketing",
  component: Marketing,
});

const theoryGroupsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/theorie-gruppen",
  component: TheorieGruppen,
});

const examPlannerRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/pruefungsplaner",
  component: Pruefungsplaner,
});

const schoolProfileRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/schulprofil",
  component: Schulprofil,
});

const appointmentRequestsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/terminanfragen",
  component: Terminanfragen,
});

const schoolRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrschule",
  component: Fahrschule,
});

const statisticsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/statistik",
  component: Statistik,
});

const reviewsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/bewertungen",
  component: Bewertungen,
});

const contractsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/vertraege",
  component: Vertraege,
});

const messagesRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/nachrichten",
  component: Nachrichten,
});

const archiveRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/archiv",
  component: Archiv,
});

const invoicesRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/rechnungen",
  component: Rechnungen,
});

const usersRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/benutzer",
  component: Benutzer,
});

const importRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/import",
  component: Datenimport,
});

const backupRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/datensicherung",
  component: Datensicherung,
});

const appointmentRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/anfrage",
  component: Anfrage,
});

/* Schülerportal — public, token-gated, outside the staff app shell. */
const studentPortalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/$token",
  component: Schuelerportal,
});

/* Legal pages — public, outside the staff app shell (like /anfrage). */
const impressumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/impressum",
  component: Impressum,
});

const datenschutzRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/datenschutz",
  component: Datenschutz,
});

const portalRouteTree = portalRoute.addChildren([
  dashboardRoute,
  profileRoute,
  theoryRoute,
  studentsRoute,
  studentDetailRoute,
  accountingRoute,
  calendarRoute,
  myDayRoute,
  vehiclesRoute,
  instructorsRoute,
  newStudentRoute,
  offerRoute,
  chatRoute,
  marketingRoute,
  theoryGroupsRoute,
  examPlannerRoute,
  schoolProfileRoute,
  appointmentRequestsRoute,
  schoolRoute,
  statisticsRoute,
  reviewsRoute,
  contractsRoute,
  messagesRoute,
  archiveRoute,
  invoicesRoute,
  importRoute,
  usersRoute,
  backupRoute,
]);

const routeTree = rootRoute.addChildren([
  portalRouteTree,
  appointmentRequestRoute,
  studentPortalRoute,
  impressumRoute,
  datenschutzRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
