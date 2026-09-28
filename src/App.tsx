import "./index.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { ConfirmHost } from "@/components/confirm";
import { Agentation } from "agentation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  KeyRound,
  LogOut,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AuthGate } from "@/components/auth/AuthGate";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { NoAccess } from "@/components/auth/NoAccess";
import { GlobalSearch } from "@/components/GlobalSearch";
import { logout, ROLE_LABELS, useAuthStatus } from "@/hooks/use-auth";
import {
  canSeeRoute,
  DEFAULT_COLLAPSED_GROUPS,
  type NavGroup,
  visibleNav,
} from "@/lib/navigation";
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
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";

/* The menu itself lives in src/lib/navigation.ts (NAV_GROUPS) — one config
   for sidebar, route guard and search. */

const activeSidebarItemClass =
  "group/sidebar-link hover:z-10 overflow-visible select-none hover:bg-transparent active:bg-transparent data-active:bg-transparent data-active:hover:bg-transparent data-active:active:bg-transparent transition-[background-color] duration-100 ease-out data-active:duration-0 motion-reduce:transition-none";

function SidebarLinkHoverEffect() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <span className="absolute inset-1 rounded-sm bg-sidebar-accent opacity-0 transition-[top,right,bottom,left,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/sidebar-link:inset-y-0 group-hover/sidebar-link:-inset-x-1 group-hover/sidebar-link:opacity-100 group-focus-visible/sidebar-link:inset-y-0 group-focus-visible/sidebar-link:-inset-x-1 group-focus-visible/sidebar-link:opacity-100 group-data-[active=true]/sidebar-link:inset-y-0 group-data-[active=true]/sidebar-link:-inset-x-1 group-data-[active=true]/sidebar-link:opacity-100 motion-reduce:transition-none" />
    </span>
  );
}

/* Collapsed groups are remembered per browser (a convenience only —
   storage may be unavailable, then the defaults apply). */
const COLLAPSED_KEY = "openfs:nav-collapsed";

function readCollapsed(defaults: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : defaults;
  } catch {
    return defaults;
  }
}

function useCollapsedGroups(defaults: string[]) {
  const [collapsed, setCollapsed] = useState<string[]>(() => readCollapsed(defaults));
  const toggle = useCallback((id: string, open: boolean) => {
    setCollapsed((current) => {
      const next = open
        ? current.filter((g) => g !== id)
        : [...new Set([...current, id])];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — keep the in-memory state
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

function isActive(route: string, path: string) {
  return route === "/" ? path === "/" : path === route || path.startsWith(`${route}/`);
}

function SidebarNavGroup({
  group,
  path,
  open,
  onOpenChange,
}: {
  group: NavGroup;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const containsActive = group.items.some((item) => isActive(item.route, path));
  // The group of the current page is always shown open.
  const expanded = open || containsActive;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onOpenChange}
      className="group/collapsible"
      asChild
    >
      <SidebarGroup className="z-10 px-1 py-0.5">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            disabled={containsActive}
            className="h-7 w-full cursor-pointer justify-between text-[11px] font-semibold tracking-wide text-sidebar-foreground/60 uppercase hover:text-sidebar-foreground disabled:cursor-default"
          >
            {group.label}
            <ChevronRight
              aria-hidden
              className={cn(
                "transition-transform duration-200 ease-drawer motion-reduce:transition-none",
                expanded && "rotate-90",
                containsActive && "opacity-0",
              )}
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarMenu className="gap-0">
            {group.items.map(({ label, Icon, route }) => {
              const active = isActive(route, path);
              return (
                <SidebarMenuItem key={route}>
                  <SidebarMenuButton
                    asChild
                    tooltip={label}
                    isActive={active}
                    className={cn(activeSidebarItemClass, "h-8 md:h-7")}
                  >
                    <Link
                      to={route}
                      draggable={false}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <SidebarLinkHoverEffect />
                      <Icon className="relative z-10" />
                      <span className="relative z-10 truncate">{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
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
  const router = useRouter();
  const user = auth.data?.user ?? null;
  const role = user?.role;
  const [passwordOpen, setPasswordOpen] = useState(false);
  // The short Fahrlehrer menu fits without collapsing anything.
  const { collapsed, toggle } = useCollapsedGroups(
    role === "fahrlehrer" ? [] : DEFAULT_COLLAPSED_GROUPS,
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sidebarCanScrollDownRef = useRef(false);
  const [sidebarCanScrollDown, setSidebarCanScrollDown] = useState(false);
  const groups = visibleNav(role, (route) => route in router.routesByPath);

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
    const list = content.firstElementChild;
    if (list) observer?.observe(list);

    return () => {
      content.removeEventListener("scroll", updateFooterFade);
      window.removeEventListener("resize", updateFooterFade);
      observer?.disconnect();
    };
  }, []);

  return (
    <Sidebar variant="inset">
      <SidebarContent ref={contentRef} className="gap-0 py-1">
        <div className="flex flex-col gap-0.5">
          {groups.map((group) => (
            <SidebarNavGroup
              key={group.id}
              group={group}
              path={path}
              open={!collapsed.includes(group.id)}
              onOpenChange={(open) => toggle(group.id, open)}
            />
          ))}
        </div>
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

/* A new page starts at the top: every page has its own scroll container,
   but a reused component (e.g. /fahrschueler/1 → /fahrschueler/2) or the
   mobile document scroll would otherwise keep the old position. */
function useResetScrollOnNavigate(
  path: string,
  root: React.RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const main = root.current;
    if (!main) return;
    main.scrollTop = 0;
    for (const element of main.querySelectorAll<HTMLElement>(
      ".overflow-auto, .overflow-y-auto, [data-slot=scroll-area-viewport]",
    )) {
      if (element.scrollTop > 0) element.scrollTop = 0;
    }
  }, [path, root]);
}

function AppShell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const role = useAuthStatus().data?.user?.role;
  const insetRef = useRef<HTMLElement | null>(null);
  useResetScrollOnNavigate(path, insetRef);

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider className="bg-sidebar">
        <AppSidebar path={path} />
        <SidebarInset
          ref={insetRef}
          className="h-[calc(100svh-1rem)] min-h-0 !bg-transparent !shadow-none md:!m-2 md:!rounded-lg"
        >
          {canSeeRoute(role, path) ? <Outlet /> : <NoAccess path={path} />}
        </SidebarInset>
        <GlobalSearch />
      </SidebarProvider>
      <Toaster />
      <ConfirmHost />
      {process.env.NODE_ENV === "development" && <DevAgentation />}
    </TooltipProvider>
  );
}

export default App;
