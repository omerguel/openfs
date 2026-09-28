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
  ListFilter,
  MoonStar,
  PanelRight,
  Plus,
  Printer,
  Search,
} from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import { CalendarEventCard } from "./components/CalendarEventCard.tsx";
import { CalendarEventInspector } from "./components/CalendarEventInspector.tsx";
import { CancelEventDialog } from "./components/CancelEventDialog.tsx";
import { EventEditDialog, type EventSaveOptions } from "./components/EventEditDialog.tsx";
import { NachweisDialog } from "./components/NachweisDialog.tsx";
import { DayPlanPrint, type DayPlan } from "./components/calendar/DayPlanPrint.tsx";
import {
  AttendanceDialog,
  type AttendancePrefill,
} from "./components/theorie/AttendanceDialog.tsx";
import { type Absence, useAbsences } from "@/hooks/use-absences";
import { useAuthStatus } from "@/hooks/use-auth";
import { instructorName, useInstructors } from "@/hooks/use-instructors";
import { useStudents } from "@/hooks/use-students";
import { useTheoryGroups } from "@/hooks/use-theory-groups";
import { useVehicles } from "@/hooks/use-vehicles";
import {
  addDays,
  type CalEvent,
  type EventPreset,
  eventPresets,
  groupEventsByDay,
  isSameDay,
  layoutDay,
  nonFahrstundeTypes,
  parseISODate,
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
  updateCalendarEventSeriesFrom,
  useCalendarConflicts,
  useCalendarEvents,
} from "@/hooks/use-calendar-events";
import {
  eventMatchesSearch,
  instructorColorIndex,
  monthRangeLabel,
  weekdayShort,
} from "@/lib/scheduling";
import { theoryLessonFromTitle } from "@/lib/theory-lessons";
import { UNASSIGNED_VEHICLE } from "@/lib/vehicle-options";
import { formatGermanDate } from "@/lib/working-time";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

import { confirmDialog } from "@/components/confirm";
import { queryClient } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Time grid configuration                                            */
/* ------------------------------------------------------------------ */

/* Working hours shown by default; "Nachtstunden" extends to 0–24.
   The range also grows on its own when a Termin lies outside it. */
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
/* The grid opens scrolled to this hour. */
const SCROLL_TO_HOUR = 7;
const HOUR_HEIGHT = 76; // px per hour
const SNAP_MINUTES = 15;
const MIN_CARD_HEIGHT = 22;

type ViewMode = "woche" | "tag";

type Grid = { startHour: number; endHour: number };

const NEW_EVENT_ID = "__new_calendar_event__";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const snapMinutes = (minutes: number) =>
  Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

const formatMinutes = (minutes: number) => {
  const clamped = clamp(minutes, 0, 24 * 60);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

/* A new Termin starts at the next quarter-hour today (within working
   hours), otherwise at 09:00 — never silently in the past. */
const defaultStartTime = (date: Date) => {
  const now = new Date();
  if (!isSameDay(date, now)) return "09:00";
  const minutes =
    Math.ceil((now.getHours() * 60 + now.getMinutes()) / SNAP_MINUTES) * SNAP_MINUTES;
  return formatMinutes(clamp(minutes, 7 * 60, 23 * 60 - 45));
};

/* Non-blocking server hints (e.g. daily limit exceeded) after a write. */
const showWarnings = (warnings?: string[]) => {
  for (const warning of warnings ?? []) toast.warning(warning);
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const slotLabel = (event: Pick<CalEvent, "date" | "start" | "end">) =>
  `${parseISODate(event.date).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  })}, ${event.start}–${event.end}`;

const topForMinutes = (minutes: number, grid: Grid) =>
  ((minutes - grid.startHour * 60) / 60) * HOUR_HEIGHT;

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

const getISOWeek = (date: Date) => {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
};

const colorVar = (index: number | null) =>
  index === null ? "var(--muted-foreground)" : `var(--instructor-${index + 1})`;

/* ------------------------------------------------------------------ */
/* Drag / resize                                                      */
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
      mode: "resize-end";
      /* Minutes between the pointer and the grabbed edge at drag start. */
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
  days: Date[],
  grid: Grid,
): { date: string; start: string; end: string } {
  const minMinutes = grid.startHour * 60;
  const maxMinutes = grid.endHour * 60;
  const rawPointerMinutes = ((clientY - rect.top) / HOUR_HEIGHT) * 60 + minMinutes;

  if (dragging.mode === "move") {
    const dayWidth = rect.width / days.length;
    const day = clamp(Math.floor((clientX - rect.left) / dayWidth), 0, days.length - 1);
    const rawStartMinutes =
      ((clientY - rect.top - dragging.pointerOffsetY) / HOUR_HEIGHT) * 60 + minMinutes;
    const startMinutes = clamp(
      Math.round(rawStartMinutes),
      minMinutes,
      maxMinutes - dragging.duration,
    );
    return {
      date: toISODate(days[day]!),
      start: formatMinutes(startMinutes),
      end: formatMinutes(startMinutes + dragging.duration),
    };
  }

  const startMinutes = toMinutes(dragging.start);
  const nextEndMinutes = clamp(
    Math.round(rawPointerMinutes - dragging.grabOffsetMinutes),
    startMinutes + SNAP_MINUTES,
    maxMinutes,
  );
  return {
    date: dragging.date,
    start: dragging.start,
    end: formatMinutes(nextEndMinutes),
  };
}

/* Stable empty array so eventsByDay.get(iso) ?? NO_EVENTS never produces
   a new array identity on days that have no events — DayColumn's memo
   compares by reference and would otherwise always rerender empty columns. */
const NO_EVENTS: CalEvent[] = [];

/* ------------------------------------------------------------------ */
/* Day column                                                         */
/*                                                                    */
/* Memo'd so that during a drag only the column(s) containing the     */
/* dragged event rerender. Overlapping Termine sit side by side.      */
/* ------------------------------------------------------------------ */

const DayColumn = memo(
  function DayColumn({
    isToday,
    events,
    grid,
    draggingId,
    selectedEventId,
    conflictIds,
    colorFor,
    onDragStart,
    onResizeStart,
    onSelect,
    onEdit,
    onDelete,
  }: {
    iso: string;
    isToday: boolean;
    events: CalEvent[];
    grid: Grid;
    draggingId: string | null;
    selectedEventId: string | null;
    conflictIds: Set<string>;
    colorFor: (event: CalEvent) => string;
    onDragStart: (
      event: CalEvent,
      pointerEvent: ReactPointerEvent<HTMLButtonElement>,
    ) => void;
    onResizeStart: (
      event: CalEvent,
      pointerEvent: ReactPointerEvent<HTMLElement>,
    ) => void;
    onSelect: (event: CalEvent) => void;
    onEdit: (event: CalEvent) => void;
    onDelete: (event: CalEvent) => void;
  }) {
    const placed = useMemo(() => layoutDay(events).placed, [events]);
    const hours = grid.endHour - grid.startHour;
    return (
      <div
        className={cn(
          "relative h-full border-l border-border/60",
          isToday && "bg-primary/[0.025]",
        )}
      >
        {Array.from({ length: hours }, (_, index) => (
          <div
            key={grid.startHour + index}
            className="border-b border-border/55"
            style={{ height: HOUR_HEIGHT }}
          />
        ))}

        {placed.map(({ event, column, columns }) => {
          const start = toMinutes(event.start);
          const end = toMinutes(event.end);
          const height = Math.max(
            ((end - start) / 60) * HOUR_HEIGHT - 2,
            MIN_CARD_HEIGHT,
          );
          return (
            <CalendarEventCard
              key={event.id}
              event={event}
              compact={height < 36}
              dense={height < 58}
              isDragging={draggingId === event.id}
              isSelected={selectedEventId === event.id}
              hasConflict={conflictIds.has(event.id)}
              onPointerDown={(pointerEvent) => {
                if (pointerEvent.button !== 0) return;
                pointerEvent.preventDefault();
                pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
                onDragStart(event, pointerEvent);
              }}
              onResizeStart={(pointerEvent) => onResizeStart(event, pointerEvent)}
              onSelect={() => onSelect(event)}
              onEdit={() => onEdit(event)}
              onDelete={() => onDelete(event)}
              style={
                {
                  top: topForMinutes(start, grid),
                  left: `calc(${(column / columns) * 100}% + 2px)`,
                  width: `calc(${100 / columns}% - 4px)`,
                  "--card-h": `${height}px`,
                  "--ev": colorFor(event),
                } as CSSProperties
              }
            />
          );
        })}
      </div>
    );
  },
  (prev, next) =>
    prev.iso === next.iso &&
    prev.isToday === next.isToday &&
    prev.grid.startHour === next.grid.startHour &&
    prev.grid.endHour === next.grid.endHour &&
    prev.draggingId === next.draggingId &&
    prev.selectedEventId === next.selectedEventId &&
    prev.conflictIds === next.conflictIds &&
    prev.colorFor === next.colorFor &&
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
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
      ? "tag"
      : "woche",
  );
  const [anchor, setAnchor] = useState<Date>(TODAY);
  const [selected, setSelected] = useState<Date>(TODAY);
  const [now, setNow] = useState(() => new Date());
  const [showNight, setShowNight] = useState(false);
  const [instructorFilter, setInstructorFilter] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  // The DB is the system of record; local state mirrors it for the
  // synchronous drag/resize updates and is reconciled on failure.
  const { events: storedEvents, refresh: refreshEvents } = useCalendarEvents();
  const [calendarEvents, setCalendarEvents] = useState<CalEvent[]>([]);
  useEffect(() => {
    setCalendarEvents(storedEvents);
  }, [storedEvents]);
  /** Puts a card at a date/time locally (failed drag, undo). */
  const placeEvent = useCallback(
    (id: string, slot: { date: string; start: string; end: string }) => {
      setCalendarEvents((current) =>
        current.map((event) =>
          event.id === id
            ? { ...event, date: slot.date, start: slot.start, end: slot.end }
            : event,
        ),
      );
    },
    [],
  );
  // dragResultRef holds the exact final position computed synchronously on
  // every pointermove. Drag-end reads it instead of calendarEvents state, so
  // the persisted value is never behind by one React commit cycle.
  const dragResultRef = useRef<{ date: string; start: string; end: string } | null>(null);
  const { instructors, names: instructorOptions } = useInstructors();
  const { students } = useStudents();
  const { vehicles } = useVehicles();
  const { groups: theoryGroups } = useTheoryGroups();
  const { vehicleOptions } = useVehicleOptions();
  const { data: auth } = useAuthStatus();
  const role = auth?.user?.role;
  const ownInstructor = useMemo(() => {
    const id = auth?.user?.instructorId;
    const record = instructors.find((instructor) => instructor.id === id);
    return record ? instructorName(record) : null;
  }, [auth?.user?.instructorId, instructors]);

  // A Fahrlehrer/in starts with their own Termine only (filter is visible
  // and can be cleared).
  const appliedOwnFilter = useRef(false);
  useEffect(() => {
    if (appliedOwnFilter.current || role !== "fahrlehrer" || !ownInstructor) return;
    appliedOwnFilter.current = true;
    setInstructorFilter(new Set([ownInstructor]));
  }, [role, ownInstructor]);

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
  // student's id so saved events carry a reliable FK. Duplicate display
  // names keep the FIRST match.
  const studentIdByName = useMemo(() => {
    const byName = new Map<string, number>();
    for (const student of students) {
      const name = `${student.firstName} ${student.lastName}`.trim();
      if (name && !byName.has(name)) byName.set(name, student.id);
    }
    return byName;
  }, [students]);
  const phoneByStudentId = useMemo(
    () => new Map(students.map((student) => [student.id, student.phone])),
    [students],
  );

  const [types] = useState<Set<string>>(() => new Set(initialTypeFilter ?? []));
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CalEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalEvent | null>(null);
  const [attestTarget, setAttestTarget] = useState<CalEvent | null>(null);
  const [attendance, setAttendance] = useState<AttendancePrefill | null>(null);
  const [dayPlan, setDayPlan] = useState<DayPlan | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // Live placement while a preset from the "Termin" menu is dragged over
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

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(
    () =>
      view === "tag"
        ? [new Date(selected.getFullYear(), selected.getMonth(), selected.getDate())]
        : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [view, selected, weekStart],
  );
  const dayCount = days.length;
  const rangeFrom = toISODate(days[0]!);
  const rangeTo = toISODate(days[dayCount - 1]!);

  // Existing overlaps / Termine on absence days in the visible range, and
  // the absences themselves for the "Ganztägig" row.
  const { data: rangeConflicts, refetch: refetchConflicts } = useCalendarConflicts(
    rangeFrom,
    rangeTo,
  );
  const { data: rangeAbsences = [] } = useAbsences({ from: rangeFrom, to: rangeTo });

  /* ---------------------------------------------------------------- */
  /* Filtering                                                        */
  /* ---------------------------------------------------------------- */

  const visibleEvents = useMemo(
    () =>
      calendarEvents.filter(
        (event) =>
          (!types.size || types.has(event.type)) &&
          (!instructorFilter.size || instructorFilter.has(event.instructor)) &&
          eventMatchesSearch(event, search),
      ),
    [calendarEvents, types, instructorFilter, search],
  );

  // One pass over visible events instead of one filter per day column.
  const eventsByDay = useMemo(() => groupEventsByDay(visibleEvents), [visibleEvents]);

  // Working hours, extended when a visible Termin lies outside them.
  const grid = useMemo<Grid>(() => {
    if (showNight) return { startHour: 0, endHour: 24 };
    let startHour = DAY_START_HOUR;
    let endHour = DAY_END_HOUR;
    for (const day of days) {
      for (const event of eventsByDay.get(toISODate(day)) ?? []) {
        startHour = Math.min(startHour, Math.floor(toMinutes(event.start) / 60));
        endHour = Math.max(endHour, Math.ceil(toMinutes(event.end) / 60));
      }
    }
    return { startHour, endHour };
  }, [showNight, days, eventsByDay]);
  const gridHeight = (grid.endHour - grid.startHour) * HOUR_HEIGHT;

  const roster = instructorOptions;
  const colorFor = useCallback(
    (event: CalEvent) => colorVar(instructorColorIndex(event.instructor, roster)),
    [roster],
  );

  const { conflictIds, conflictMessages } = useMemo(() => {
    const ids = new Set<string>();
    const messages = new Map<string, string[]>();
    const add = (id: string, message: string) => {
      ids.add(id);
      messages.set(id, [...(messages.get(id) ?? []), message]);
    };
    for (const overlap of rangeConflicts?.overlaps ?? []) {
      const resource =
        overlap.resource === "vehicle"
          ? `Fahrzeug ${overlap.label} doppelt belegt`
          : `${overlap.label} doppelt gebucht`;
      const describe = (event: CalEvent) =>
        `${event.subtitle || event.title} ${event.start}–${event.end}`;
      add(overlap.first.id, `${resource}: ${describe(overlap.second)}`);
      add(overlap.second.id, `${resource}: ${describe(overlap.first)}`);
    }
    for (const { event, absence } of rangeConflicts?.absences ?? []) {
      add(event.id, `${absence.instructor} ist abwesend (${absence.kind}).`);
    }
    return { conflictIds: ids, conflictMessages: messages };
  }, [rangeConflicts]);

  /* ---------------------------------------------------------------- */
  /* Scrolling                                                        */
  /* ---------------------------------------------------------------- */

  // Open at the start of the working day (07:00) with today's column in
  // view when the week overflows horizontally (phones).
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const gridEl = gridRef.current;
    const dayGrid = dayGridRef.current;
    if (!gridEl || !dayGrid || initialScrollDone.current) return;
    initialScrollDone.current = true;
    // The sticky day header covers exactly the space above the hour grid,
    // so scrolling by the hour's offset puts it right below the header.
    gridEl.scrollTop = Math.max(topForMinutes(SCROLL_TO_HOUR * 60, grid) - 8, 0);
    if (view === "woche") {
      const dayIndex = (TODAY.getDay() + 6) % 7;
      const gutterWidth =
        dayGrid.getBoundingClientRect().left - gridEl.getBoundingClientRect().left;
      const dayWidth = dayGrid.getBoundingClientRect().width / 7;
      if (gutterWidth + (dayIndex + 1) * dayWidth > gridEl.clientWidth) {
        gridEl.scrollLeft = Math.min(
          dayIndex * dayWidth,
          gridEl.scrollWidth - gridEl.clientWidth,
        );
      }
    }
  }, [grid, view]);

  // Bring a freshly created / edited / moved Termin into view.
  useEffect(() => {
    if (!pendingScrollId) return;
    const frame = requestAnimationFrame(() => {
      const card = gridRef.current?.querySelector<HTMLElement>(
        `[data-event-id="${pendingScrollId}"]`,
      );
      if (card) {
        card.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        setPendingScrollId(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  // Give up on a Termin that never shows up (e.g. hidden by a filter).
  useEffect(() => {
    if (!pendingScrollId) return;
    const timer = window.setTimeout(() => setPendingScrollId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [pendingScrollId]);

  const revealEvent = useCallback(
    (event: CalEvent) => {
      const date = parseISODate(event.date);
      if (!days.some((day) => isSameDay(day, date))) {
        setAnchor(date);
        setSelected(date);
      }
      setSelectedEventId(event.id);
      setPendingScrollId(event.id);
    },
    [days],
  );

  /* ---------------------------------------------------------------- */
  /* Drag & resize                                                    */
  /* ---------------------------------------------------------------- */

  // The drag effect reads geometry through refs: the grid range is derived
  // from the (moving) events, and re-running the effect mid-drag would
  // drop the drag result.
  const geometryRef = useRef({ days, grid });
  geometryRef.current = { days, grid };

  useEffect(() => {
    if (!dragging) return;
    dragResultRef.current = null;
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

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      if (
        dragResultRef.current === null &&
        Math.hypot(
          event.clientX - dragging.pointerStartX,
          event.clientY - dragging.pointerStartY,
        ) < 4
      ) {
        return;
      }
      const dayGrid = dayGridRef.current;
      if (!dayGrid) return;
      const { days: currentDays, grid: currentGrid } = geometryRef.current;
      dragResultRef.current = computeDragPosition(
        dragging,
        event.clientX,
        event.clientY,
        dayGrid.getBoundingClientRect(),
        currentDays,
        currentGrid,
      );
      if (rafId === null) rafId = requestAnimationFrame(applyPendingDragResult);
    };

    const stopDragging = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const { grid } = geometryRef.current;
      const preview = dragResultRef.current;
      // Snap to a quarter-hour only on release so dragging feels fluid.
      if (preview && dragging.mode === "move") {
        const startMinutes = clamp(
          snapMinutes(toMinutes(preview.start)),
          grid.startHour * 60,
          grid.endHour * 60 - dragging.duration,
        );
        dragResultRef.current = {
          ...preview,
          start: formatMinutes(startMinutes),
          end: formatMinutes(startMinutes + dragging.duration),
        };
      } else if (preview && dragging.mode === "resize-end") {
        dragResultRef.current = {
          ...preview,
          end: formatMinutes(
            clamp(
              snapMinutes(toMinutes(preview.end)),
              toMinutes(dragging.start) + SNAP_MINUTES,
              grid.endHour * 60,
            ),
          ),
        };
      }

      applyPendingDragResult();
      const result = dragResultRef.current;
      const unchanged =
        result &&
        result.date === dragging.date &&
        result.start === dragging.start &&
        result.end === dragging.end;
      // null = plain click (no PATCH); unchanged = dropped where it was.
      if (result && !unchanged) {
        const previous = {
          date: dragging.date,
          start: dragging.start,
          end: dragging.end,
        };
        const id = dragging.id;
        const verb = dragging.mode === "move" ? "verschoben" : "geändert";
        // The server rejects overlaps / absent instructors — show why and
        // snap the card back to its stored position.
        void updateCalendarEvent(Number(id), result)
          .then((saved) => {
            toast.success(`Termin ${verb}: ${slotLabel(saved)}`, {
              action: {
                label: "Rückgängig",
                onClick: () => {
                  void updateCalendarEvent(Number(id), {
                    ...previous,
                    allowConflicts: true,
                  })
                    .then((restored) => {
                      // The refetch returns what the cache already holds,
                      // so local state must be moved back explicitly.
                      placeEvent(id, restored);
                      toast.success("Änderung rückgängig gemacht.");
                    })
                    .catch((error: unknown) =>
                      toast.error(errorMessage(error, "Rückgängig fehlgeschlagen.")),
                    )
                    .finally(() => {
                      void refreshEvents();
                      void refetchConflicts();
                    });
                },
              },
            });
            showWarnings(saved.warnings);
            void refetchConflicts();
          })
          .catch((error: unknown) => {
            toast.error(errorMessage(error, "Termin konnte nicht gespeichert werden."));
            placeEvent(id, previous);
            void refreshEvents();
          });
      }
      setDragging(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", stopDragging, { once: true });
    window.addEventListener("pointercancel", stopDragging, { once: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, refreshEvents, refetchConflicts, placeEvent]);

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
      if (event.cancelledAt) return;
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
    (event: CalEvent, pointerEvent: ReactPointerEvent<HTMLElement>) => {
      if (pointerEvent.button !== 0) return;
      pointerEvent.preventDefault();
      pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
      const edgeMinutes = toMinutes(event.end);
      const dayGrid = dayGridRef.current;
      const pointerMinutes = dayGrid
        ? ((pointerEvent.clientY - dayGrid.getBoundingClientRect().top) / HOUR_HEIGHT) *
            60 +
          grid.startHour * 60
        : edgeMinutes;
      dragResultRef.current = null;
      setDragging({
        id: event.id,
        pointerStartX: pointerEvent.clientX,
        pointerStartY: pointerEvent.clientY,
        date: event.date,
        start: event.start,
        end: event.end,
        mode: "resize-end",
        grabOffsetMinutes: pointerMinutes - edgeMinutes,
      });
    },
    [grid.startHour],
  );

  /* ---------------------------------------------------------------- */
  /* Delete (always confirmed)                                        */
  /* ---------------------------------------------------------------- */

  const requestDelete = useCallback((event: CalEvent) => {
    setMobileInspectorOpen(false);
    deferUntilFloatingLayerCloses(() => setDeleteTarget(event));
  }, []);

  const confirmDelete = () => {
    const event = deleteTarget;
    if (!event) return;
    setDeleteTarget(null);
    setCalendarEvents((current) => current.filter((item) => item.id !== event.id));
    setSelectedEventId((current) => (current === event.id ? null : current));
    void deleteCalendarEvent(Number(event.id))
      .then(() => {
        toast.success("Termin gelöscht. Er kann im Archiv wiederhergestellt werden.");
        void refetchConflicts();
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error, "Termin konnte nicht gelöscht werden."));
        void refreshEvents();
      });
  };

  const handleEventEdit = useCallback((event: CalEvent) => {
    // Defer so the context menu finishes closing (and clears its
    // body `pointer-events: none`) before the dialog mounts.
    deferUntilFloatingLayerCloses(() => setEditingEvent(event));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Create                                                           */
  /* ---------------------------------------------------------------- */

  const openNewEventDialog = (draft: Omit<CalEvent, "id">) => {
    deferUntilFloatingLayerCloses(() => setEditingEvent({ id: NEW_EVENT_ID, ...draft }));
  };

  /* Default resources for a new Termin: the logged-in Fahrlehrer/in (or
     the one instructor filtered to), and that instructor's car unless it
     is in the workshop or already booked in that slot. */
  const newEventDefaults = (slot: { date: string; start: string; end: string }) => {
    const instructor =
      (role === "fahrlehrer" && ownInstructor) ||
      (instructorFilter.size === 1 ? [...instructorFilter][0]! : null) ||
      instructorOptions[0] ||
      "Nicht zugeteilt";
    const record = instructors.find(
      (candidate) => instructorName(candidate) === instructor,
    );
    const usable = (label: string | undefined) => {
      if (!label || label === UNASSIGNED_VEHICLE || !vehicleOptions.includes(label)) {
        return false;
      }
      const vehicle = vehicles.find(
        (candidate) =>
          label === candidate.model ||
          label === `${candidate.model} · ${candidate.plate}`,
      );
      if (vehicle?.status === "wartung") return false;
      return !calendarEvents.some(
        (event) =>
          event.vehicle === label &&
          !event.cancelledAt &&
          event.date === slot.date &&
          event.start < slot.end &&
          event.end > slot.start,
      );
    };
    const vehicle = usable(record?.vehicle)
      ? record?.vehicle
      : vehicleOptions.find((option) => usable(option));
    return { instructor, vehicle };
  };

  const openPresetEditor = (preset: EventPreset, date: string, start: string) => {
    const end = formatMinutes(toMinutes(start) + preset.duration);
    openNewEventDialog({
      date,
      start,
      end,
      title: preset.title,
      ...newEventDefaults({ date, start, end }),
      type: preset.type,
    });
  };

  const handleEventCreate = () => {
    setMobileInspectorOpen(false);
    const start = defaultStartTime(selected);
    const date = toISODate(selected);
    const end = formatMinutes(toMinutes(start) + 45);
    openNewEventDialog({
      date,
      start,
      end,
      title: "Fahrstunde",
      ...newEventDefaults({ date, start, end }),
      type: "Praktisch",
    });
  };

  // A preset item supports both gestures: a plain click opens the dialog,
  // dragging carries the preset onto the grid as a ghost block — on drop,
  // the dialog opens with date/start/end already set from the drop position.
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
        setCreateMenuOpen(false);
      }

      const dayGrid = dayGridRef.current;
      if (!dayGrid) return;
      const rect = dayGrid.getBoundingClientRect();
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

      const dayWidth = rect.width / dayCount;
      const day = clamp(
        Math.floor((event.clientX - rect.left) / dayWidth),
        0,
        dayCount - 1,
      );
      const rawStartMinutes =
        ((event.clientY - rect.top) / HOUR_HEIGHT) * 60 + grid.startHour * 60;
      const startMinutes = clamp(
        snapMinutes(rawStartMinutes),
        grid.startHour * 60,
        grid.endHour * 60 - preset.duration,
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
        openPresetEditor(preset, toISODate(selected), defaultStartTime(selected));
        return;
      }
      if (placement) {
        openPresetEditor(
          preset,
          toISODate(days[placement.day]!),
          formatMinutes(placement.startMinutes),
        );
      }
    };
    const cancelDrag = () => cleanup();

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", cancelDrag, { once: true });
  };

  /* ---------------------------------------------------------------- */
  /* Save                                                             */
  /* ---------------------------------------------------------------- */

  /* Rejections propagate to the dialog, which shows the message and —
     for instructor overlaps / absences — offers "Trotzdem speichern". */
  const handleEventSave = async (
    id: string,
    updates: CalEvent,
    options: EventSaveOptions,
  ) => {
    // Explicit nulls: JSON drops undefined keys and the server keeps the
    // stored value when the key is absent.
    const { id: _id, ...rest } = updates;
    const payload = {
      ...rest,
      studentId: updates.studentId ?? null,
      lessonKind: updates.lessonKind ?? null,
      notes: updates.notes ?? "",
      allowConflicts: options.allowConflicts === true,
    };

    if (id === NEW_EVENT_ID) {
      if (options.repeat) {
        const series = await createCalendarEventSeries({
          ...payload,
          repeat: options.repeat,
        });
        setCalendarEvents((current) => [...current, ...series.events]);
        toast.success(`${series.events.length} Serientermine angelegt.`);
        showWarnings(series.warnings);
        if (series.events[0]) revealEvent(series.events[0]);
      } else {
        const created = await createCalendarEvent(payload);
        setCalendarEvents((current) => [...current, created]);
        toast.success(`Termin angelegt: ${slotLabel(created)}`);
        showWarnings(created.warnings);
        revealEvent(created);
      }
    } else if (options.scope === "following") {
      const result = await updateCalendarEventSeriesFrom(id, payload);
      toast.success(
        `${result.events.length} Serientermine geändert${
          result.skipped
            ? `, ${result.skipped} übersprungen (abgesagt, abgerechnet oder mit Nachweis)`
            : ""
        }.`,
      );
      showWarnings(result.warnings);
      const anchorEvent = result.events.find((event) => event.id === id);
      if (anchorEvent) revealEvent(anchorEvent);
    } else {
      const saved = await updateCalendarEvent(Number(id), payload);
      setCalendarEvents((current) =>
        current.map((event) => (event.id === id ? saved : event)),
      );
      toast.success(`Termin gespeichert: ${slotLabel(saved)}`);
      showWarnings(saved.warnings);
      revealEvent(saved);
    }
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
          !(await confirmDialog({
            title: "Absage trotzdem zurücknehmen?",
            description: message,
            confirmLabel: "Zurücknehmen",
          }))
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
      const confirmed = await confirmDialog({
        title: "Serientermine löschen?",
        description: `Dieser und alle folgenden Termine der Serie ab ${formatGermanDate(event.date)} werden gelöscht. Abgerechnete Termine, Termine mit Nachweis oder Ausfallgebühr bleiben erhalten.`,
        confirmLabel: "Termine löschen",
        destructive: true,
      });
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

  const handleAttest = useCallback((event: CalEvent) => {
    setMobileInspectorOpen(false);
    deferUntilFloatingLayerCloses(() => setAttestTarget(event));
  }, []);

  /* A theory Termin belongs to the group taught by the same instructor on
     that weekday and time; the dialog lets the user pick another group. */
  const handleAttendance = useCallback(
    (event: CalEvent) => {
      const weekday = parseISODate(event.date).toLocaleDateString("de-DE", {
        weekday: "long",
      });
      const byInstructor = theoryGroups.filter(
        (group) =>
          group.instructorId != null && group.instructorId === event.instructorId,
      );
      const group =
        byInstructor.find((g) => g.weekday === weekday && g.time === event.start) ??
        theoryGroups.find((g) => g.weekday === weekday && g.time === event.start) ??
        byInstructor[0];
      setMobileInspectorOpen(false);
      deferUntilFloatingLayerCloses(() =>
        setAttendance({
          groupId: group?.id,
          date: event.date,
          topic: theoryLessonFromTitle(event.title) ?? undefined,
          eventId: Number(event.id),
          label: `${event.title} · ${formatGermanDate(event.date)} ${event.start}`,
        }),
      );
    },
    [theoryGroups],
  );

  // Absent instructors per visible day (inclusive ranges).
  const absencesByDay = useMemo(() => {
    const byDay = new Map<string, Absence[]>();
    for (const day of days) {
      const iso = toISODate(day);
      const list = rangeAbsences.filter(
        (absence) => absence.fromDate <= iso && absence.toDate >= iso,
      );
      if (list.length) byDay.set(iso, list);
    }
    return byDay;
  }, [rangeAbsences, days]);

  const conflictCount = rangeConflicts?.count ?? 0;
  const showsToday = days.some((day) => isSameDay(day, now));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowVisible =
    showsToday && nowMinutes >= grid.startHour * 60 && nowMinutes <= grid.endHour * 60;
  const weekNumber = getISOWeek(days[0]!);
  const headerLabel =
    view === "tag"
      ? days[0]!.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : monthRangeLabel(days[0]!, days[dayCount - 1]!);

  const goToToday = () => {
    setAnchor(TODAY);
    setSelected(TODAY);
    setSelectedEventId(null);
    setMobileInspectorOpen(false);
    initialScrollDone.current = false;
  };

  const move = (direction: -1 | 1) => {
    const next = addDays(
      view === "tag" ? selected : weekStart,
      direction * (view === "tag" ? 1 : 7),
    );
    setAnchor(next);
    setSelected(next);
    setSelectedEventId(null);
    setMobileInspectorOpen(false);
  };

  const printDayPlan = () => {
    const date = toISODate(selected);
    setDayPlan({
      date,
      events: visibleEvents.filter((event) => event.date === date),
      phones: phoneByStudentId,
    });
  };

  const toggleInstructor = (name: string, checked: boolean) =>
    setInstructorFilter((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });

  const legend = instructorFilter.size ? [...instructorFilter] : roster;
  const selectedConflicts = selectedEvent
    ? (conflictMessages.get(selectedEvent.id) ?? [])
    : [];
  const selectedPhone =
    selectedEvent?.studentId != null
      ? phoneByStudentId.get(selectedEvent.studentId)
      : undefined;
  const gridMinWidth = view === "woche" ? "min-w-[740px]" : "";

  const inspectorProps = {
    event: selectedEvent,
    onEdit: handleEventEdit,
    onDelete: requestDelete,
    onCreate: handleEventCreate,
    onCancelEvent: handleEventCancel,
    onUncancelEvent: handleEventUncancel,
    onDeleteFollowing: handleDeleteFollowing,
    onAttest: handleAttest,
    onAttendance: handleAttendance,
    studentPhone: selectedPhone || undefined,
    conflicts: selectedConflicts,
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            {conflictCount > 0 && rangeConflicts && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-amber-700 dark:text-amber-400"
                    aria-label={`${conflictCount} Terminkonflikte im angezeigten Zeitraum`}
                  >
                    <AlertTriangle />
                    <span className="tabular-nums">{conflictCount}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    Konflikte im angezeigten Zeitraum
                  </div>
                  <ul className="max-h-80 divide-y overflow-y-auto text-xs">
                    {rangeConflicts.overlaps.map((overlap) => (
                      <li
                        key={`${overlap.resource}-${overlap.first.id}-${overlap.second.id}`}
                      >
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
                          onClick={() => {
                            revealEvent(overlap.first);
                            handleEventSelect(overlap.first);
                          }}
                        >
                          <span className="font-medium">
                            {overlap.resource === "vehicle"
                              ? `Fahrzeug ${overlap.label} doppelt belegt`
                              : `${overlap.label} doppelt gebucht`}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatGermanDate(overlap.first.date)} ·{" "}
                            {overlap.first.subtitle || overlap.first.title}{" "}
                            {overlap.first.start}–{overlap.first.end} ↔{" "}
                            {overlap.second.subtitle || overlap.second.title}{" "}
                            {overlap.second.start}–{overlap.second.end}
                          </span>
                        </button>
                      </li>
                    ))}
                    {rangeConflicts.absences.map(({ event, absence }) => (
                      <li key={`absence-${event.id}`}>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted"
                          onClick={() => {
                            revealEvent(event);
                            handleEventSelect(event);
                          }}
                        >
                          <span className="font-medium">
                            {absence.instructor} abwesend ({absence.kind})
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatGermanDate(event.date)} ·{" "}
                            {event.subtitle || event.title} {event.start}–{event.end}
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
                aria-label={view === "tag" ? "Vorheriger Tag" : "Vorherige Woche"}
                onClick={() => move(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={view === "tag" ? "Nächster Tag" : "Nächste Woche"}
                onClick={() => move(1)}
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
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] tabular-nums">
            {headerLabel}
          </h1>
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            KW {weekNumber}
          </span>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 gap-[3px] overflow-hidden bg-sidebar">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background">
          {/* Toolbar: view, filters, search, legend, print */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-2 py-1.5">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => {
                if (!value) return;
                setView(value as ViewMode);
                if (value === "woche") setAnchor(selected);
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Ansicht"
            >
              <ToggleGroupItem value="tag">Tag</ToggleGroupItem>
              <ToggleGroupItem value="woche">Woche</ToggleGroupItem>
            </ToggleGroup>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Nach Fahrlehrer/in filtern"
                  className="max-w-48"
                >
                  <ListFilter data-icon="inline-start" />
                  <span className="hidden truncate sm:inline">
                    {instructorFilter.size === 0
                      ? "Alle Fahrlehrer"
                      : instructorFilter.size === 1
                        ? [...instructorFilter][0]
                        : `${instructorFilter.size} Fahrlehrer`}
                  </span>
                  {instructorFilter.size > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums sm:hidden">
                      {instructorFilter.size}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Fahrlehrer/in anzeigen
                </DropdownMenuLabel>
                {roster.map((name) => (
                  <DropdownMenuCheckboxItem
                    key={name}
                    checked={instructorFilter.has(name)}
                    onCheckedChange={(checked) =>
                      toggleInstructor(name, checked === true)
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: colorVar(instructorColorIndex(name, roster)) }}
                    />
                    {name}
                    {name === ownInstructor && (
                      <span className="ml-auto text-xs text-muted-foreground">Ich</span>
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={instructorFilter.size === 0}
                  onSelect={() => setInstructorFilter(new Set())}
                >
                  Alle anzeigen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <InputGroup className="h-8 w-auto min-w-28 flex-1 sm:max-w-56">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                placeholder="Suchen"
                aria-label="Termine nach Fahrschüler, Titel oder Notiz durchsuchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>

            <ul
              aria-label="Farben der Fahrlehrer/innen"
              className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:flex"
            >
              {legend.map((name) => (
                <li key={name} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: colorVar(instructorColorIndex(name, roster)) }}
                  />
                  {name}
                </li>
              ))}
            </ul>

            <div className="ml-auto flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={showNight}
                title={showNight ? "Nachtstunden ausblenden" : "Nachtstunden anzeigen"}
                onClick={() => setShowNight((value) => !value)}
              >
                <MoonStar data-icon="inline-start" />
                <span className="hidden md:inline">
                  {showNight ? "0–24 Uhr" : `${DAY_START_HOUR}–${DAY_END_HOUR} Uhr`}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="Tagesplan des ausgewählten Tages drucken (je Fahrlehrer/in eine Seite)"
                onClick={printDayPlan}
              >
                <Printer data-icon="inline-start" />
                <span className="hidden md:inline">Tagesplan</span>
              </Button>
            </div>
          </div>

          <div
            ref={gridRef}
            className="subtle-scrollbar min-h-0 flex-1 overflow-auto"
            onWheel={handleCalendarWheel}
            style={{ scrollbarGutter: "stable" }}
          >
            <div className={cn("sticky top-0 z-40 bg-background", gridMinWidth)}>
              <div className="flex h-9 border-b border-border/70">
                <div aria-hidden className="w-14 shrink-0" />
                <div
                  className="grid flex-1"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
                >
                  {days.map((day) => {
                    const today = isSameDay(day, now);
                    const daySelected = isSameDay(day, selected);
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        className={cn(
                          "flex min-w-0 items-center justify-center gap-1.5 px-1 text-xs font-medium outline-hidden transition-colors duration-150 hover:bg-muted hover:duration-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          daySelected && view === "woche" && "bg-muted/60",
                        )}
                        aria-label={`${day.toLocaleDateString("de-DE", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}${view === "woche" ? " – Tagesansicht öffnen" : ""}`}
                        aria-pressed={daySelected}
                        title={view === "woche" ? "Doppelklick: Tagesansicht" : undefined}
                        onClick={() => setSelected(day)}
                        onDoubleClick={() => {
                          setSelected(day);
                          setView("tag");
                        }}
                      >
                        <span className="text-muted-foreground">{weekdayShort(day)}</span>
                        <span
                          className={cn(
                            "tabular-nums",
                            today &&
                              "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground",
                          )}
                        >
                          {day.getDate()}.
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex min-h-8 border-b border-border/70 bg-muted/[0.18]">
                <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] text-muted-foreground">
                  Ganztägig
                </div>
                <div
                  className="grid flex-1"
                  style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
                >
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

            <div className={cn("flex", gridMinWidth)}>
              <div className="relative w-14 shrink-0" style={{ height: gridHeight }}>
                {Array.from(
                  { length: grid.endHour - grid.startHour + 1 },
                  (_, i) => grid.startHour + i,
                ).map((hour) => (
                  <span
                    key={hour}
                    className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                    style={{
                      top:
                        hour === grid.startHour
                          ? 8
                          : hour === grid.endHour
                            ? gridHeight - 6
                            : topForMinutes(hour * 60, grid),
                    }}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
                {nowVisible && (
                  <span
                    className="absolute right-1 z-20 -translate-y-1/2 bg-background px-1 text-[10px] font-medium text-red-500 tabular-nums"
                    style={{ top: topForMinutes(nowMinutes, grid) }}
                  >
                    {formatMinutes(nowMinutes)}
                  </span>
                )}
              </div>

              <div
                ref={dayGridRef}
                className="relative grid flex-1"
                style={{
                  height: gridHeight,
                  gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
                }}
              >
                {nowVisible && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-30 flex items-center"
                    style={{ top: topForMinutes(nowMinutes, grid) }}
                  >
                    <span className="size-1.5 -translate-x-0.5 rounded-full bg-red-500" />
                    <span
                      className="-ml-0.5 grid flex-1"
                      style={{
                        gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
                      }}
                    >
                      {days.map((day) => (
                        <span
                          key={day.toISOString()}
                          className={cn(
                            "h-0.5 bg-red-500",
                            !isSameDay(day, now) && "bg-red-500/30",
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
                        top: topForMinutes(presetDrag.startMinutes, grid),
                        left: `calc(${(presetDrag.day * 100) / dayCount}% + 3px)`,
                        width: `calc(${100 / dayCount}% - 6px)`,
                        height: Math.max(
                          (presetDrag.preset.duration / 60) * HOUR_HEIGHT - 2,
                          MIN_CARD_HEIGHT,
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
                      isToday={isSameDay(day, now)}
                      events={eventsByDay.get(iso) ?? NO_EVENTS}
                      grid={grid}
                      draggingId={dragResultRef.current ? (dragging?.id ?? null) : null}
                      selectedEventId={selectedEventId}
                      conflictIds={conflictIds}
                      colorFor={colorFor}
                      onDragStart={handleEventDragStart}
                      onResizeStart={handleEventResizeStart}
                      onSelect={handleEventSelect}
                      onEdit={handleEventEdit}
                      onDelete={requestDelete}
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
              {...inspectorProps}
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
            {...inspectorProps}
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
        events={calendarEvents}
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

      <NachweisDialog
        event={attestTarget}
        studentId={attestTarget?.studentId}
        onClose={() => setAttestTarget(null)}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["attestations"] })}
      />

      <AttendanceDialog
        groups={theoryGroups}
        prefill={attendance ?? undefined}
        open={attendance !== null}
        onOpenChange={(open) => {
          if (!open) setAttendance(null);
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Termin löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                `„${deleteTarget.subtitle || deleteTarget.title}“ am ${formatGermanDate(deleteTarget.date)} um ${deleteTarget.start} Uhr wird gelöscht. Soll der Termin nur ausfallen, verwenden Sie „Absagen“ — dann bleibt er als Verlauf sichtbar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dayPlan && <DayPlanPrint plan={dayPlan} onDone={() => setDayPlan(null)} />}
    </div>
  );
}

export default Kalendar;
