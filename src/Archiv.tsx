/* ------------------------------------------------------------------ */
/* Archiv — gelöschte Einträge (Papierkorb). Alles, was über die App   */
/* gelöscht wurde (Fahrschüler, Termine, Fahrlehrer, Fahrzeuge,        */
/* Preispläne), landet hier und kann wiederhergestellt oder endgültig  */
/* entfernt werden. Daten kommen aus /api/archive (use-archive).       */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import {
  ArchiveRestore,
  Archive as ArchiveIcon,
  CalendarDays,
  Car,
  GraduationCap,
  Search,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  purgeArchived,
  restoreArchived,
  useArchive,
  type ArchiveEntity,
  type ArchiveItem,
} from "@/hooks/use-archive";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ENTITY_META: Record<
  ArchiveEntity,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  student: { label: "Fahrschüler/in", Icon: GraduationCap },
  calendar_event: { label: "Termin", Icon: CalendarDays },
  instructor: { label: "Fahrlehrer/in", Icon: Users },
  vehicle: { label: "Fahrzeug", Icon: Car },
  price_plan: { label: "Preisplan", Icon: Tag },
};

const deletedAtFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

type EntityFilter = "all" | ArchiveEntity;

function formatDeletedAt(deletedAt: string): string {
  const date = new Date(deletedAt);
  if (Number.isNaN(date.getTime())) return "Unbekannt";
  return deletedAtFormatter.format(date);
}

function ArchiveRow({
  item,
  busy,
  onRestore,
  onPurge,
}: {
  item: ArchiveItem;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { label, Icon } = ENTITY_META[item.entity];

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{item.label}</span>
            <Badge variant="outline" className="font-normal">
              {label}
            </Badge>
          </div>
          {item.detail && (
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {item.detail}
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            Gelöscht am {formatDeletedAt(item.deletedAt)}
            {item.deletedBy ? ` von ${item.deletedBy}` : ""}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onRestore}>
          <ArchiveRestore data-icon="inline-start" />
          Wiederherstellen
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`${item.label} endgültig löschen`}
            >
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Endgültig löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                „{item.label}" ({label}) wird unwiderruflich aus dem Archiv entfernt und
                kann danach nicht mehr wiederhergestellt werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={onPurge}>Endgültig löschen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function Archiv() {
  const { items, loading, refresh } = useArchive();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return items.filter(
      (item) =>
        (entityFilter === "all" || item.entity === entityFilter) &&
        (!needle ||
          `${item.label} ${item.detail} ${item.deletedBy}`
            .toLocaleLowerCase("de")
            .includes(needle)),
    );
  }, [entityFilter, items, query]);

  const run = async (id: number, action: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Select
            value={entityFilter}
            onValueChange={(value) => setEntityFilter(value as EntityFilter)}
          >
            <SelectTrigger size="sm" className="w-auto" aria-label="Art filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                <SelectItem value="all">Alle Arten</SelectItem>
                {(Object.keys(ENTITY_META) as ArchiveEntity[]).map((entity) => (
                  <SelectItem key={entity} value={entity}>
                    {ENTITY_META[entity].label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      >
        <h1 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em]">Archiv</h1>
        <div className="relative min-w-0 flex-1 sm:max-w-64 sm:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Suchen"
            aria-label="Archiv durchsuchen"
            className="h-8 w-full pl-8"
          />
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <p className="pb-2 text-sm text-pretty text-muted-foreground">
            Gelöschte Fahrschüler, Termine, Fahrlehrer, Fahrzeuge und Preispläne bleiben
            hier erhalten. Mit „Wiederherstellen“ kehrt der Eintrag mit allen
            Verknüpfungen an seinen Platz zurück.
          </p>

          {loading ? (
            <>
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </>
          ) : items.length === 0 ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArchiveIcon />
                </EmptyMedia>
                <EmptyTitle>Das Archiv ist leer</EmptyTitle>
                <EmptyDescription>
                  Gelöschte Fahrschüler, Termine, Fahrlehrer, Fahrzeuge und Preispläne
                  erscheinen hier.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : visible.length === 0 ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>Keine Treffer</EmptyTitle>
                <EmptyDescription>
                  Kein archivierter Eintrag passt zu Suche und Filter.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setEntityFilter("all");
                }}
              >
                Filter zurücksetzen
              </Button>
            </Empty>
          ) : (
            <div className="stagger-in flex flex-col gap-2">
              {visible.map((item) => (
                <ArchiveRow
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onRestore={() =>
                    run(
                      item.id,
                      () => restoreArchived(item.id),
                      `„${item.label}" wiederhergestellt.`,
                    )
                  }
                  onPurge={() =>
                    run(
                      item.id,
                      () => purgeArchived(item.id),
                      `„${item.label}" endgültig gelöscht.`,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Archiv;
