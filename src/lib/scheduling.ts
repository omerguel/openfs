/* ------------------------------------------------------------------ */
/* Scheduling helpers for the calendar UI — pure, unit-tested          */
/* (scheduling.test.ts). Time strings are "HH:MM", dates ISO.          */
/* ------------------------------------------------------------------ */

import type { CalEvent } from "./calendar-data";
import { MAX_PRACTICAL_MINUTES_PER_DAY, PRACTICAL_EVENT_TYPES } from "./working-time";

export const minutesOf = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

export const formatTime = (minutes: number) => {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 24 * 60);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

/** Lenient time entry: "9" → 09:00, "930" / "9.30" / "9:30" → 09:30,
    "1745" → 17:45, "24:00" allowed as an end time. null when invalid. */
export function parseTimeInput(raw: string): string | null {
  const value = raw.trim().replace(/\s*uhr$/i, "");
  if (!value) return null;
  let hours: number;
  let minutes: number;
  const separated = /^(\d{1,2})[:.,h](\d{1,2})$/.exec(value);
  if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2]);
    if (separated[2]!.length === 1) minutes *= 10; // "9:3" → 09:30
  } else if (/^\d{1,4}$/.test(value)) {
    if (value.length <= 2) {
      hours = Number(value);
      minutes = 0;
    } else {
      hours = Number(value.slice(0, -2));
      minutes = Number(value.slice(-2));
    }
  } else {
    return null;
  }
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return formatTime(hours * 60 + minutes);
}

/** Quarter-hour suggestions from `from` (inclusive) to `to` (exclusive). */
export function quarterHourOptions(from = 0, to = 24 * 60): string[] {
  const options: string[] = [];
  for (let minutes = Math.ceil(from / 15) * 15; minutes < to; minutes += 15) {
    options.push(formatTime(minutes));
  }
  return options;
}

/** New end when the start moves: the duration is kept (capped at 24:00). */
export function moveStartKeepDuration(
  current: { start: string; end: string },
  nextStart: string,
): { start: string; end: string } {
  const duration = Math.max(minutesOf(current.end) - minutesOf(current.start), 15);
  const start = minutesOf(nextStart);
  return { start: nextStart, end: formatTime(Math.min(start + duration, 24 * 60)) };
}

/** Longest plausible practical lesson (Doppelstunde + Prüfungsfahrt). */
export const MAX_PLAUSIBLE_LESSON_MINUTES = 180;

export type SlotIssue = { level: "error" | "warning"; message: string };

/** Checks the dialog can run before saving: order, plausibility, past. */
export function slotIssues(
  slot: { date: string; start: string; end: string; type: string },
  now: Date,
): SlotIssue[] {
  const issues: SlotIssue[] = [];
  const start = minutesOf(slot.start);
  const end = minutesOf(slot.end);
  if (end <= start) {
    issues.push({ level: "error", message: "„Bis“ muss nach „Von“ liegen." });
    return issues;
  }
  const duration = end - start;
  if (slot.type === "Praktisch" && duration > MAX_PLAUSIBLE_LESSON_MINUTES) {
    issues.push({
      level: "warning",
      message: `Ungewöhnlich lange Fahrstunde (${formatDuration(duration)}) – bitte „Bis“ prüfen.`,
    });
  }
  const [y = 0, mo = 1, d = 1] = slot.date.split("-").map(Number);
  const startsAt = new Date(y, mo - 1, d, Math.floor(start / 60), start % 60);
  if (startsAt.getTime() < now.getTime()) {
    issues.push({ level: "warning", message: "Der Termin liegt in der Vergangenheit." });
  }
  return issues;
}

/** 45 → "45 Min.", 135 → "2 Std. 15 Min." */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} Min.`;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

/** Practical minutes (Praktisch + Prüfungsfahrt, not cancelled) of one
    instructor on one day, optionally without the event being edited. */
export function practicalMinutes(
  events: Pick<CalEvent, "id" | "date" | "start" | "end" | "type" | "instructor" | "cancelledAt">[],
  instructor: string,
  date: string,
  excludeId?: string,
): number {
  return events
    .filter(
      (event) =>
        event.id !== excludeId &&
        event.date === date &&
        event.instructor === instructor &&
        !event.cancelledAt &&
        PRACTICAL_EVENT_TYPES.includes(event.type),
    )
    .reduce((sum, event) => sum + minutesOf(event.end) - minutesOf(event.start), 0);
}

/** Warning when saving `draft` pushes the instructor past the legal daily
    maximum for practical instruction; null otherwise. */
export function dailyLimitWarning(
  events: Parameters<typeof practicalMinutes>[0],
  draft: Pick<CalEvent, "id" | "date" | "start" | "end" | "type" | "instructor">,
): string | null {
  if (!PRACTICAL_EVENT_TYPES.includes(draft.type)) return null;
  const own = minutesOf(draft.end) - minutesOf(draft.start);
  if (own <= 0) return null;
  const total = practicalMinutes(events, draft.instructor, draft.date, draft.id) + own;
  if (total <= MAX_PRACTICAL_MINUTES_PER_DAY) return null;
  return `${draft.instructor} käme an diesem Tag auf ${total} Min. praktischen Unterricht — erlaubt sind höchstens ${MAX_PRACTICAL_MINUTES_PER_DAY} Min.`;
}

/* ------------------------------------------------------------------ */
/* Instructor colours                                                  */
/* ------------------------------------------------------------------ */

/** Number of --instructor-N tokens in index.css. */
export const INSTRUCTOR_PALETTE_SIZE = 8;

/** Stable palette slot per instructor: the roster order decides, so the
    same instructor keeps the same colour across pages and reloads.
    Unknown / unassigned names get null (neutral card). */
export function instructorColorIndex(
  instructor: string | undefined,
  roster: string[],
): number | null {
  if (!instructor) return null;
  const index = roster.indexOf(instructor);
  if (index === -1) return null;
  return index % INSTRUCTOR_PALETTE_SIZE;
}

/* ------------------------------------------------------------------ */
/* Header label                                                        */
/* ------------------------------------------------------------------ */

const monthShortDe = (date: Date) =>
  date.toLocaleDateString("de-DE", { month: "short" }).replace(".", "");

/** "September 2026", or "Sep – Okt 2026" / "Dez 2026 – Jan 2027" when the
    range spans two months. */
export function monthRangeLabel(from: Date, to: Date): string {
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return from.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }
  if (from.getFullYear() === to.getFullYear()) {
    return `${monthShortDe(from)} – ${monthShortDe(to)} ${to.getFullYear()}`;
  }
  return `${monthShortDe(from)} ${from.getFullYear()} – ${monthShortDe(to)} ${to.getFullYear()}`;
}

/** Two-letter German weekday ("Mo", "Di", …). */
export const weekdayShort = (date: Date) =>
  date.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "").slice(0, 2);

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Case- and accent-insensitive match of a search term against the
    event's student, title, instructor and notes. */
export function eventMatchesSearch(
  event: Pick<CalEvent, "title" | "subtitle" | "instructor" | "notes" | "location">,
  term: string,
): boolean {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase("de-DE")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const needle = normalize(term.trim());
  if (!needle) return true;
  return [event.subtitle, event.title, event.instructor, event.notes, event.location]
    .filter(Boolean)
    .some((value) => normalize(value!).includes(needle));
}
