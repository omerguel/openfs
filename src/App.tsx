import "./index.css";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Agentation } from "agentation";
import {
  Archive,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  DatabaseBackup,
  FileText,
  FileUp,
  GraduationCap,
  Heart,
  LayoutGrid,
  LogOut,
  Mail,
  Megaphone,
  MessageCircle,
  Receipt,
  Tag,
  User,
  UserPlus,
  Users,
  FileSpreadsheet,
  KeyRound,
  UserCog,
  Sun,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AuthGate } from "@/components/auth/AuthGate";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { canSeeRoute, logout, ROLE_LABELS, useAuthStatus } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

type IconCmp = React.ComponentType<{ className?: string }>;

const navItems: { label: string; Icon: IconCmp; route?: string }[] = [
  { label: "Home", Icon: LayoutGrid, route: "/" },
  { label: "Mein Tag", Icon: Sun, route: "/mein-tag" },
  { label: "Profil", Icon: User, route: "/profil" },
  { label: "Theorie", Icon: BookOpen, route: "/theorie" },
  // { label: "Unterricht", Icon: Users },
  { label: "Schüler Anmeldung", Icon: UserPlus, route: "/neue-schueler" },
];

const navGroups: {
  label: string;
  Icon: IconCmp;
  items: { label: string; Icon: IconCmp; route: string }[];
}[] = [
  {
    label: "Marketing",
    Icon: Megaphone,
    items: [
      { label: "Marketing", Icon: Megaphone, route: "/marketing" },
      { label: "Schulprofil", Icon: Building2, route: "/schulprofil" },
      { label: "Preisangebot", Icon: Tag, route: "/preisangebot" },
      { label: "Bewertungen", Icon: Heart, route: "/bewertungen" },
    ],
  },
  {
    label: "Verwaltung",
    Icon: CalendarClock,
    items: [
      { label: "Terminanfragen", Icon: CalendarClock, route: "/terminanfragen" },
      { label: "Fahrschule", Icon: Building2, route: "/fahrschule" },
      { label: "Kalender", Icon: CalendarDays, route: "/kalendar" },
      { label: "Fahrlehrer/in", Icon: Users, route: "/fahrlehrer" },
      { label: "Fahrzeuge", Icon: Car, route: "/fahrzeuge" },
      { label: "Fahrschüler", Icon: GraduationCap, route: "/fahrschueler" },
      { label: "Theorie Gruppen", Icon: BookOpen, route: "/theorie-gruppen" },
      { label: "Buchhaltung", Icon: Receipt, route: "/buchhaltung" },
      { label: "Rechnungen", Icon: FileSpreadsheet, route: "/rechnungen" },
      { label: "Statistik", Icon: BarChart3, route: "/statistik" },
      { label: "Plaudern", Icon: MessageCircle, route: "/plaudern" },
      { label: "Nachrichten", Icon: Mail, route: "/nachrichten" },
      { label: "Verträge", Icon: FileText, route: "/vertraege" },
      { label: "Prüfungsplaner", Icon: CalendarCheck, route: "/pruefungsplaner" },
      { label: "Datenimport", Icon: FileUp, route: "/import" },
      { label: "Datensicherung", Icon: DatabaseBackup, route: "/datensicherung" },
    ],
  },
];

type NavGroup = (typeof navGroups)[number];

const activeSidebarItemClass =
  "group/sidebar-link hover:z-10 overflow-visible select-none hover:bg-transparent active:bg-transparent data-active:bg-transparent data-active:hover:bg-transparent data-active:active:bg-transparent transition-[background-color] duration-100 ease-out data-active:duration-0 motion-reduce:transition-none";

function SidebarLinkHoverEffect() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <span className="absolute inset-2 rounded-sm bg-sidebar-accent opacity-0 transition-[top,right,bottom,left,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/sidebar-link:inset-y-0 group-hover/sidebar-link:-inset-x-1 group-hover/sidebar-link:opacity-100 group-focus-visible/sidebar-link:inset-y-0 group-focus-visible/sidebar-link:-inset-x-1 group-focus-visible/sidebar-link:opacity-100 group-data-[active=true]/sidebar-link:inset-y-0 group-data-[active=true]/sidebar-link:-inset-x-1 group-data-[active=true]/sidebar-link:opacity-100 motion-reduce:transition-none" />
    </span>
  );
}

function SidebarNavGroup({ group, path }: { group: NavGroup; path: string }) {
  const { label, Icon, items } = group;
  const activeItem = items.find((item) => item.route === path);

  return (
    <SidebarGroup className="z-10 px-1 py-2 group-data-[collapsible=icon]:p-2">
      <SidebarMenu>
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip={label}
                className="hover:bg-transparent active:bg-transparent data-open:hover:bg-transparent"
              >
                <Icon />
                <span>{label}</span>
                <ChevronRight className="ml-auto transition-transform duration-200 ease-drawer motion-reduce:transition-none group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-drawer data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100 motion-reduce:transition-none">
              <SidebarMenuSub className="min-h-0 overflow-hidden">
                {items.map(({ label: subLabel, Icon: SubIcon, route }) => (
                  <SidebarMenuSubItem key={subLabel}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={path === route}
                      className={activeSidebarItemClass}
                    >
                      <Link
                        to={route}
                        draggable={false}
                        aria-current={path === route ? "page" : undefined}
                      >
                        <SidebarLinkHoverEffect />
                        <SubIcon className="relative z-10" />
                        <span className="relative z-10">{subLabel}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
            {activeItem && (
              <SidebarMenuSub className="group-data-[state=open]/collapsible:hidden">
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    asChild
                    isActive
                    className={activeSidebarItemClass}
                  >
                    <Link to={activeItem.route} draggable={false} aria-current="page">
                      <SidebarLinkHoverEffect />
                      <activeItem.Icon className="relative z-10" />
                      <span className="relative z-10">{activeItem.label}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            )}
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function DevAgentation() {
  useEffect(() => {
    const ignoreCrossOriginScriptError = (event: ErrorEvent) => {
      if (event.message === "Script error.") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("error", ignoreCrossOriginScriptError, true);
    return () => {
      window.removeEventListener("error", ignoreCrossOriginScriptError, true);
    };
  }, []);

  return <Agentation />;
}

// The footer cue is a real affordance: clicking it pages the nav down so the
// items hidden under the fold scroll into view (smooth, reduced-motion aware).
function scrollSidebarNavigationDown() {
  const content = document.querySelector('[data-slot="sidebar-content"]');
  if (!(content instanceof HTMLElement)) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  content.scrollBy({
    top: Math.round(content.clientHeight * 0.7),
    behavior: reduce ? "auto" : "smooth",
  });
}

function AppSidebar({ path }: { path: string }) {
  const auth = useAuthStatus();
  const user = auth.data?.user ?? null;
  const role = user?.role;
  const [passwordOpen, setPasswordOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sidebarCanScrollDownRef = useRef(false);
  const [sidebarCanScrollDown, setSidebarCanScrollDown] = useState(false);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateFooterFade = () => {
      const next = content.scrollTop + content.clientHeight < content.scrollHeight - 1;
      if (next === sidebarCanScrollDownRef.current) return;
      sidebarCanScrollDownRef.current = next;
      setSidebarCanScrollDown(next);
    };

    updateFooterFade();
    content.addEventListener("scroll", updateFooterFade, { passive: true });
    window.addEventListener("resize", updateFooterFade);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateFooterFade);
    observer?.observe(content);

    return () => {
      content.removeEventListener("scroll", updateFooterFade);
      window.removeEventListener("resize", updateFooterFade);
      observer?.disconnect();
    };
  }, []);

  return (
    <Sidebar variant="inset">
      <SidebarContent ref={contentRef}>
        <SidebarGroup className="z-10 px-1 py-2 group-data-[collapsible=icon]:p-2">
          <SidebarMenu>
            {navItems.map(({ label, Icon, route }) => (
              <SidebarMenuItem key={label}>
                {route ? (
                  <SidebarMenuButton
                    asChild
                    tooltip={label}
                    isActive={path === route}
                    className={activeSidebarItemClass}
                  >
                    <Link
                      to={route}
                      draggable={false}
                      aria-current={path === route ? "page" : undefined}
                    >
                      <SidebarLinkHoverEffect />
                      <Icon className="relative z-10" />
                      <span className="relative z-10">{label}</span>
                    </Link>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton tooltip={label} disabled aria-disabled>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {navGroups.map((group) => {
          const items = group.items.filter((item) => canSeeRoute(role, item.route));
          return items.length > 0 ? (
            <SidebarNavGroup key={group.label} group={{ ...group, items }} path={path} />
          ) : null;
        })}

        {/* Archiv — Papierkorb für versehentlich gelöschte Einträge */}
        <SidebarGroup className="z-10 px-1 py-2 group-data-[collapsible=icon]:p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Archiv"
                isActive={path === "/archiv"}
                className={activeSidebarItemClass}
              >
                <Link
                  to="/archiv"
                  draggable={false}
                  aria-current={path === "/archiv" ? "page" : undefined}
                >
                  <SidebarLinkHoverEffect />
                  <Archive className="relative z-10" />
                  <span className="relative z-10">Archiv</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter
        className={cn(
          "relative z-20 bg-sidebar before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-14 before:bg-gradient-to-t before:from-sidebar before:via-sidebar/90 before:to-transparent before:transition-opacity before:duration-300",
          sidebarCanScrollDown ? "before:opacity-100" : "before:opacity-0",
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 -top-7 z-10 flex justify-center transition-[opacity,transform] duration-300 ease-snappy group-data-[collapsible=icon]:hidden motion-reduce:transition-none",
            sidebarCanScrollDown
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-1.5 scale-90 opacity-0",
          )}
        >
          <button
            type="button"
            aria-label="Weitere Menüpunkte anzeigen"
            tabIndex={sidebarCanScrollDown ? 0 : -1}
            onClick={scrollSidebarNavigationDown}
            className={cn(
              "group/cue flex size-6 items-center justify-center rounded-full border border-sidebar-border/70 bg-sidebar text-muted-foreground shadow-[var(--shadow-lift)] transition-[color,background-color] duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              sidebarCanScrollDown ? "pointer-events-auto" : "pointer-events-none",
            )}
          >
            <ChevronDown className="size-3.5 transition-transform duration-150 group-hover/cue:translate-y-0.5" />
          </button>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-heading text-base font-medium tracking-tight">
                      {user?.name ?? "Fahrschule"}
                    </span>
                    {user && (
                      <span className="truncate text-xs text-muted-foreground">
                        {ROLE_LABELS[user.role]}
                      </span>
                    )}
                  </span>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-popper-anchor-width) min-w-56"
              >
                {role === "inhaber" && (
                  <DropdownMenuItem asChild>
                    <Link to="/benutzer">
                      <UserCog />
                      Benutzer &amp; Protokoll
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                  <KeyRound />
                  Passwort ändern
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    void logout();
                  }}
                >
                  <LogOut />
                  Abmelden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </Sidebar>
  );
}

export function App() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

function AppShell() {
  const path = useRouterState({ select: (state) => state.location.pathname });

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider className="bg-sidebar">
        <AppSidebar path={path} />
        <SidebarInset className="h-[calc(100svh-1rem)] min-h-0 !bg-transparent !shadow-none md:!m-2 md:!rounded-lg">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
      {process.env.NODE_ENV === "development" && <DevAgentation />}
    </TooltipProvider>
  );
}

export default App;
