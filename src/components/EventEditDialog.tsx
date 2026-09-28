import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  X,
} from "lucide-react";

import {
  type CalEvent,
  type EventPreset,
  type EventType,
  eventPresets,
  eventTypeOptions,
  parseISODate,
  toISODate,
  toMinutes,
} from "@/lib/calendar-data";
import { isOverridableConflict, type SeriesRepeat } from "@/hooks/use-calendar-events";
import { LESSON_KINDS, type LessonKind } from "@/lib/special-drives";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NO_VEHICLE = "__none__";
const NO_LESSON_KIND = "__none__";

type RepeatChoice = "none" | "weekly" | "biweekly";

export type EventSaveOptions = {
  /** Only for new events: create a weekly / biweekly series. */
  repeat?: SeriesRepeat;
  /** The user confirmed saving despite an overlap / absence. */
  allowConflicts?: boolean;
};
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const MINUTE_OPTIONS = ["00", "15", "30", "45"];

const formatDateLabel = (value: string) =>
  parseISODate(value).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const parseTimeValue = (value: string) => {
  const [hour = "00", minute = "00"] = value.split(":");
  return {
    hour: hour.padStart(2, "0"),
    minute: minute.padStart(2, "0"),
  };
};

const formatTimeValue = (minutes: number) => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const scrollTimeListWithWheel = (event: React.WheelEvent<HTMLDivElement>) => {
  if (!event.deltaY) return;

  event.currentTarget.scrollTop += event.deltaY;
  event.preventDefault();
  event.stopPropagation();
};

const floatingContentSelector =
  '[data-slot="popover-content"], [data-slot="combobox-content"]';

const keepDialogOpenForFloatingContent = (event: Event) => {
  const target = event.target;
  if (
    document.querySelector(floatingContentSelector) ||
    (target instanceof Element && target.closest(floatingContentSelector))
  ) {
    event.preventDefault();
  }
};

function DatePickerField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-8 w-full justify-start px-2.5 font-normal"
        >
          <CalendarDays data-icon="inline-start" />
          <span className="truncate">{formatDateLabel(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          required
          selected={selected}
          month={selected}
          onSelect={(date) => {
            onChange(toISODate(date));
            setOpen(false);
          }}
          weekStartsOn={1}
          showOutsideDays
          className="p-0"
          formatters={{
            formatCaption: (date) =>
              date.toLocaleDateString("de-DE", {
                month: "long",
                year: "numeric",
              }),
            formatWeekdayName: (date) =>
              date.toLocaleDateString("de-DE", { weekday: "short" }).slice(0, 2),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TimePickerField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { hour, minute } = parseTimeValue(value);
  const selectedHourRef = useRef<HTMLButtonElement | null>(null);
  const setTime = (nextHour: string, nextMinute: string) => {
    onChange(`${nextHour}:${nextMinute}`);
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      selectedHourRef.current?.scrollIntoView({
        block: "center",
      });
    });
  }, [open, hour]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-8 w-full justify-start px-2.5 font-normal tabular-nums"
        >
          <Clock data-icon="inline-start" />
          {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2.5">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Uhrzeit</span>
            <span className="text-lg font-medium tabular-nums">
              {hour}:{minute}
            </span>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="px-1 text-center text-xs font-medium text-muted-foreground">
                Stunde
              </div>
              <div
                className="subtle-scrollbar h-44 overflow-y-auto overscroll-contain rounded-lg border bg-background"
                role="listbox"
                aria-label="Stunde auswählen"
                onWheel={scrollTimeListWithWheel}
              >
                <div className="flex flex-col gap-1 p-1">
                  {HOUR_OPTIONS.map((option) => (
                    <Button
                      key={option}
                      ref={option === hour ? selectedHourRef : undefined}
                      type="button"
                      role="option"
                      aria-selected={option === hour}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 justify-center rounded-md px-2 text-base font-normal tabular-nums",
                        option === hour &&
                          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                      onClick={() => setTime(option, minute)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center pt-7 text-xl font-medium text-muted-foreground">
              :
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <div className="px-1 text-center text-xs font-medium text-muted-foreground">
                Minute
              </div>
              <div
                className="subtle-scrollbar h-44 overflow-y-auto overscroll-contain rounded-lg border bg-background"
                role="listbox"
                aria-label="Minute auswählen"
                onWheel={scrollTimeListWithWheel}
              >
                <div className="flex flex-col gap-1 p-1">
                  {MINUTE_OPTIONS.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      role="option"
                      aria-selected={option === minute}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 justify-center rounded-md px-2 text-base font-normal tabular-nums",
                        option === minute &&
                          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                      onClick={() => setTime(hour, option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            <Check data-icon="inline-start" />
            Übernehmen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EventEditDialog({
  event,
  open,
  onOpenChange,
  onSave,
  instructorOptions,
  studentOptions,
  studentIdByName,
  vehicleOptions,
  allowRepeat = false,
}: {
  event: CalEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolve to close the dialog; reject to show the error in place
      (with "Trotzdem speichern" for overlaps / absences). */
  onSave: (
    id: string,
    updates: CalEvent,
    options: EventSaveOptions,
  ) => Promise<void> | void;
  instructorOptions: string[];
  studentOptions: string[];
  /** Display name → students.id. When provided, saving resolves the
      "Fahrschüler" field to studentId (unmatched/free text → undefined,
      overwriting any previous link). When omitted, studentId is left
      exactly as it was on the event. */
  studentIdByName?: Map<string, number>;
  vehicleOptions: string[];
  /** Offer "Wiederholen" (new events only). */
  allowRepeat?: boolean;
}) {
  const [draft, setDraft] = useState<CalEvent | null>(event);
  const [repeat, setRepeat] = useState<RepeatChoice>("none");
  const [repeatCount, setRepeatCount] = useState(4);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset the working copy whenever a different event is opened for editing.
  useEffect(() => {
    setDraft(event);
    setRepeat("none");
    setRepeatCount(4);
    setSaveError(null);
  }, [event]);

  if (!event || !draft) return null;

  const update = <K extends keyof CalEvent>(key: K, value: CalEvent[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const applyPreset = (preset: EventPreset) => {
    setDraft((current) => {
      if (!current) return current;
      const startMinutes = toMinutes(current.start);

      return {
        ...current,
        title: preset.title,
        type: preset.type,
        end: formatTimeValue(startMinutes + preset.duration),
      };
    });
  };

  const updateStartTime = (value: string) => {
    setDraft((current) => {
      if (!current) return current;

      const nextStartMinutes = toMinutes(value);
      const currentEndMinutes = toMinutes(current.end);

      return {
        ...current,
        start: value,
        end:
          nextStartMinutes >= currentEndMinutes
            ? formatTimeValue(nextStartMinutes + 30)
            : current.end,
      };
    });
  };

  const dateLabel = parseISODate(draft.date).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const selectableVehicleOptions =
    draft.vehicle && !vehicleOptions.includes(draft.vehicle)
      ? [draft.vehicle, ...vehicleOptions]
      : vehicleOptions;

  const cancel = () => {
    setDraft(event);
    onOpenChange(false);
  };

  const save = async (allowConflicts = false) => {
    const updates = studentIdByName
      ? {
          ...draft,
          // Resolve the selected/typed name to the student's id so the
          // event carries the FK from the start. Free-text subtitles
          // (non-student events) resolve to undefined — replacing any
          // stale id from before the name was changed or cleared.
          studentId: studentIdByName.get(draft.subtitle?.trim() ?? ""),
        }
      : draft;
    const options: EventSaveOptions = { allowConflicts };
    if (allowRepeat && repeat !== "none") {
      options.repeat = { interval: repeat, count: repeatCount };
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(event.id, updates, options);
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };
  const canOverride = saveError !== null && isOverridableConflict(saveError);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-auto sm:max-w-2xl"
        onFocusOutside={keepDialogOpenForFloatingContent}
        onInteractOutside={keepDialogOpenForFloatingContent}
        onPointerDownOutside={keepDialogOpenForFloatingContent}
      >
        <DialogHeader>
          <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CalendarClock />
              </div>
              <div className="flex flex-col gap-1">
                <DialogTitle className="text-xl">{draft.title || "Termin"}</DialogTitle>
                <DialogDescription>
                  {dateLabel} · {draft.start}–{draft.end}
                </DialogDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void save()}
              >
                <Check data-icon="inline-start" />
                Speichern
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancel}>
                <X data-icon="inline-start" />
                Abbrechen
              </Button>
            </div>
          </div>
        </DialogHeader>

        {saveError && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {saveError}
            </span>
            {canOverride && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={saving}
                onClick={() => void save(true)}
              >
                Trotzdem speichern
              </Button>
            )}
          </div>
        )}

        <Card size="sm">
          <CardContent>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel>Schnellauswahl</FieldLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {eventPresets.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-center"
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="event-title">Titel</FieldLabel>
                <Input
                  id="event-title"
                  value={draft.title}
                  onChange={(e) => update("title", e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="event-type">Ereignistyp</FieldLabel>
                <Select
                  value={draft.type}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            type: value as EventType,
                            // Only practical lessons carry a Fahrtart.
                            lessonKind:
                              value === "Praktisch" ? current.lessonKind : undefined,
                          }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="event-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {eventTypeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              {draft.type === "Praktisch" && (
                <Field>
                  <FieldLabel htmlFor="event-lesson-kind">Fahrtart</FieldLabel>
                  <Select
                    value={draft.lessonKind ?? NO_LESSON_KIND}
                    onValueChange={(value) =>
                      update(
                        "lessonKind",
                        value === NO_LESSON_KIND ? undefined : (value as LessonKind),
                      )
                    }
                  >
                    <SelectTrigger id="event-lesson-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NO_LESSON_KIND}>Keine Angabe</SelectItem>
                        {LESSON_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {kind}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="event-date">Datum</FieldLabel>
                <DatePickerField
                  id="event-date"
                  value={draft.date}
                  onChange={(value) => update("date", value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="event-start">Von</FieldLabel>
                <TimePickerField
                  id="event-start"
                  value={draft.start}
                  onChange={updateStartTime}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="event-end">Bis</FieldLabel>
                <TimePickerField
                  id="event-end"
                  value={draft.end}
                  onChange={(value) => update("end", value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="event-subtitle">Fahrschüler</FieldLabel>
                <Combobox
                  items={studentOptions}
                  inputValue={draft.subtitle ?? ""}
                  value={
                    draft.subtitle && studentOptions.includes(draft.subtitle)
                      ? draft.subtitle
                      : null
                  }
                  onInputValueChange={(value, eventDetails) => {
                    if (
                      eventDetails.reason !== "input-change" &&
                      eventDetails.reason !== "input-clear" &&
                      eventDetails.reason !== "clear-press"
                    ) {
                      return;
                    }
                    update("subtitle", value || undefined);
                  }}
                  onValueChange={(value) => update("subtitle", value ?? undefined)}
                  autoHighlight
                >
                  <ComboboxInput
                    id="event-subtitle"
                    placeholder="Namen eingeben oder auswählen"
                    className="w-full"
                    showClear
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>Keine Fahrschüler gefunden.</ComboboxEmpty>
                    <ComboboxList>
                      {(option: string) => (
                        <ComboboxItem key={option} value={option}>
                          {option}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>

              <Field>
                <FieldLabel htmlFor="event-instructor">Fahrlehrer/in</FieldLabel>
                <Select
                  value={draft.instructor}
                  onValueChange={(value) => update("instructor", value)}
                >
                  <SelectTrigger id="event-instructor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(instructorOptions.includes(draft.instructor)
                        ? instructorOptions
                        : [draft.instructor, ...instructorOptions]
                      ).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="event-vehicle">Fahrzeug</FieldLabel>
                <Select
                  value={draft.vehicle ?? NO_VEHICLE}
                  onValueChange={(value) =>
                    update("vehicle", value === NO_VEHICLE ? undefined : value)
                  }
                >
                  <SelectTrigger id="event-vehicle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_VEHICLE}>Kein Fahrzeug</SelectItem>
                      {selectableVehicleOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="event-location">Ort</FieldLabel>
                <Input
                  id="event-location"
                  value={draft.location ?? ""}
                  onChange={(e) => update("location", e.target.value || undefined)}
                />
              </Field>

              {allowRepeat && (
                <>
                  <Field>
                    <FieldLabel htmlFor="event-repeat">Wiederholen</FieldLabel>
                    <Select
                      value={repeat}
                      onValueChange={(value) => setRepeat(value as RepeatChoice)}
                    >
                      <SelectTrigger id="event-repeat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">Nie</SelectItem>
                          <SelectItem value="weekly">Wöchentlich</SelectItem>
                          <SelectItem value="biweekly">Alle 2 Wochen</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  {repeat !== "none" && (
                    <Field>
                      <FieldLabel htmlFor="event-repeat-count">Anzahl</FieldLabel>
                      <Input
                        id="event-repeat-count"
                        type="number"
                        min={2}
                        max={52}
                        className="tabular-nums"
                        value={repeatCount}
                        onChange={(e) =>
                          setRepeatCount(
                            Math.min(
                              52,
                              Math.max(2, Math.round(Number(e.target.value) || 2)),
                            ),
                          )
                        }
                      />
                    </Field>
                  )}
                </>
              )}

              <label className="flex cursor-pointer items-center gap-2.5 text-sm sm:col-span-2">
                <Checkbox
                  checked={draft.tentative ?? false}
                  onCheckedChange={(checked) => update("tentative", checked === true)}
                />
                Vorläufig (unbestätigt)
              </label>
            </FieldGroup>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
