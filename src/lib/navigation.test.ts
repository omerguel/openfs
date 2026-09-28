import { describe, expect, test } from "bun:test";

import {
  canSeeRoute,
  groupOfPath,
  NAV_GROUPS,
  routeAccess,
  visibleNav,
} from "./navigation";

const labels = (role: Parameters<typeof visibleNav>[0]) =>
  visibleNav(role).flatMap((group) => group.items.map((item) => item.route));

describe("navigation config", () => {
  test("every route appears once and no group repeats its own name as an item", () => {
    const routes = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.route));
    expect(new Set(routes).size).toBe(routes.length);
    for (const group of NAV_GROUPS) {
      expect(group.items.map((i) => i.label)).not.toContain(group.label);
    }
  });

  test("Fahrlehrer see no finances, no master data and no office pages", () => {
    const routes = labels("fahrlehrer");
    for (const hidden of [
      "/statistik",
      "/rechnungen",
      "/buchhaltung",
      "/preisangebot",
      "/vertraege",
      "/fahrschule",
      "/benutzer",
      "/datensicherung",
      "/neue-schueler",
    ]) {
      expect(routes).not.toContain(hidden);
    }
    expect(routes).toContain("/kalender");
    expect(routes).toContain("/plaudern");
    expect(routes).toContain("/mein-tag");
  });

  test("Büro sees office pages but not users and backups", () => {
    const routes = labels("buero");
    expect(routes).toContain("/rechnungen");
    expect(routes).toContain("/fahrschule");
    expect(routes).not.toContain("/benutzer");
    expect(routes).not.toContain("/datensicherung");
    // "Mein Tag" is the instructors' page.
    expect(routes).not.toContain("/mein-tag");
  });

  test("the Inhaber sees everything registered", () => {
    expect(labels("inhaber")).toContain("/benutzer");
    const onlyRegistered = visibleNav("inhaber", (route) => route !== "/mein-tag");
    expect(onlyRegistered.flatMap((g) => g.items.map((i) => i.route))).not.toContain(
      "/mein-tag",
    );
  });

  test("route guard: detail pages and old URLs inherit their access", () => {
    expect(routeAccess("/fahrschueler/12")).toBe("all");
    expect(routeAccess("/profil")).toBe("office");
    expect(routeAccess("/schulprofil")).toBe("office");
    expect(routeAccess("/datensicherung")).toBe("owner");
    expect(routeAccess("/unbekannt")).toBe("all");
    expect(canSeeRoute("fahrlehrer", "/profil")).toBe(false);
    expect(canSeeRoute("fahrlehrer", "/statistik")).toBe(false);
    expect(canSeeRoute("buero", "/datensicherung")).toBe(false);
    expect(canSeeRoute("inhaber", "/datensicherung")).toBe(true);
    expect(canSeeRoute(undefined, "/")).toBe(false);
  });

  test("the group of the current page can be found (auto-expand)", () => {
    expect(groupOfPath("/fahrschueler/3")).toBe("schueler");
    expect(groupOfPath("/fahrzeuge")).toBe("verwaltung");
    expect(groupOfPath("/")).toBe("uebersicht");
  });
});
