/* ------------------------------------------------------------------ */
/* Navigation + page access — ONE config for the sidebar, the route    */
/* guard (App.tsx), the "Kein Zugriff" page and the global search.     */
/*                                                                     */
/* Adding a page: add one item to a group below (or to EXTRA_ROUTES    */
/* when it has no menu entry). `access` says who may open it:          */
/*   all    — every signed-in role (incl. Fahrlehrer)                  */
/*   office — Inhaber + Büro (finances, master data, office work)      */
/*   owner  — Inhaber only (users, backups)                            */
/* The server enforces the same split per API (src/server/auth.ts);    */
/* this only keeps people away from pages that would fail anyway.      */
/* Items whose route is not registered (yet) are hidden, so a menu     */
/* entry can land before its page.                                     */
/* ------------------------------------------------------------------ */

import {
  Archive,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Car,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  FileUp,
  GraduationCap,
  Heart,
  LayoutGrid,
  Mail,
  Megaphone,
  MessageCircle,
  Receipt,
  Sun,
  Tag,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";

import type { Role } from "@/hooks/use-auth";

export type Access = "all" | "office" | "owner";

export type NavItem = {
  label: string;
  route: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Who may open the page (default "all"). */
  access?: Access;
  /** Only list the item for these roles (the page itself stays reachable). */
  roles?: Role[];
  /** Extra words the global search matches (synonyms, old names). */
  keywords?: string[];
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "uebersicht",
    label: "Übersicht",
    items: [
      { label: "Dashboard", route: "/", Icon: LayoutGrid, keywords: ["Home", "Start"] },
      {
        label: "Kalender",
        route: "/kalender",
        Icon: CalendarDays,
        keywords: ["Termine"],
      },
      {
        label: "Mein Tag",
        route: "/mein-tag",
        Icon: Sun,
        roles: ["fahrlehrer"],
        keywords: ["Heute", "Tagesplan"],
      },
    ],
  },
  {
    id: "schueler",
    label: "Schüler",
    items: [
      { label: "Fahrschüler", route: "/fahrschueler", Icon: GraduationCap },
      {
        label: "Schüler anmelden",
        route: "/neue-schueler",
        Icon: UserPlus,
        access: "office",
        keywords: ["Anmeldung", "Neuer Schüler"],
      },
      {
        label: "Terminanfragen",
        route: "/terminanfragen",
        Icon: CalendarClock,
        access: "office",
        keywords: ["Anfragen", "Interessenten"],
      },
      { label: "Verträge", route: "/vertraege", Icon: FileText, access: "office" },
      {
        label: "Archiv",
        route: "/archiv",
        Icon: Archive,
        access: "office",
        keywords: ["Papierkorb", "Gelöscht", "Wiederherstellen"],
      },
    ],
  },
  {
    id: "ausbildung",
    label: "Ausbildung",
    items: [
      { label: "Theorie", route: "/theorie", Icon: BookOpen },
      {
        label: "Theoriegruppen",
        route: "/theorie-gruppen",
        Icon: UsersRound,
        keywords: ["Theorie Gruppen", "Kurse"],
      },
      {
        label: "Prüfungsplaner",
        route: "/pruefungsplaner",
        Icon: CalendarCheck,
        keywords: ["Prüfung", "TÜV", "DEKRA"],
      },
    ],
  },
  {
    id: "finanzen",
    label: "Finanzen",
    items: [
      {
        label: "Rechnungen",
        route: "/rechnungen",
        Icon: FileSpreadsheet,
        access: "office",
      },
      {
        label: "Buchhaltung",
        route: "/buchhaltung",
        Icon: Receipt,
        access: "office",
        keywords: ["Kasse", "DATEV", "Journal"],
      },
      {
        label: "Preise",
        route: "/preisangebot",
        Icon: Tag,
        access: "office",
        keywords: ["Preisangebot", "Preisplan", "Tarif"],
      },
      {
        label: "Statistik",
        route: "/statistik",
        Icon: BarChart3,
        access: "office",
        keywords: ["Umsatz", "Auswertung"],
      },
    ],
  },
  {
    id: "kommunikation",
    label: "Kommunikation",
    items: [
      {
        label: "Chat",
        route: "/plaudern",
        Icon: MessageCircle,
        keywords: ["Plaudern", "Nachricht"],
      },
      {
        label: "Nachrichten",
        route: "/nachrichten",
        Icon: Mail,
        access: "office",
        keywords: ["E-Mail", "SMS", "Postausgang"],
      },
      { label: "Bewertungen", route: "/bewertungen", Icon: Heart, access: "office" },
      {
        label: "Marketing",
        route: "/marketing",
        Icon: Megaphone,
        access: "office",
        keywords: ["Kampagnen"],
      },
    ],
  },
  {
    id: "verwaltung",
    label: "Verwaltung",
    items: [
      {
        label: "Fahrschule & Einstellungen",
        route: "/fahrschule",
        Icon: Building2,
        access: "office",
        keywords: [
          "Profil",
          "Schulprofil",
          "Stammdaten",
          "Steuernummer",
          "IBAN",
          "Öffnungszeiten",
          "Standorte",
          "Impressum",
        ],
      },
      {
        label: "Fahrlehrer",
        route: "/fahrlehrer",
        Icon: Users,
        access: "office",
        keywords: ["Fahrlehrerin", "Arbeitszeiten", "Abwesenheit"],
      },
      { label: "Fahrzeuge", route: "/fahrzeuge", Icon: Car, access: "office" },
      {
        label: "Benutzer",
        route: "/benutzer",
        Icon: UserCog,
        access: "owner",
        keywords: ["Zugänge", "Protokoll", "Rollen", "Einladen"],
      },
      {
        label: "Datenimport",
        route: "/import",
        Icon: FileUp,
        access: "office",
        keywords: ["CSV", "Import"],
      },
      {
        label: "Datensicherung",
        route: "/datensicherung",
        Icon: DatabaseBackup,
        access: "owner",
        keywords: ["Backup", "Export"],
      },
    ],
  },
];

/* Pages without a menu entry (old URLs redirect, detail pages). */
const EXTRA_ROUTES: Record<string, Access> = {
  "/kalendar": "all",
  "/profil": "office",
  "/schulprofil": "office",
};

/** Groups collapsed until the user opens them (remembered afterwards). */
export const DEFAULT_COLLAPSED_GROUPS = ["kommunikation", "verwaltung"];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function canAccess(role: Role | undefined, access: Access): boolean {
  if (!role) return false;
  if (role === "inhaber") return true;
  if (access === "owner") return false;
  if (role === "buero") return true;
  return access === "all";
}

/** Access level of a path; detail pages inherit it from their list page
 *  (/fahrschueler/12 → /fahrschueler). Unknown paths default to "all" —
 *  the API still guards the data. */
export function routeAccess(path: string): Access {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const exact = ALL_ITEMS.find((item) => item.route === clean)?.access;
  if (exact) return exact;
  if (clean in EXTRA_ROUTES) return EXTRA_ROUTES[clean]!;
  if (ALL_ITEMS.some((item) => item.route === clean)) return "all";
  const parent = ALL_ITEMS.filter(
    (item) => item.route !== "/" && clean.startsWith(`${item.route}/`),
  ).sort((a, b) => b.route.length - a.route.length)[0];
  return parent?.access ?? "all";
}

export function canSeeRoute(role: Role | undefined, path: string): boolean {
  return canAccess(role, routeAccess(path));
}

/** The menu for a role; `hasRoute` drops items whose page is not registered. */
export function visibleNav(
  role: Role | undefined,
  hasRoute: (route: string) => boolean = () => true,
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        hasRoute(item.route) &&
        canAccess(role, item.access ?? "all") &&
        (!item.roles || (role !== undefined && item.roles.includes(role))),
    ),
  })).filter((group) => group.items.length > 0);
}

/** The group holding the page at `path` (for auto-expanding it). */
export function groupOfPath(path: string): string | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (
        item.route === path ||
        (item.route !== "/" && path.startsWith(`${item.route}/`))
      )
        return group.id;
    }
  }
  return null;
}

export const ACCESS_LABELS: Record<Exclude<Access, "all">, string> = {
  office: "Inhaber/in und Büro",
  owner: "Inhaber/in",
};
