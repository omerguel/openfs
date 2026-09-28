import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  PanelRight,
  Plus,
} from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  CalendarEventCard,
  type CalendarEventCardTheme,
} from "./components/CalendarEventCard.tsx";
import { CalendarEventInspector } from "./components/CalendarEventInspector.tsx";
import { CancelEventDialog } from "./components/CancelEventDialog.tsx";
import { EventEditDialog, type EventSaveOptions } from "./components/EventEditDialog.tsx";
import { type Absence, useAbsences } from "@/hooks/use-absences";
import { useInstructors } from "@/hooks/use-instructors";
import { useStudents } from "@/hooks/use-students";
import {
  addDays,
  type CalEvent,
  type EventPreset,
  eventPresets,
  groupEventsByDay,
  isSameDay,
  layoutDay,
  nonFahrstundeTypes,
  startOfWeek,
  toISODate,
  toMinutes,
  TODAY,
} from "@/lib/calendar-data";
import {
  createCalendarEvent,
  createCalendarEventSeries,
  deleteCalendarEvent,
  deleteCalendarEventSeries,
  isOverridableConflict,
  uncancelCalendarEvent,
  updateCalendarEvent,
  useCalendarConflicts,
  useCalendarEvents,
} from "@/hooks/use-calendar-events";
import { formatGermanDate } from "@/lib/working-time";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Time grid configuration                                            */
/* ------------------------------------------------------------------ */

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 76; // px per hour
const SNAP_MINUTES = 15;
const DAY_COUNT = 7;
const DAY_MINUTES = (END_HOUR - START_HOUR) * 60;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const HOUR_INTERVALS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, i) => START_HOUR + i,
);
const HOUR_MARKS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i,
);

const NEW_EVENT_ID = "__new_calendar_event__";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const snapMinutes = (minutes: number) =>
  Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

const formatMinutes = (minutes: number) => {
  const clamped = clamp(minutes, 0, DAY_MINUTES);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const nextEditableStartTime = () => {
  const now = new Date();
  const roundedMinutes = Math.ceil(now.getMinutes() / SNAP_MINUTES) * SNAP_MINUTES;
  const minutes = clamp(
    now.getHours() * 60 + roundedMinutes,
    START_HOUR * 60,
    END_HOUR * 60 - 45,
  );

  return formatMinutes(minutes);
};

/* Non-blocking server hints (e.g. daily limit exceeded) after a write. */
const showWarnings = (warnings?: string[]) => {
  for (const warning of warnings ?? []) toast.warning(warning);
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const topForMinutes = (minutes: number) =>
  ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

const deferUntilFloatingLayerCloses = (callback: () => void) => {
  window.setTimeout(callback, 0);
};

const handleCalendarWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
  const horizontalDelta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.shiftKey
        ? event.deltaY
        : 0;

  if (!horizontalDelta) return;

  const grid = event.currentTarget;
  const nextScrollLeft = clamp(
    grid.scrollLeft + horizontalDelta,
    0,
    Math.max(grid.scrollWidth - grid.clientWidth, 0),
  );

  if (nextScrollLeft === grid.scrollLeft) return;

  grid.scrollLeft = nextScrollLeft;
  event.preventDefault();
};

/* ------------------------------------------------------------------ */
/* Event card theme                                                   */
/* ------------------------------------------------------------------ */

/* The reference uses a different pastel for every calendar. OpenFS keeps
   its one-accent system instead: event type is written on the card and the
   selected state carries the stronger blue emphasis. */
const calendarEventTheme: CalendarEventCardTheme = {
  surface:
    "border-primary/20 bg-[color-mix(in_oklab,var(--background)_93%,var(--primary))] hover:bg-[color-mix(in_oklab,var(--background)_90%,var(--primary))]",
  text: "text-foreground",
  meta: "text-muted-foreground",
  focus: "focus-visible:ring-primary/30",
};
/* ------------------------------------------------------------------ */
/* Date formatters                                                    */
/* ------------------------------------------------------------------ */

const monthLong = (date: Date) => date.toLocaleDateString("de-DE", { month: "long" });
const monthShort = (date: Date) => date.toLocaleDateString("de-DE", { month: "short" });

const getISOWeek = (date: Date) => {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
};

/* ------------------------------------------------------------------ */
/* Event block                                                        */
/* ------------------------------------------------------------------ */

type DragState = {
  id: string;
  pointerStartX: number;
  pointerStartY: number;
  /* The event's position when the drag started — drag math is a pure
     function of this + the pointer, so drag-end never depends on React
     having committed the last move (see dragResultRef below). */
  date: string;
  start: string;
  end: string;
} & (
  | { mode: "move"; duration: number; pointerOffsetY: number }
  | {
      mode: "resize-start" | "resize-end";
      /* Minutes between the pointer and the grabbed edge at drag start. Compact
         cards expand on hover, so the visible edge can sit well below the true
         end time — without this anchor, grabbing would jump the time to the
         cursor's line before the user even moves. */
      grabOffsetMinutes: number;
    }
);

/* Where the dragged event sits for a given pointer position. Pure: reads
   the original position from DragState, so it can run outside React. */
function computeDragPosition(
  dragging: DragState,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  weekStart: Date,
): { date: string; start: string; end: string } {
  const rawPointerMinutes = ((clientY - rect.top) / HOUR_HEIGHT) * 60 + START_HOUR * 60;

  if (dragging.mode === "move") {
    const dayWidth = rect.width / DAY_COUNT;
    const day = clamp(Math.floor((clientX - rect.left) / dayWidth), 0, DAY_COUNT - 1);
    const rawStartMinutes =
      ((clientY - rect.top - dragging.pointerOffsetY) / HOUR_HEIGHT) * 60 +
      START_HOUR * 60;
    const startMinutes = clamp(
      Math.round(rawStartMinutes),
      START_HOUR * 60,
      END_HOUR * 60 - dragging.duration,
    );
    const endMinutes = startMinutes + dragging.duration;
    return {
      date: toISODate(addDays(weekStart, day)),
      start: formatMinutes(startMinutes),
      end: formatMinutes(endMinutes),
    };
  }

  // Resize by pointer delta from where the edge was grabbed, not by
  // absolute pointer position — see DragState.grabOffsetMinutes.
  // Keep the preview attached to the pointer. The final value is snapped to
  // a quarter-hour on release so resizing feels fluid without changing the
  // calendar's stored time increments.
  const pointerMinutes = Math.round(rawPointerMinutes - dragging.grabOffsetMinutes);

  if (dragging.mode === "resize-start") {
    const endMinutes = toMinutes(dragging.end);
    const nextStartMinutes = clamp(
      pointerMinutes,
      START_HOUR * 60,
      endMinutes - SNAP_MINUTES,
    );
    return {
      date: dragging.date,
      start: formatMinutes(nextStartMinutes),
      end: dragging.end,
    };
  }

  // mode === "resize-end"
  const startMinutes = toMinutes(dragging.start);
  const nextEndMinutes = clamp(
    pointerMinutes,
    startMinutes + SNAP_MINUTES,
    END_HOUR * 60,
  );
  return {
    date: dragging.date,
    start: dragging.start,
    end: formatMinutes(nextEndMinutes),
  };
}

function EventBlock({
  event,
  cascadeOffset,
  cascadeDepth,
  isDragging,
  isSelected,
  onDragStart,
  onResizeStart,
  onSelect,
  onEdit,
  onDelete,
}: {
  event: CalEvent;
  cascadeOffset: number;
  cascadeDepth: number;
  isDragging: boolean;
  isSelected: boolean;
  onDragStart: (
    event: CalEvent,
    pointerEvent: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onResizeStart: (
    event: CalEvent,
    edge: "start" | "end",
    pointerEvent: ReactPointerEvent<HTMLElement>,
  ) => void;
  onSelect: (event: CalEvent) => void;
  onEdit: (event: CalEvent) => void;
  onDelete: (event: CalEvent) => void;
}) {
  const startMin = toMinutes(event.start);
  const endMin = toMinutes(event.end);
  const duration = endMin - startMin;
  const slotHeight = Math.max((duration / 60) * HOUR_HEIGHT - 2, 38);
  const horizontalOffset = Math.min(cascadeDepth * 6, 24);
  const top = topForMinutes(startMin) + cascadeOffset;
  const visibleHeight = slotHeight - cascadeOffset;
  const theme = calendarEventTheme;
  const compact = visibleHeight < 52;
  // Cards up to ~1h are too short for a wrapped meta row — it would squeeze
  // the title. Title and meta stay single-line and truncate instead.
  const dense = !compact && visibleHeight < 76;

  return (
    <CalendarEventCard
      event={event}
      compact={compact}
      dense={dense}
      isDragging={isDragging}
      isSelected={isSelected}
      theme={theme}
      onPointerDown={(pointerEvent) => {
        if (pointerEvent.button !== 0) return;
        pointerEvent.preventDefault();
        pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
        onDragStart(event, pointerEvent);
      }}
      onSelect={() => onSelect(event)}
      onResizeStart={(edge, pointerEvent) => onResizeStart(event, edge, pointerEvent)}
      onEdit={() => onEdit(event)}
      onDelete={() => onDelete(event)}
      style={
        {
          top,
          left: 3 + horizontalOffset,
          width: `calc(100% - ${6 + horizontalOffset}px)`,
          zIndex: isDragging ? 40 : 3,
          "--card-h": `${visibleHeight}px`,
        } as CSSProperties
      }
    />
  );
}

/* Stable empty array so eventsByDay.get(iso) ?? NO_EVENTS never produces
   a new array identity on days that have no events — DayColumn's memo
   compares by reference and would otherwise always rerender empty columns. */
const NO_EVENTS: CalEvent[] = [];

/* ------------------------------------------------------------------ */
/* Day column                                                         */
/*                                                                    */
/* Self-contained on purpose: memo'd so that during a drag only the  */
/* column(s) containing the dragged event rerender — the grouping    */
/* memo rebuilds the per-day arrays every frame, so array identity   */
/* alone would defeat the memo. The element-wise events comparison   */
/* is load-bearing: untouched events keep object identity through    */
/* the drag's current.map(), so 6 of 7 columns bail out every frame. */
/* ------------------------------------------------------------------ */

const DayColumn = memo(
  function DayColumn({
    iso,
    isToday,
    events,
    draggingId,
    selectedEventId,
    onDragStart,
    onResizeStart,
    onSelect,
    onEdit,
    onDelete,
  }: {
    iso: string;
    isToday: boolean;
    events: CalEvent[];
    draggingId: string | null;
    selectedEventId: string | null;
    onDragStart: (
      event: CalEvent,
      pointerEvent: ReactPointerEvent<HTMLButtonElement>,
    ) => void;
    onResizeStart: (
      event: CalEvent,
      edge: "start" | "end",
      pointerEvent: ReactPointerEvent<HTMLElement>,
    ) => void;
    onSelect: (event: CalEvent) => void;
    onEdit: (event: CalEvent) => void;
    onDelete: (event: CalEvent) => void;
  }) {
    const placed = useMemo(() => {
      const layout = layoutDay(events).placed;
      let overlapEnd = -1;
      let previousDisplayTop = -Infinity;
      let cascadeDepth = 0;

      return layout.map((placement) => {
        const start = toMinutes(placement.event.start);
        const end = toMinutes(placement.event.end);
        const actualTop = topForMinutes(start);
        const slotHeight = Math.max(((end - start) / 60) * HOUR_HEIGHT - 2, 38);

        if (start >= overlapEnd) {
          overlapEnd = end;
          previousDisplayTop = actualTop;
          cascadeDepth = 0;
          return { ...placement, cascadeOffset: 0, cascadeDepth };
        }

        cascadeDepth += 1;
        overlapEnd = Math.max(overlapEnd, end);
        const cascadeOffset = Math.min(
          Math.max(previousDisplayTop + 22 - actualTop, 0),
          Math.max(slotHeight - 38, 0),
        );
        previousDisplayTop = actualTop + cascadeOffset;
        return { ...placement, cascadeOffset, cascadeDepth };
      });
    }, [events]);
    return (
      <div
        className={cn(
          "relative h-full border-l border-border/60",
          isToday && "bg-destructive/[0.025]",
        )}
      >
        {/* Hour lines */}
        {HOUR_INTERVALS.map((hour) => (
          <div
            key={hour}
            className="border-b border-border/55"
            style={{ height: HOUR_HEIGHT }}
          />
        ))}

        {/* Events */}
        {placed.map(({ event, cascadeOffset, cascadeDepth }) => (
          <EventBlock
            key={event.id}
            event={event}
            cascadeOffset={cascadeOffset}
            cascadeDepth={cascadeDepth}
            isDragging={draggingId === event.id}
            isSelected={selectedEventId === event.id}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    );
  },
  (prev, next) =>
    prev.iso === next.iso &&
    prev.isToday === next.isToday &&
    prev.draggingId === next.draggingId &&
    prev.selectedEventId === next.selectedEventId &&
    prev.onDragStart === next.onDragStart &&
    prev.onResizeStart === next.onResizeStart &&
    prev.onSelect === next.onSelect &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.events.length === next.events.length &&
    prev.events.every((event, i) => event === next.events[i]),
);

/* ------------------------------------------------------------------ */
/* Kalendar page                                                      */
/* ------------------------------------------------------------------ */

export function Kalendar() {
  const { filter } = useSearch({ from: "/_portal/kalender" });
  const initialTypeFilter = filter === "non-fahrstunde" ? nonFahrstundeTypes : undefined;
  const [anchor, setAnchor] = useState<Date>(TODAY);
  const [selected, setSelected] = useState<Date | undefined>(TODAY);
  const [now, setNow] = useState(() => new Date());
  // The DB is the system of record; local state mirrors it for the
  // synchronous drag/resize updates and is reconciled on failure.
  const { events: storedEvents, refresh: refreshEvents } = useCalendarEvents();
  const [calendarEvents, setCalendarEvents] = useState<CalEvent[]>([]);
  useEffect(() => {
    setCalendarEvents(storedEvents);
  }, [storedEvents]);
  // dragResultRef holds the exact final position computed synchronously on
  // every pointermove. Drag-end reads it instead of calendarEvents state, so
  // the persisted value is never behind by one React commit cycle.
  const dragResultRef = useRef<{ date: string; start: string; end: string } | null>(null);
  // Instructor names come from the DB (/api/instructors) so the filter and
  // the edit dialog always match the roster managed on /fahrlehrer.
  const { names: instructorOptions } = useInstructors();
  const { students } = useStudents();
  const { vehicleOptions } = useVehicleOptions();
  const studentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students.flatMap((student) => {
            const name = `${student.firstName} ${student.lastName}`.trim();
            return name ? [name] : [];
          }),
        ),
      ).toSorted((left, right) => left.localeCompare(right, "de")),
    [students],
  );
  // Resolves the display name picked in the edit dialog back to the
  // student's id so saved events carry a reliable FK instead of relying
  // on a later name-match back-fill. Duplicate display names keep the
  // FIRST match — same limitation the billing back-fill has.
  const studentIdByName = useMemo(() => {
    const byName = new Map<string, number>();
    for (const student of students) {
      const name = `${student.firstName} ${student.lastName}`.trim();
      if (name && !byName.has(name)) byName.set(name, student.id);
    }
    return byName;
  }, [students]);
  const [types] = useState<Set<string>>(() => new Set(initialTypeFilter ?? []));
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CalEvent | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // Live placement while a preset from the "Ereignis" menu is dragged over
  // the grid. day/startMinutes are null while the pointer is off the grid.
  const [presetDrag, setPresetDrag] = useState<{
    preset: EventPreset;
    day: number | null;
    startMinutes: number | null;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dayGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Open with the current time centered and today's column in view when the
  // week overflows horizontally.
  useEffect(() => {
    const grid = gridRef.current;
    const dayGrid = dayGridRef.current;
    if (!grid) return;

    if (!dayGrid) return;
    const initialNow = new Date();
    const currentMinutes = initialNow.getHours() * 60 + initialNow.getMinutes();
    const gridContentTop =
      dayGrid.getBoundingClientRect().top -
      grid.getBoundingClientRect().top +
      grid.scrollTop;
    grid.scrollTop = clamp(
      gridContentTop + topForMinutes(currentMinutes) - grid.clientHeight / 2,
      0,
      grid.scrollHeight - grid.clientHeight,
    );

    // The initial anchor is TODAY, so the mounted week always contains it.
    const dayIndex = (TODAY.getDay() + 6) % 7; // Monday = 0
    // scrollLeft is 0 on mount, so rect offsets are content coordinates.
    const gutterWidth =
      dayGrid.getBoundingClientRect().left - grid.getBoundingClientRect().left;
    const dayWidth = dayGrid.getBoundingClientRect().width / DAY_COUNT;
    const dayRight = gutterWidth + (dayIndex + 1) * dayWidth;

    // Only scroll if today isn't fully visible; align its column right
    // after the time gutter so the rest of the week stays in view.
    if (dayRight > grid.clientWidth) {
      grid.scrollLeft = Math.min(
        dayIndex * dayWidth,
        grid.scrollWidth - grid.clientWidth,
      );
    }
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const weekFromIso = toISODate(weekStart);
  const weekToIso = toISODate(addDays(weekStart, DAY_COUNT - 1));
  // Existing overlaps / Termine on absence days in the visible week, and
  // the absences themselves for the "Ganztägig" row.
  const { data: weekConflicts, refetch: refetchConflicts } = useCalendarConflicts(
    weekFromIso,
    weekToIso,
  );
  const { data: weekAbsences = [] } = useAbsences({ from: weekFromIso, to: weekToIso });

  useEffect(() => {
    if (!dragging) return;

    // Each drag session starts with no committed result; the ref is
    // populated synchronously on the first pointermove.
    dragResultRef.current = null;

    // The ref always holds the exact latest position; the React state —
    // and with it the whole-page render — updates at most once per frame.
    // pointermove can outpace frames on some browsers/devices.
    let rafId: number | null = null;

    const applyPendingDragResult = () => {
      rafId = null;
      const next = dragResultRef.current;
      if (!next) return;
      setCalendarEvents((current) =>
        current.map((event) =>
          event.id === dragging.id ? { ...event, ...next } : event,
        ),
      );
    };

    const updateEventFromPointer = (clientX: number, clientY: number) => {
      const grid = dayGridRef.current;
      if (!grid) return;

      const rect = grid.getBoundingClientRect();
      // Compute the new position purely from DragState + pointer — no
      // dependency on live React state (fixes the stale-persist bug).
      const next = computeDragPosition(dragging, clientX, clientY, rect, weekStart);
      dragResultRef.current = next;
      if (rafId === null) rafId = requestAnimationFrame(applyPendingDragResult);
    };

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      if (
        dragResultRef.current === null &&
        Math.hypot(
          event.clientX - dragging.pointerStartX,
          event.clientY - dragging.pointerStartY,
        ) < 3
      ) {
        return;
      }
      updateEventFromPointer(event.clientX, event.clientY);
    };

    const stopDragging = () => {
      // Keep drag previews fluid and snap to a quarter-hour only on release.
      if (rafId !== null) cancelAnimationFrame(rafId);
      const preview = dragResultRef.current;
      if (preview && dragging.mode === "move") {
        const startMinutes = clamp(
          snapMinutes(toMinutes(preview.start)),
          START_HOUR * 60,
          END_HOUR * 60 - dragging.duration,
        );
        dragResultRef.current = {
          ...preview,
          start: formatMinutes(startMinutes),
          end: formatMinutes(startMinutes + dragging.duration),
        };
      } else if (preview && dragging.mode === "resize-start") {
        dragResultRef.current = {
          ...preview,
          start: formatMinutes(
            clamp(
              snapMinutes(toMinutes(preview.start)),
              START_HOUR * 60,
              toMinutes(dragging.end) - SNAP_MINUTES,
            ),
          ),
        };
      } else if (preview && dragging.mode === "resize-end") {
        dragResultRef.current = {
          ...preview,
          end: formatMinutes(
            clamp(
              snapMinutes(toMinutes(preview.end)),
              toMinutes(dragging.start) + SNAP_MINUTES,
              END_HOUR * 60,
            ),
          ),
        };
      }

      // Apply the snapped final result synchronously before persisting it.
      applyPendingDragResult();
      // If dragResultRef is still null the user never moved (plain click) —
      // skip the PATCH so a tap on an event doesn't dirty the DB.
      if (dragResultRef.current !== null) {
        // The server rejects overlaps / absent instructors — show why and
        // snap the card back to its stored position.
        void updateCalendarEvent(Number(dragging.id), dragResultRef.current)
          .then((saved) => {
            showWarnings(saved.warnings);
            void refetchConflicts();
          })
          .catch((error: unknown) => {
            toast.error(errorMessage(error, "Termin konnte nicht gespeichert werden."));
            void refreshEvents();
          });
      }
      setDragging(null);
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", stopDragging, { once: true });
    window.addEventListener("pointercancel", stopDragging, { once: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, weekStart, refreshEvents, refetchConflicts]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const days = useMemo(
    () => Array.from({ length: DAY_COUNT }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const visibleEvents = useMemo(() => {
    if (!types.size) return calendarEvents;
    return calendarEvents.filter((event) => types.has(event.type));
  }, [calendarEvents, types]);

  // One pass over visible events instead of one filter per day column +
  // one per day header (14 passes total at 7 columns). During a drag the
  // per-day arrays that don't contain the dragged event keep the same
  // object identity, which lets DayColumn's memo bail out cheaply.
  const eventsByDay = useMemo(() => groupEventsByDay(visibleEvents), [visibleEvents]);
  const selectedEvent = useMemo(
    () =>
      selectedEventId === null
        ? null
        : (calendarEvents.find((event) => event.id === selectedEventId) ?? null),
    [calendarEvents, selectedEventId],
  );

  const handleEventSelect = useCallback((event: CalEvent) => {
    setSelectedEventId(event.id);
    setInspectorOpen(true);
    if (window.matchMedia("(max-width: 1279px)").matches) {
      setMobileInspectorOpen(true);
    }
  }, []);

  const handleEventDragStart = useCallback(
    (event: CalEvent, pointerEvent: ReactPointerEvent<HTMLButtonElement>) => {
      const rect = pointerEvent.currentTarget.getBoundingClientRect();
      dragResultRef.current = null;
      setDragging({
        id: event.id,
        pointerStartX: pointerEvent.clientX,
        pointerStartY: pointerEvent.clientY,
        date: event.date,
        start: event.start,
        end: event.end,
        mode: "move",
        duration: toMinutes(event.end) - toMinutes(event.start),
        pointerOffsetY: pointerEvent.clientY - rect.top,
      });
    },
    [],
  );

  const handleEventResizeStart = useCallback(
    (
      event: CalEvent,
      edge: "start" | "end",
      pointerEvent: ReactPointerEvent<HTMLElement>,
    ) => {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
      const edgeMinutes = toMinutes(edge === "start" ? event.start : event.end);
      const grid = dayGridRef.current;
      const pointerMinutes = grid
        ? ((pointerEvent.clientY - grid.getBoundingClientRect().top) / HOUR_HEIGHT) * 60 +
          START_HOUR * 60
        : edgeMinutes;
      dragResultRef.current = null;
      setDragging({
        id: event.id,
        pointerStartX: pointerEvent.clientX,
        pointerStartY: pointerEvent.clientY,
        date: event.date,
        start: event.start,
        end: event.end,
        mode: edge === "start" ? "resize-start" : "resize-end",
        grabOffsetMinutes: pointerMinutes - edgeMinutes,
      });
    },
    [],
  );

  const handleEventDelete = useCallback(
    (event: CalEvent) => {
      setCalendarEvents((current) => current.filter((item) => item.id !== event.id));
      setSelectedEventId((current) => (current === event.id ? null : current));
      setMobileInspectorOpen(false);
      void deleteCalendarEvent(Number(event.id))
        .then(() => void refetchConflicts())
        .catch((error: unknown) => {
          toast.error(errorMessage(error, "Termin konnte nicht gelöscht werden."));
          void refreshEvents();
        });
    },
    [refreshEvents, refetchConflicts],
  );

  const handleEventEdit = useCallback((event: CalEvent) => {
    // Defer so the context menu finishes closing (and clears its
    // body `pointer-events: none`) before the dialog mounts — otherwise
    // the dialog can open non-interactive.
    deferUntilFloatingLayerCloses(() => setEditingEvent(event));
  }, []);

  // Opens the edit dialog for a not-yet-persisted event. Deferred so the
  // dropdown finishes closing (and clears its body `pointer-events: none`)
  // before the dialog mounts — same trick as handleEventEdit.
  const openNewEventDialog = (draft: Omit<CalEvent, "id">) => {
    deferUntilFloatingLayerCloses(() => setEditingEvent({ id: NEW_EVENT_ID, ...draft }));
  };

  const openPresetEditor = (preset: EventPreset, date: string, start: string) => {
    openNewEventDialog({
      date,
      start,
      end: formatMinutes(toMinutes(start) + preset.duration),
      title: preset.title,
      instructor: instructorOptions[0] ?? "Nicht zugeteilt",
      vehicle: vehicleOptions.find((option) => option !== "Nicht zugeteilt"),
      type: preset.type,
    });
  };

  const handleEventCreate = () => {
    setMobileInspectorOpen(false);
    const start = nextEditableStartTime();
    openNewEventDialog({
      date: toISODate(selected ?? TODAY),
      start,
      end: formatMinutes(toMinutes(start) + 45),
      title: "Fahrstunde",
      instructor: instructorOptions[0] ?? "Nicht zugeteilt",
      vehicle: vehicleOptions.find((option) => option !== "Nicht zugeteilt"),
      type: "Praktisch",
    });
  };

  // A preset item supports both gestures: a plain click opens the dialog at
  // the next quarter-hour, while dragging carries the preset onto the grid
  // as a ghost block — on drop, the dialog opens with date/start/end already
  // set from the drop position.
  const handlePresetPointerDown = (
    preset: EventPreset,
    pointerEvent: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (pointerEvent.button !== 0) return;
    pointerEvent.preventDefault();
    const origin = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    let moved = false;
    let placement: { day: number; startMinutes: number } | null = null;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      if (!moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) {
        return;
      }
      if (!moved) {
        moved = true;
        // Close the menu as soon as a real drag starts; from here the
        // ghost block is the drag feedback.
        setCreateMenuOpen(false);
      }

      const grid = dayGridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const insideGrid =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!insideGrid) {
        placement = null;
        setPresetDrag({ preset, day: null, startMinutes: null });
        return;
      }

      const dayWidth = rect.width / DAY_COUNT;
      const day = clamp(
        Math.floor((event.clientX - rect.left) / dayWidth),
        0,
        DAY_COUNT - 1,
      );
      const rawStartMinutes =
        ((event.clientY - rect.top) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
      const startMinutes = clamp(
        snapMinutes(rawStartMinutes),
        START_HOUR * 60,
        END_HOUR * 60 - preset.duration,
      );
      placement = { day, startMinutes };
      setPresetDrag({ preset, day, startMinutes });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      setPresetDrag(null);
    };
    const finishDrag = () => {
      cleanup();
      if (!moved) {
        setCreateMenuOpen(false);
        openPresetEditor(preset, toISODate(selected ?? TODAY), nextEditableStartTime());
        return;
      }
      if (placement) {
        openPresetEditor(
          preset,
          toISODate(addDays(weekStart, placement.day)),
          formatMinutes(placement.startMinutes),
        );
      }
    };
    const cancelDrag = () => cleanup();

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", cancelDrag, { once: true });
  };

  /* Rejections propagate to the dialog, which shows the message and —
     for overlaps / absences — offers "Trotzdem speichern". */
  const handleEventSave = async (
    id: string,
    updates: CalEvent,
    options: EventSaveOptions,
  ) => {
    // The dialog resolves the student name to an id (or undefined). Send
    // an explicit null when unresolved: JSON drops undefined keys and the
    // server keeps the stored value when the key is absent — which would
    // silently keep a stale link after the name was cleared or changed.
    // Same for lessonKind.
    const { id: _id, ...rest } = updates;
    const payload = {
      ...rest,
      studentId: updates.studentId ?? null,
      lessonKind: updates.lessonKind ?? null,
      allowConflicts: options.allowConflicts === true,
    };

    if (id === NEW_EVENT_ID) {
      if (options.repeat) {
        const series = await createCalendarEventSeries({
          ...payload,
          repeat: options.repeat,
        });
        setCalendarEvents((current) => [...current, ...series.events]);
        setSelectedEventId(series.events[0]?.id ?? null);
        toast.success(`${series.events.length} Serientermine angelegt.`);
        showWarnings(series.warnings);
      } else {
        const created = await createCalendarEvent(payload);
        setCalendarEvents((current) => [...current, created]);
        setSelectedEventId(created.id);
        showWarnings(created.warnings);
      }
      void refreshEvents();
      void refetchConflicts();
      return;
    }

    const saved = await updateCalendarEvent(Number(id), payload);
    setCalendarEvents((current) =>
      current.map((event) => (event.id === id ? saved : event)),
    );
    showWarnings(saved.warnings);
    void refreshEvents();
    void refetchConflicts();
  };

  const replaceEvent = useCallback((updated: CalEvent) => {
    setCalendarEvents((current) =>
      current.map((event) => (event.id === updated.id ? updated : event)),
    );
  }, []);

  const handleEventCancel = useCallback((event: CalEvent) => {
    deferUntilFloatingLayerCloses(() => setCancelTarget(event));
  }, []);

  const handleEventUncancel = useCallback(
    async (event: CalEvent) => {
      let restored: CalEvent;
      try {
        restored = await uncancelCalendarEvent(event.id);
      } catch (error) {
        const message = errorMessage(error, "Absage konnte nicht zurückgenommen werden.");
        if (
          !isOverridableConflict(message) ||
          !window.confirm(`${message}\n\nAbsage trotzdem zurücknehmen?`)
        ) {
          toast.error(message);
          return;
        }
        try {
          restored = await uncancelCalendarEvent(event.id, true);
        } catch (retryError) {
          toast.error(
            errorMessage(retryError, "Absage konnte nicht zurückgenommen werden."),
          );
          return;
        }
      }
      replaceEvent(restored);
      toast.success("Absage zurückgenommen.");
      void refreshEvents();
      void refetchConflicts();
    },
    [refetchConflicts, refreshEvents, replaceEvent],
  );

  const handleDeleteFollowing = useCallback(
    async (event: CalEvent) => {
      if (!event.seriesId) return;
      const confirmed = window.confirm(
        `Diesen und alle folgenden Termine der Serie ab ${formatGermanDate(event.date)} löschen?`,
      );
      if (!confirmed) return;
      try {
        const result = await deleteCalendarEventSeries(event.seriesId, event.date);
        toast.success(
          result.skipped > 0
            ? `${result.deleted} Termine gelöscht, ${result.skipped} übersprungen (abgerechnet, Nachweis oder Ausfallgebühr).`
            : `${result.deleted} Termine gelöscht.`,
        );
        setSelectedEventId(null);
        setMobileInspectorOpen(false);
      } catch (error) {
        toast.error(errorMessage(error, "Serie konnte nicht gelöscht werden."));
      }
      void refreshEvents();
      void refetchConflicts();
    },
    [refetchConflicts, refreshEvents],
  );

  // Absent instructors per visible day (inclusive ranges).
  const absencesByDay = useMemo(() => {
    const byDay = new Map<string, Absence[]>();
    for (let i = 0; i < DAY_COUNT; i++) {
      const iso = toISODate(addDays(weekStart, i));
      const list = weekAbsences.filter(
        (absence) => absence.fromDate <= iso && absence.toDate >= iso,
      );
      if (list.length) byDay.set(iso, list);
    }
    return byDay;
  }, [weekAbsences, weekStart]);

  const conflictCount = weekConflicts?.count ?? 0;

  const isCurrentWeek = isSameDay(weekStart, startOfWeek(TODAY));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekNumber = getISOWeek(weekStart);
  const monthYearLabel = anchor.toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
  const rangeLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${weekStart.getDate()}.–${weekEnd.getDate()}. ${monthLong(weekEnd)}`
      : `${weekStart.getDate()}. ${monthShort(weekStart)} – ${weekEnd.getDate()}. ${monthShort(weekEnd)}`;

  const goToToday = () => {
    setAnchor(TODAY);
    setSelected(TODAY);
    setSelectedEventId(null);
    setMobileInspectorOpen(false);
  };

  const moveWeek = (amount: number) => {
    const next = addDays(weekStart, amount);
    setAnchor(next);
    setSelected(next);
    setSelectedEventId(null);
    setMobileInspectorOpen(false);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            {conflictCount > 0 && weekConflicts && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-amber-600 dark:text-amber-400"
                    aria-label={`${conflictCount} Terminkonflikte in dieser Woche`}
                  >
                    <AlertTriangle />
                    <span className="tabular-nums">{conflictCount}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Konflikte in dieser Woche
                  </div>
                  <ul className="max-h-72 divide-y overflow-y-auto text-xs">
                    {weekConflicts.overlaps.map((overlap) => (
                      <li
                        key={`${overlap.resource}-${overlap.first.id}-${overlap.second.id}`}
                      >
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
                          onClick={() => handleEventSelect(overlap.first)}
                        >
                          <span className="font-medium">
                            Überschneidung · {overlap.label}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatGermanDate(overlap.first.date)} · „
                            {overlap.first.title}“ {overlap.first.start}–
                            {overlap.first.end} / „{overlap.second.title}“{" "}
                            {overlap.second.start}–{overlap.second.end}
                          </span>
                        </button>
                      </li>
                    ))}
                    {weekConflicts.absences.map(({ event, absence }) => (
                      <li key={`absence-${event.id}`}>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
                          onClick={() => handleEventSelect(event)}
                        >
                          <span className="font-medium">
                            {absence.instructor} abwesend ({absence.kind})
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatGermanDate(event.date)} · „{event.title}“ {event.start}
                            –{event.end}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Vorherige Woche"
                onClick={() => moveWeek(-7)}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Nächste Woche"
                onClick={() => moveWeek(7)}
              >
                <ChevronRight />
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={goToToday}>
              Heute
            </Button>
            <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" aria-label="Termin erstellen">
                  <Plus data-icon="inline-start" />
                  <span className="hidden sm:inline">Termin</span>
                  <ChevronDown className="hidden sm:block" data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Klicken oder in den Kalender ziehen
                </DropdownMenuLabel>
                {eventPresets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    className="cursor-grab gap-2.5 active:cursor-grabbing"
                    onPointerDown={(pointerEvent) =>
                      handlePresetPointerDown(preset, pointerEvent)
                    }
                  >
                    <span className="size-2 shrink-0 rounded-full bg-primary" />
                    <span className="flex-1 truncate">{preset.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {preset.duration} Min.
                    </span>
                    <GripVertical className="size-3.5 text-muted-foreground/60" />
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleEventCreate}>
                  <Plus className="size-3.5 text-muted-foreground" />
                  Eigenen Termin erstellen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden xl:inline-flex"
              aria-label={
                inspectorOpen ? "Detailleiste ausblenden" : "Detailleiste einblenden"
              }
              aria-pressed={inspectorOpen}
              title={
                inspectorOpen ? "Detailleiste ausblenden" : "Detailleiste einblenden"
              }
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <PanelRight />
            </Button>
          </>
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] capitalize tabular-nums">
            {monthYearLabel}
          </h1>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            KW {weekNumber}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums lg:inline">
            {rangeLabel}
          </span>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 gap-[3px] overflow-hidden bg-sidebar">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background">
          <div
            ref={gridRef}
            className="subtle-scrollbar min-h-0 flex-1 overflow-auto"
            onWheel={handleCalendarWheel}
            style={{ scrollbarGutter: "stable" }}
          >
            <div className="sticky top-0 z-40 min-w-[740px] bg-background">
              <div className="flex h-9 border-b border-border/70">
                <div aria-hidden className="w-16 shrink-0" />
                <div className="grid flex-1 grid-cols-7">
                  {days.map((day) => {
                    const today = isSameDay(day, TODAY);
                    const daySelected = selected ? isSameDay(day, selected) : false;
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        className={cn(
                          "flex min-w-0 items-center justify-center gap-1.5 px-1 text-xs font-medium outline-hidden transition-colors duration-150 hover:bg-muted hover:duration-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          daySelected && "text-foreground",
                        )}
                        aria-label={day.toLocaleDateString("de-DE", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                        aria-pressed={daySelected}
                        onClick={() => setSelected(day)}
                      >
                        <span className="truncate text-muted-foreground">
                          {day
                            .toLocaleDateString("de-DE", { weekday: "long" })
                            .slice(0, 3)
                            .toUpperCase()}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            (daySelected || today) && "text-destructive",
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex h-8 border-b border-border/70 bg-muted/[0.18]">
                <div className="flex w-16 shrink-0 items-center justify-end pr-2.5 text-[10px] text-muted-foreground">
                  Ganztägig
                </div>
                <div className="grid flex-1 grid-cols-7">
                  {days.map((day) => {
                    const absent = absencesByDay.get(toISODate(day)) ?? [];
                    const label = absent
                      .map((absence) => `${absence.instructor} (${absence.kind})`)
                      .join(", ");
                    return (
                      <div
                        key={day.toISOString()}
                        className="flex min-w-0 items-center border-l border-border/60 px-1.5"
                      >
                        {absent.length > 0 && (
                          <span
                            className="truncate text-[10px] text-muted-foreground"
                            title={`Abwesend: ${label}`}
                          >
                            Abwesend: {label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex min-w-[740px]">
              <div className="relative w-16 shrink-0" style={{ height: GRID_HEIGHT }}>
                {HOUR_MARKS.map((hour) => {
                  if (
                    isCurrentWeek &&
                    hour === now.getHours() &&
                    now.getMinutes() < SNAP_MINUTES
                  ) {
                    return null;
                  }

                  return (
                    <span
                      key={hour}
                      className="absolute right-2.5 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                      style={{
                        top:
                          hour === START_HOUR
                            ? 14
                            : hour === END_HOUR
                              ? GRID_HEIGHT - 1
                              : topForMinutes(hour * 60),
                      }}
                    >
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  );
                })}
                {isCurrentWeek && (
                  <span
                    className="absolute right-1.5 z-20 -translate-y-1/2 bg-background px-1 text-[10px] font-medium text-red-500 tabular-nums"
                    style={{ top: topForMinutes(nowMinutes) }}
                  >
                    {formatMinutes(nowMinutes)}
                  </span>
                )}
              </div>

              <div
                ref={dayGridRef}
                className="relative grid flex-1 grid-cols-7"
                style={{ height: GRID_HEIGHT }}
              >
                {isCurrentWeek && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-30 flex items-center"
                    style={{ top: topForMinutes(nowMinutes) }}
                  >
                    <span className="size-1.5 -translate-x-0.5 rounded-full bg-red-500" />
                    <span className="-ml-0.5 grid flex-1 grid-cols-7">
                      {days.map((day) => (
                        <span
                          key={day.toISOString()}
                          className={cn(
                            "h-0.5 bg-red-500",
                            !isSameDay(day, TODAY) && "bg-red-500/30",
                          )}
                        />
                      ))}
                    </span>
                  </div>
                )}

                {presetDrag &&
                  presetDrag.day !== null &&
                  presetDrag.startMinutes !== null && (
                    <div
                      className="pointer-events-none absolute z-40 overflow-hidden rounded-md border border-dashed border-primary/50 bg-primary/[0.08]"
                      style={{
                        top: topForMinutes(presetDrag.startMinutes),
                        left: `calc(${(presetDrag.day * 100) / DAY_COUNT}% + 3px)`,
                        width: `calc(${100 / DAY_COUNT}% - 6px)`,
                        height: Math.max(
                          (presetDrag.preset.duration / 60) * HOUR_HEIGHT - 2,
                          38,
                        ),
                      }}
                    >
                      <div className="flex h-full flex-col justify-center gap-0.5 px-2 py-1">
                        <span className="truncate text-xs font-medium">
                          {presetDrag.preset.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatMinutes(presetDrag.startMinutes)}–
                          {formatMinutes(
                            presetDrag.startMinutes + presetDrag.preset.duration,
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                {days.map((day) => {
                  const iso = toISODate(day);
                  return (
                    <DayColumn
                      key={iso}
                      iso={iso}
                      isToday={isSameDay(day, TODAY)}
                      events={eventsByDay.get(iso) ?? NO_EVENTS}
                      draggingId={dragResultRef.current ? (dragging?.id ?? null) : null}
                      selectedEventId={selectedEventId}
                      onDragStart={handleEventDragStart}
                      onResizeStart={handleEventResizeStart}
                      onSelect={handleEventSelect}
                      onEdit={handleEventEdit}
                      onDelete={handleEventDelete}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </main>

        <section
          className={cn(
            "hidden shrink-0 overflow-hidden rounded-t-sm rounded-b-lg bg-background transition-[width,border-width] duration-300 ease-drawer motion-reduce:transition-none xl:block",
            inspectorOpen ? "w-64 border border-border/70 2xl:w-72" : "w-0 border-0",
          )}
        >
          <div className="h-full w-64 2xl:w-72">
            <CalendarEventInspector
              event={selectedEvent}
              onEdit={handleEventEdit}
              onDelete={handleEventDelete}
              onCreate={handleEventCreate}
              onCancelEvent={handleEventCancel}
              onUncancelEvent={handleEventUncancel}
              onDeleteFollowing={handleDeleteFollowing}
              onClear={() => {
                setSelectedEventId(null);
                setInspectorOpen(false);
              }}
            />
          </div>
        </section>
      </div>

      <Sheet
        open={
          mobileInspectorOpen &&
          selectedEvent !== null &&
          editingEvent === null &&
          cancelTarget === null
        }
        onOpenChange={setMobileInspectorOpen}
      >
        <SheetContent className="gap-0 p-0 xl:hidden" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Termindetails</SheetTitle>
            <SheetDescription>Details zum ausgewählten Termin</SheetDescription>
          </SheetHeader>
          <CalendarEventInspector
            event={selectedEvent}
            onEdit={handleEventEdit}
            onDelete={handleEventDelete}
            onCreate={handleEventCreate}
            onCancelEvent={handleEventCancel}
            onUncancelEvent={handleEventUncancel}
            onDeleteFollowing={handleDeleteFollowing}
            onClear={() => {
              setMobileInspectorOpen(false);
              setSelectedEventId(null);
            }}
          />
        </SheetContent>
      </Sheet>

      <EventEditDialog
        event={editingEvent}
        open={editingEvent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null);
        }}
        onSave={handleEventSave}
        instructorOptions={instructorOptions}
        studentOptions={studentOptions}
        studentIdByName={studentIdByName}
        vehicleOptions={vehicleOptions}
        allowRepeat={editingEvent?.id === NEW_EVENT_ID}
      />

      <CancelEventDialog
        event={cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onCancelled={(updated) => {
          replaceEvent(updated);
          void refreshEvents();
          void refetchConflicts();
        }}
      />
    </div>
  );
}

export default Kalendar;
