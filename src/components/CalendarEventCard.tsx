import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Ban, Car, Moon, Pencil, Route, StickyNote, Trash2, Waypoints } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CalEvent } from "@/lib/calendar-data";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/* Short Fahrtart labels + icons for the cards (Übungsfahrt is the
   default and not worth the space). */
export const LESSON_KIND_BADGE: Record<
  string,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  Überlandfahrt: { label: "Überland", Icon: Route },
  Autobahnfahrt: { label: "Autobahn", Icon: Car },
  Nachtfahrt: { label: "Nacht", Icon: Moon },
  Grundfahraufgaben: { label: "GFA", Icon: Waypoints },
};

/** The bottom strip that resizes the card — small on purpose, so a
    grab anywhere else moves the Termin. */
export const RESIZE_HANDLE_PX = 5;

export function CalendarEventCard({
  event,
  compact,
  dense,
  isDragging,
  isSelected,
  hasConflict,
  style,
  onPointerDown,
  onResizeStart,
  onSelect,
  onEdit,
  onDelete,
}: {
  event: CalEvent;
  compact: boolean;
  /* Taller than compact but still too short for a third row (~1h). */
  dense: boolean;
  isDragging: boolean;
  isSelected: boolean;
  /** Part of an overlap / absence conflict — outlined in red. */
  hasConflict: boolean;
  /** Positioning plus `--ev` (the instructor colour). */
  style: CSSProperties;
  onPointerDown: (pointerEvent: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (pointerEvent: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const cancelled = Boolean(event.cancelledAt);
  // Lessons and exams are about the student; theory and other Termine
  // are about their topic.
  const personal = event.type !== "Theorie" && event.type !== "Andere";
  const primary = (personal && event.subtitle?.trim()) || event.title;
  const kind = event.lessonKind ? LESSON_KIND_BADGE[event.lessonKind] : undefined;
  const secondary = [event.instructor, event.vehicle].filter(Boolean).join(" · ");
  const label = [
    primary,
    primary !== event.title ? event.title : null,
    `${event.start} bis ${event.end}`,
    event.lessonKind,
    event.instructor,
    cancelled ? "abgesagt" : null,
    hasConflict ? "Konflikt" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          aria-grabbed={isDragging}
          aria-label={label}
          title={`${primary} · ${event.start}–${event.end}${event.notes ? `\n${event.notes}` : ""}`}
          draggable={false}
          data-event-id={event.id}
          onPointerDown={onPointerDown}
          onClick={onSelect}
          onDoubleClick={(pointerEvent) => {
            pointerEvent.preventDefault();
            onEdit?.();
          }}
          style={style}
          className={cn(
            "group absolute touch-none select-none overflow-hidden rounded-md border border-l-[3px] text-left outline-hidden transition-[color,background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary/30",
            "h-[var(--card-h)] border-[color-mix(in_oklab,var(--border)_60%,var(--ev))] border-l-[var(--ev)] bg-[color-mix(in_oklab,var(--background)_90%,var(--ev))] hover:bg-[color-mix(in_oklab,var(--background)_85%,var(--ev))]",
            "cursor-grab active:cursor-grabbing hover:z-30 focus-visible:z-30 data-[state=open]:z-30",
            event.tentative && "border-dashed",
            cancelled && "opacity-60",
            hasConflict && "ring-2 ring-destructive/60",
            isSelected && "z-30 ring-2 ring-primary/40",
            isDragging ? "z-40 opacity-90 transition-none" : "z-20",
          )}
        >
          {compact ? (
            <div className="flex h-full min-w-0 items-center gap-1.5 px-1.5">
              <span
                className={cn(
                  "block min-w-0 flex-1 truncate text-[11px] font-medium",
                  cancelled && "line-through",
                )}
              >
                {primary}
              </span>
              {kind && (
                <kind.Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {event.start}
              </span>
            </div>
          ) : (
            <div className="flex h-full min-w-0 flex-col gap-0.5 px-1.5 py-1">
              <span className="flex min-w-0 items-center gap-1 text-[12px] leading-tight font-medium">
                {cancelled && (
                  <Ban aria-hidden className="size-3 shrink-0 text-destructive" />
                )}
                <span className={cn("truncate", cancelled && "line-through")}>
                  {primary}
                </span>
                {event.notes && (
                  <StickyNote
                    aria-hidden
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1 text-[10px] leading-none text-muted-foreground tabular-nums">
                <span className="shrink-0">
                  {event.start}–{event.end}
                </span>
                {kind && (
                  <span className="flex min-w-0 items-center gap-0.5 font-medium text-foreground/80">
                    <kind.Icon aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{kind.label}</span>
                  </span>
                )}
                {!kind && primary !== event.title && (
                  <span className="truncate">· {event.title}</span>
                )}
              </span>
              {!dense && secondary && (
                <span className="mt-auto truncate text-[10px] leading-none text-muted-foreground">
                  {secondary}
                </span>
              )}
            </div>
          )}
          {!cancelled && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 z-10 flex cursor-ns-resize justify-center"
              style={{ height: RESIZE_HANDLE_PX }}
              onPointerDown={(pointerEvent) => {
                pointerEvent.stopPropagation();
                onResizeStart(pointerEvent);
              }}
            >
              <span className="mt-px h-[3px] w-6 rounded-full bg-[var(--ev)] opacity-0 transition-opacity group-hover:opacity-60" />
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => onEdit?.()}>
          <Pencil />
          Bearbeiten
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete?.()}>
          <Trash2 />
          Löschen…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
