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
import { Bewertungen } from "./Bewertungen";
import { Buchhaltung } from "./Buchhaltung";
import { Dashboard } from "./Dashboard";
import { Fahrlehrer } from "./Fahrlehrer";
import { Fahrschule } from "./Fahrschule";
import { Fahrschueler } from "./Fahrschueler";
import { FahrschuelerDetail } from "./FahrschuelerDetail";
import { Fahrzeuge } from "./Fahrzeuge";
import { Kalendar } from "./Kalendar";
import { Marketing } from "./Marketing";
import { NeueSchueler } from "./NeueSchueler";
import { Plaudern } from "./Plaudern";
import { Preisangebot } from "./Preisangebot";
import { Profil } from "./Profil";
import { Rechnungen } from "./Rechnungen";
import { Pruefungsplaner } from "./Pruefungsplaner";
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

const vehiclesRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/fahrzeuge",
  loader: ({ context }) => context.queryClient.ensureQueryData(vehiclesQueryOptions),
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

const appointmentRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/anfrage",
  component: Anfrage,
});

const portalRouteTree = portalRoute.addChildren([
  dashboardRoute,
  profileRoute,
  theoryRoute,
  studentsRoute,
  studentDetailRoute,
  accountingRoute,
  calendarRoute,
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
  archiveRoute,
  invoicesRoute,
]);

const routeTree = rootRoute.addChildren([portalRouteTree, appointmentRequestRoute]);

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
