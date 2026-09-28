import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
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
import { Einladung } from "./Einladung";
import { Fahrlehrer } from "./Fahrlehrer";
import { Fahrschule } from "./Fahrschule";
import { Fahrschueler } from "./Fahrschueler";
import { FahrschuelerDetail } from "./FahrschuelerDetail";
import { Fahrzeuge } from "./Fahrzeuge";
import { Impressum } from "./Impressum";
import { Kalendar } from "./Kalendar";
import { Marketing } from "./Marketing";
import { Nachrichten } from "./Nachrichten";
import { NeueSchueler } from "./NeueSchueler";
import { Plaudern } from "./Plaudern";
import { Preisangebot } from "./Preisangebot";
import { Rechnungen } from "./Rechnungen";
import { Pruefungsplaner } from "./Pruefungsplaner";
import { Schuelerportal } from "./Schuelerportal";
import { Statistik } from "./Statistik";
import { Terminanfragen } from "./Terminanfragen";
import { Theorie } from "./Theorie";
import { TheorieGruppen } from "./TheorieGruppen";
import { Vertraege } from "./Vertraege";
import { queryClient } from "@/lib/query-client";
import { vehiclesQueryOptions } from "@/hooks/use-vehicles";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/settings-tabs";

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

/* Profil + Schulprofil were merged into "Fahrschule & Einstellungen". */
const profileRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/profil",
  beforeLoad: () => {
    throw redirect({ to: "/fahrschule", search: { tab: "stammdaten" }, replace: true });
  },
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
  path: "/kalender",
  validateSearch: (search): { filter?: "non-fahrstunde" } => ({
    filter: search.filter === "non-fahrstunde" ? search.filter : undefined,
  }),
  component: Kalendar,
});

/* Old spelling — bookmarks and links keep working. */
const legacyCalendarRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/kalendar",
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/kalender", search, replace: true });
  },
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
  beforeLoad: () => {
    throw redirect({ to: "/fahrschule", search: { tab: "profil" }, replace: true });
  },
});

const appointmentRequestsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/terminanfragen",
  component: Terminanfragen,
});

const schoolRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrschule",
  // ?tab=stammdaten|bank|profil|zeiten|standorte|recht|absagen
  validateSearch: (search): { tab?: SettingsTab } => ({
    tab: SETTINGS_TABS.includes(search.tab as SettingsTab)
      ? (search.tab as SettingsTab)
      : undefined,
  }),
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

/* Einladungslink — public: sets the password of an invited staff member. */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/einladung/$inviteToken",
  component: Einladung,
});

const portalRouteTree = portalRoute.addChildren([
  dashboardRoute,
  profileRoute,
  theoryRoute,
  studentsRoute,
  studentDetailRoute,
  accountingRoute,
  calendarRoute,
  legacyCalendarRoute,
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
  inviteRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // Off on purpose: every page scrolls its own container, and the router's
  // element restoration copied one page's scroll offset onto the next page
  // (same DOM path). App.tsx resets the scroll on each navigation instead.
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
