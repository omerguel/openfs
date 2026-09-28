/* ------------------------------------------------------------------ */
/* Global search — Strg/⌘ + K or the search button in every page       */
/* header. Finds Fahrschüler (name, Telefon ohne Leerzeichen, Kunden-/ */
/* Vertragsnummer, E-Mail), Fahrlehrer, Fahrzeuge, Rechnungen (Nummer) */
/* and pages. Uses the existing list APIs, loaded on first open, and   */
/* only what the signed-in role may see.                               */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useAuthStatus } from "@/hooks/use-auth";
import { fetchInstructors, instructorName } from "@/hooks/use-instructors";
import { fetchInvoices } from "@/hooks/use-invoices";
import { fetchStudents } from "@/hooks/use-students";
import { fetchVehicles } from "@/hooks/use-vehicles";
import { searchEntries, type SearchEntry } from "@/lib/global-search";
import { canAccess, visibleNav } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "openfs:open-search";

/** Opens the search dialog (used by the header button). */
export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The header button — icon on phones, "Suchen ⌘K" from md up. */
export function SearchButton() {
  return (
    <button
      type="button"
      onClick={openGlobalSearch}
      aria-label="Suchen (Strg+K)"
      className="flex h-7 shrink-0 items-center gap-2 rounded-md border border-border/70 bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:w-44"
    >
      <Search className="size-3.5" />
      <span className="hidden md:inline">Suchen …</span>
      <Kbd className="ml-auto hidden md:inline-flex">{isMac() ? "⌘K" : "Strg K"}</Kbd>
    </button>
  );
}

function useSearchEntries(open: boolean): SearchEntry[] {
  const role = useAuthStatus().data?.user?.role;
  const router = useRouter();
  const office = canAccess(role, "office");
  const students = useQuery({
    queryKey: ["students"],
    queryFn: fetchStudents,
    enabled: open,
  });
  const instructors = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
    enabled: open && office,
  });
  const vehicles = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => fetchVehicles(),
    enabled: open && office,
  });
  const invoices = useQuery({
    queryKey: ["invoices", "list", "all"],
    queryFn: () => fetchInvoices(),
    enabled: open && office,
  });

  return useMemo(() => {
    const entries: SearchEntry[] = [];
    for (const group of visibleNav(role, (route) => route in router.routesByPath)) {
      for (const item of group.items) {
        entries.push({
          key: `page:${item.route}`,
          kind: "Seite",
          label: item.label,
          detail: group.label,
          href: item.route,
          text: [item.label, group.label, ...(item.keywords ?? [])],
        });
      }
    }
    for (const s of students.data ?? []) {
      const name = `${s.firstName} ${s.lastName}`.trim();
      entries.push({
        key: `student:${s.id}`,
        kind: "Fahrschüler",
        label: name || "Ohne Namen",
        detail: [s.customerNumber, s.classes, s.status === "aktiv" ? "" : s.status]
          .filter(Boolean)
          .join(" · "),
        href: `/fahrschueler/${s.id}`,
        text: [name, s.customerNumber, s.contractNumber, s.email].filter(Boolean),
        phones: [s.phone].filter(Boolean),
      });
    }
    if (office) {
      for (const i of instructors.data ?? []) {
        entries.push({
          key: `instructor:${i.id}`,
          kind: "Fahrlehrer",
          label: instructorName(i),
          detail: i.classes,
          href: "/fahrlehrer",
          text: [instructorName(i), i.email],
          phones: [i.phone].filter(Boolean),
        });
      }
      for (const v of vehicles.data ?? []) {
        entries.push({
          key: `vehicle:${v.id}`,
          kind: "Fahrzeug",
          label: v.model,
          detail: [v.plate, v.klass].filter(Boolean).join(" · "),
          href: "/fahrzeuge",
          text: [v.model, v.plate, v.plate.replace(/[\s-]/g, "")],
        });
      }
      for (const invoice of invoices.data ?? []) {
        entries.push({
          key: `invoice:${invoice.id}`,
          kind: "Rechnung",
          label: invoice.invoiceNr,
          detail: invoice.recipient.name,
          href: invoice.studentId ? `/fahrschueler/${invoice.studentId}` : "/rechnungen",
          text: [invoice.invoiceNr, invoice.recipient.name, invoice.customerNo],
        });
      }
    }
    return entries;
  }, [
    role,
    router,
    office,
    students.data,
    instructors.data,
    vehicles.data,
    invoices.data,
  ]);
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement | null>(null);
  const entries = useSearchEntries(open);
  const groups = useMemo(() => searchEntries(entries, query), [entries, query]);
  const flat = groups.flatMap((group) => group.items);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  };

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    close();
    void navigate({ to: entry.href });
  };

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        showCloseButton={false}
        className="top-[12svh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Suchen</DialogTitle>
        <DialogDescription className="sr-only">
          Fahrschüler, Fahrlehrer, Fahrzeuge, Rechnungen und Seiten durchsuchen.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(flat[cursor]);
              }
            }}
            placeholder="Name, Telefon, Kundennummer, Rechnung, Seite …"
            aria-label="Suchbegriff"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              flat[cursor] ? `search-${flat[cursor]!.key}` : undefined
            }
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          aria-label="Suchergebnisse"
          className="max-h-[min(60svh,420px)] overflow-y-auto p-1.5"
        >
          {!query.trim() ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Suchen Sie nach Fahrschülern (auch per Telefonnummer oder Kundennummer),
              Fahrlehrern, Fahrzeugen, Rechnungsnummern oder Seiten.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Keine Treffer für „{query.trim()}“.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.kind} className="flex flex-col pb-1">
                <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                  {group.kind === "Seite" ? "Seiten" : group.kind}
                </div>
                {group.items.map((entry) => {
                  index += 1;
                  const current = index;
                  return (
                    <button
                      key={entry.key}
                      id={`search-${entry.key}`}
                      type="button"
                      role="option"
                      aria-selected={current === cursor}
                      data-index={current}
                      onMouseMove={() => setCursor(current)}
                      onClick={() => choose(entry)}
                      className={cn(
                        "flex items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
                        current === cursor && "bg-muted",
                      )}
                    >
                      <span className="truncate font-medium">{entry.label}</span>
                      {entry.detail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.detail}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
