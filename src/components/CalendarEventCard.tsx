import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CalEvent } from "@/lib/calendar-data";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/* The calendar owns the token classes so presets and event cards share the
   same accent without this component knowing about event types. */
export type CalendarEventCardTheme = {
  surface: string;
  text: string;
  meta: string;
  focus: string;
};

const RESIZE_EDGE_SIZE = 10;

export function CalendarEventCard({
  event,
  compact,
  dense,
  isDragging,
  isSelected,
  style,
  theme,
  onPointerDown,
  onResizeStart,
  onSelect,
  onEdit,
  onDelete,
}: {
  event: CalEvent;
  compact: boolean;
  /* Taller than compact but still too short for a wrapped meta row (~1h):
     title and meta stay on one line each and truncate instead of wrapping. */
  dense: boolean;
  isDragging: boolean;
  isSelected: boolean;
  style: CSSProperties;
  theme: CalendarEventCardTheme;
  onPointerDown: (pointerEvent: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (
    edge: "start" | "end",
    pointerEvent: ReactPointerEvent<HTMLElement>,
  ) => void;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          aria-grabbed={isDragging}
          aria-label={`${event.title}, ${event.start} bis ${event.end}${event.cancelledAt ? ", abgesagt" : ""}`}
          draggable={false}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const offsetY = event.clientY - rect.top;

            if (offsetY <= RESIZE_EDGE_SIZE) {
              onResizeStart("start", event);
              return;
            }

            if (rect.height - offsetY <= RESIZE_EDGE_SIZE) {
              onResizeStart("end", event);
              return;
            }

            onPointerDown(event);
          }}
          onClick={onSelect}
          onDoubleClick={(pointerEvent) => {
            pointerEvent.preventDefault();
            onEdit?.();
          }}
          style={style}
          className={cn(
            "group absolute touch-none select-none overflow-hidden rounded-md border text-left outline-hidden transition-[top,height,color,background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none focus-visible:ring-2",
            theme.surface,
            "h-[var(--card-h)]",
            "cursor-grab active:cursor-grabbing hover:z-30 focus-visible:z-30 data-[state=open]:z-30",
            theme.focus,
            event.tentative &&
              "border-dashed border-border bg-[color-mix(in_oklab,var(--background)_20%,var(--muted))] hover:bg-muted",
            // Cancelled lessons stay as greyed-out history.
            event.cancelledAt &&
              "border-dashed border-border bg-muted/40 opacity-70 hover:bg-muted",
            isSelected &&
              "z-30 border-primary/45 bg-[color-mix(in_oklab,var(--background)_89%,var(--primary))] ring-2 ring-primary/20",
            isDragging ? "z-40 opacity-90 transition-none" : "z-20",
          )}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-10 h-2.5 cursor-ns-resize rounded-t-lg"
            onPointerDown={(event) => onResizeStart("start", event)}
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 z-10 h-2.5 cursor-ns-resize rounded-b-lg"
            onPointerDown={(event) => onResizeStart("end", event)}
          />
          {compact ? (
            <div className="flex h-full min-w-0 items-center gap-1.5 px-2">
              <span
                className={cn(
                  "block min-w-0 flex-1 truncate text-[11px] font-medium",
                  theme.text,
                  event.cancelledAt && "text-muted-foreground line-through",
                )}
              >
                {event.title}
              </span>
              <span className={cn("shrink-0 text-[10px] tabular-nums", theme.meta)}>
                {event.start}
              </span>
            </div>
          ) : (
            <div className="flex h-full min-w-0 flex-col px-2 py-1.5">
              <span
                className={cn(
                  "block w-full min-w-0 shrink-0 truncate text-[12px] font-medium leading-[1.2]",
                  theme.text,
                  event.cancelledAt && "text-muted-foreground line-through",
                )}
              >
                {event.title}
              </span>
              <span
                className={cn(
                  "mt-1 shrink-0 text-[10px] leading-none tabular-nums",
                  theme.meta,
                )}
              >
                {event.start}–{event.end}
              </span>
              {!dense && (
                <span
                  className={cn(
                    "mt-auto truncate pt-1 text-[10px] leading-none",
                    theme.meta,
                  )}
                >
                  {event.subtitle || event.instructor}
                  {event.vehicle ? ` · ${event.vehicle}` : ""}
                </span>
              )}
            </div>
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
          Löschen
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
