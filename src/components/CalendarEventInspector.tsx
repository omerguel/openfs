import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CalendarDays,
  Car,
  CircleCheck,
  CircleDashed,
  Clock3,
  GraduationCap,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Route,
  Tag,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

import { CANCELLATION_KIND_LABELS } from "@/lib/cancellation";
import { Button } from "@/components/ui/button";
import { parseISODate, type CalEvent } from "@/lib/calendar-data";
import { cn } from "@/lib/utils";

type CalendarEventInspectorProps = {
  event: CalEvent | null;
  onEdit: (event: CalEvent) => void;
  onDelete: (event: CalEvent) => void;
  onCreate: () => void;
  onClear: () => void;
  /** Absage / Nichterscheinen — opens the cancel dialog. */
  onCancelEvent?: (event: CalEvent) => void;
  onUncancelEvent?: (event: CalEvent) => void;
  /** Delete this and all later occurrences of the event's series. */
  onDeleteFollowing?: (event: CalEvent) => void;
};

function formatDate(value: string) {
  return parseISODate(value).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DetailRow({
  icon: Icon,
  label,
  children,
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[1.25rem_5.25rem_minmax(0,1fr)] items-center gap-2.5 px-3 py-2">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground/75" />
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-sm leading-snug tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function CalendarEventInspector({
  event,
  onEdit,
  onDelete,
  onCreate,
  onClear,
  onCancelEvent,
  onUncancelEvent,
  onDeleteFollowing,
}: CalendarEventInspectorProps) {
  if (!event) {
    return (
      <aside
        aria-label="Termindetails"
        className="flex h-full min-h-0 w-full flex-col bg-background"
      >
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <CalendarDays
            aria-hidden="true"
            className="mb-4 size-5 text-muted-foreground"
          />
          <h2 className="text-sm font-medium">Kein Termin ausgewählt</h2>
          <p className="mt-1.5 max-w-56 text-sm leading-relaxed text-muted-foreground text-pretty">
            Wählen Sie einen Termin im Kalender aus, um die Details zu sehen.
          </p>
          <Button type="button" size="sm" className="mt-5" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            Termin erstellen
          </Button>
        </div>
      </aside>
    );
  }

  const hasStudent = Boolean(event.subtitle?.trim());
  const hasVehicle = Boolean(event.vehicle?.trim());
  const hasLocation = Boolean(event.location?.trim());
  const cancelled = Boolean(event.cancelledAt);
  const StatusIcon = cancelled ? Ban : event.tentative ? CircleDashed : CircleCheck;
  const statusLabel = cancelled
    ? CANCELLATION_KIND_LABELS[event.cancellationKind ?? "abgesagt"]
    : event.tentative
      ? "Vorläufig"
      : "Bestätigt";
  const statusDot = cancelled
    ? "bg-destructive"
    : event.tentative
      ? "bg-amber-500"
      : "bg-emerald-500";
  // Billed lessons must be storniert before they can be cancelled.
  const canCancel =
    !cancelled && !(event.billedTransactionId != null && event.billedActive);

  return (
    <aside
      aria-label="Termindetails"
      className="flex h-full min-h-0 w-full flex-col bg-background"
    >
      <header className="shrink-0 border-b border-border/70 px-3 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[11px] font-medium text-muted-foreground">Termin</p>
            <h2
              id="calendar-event-inspector-title"
              aria-live="polite"
              className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.01em]"
              title={event.title}
            >
              {event.title}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="-mt-1 -mr-2 text-muted-foreground"
            aria-label="Termindetails schließen"
            title="Schließen"
            onClick={onClear}
          >
            <X />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(event)}>
            <Pencil data-icon="inline-start" />
            Bearbeiten
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(event)}
          >
            <Trash2 data-icon="inline-start" />
            Löschen
          </Button>
          {cancelled && onUncancelEvent && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="col-span-2"
              onClick={() => onUncancelEvent(event)}
            >
              <Undo2 data-icon="inline-start" />
              Absage zurücknehmen
            </Button>
          )}
          {canCancel && onCancelEvent && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="col-span-2"
              onClick={() => onCancelEvent(event)}
            >
              <Ban data-icon="inline-start" />
              Absagen
            </Button>
          )}
          {event.seriesId && onDeleteFollowing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="col-span-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDeleteFollowing(event)}
            >
              <Repeat data-icon="inline-start" />
              Folgetermine der Serie löschen
            </Button>
          )}
        </div>
      </header>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <section aria-labelledby="calendar-event-inspector-title">
          <dl className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
            <DetailRow icon={CalendarDays} label="Datum">
              <span className="capitalize">{formatDate(event.date)}</span>
            </DetailRow>
            <DetailRow icon={Clock3} label="Uhrzeit">
              {event.start}–{event.end} Uhr
            </DetailRow>
            <DetailRow icon={UserRound} label="Fahrschüler" muted={!hasStudent}>
              {event.subtitle?.trim() || "Nicht zugeordnet"}
            </DetailRow>
            <DetailRow icon={GraduationCap} label="Fahrlehrer" muted={!event.instructor}>
              {event.instructor || "Nicht zugeteilt"}
            </DetailRow>
            <DetailRow icon={Car} label="Fahrzeug" muted={!hasVehicle}>
              {event.vehicle?.trim() || "Kein Fahrzeug"}
            </DetailRow>
            <DetailRow icon={MapPin} label="Ort" muted={!hasLocation}>
              {event.location?.trim() || "Nicht angegeben"}
            </DetailRow>
            <DetailRow icon={Tag} label="Ereignistyp">
              {event.type}
            </DetailRow>
            {event.lessonKind && (
              <DetailRow icon={Route} label="Fahrtart">
                {event.lessonKind}
              </DetailRow>
            )}
            {event.seriesId && (
              <DetailRow icon={Repeat} label="Serie">
                Serientermin
              </DetailRow>
            )}
            <DetailRow icon={StatusIcon} label="Status">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", statusDot)}
                />
                {statusLabel}
              </span>
            </DetailRow>
            {event.cancellationFeeTransactionId != null && (
              <DetailRow
                icon={Tag}
                label="Ausfallgebühr"
                muted={!event.cancellationFeeActive}
              >
                {event.cancellationFeeActive ? "Gebucht" : "Storniert"}
              </DetailRow>
            )}
          </dl>
        </section>
      </div>
    </aside>
  );
}
