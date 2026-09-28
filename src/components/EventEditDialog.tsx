import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import {
  type CalEvent,
  type EventPreset,
  type EventType,
  eventPresets,
  eventTypeOptions,
  parseISODate,
  toMinutes,
} from "@/lib/calendar-data";
import { isOverridableConflict, type SeriesRepeat } from "@/hooks/use-calendar-events";
import { useStudents } from "@/hooks/use-students";
import { useVehicles, type Vehicle } from "@/hooks/use-vehicles";
import { LESSON_KINDS, type LessonKind } from "@/lib/special-drives";
import {
  dailyLimitWarning,
  formatDuration,
  formatTime,
  moveStartKeepDuration,
  slotIssues,
} from "@/lib/scheduling";
import { UNASSIGNED_VEHICLE } from "@/lib/vehicle-options";
import { DatePickerField } from "@/components/DatePickerField";
import { TimeInputField } from "@/components/TimeInputField";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const NO_VEHICLE = "__none__";
const NO_LESSON_KIND = "__none__";

type RepeatChoice = "none" | "weekly" | "biweekly";

export type EventSaveOptions = {
  /** Only for new events: create a weekly / biweekly series. */
  repeat?: SeriesRepeat;
  /** The user confirmed saving despite an instructor overlap / absence. */
  allowConflicts?: boolean;
  /** Series occurrence: change only this one or this and all following. */
  scope?: "single" | "following";
};

type Hint = { level: "error" | "warning" | "info"; message: string };

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

/* Vehicle labels are "Modell" or "Modell · Kennzeichen" (server refs). */
const vehicleForLabel = (vehicles: Vehicle[], label: string | undefined) =>
  label
    ? vehicles.find(
        (vehicle) =>
          label === vehicle.model || label === `${vehicle.model} · ${vehicle.plate}`,
      )
    : undefined;

const overlaps = (a: CalEvent, b: CalEvent) =>
  a.date === b.date &&
  toMinutes(a.start) < toMinutes(b.end) &&
  toMinutes(b.start) < toMinutes(a.end);

function HintList({ hints }: { hints: Hint[] }) {
  if (hints.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-live="polite">
      {hints.map((hint) => (
        <li
          key={hint.message}
          className={cn(
            "flex items-start gap-2 text-sm",
            hint.level === "error" && "text-destructive",
            hint.level === "warning" && "text-amber-700 dark:text-amber-400",
            hint.level === "info" && "text-muted-foreground",
          )}
        >
          {hint.level === "info" ? (
            <Info className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="text-pretty">{hint.message}</span>
        </li>
      ))}
    </ul>
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
  events = [],
}: {
  event: CalEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolve to close the dialog; reject to show the error in place
      (with "Trotzdem speichern" for instructor overlaps / absences). */
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
  /** Known Termine — used for the daily limit and resource hints before
      saving (the server re-checks). */
  events?: CalEvent[];
}) {
  const { students } = useStudents();
  const { vehicles } = useVehicles();
  const [draft, setDraft] = useState<CalEvent | null>(event);
  const [repeat, setRepeat] = useState<RepeatChoice>("none");
  const [repeatCount, setRepeatCount] = useState(4);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [askScope, setAskScope] = useState(false);
  const [chosenScope, setChosenScope] = useState<"single" | "following">();
  const [now] = useState(() => new Date());

  // Reset the working copy whenever a different event is opened for editing.
  useEffect(() => {
    setDraft(event);
    setRepeat("none");
    setRepeatCount(4);
    setSaveError(null);
    setPrefillNote(null);
    setAskScope(false);
    setChosenScope(undefined);
  }, [event]);

  const hints = useMemo<Hint[]>(() => {
    if (!draft || !event) return [];
    // Hints only for what the user is changing: editing the note of a
    // past lesson must not warn about the past.
    const slotChanged =
      event.id.startsWith("__new") ||
      draft.date !== event.date ||
      draft.start !== event.start ||
      draft.end !== event.end ||
      draft.instructor !== event.instructor ||
      draft.vehicle !== event.vehicle ||
      draft.type !== event.type;
    const list: Hint[] = slotIssues(draft, now);
    if (list.some((hint) => hint.level === "error") || !slotChanged) {
      return list.filter((hint) => hint.level === "error");
    }

    const others = events.filter(
      (other) => other.id !== draft.id && !other.cancelledAt && overlaps(other, draft),
    );
    const vehicleClash = draft.vehicle
      ? others.find((other) => other.vehicle === draft.vehicle)
      : undefined;
    if (vehicleClash) {
      list.push({
        level: "error",
        message: `Fahrzeug ${draft.vehicle} ist bereits belegt: „${vehicleClash.title}“${
          vehicleClash.subtitle ? ` mit ${vehicleClash.subtitle}` : ""
        } (${vehicleClash.start}–${vehicleClash.end}).`,
      });
    }
    const instructorClash =
      draft.instructor && draft.instructor !== "Nicht zugeteilt"
        ? others.find((other) => other.instructor === draft.instructor)
        : undefined;
    if (instructorClash) {
      list.push({
        level: "warning",
        message: `${draft.instructor} hat zur selben Zeit „${instructorClash.title}“${
          instructorClash.subtitle ? ` mit ${instructorClash.subtitle}` : ""
        } (${instructorClash.start}–${instructorClash.end}).`,
      });
    }
    const limit = dailyLimitWarning(events, draft);
    if (limit) list.push({ level: "warning", message: limit });
    const vehicle = vehicleForLabel(vehicles, draft.vehicle);
    if (vehicle?.status === "wartung") {
      list.push({
        level: "warning",
        message: `Fahrzeug ${draft.vehicle} ist als „In Wartung“ markiert.`,
      });
    }
    return list;
  }, [draft, event, events, now, vehicles]);

  if (!event || !draft) return null;

  const isNew = event.id.startsWith("__new");
  const update = <K extends keyof CalEvent>(key: K, value: CalEvent[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const applyPreset = (preset: EventPreset) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        title: preset.title,
        type: preset.type,
        lessonKind: preset.type === "Praktisch" ? current.lessonKind : undefined,
        end: formatTime(toMinutes(current.start) + preset.duration),
      };
    });
  };

  // Moving "Von" keeps the lesson length, so a 45-minute lesson stays 45
  // minutes instead of silently growing to a 9-hour block.
  const updateStartTime = (value: string) =>
    setDraft((current) =>
      current ? { ...current, ...moveStartKeepDuration(current, value) } : current,
    );

  /* Picking a student takes over their assigned instructor and vehicle. */
  const selectStudent = (name: string | undefined) => {
    setDraft((current) => {
      if (!current) return current;
      const next: CalEvent = { ...current, subtitle: name };
      const student = name
        ? students.find(
            (candidate) => `${candidate.firstName} ${candidate.lastName}`.trim() === name,
          )
        : undefined;
      if (!student) {
        setPrefillNote(null);
        return next;
      }
      const taken: string[] = [];
      if (student.instructor && instructorOptions.includes(student.instructor)) {
        next.instructor = student.instructor;
        taken.push(`Fahrlehrer/in ${student.instructor}`);
      }
      const needsVehicle =
        current.type !== "Theorie" && current.type !== "Theorieprüfung";
      if (
        needsVehicle &&
        student.vehicle &&
        student.vehicle !== UNASSIGNED_VEHICLE &&
        vehicleOptions.includes(student.vehicle)
      ) {
        next.vehicle = student.vehicle;
        taken.push(`Fahrzeug ${student.vehicle}`);
      }
      setPrefillNote(
        taken.length ? `${taken.join(" und ")} von ${name} übernommen.` : null,
      );
      return next;
    });
  };

  const dateLabel = parseISODate(draft.date).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const selectableVehicleOptions = (
    draft.vehicle && !vehicleOptions.includes(draft.vehicle)
      ? [draft.vehicle, ...vehicleOptions]
      : vehicleOptions
  ).filter((option) => option !== UNASSIGNED_VEHICLE);
  const duration = toMinutes(draft.end) - toMinutes(draft.start);

  const cancel = () => {
    setDraft(event);
    onOpenChange(false);
  };

  const hasError = hints.some((hint) => hint.level === "error");
  const hasWarning = hints.some((hint) => hint.level === "warning");
  const isSeriesEdit = Boolean(event.seriesId) && !allowRepeat;

  const save = async (allowConflicts = false, scope?: "single" | "following") => {
    if (hasError) return;
    if (isSeriesEdit && !scope) {
      setAskScope(true);
      return;
    }
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
    const options: EventSaveOptions = { allowConflicts, scope };
    if (allowRepeat && repeat !== "none") {
      options.repeat = { interval: repeat, count: repeatCount };
    }
    setSaving(true);
    setSaveError(null);
    setAskScope(false);
    setChosenScope(scope);
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
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onFocusOutside={keepDialogOpenForFloatingContent}
        onInteractOutside={keepDialogOpenForFloatingContent}
        onPointerDownOutside={keepDialogOpenForFloatingContent}
      >
        <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 pr-12">
          <DialogTitle className="text-[15px] font-semibold tracking-[-0.01em]">
            {isNew ? "Neuer Termin" : "Termin bearbeiten"}
            {draft.subtitle ? ` · ${draft.subtitle}` : ""}
          </DialogTitle>
          <DialogDescription className="tabular-nums">
            <span className="capitalize">{dateLabel}</span> · {draft.start}–{draft.end}
            {duration > 0 ? ` (${formatDuration(duration)})` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="event-subtitle">Fahrschüler/in</FieldLabel>
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
                onValueChange={(value) => selectStudent(value ?? undefined)}
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
              {prefillNote && (
                <p className="text-xs text-muted-foreground">{prefillNote}</p>
              )}
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="event-date">Datum</FieldLabel>
              <DatePickerField
                id="event-date"
                value={draft.date}
                onChange={(value) => update("date", value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <Field>
                <FieldLabel htmlFor="event-start">Von</FieldLabel>
                <TimeInputField
                  id="event-start"
                  value={draft.start}
                  onChange={updateStartTime}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="event-end">Bis</FieldLabel>
                <TimeInputField
                  id="event-end"
                  value={draft.end}
                  aria-invalid={duration <= 0}
                  onChange={(value) => update("end", value)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="event-instructor">Fahrlehrer/in</FieldLabel>
              <Select
                value={draft.instructor}
                onValueChange={(value) => update("instructor", value)}
              >
                <SelectTrigger id="event-instructor" className="w-full">
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
                <SelectTrigger id="event-vehicle" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_VEHICLE}>Kein Fahrzeug</SelectItem>
                    {selectableVehicleOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                        {vehicleForLabel(vehicles, option)?.status === "wartung" &&
                          " (In Wartung)"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel>Art</FieldLabel>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {eventPresets.map((preset) => {
                  const active =
                    draft.type === preset.type &&
                    draft.title === preset.title &&
                    duration === preset.duration;
                  return (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={active}
                      className={cn("justify-center", active && "bg-muted")}
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
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
                <SelectTrigger id="event-type" className="w-full">
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

            {draft.type === "Praktisch" ? (
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
                  <SelectTrigger id="event-lesson-kind" className="w-full">
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
            ) : (
              <div className="hidden sm:block" />
            )}

            <Field>
              <FieldLabel htmlFor="event-title">Titel</FieldLabel>
              <Input
                id="event-title"
                value={draft.title}
                onChange={(e) => update("title", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="event-location">Ort / Abholort</FieldLabel>
              <Input
                id="event-location"
                placeholder="z. B. Bahnhof Nord"
                value={draft.location ?? ""}
                onChange={(e) => update("location", e.target.value || undefined)}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="event-notes">Notiz</FieldLabel>
              <Textarea
                id="event-notes"
                rows={2}
                maxLength={2000}
                placeholder="z. B. Schwerpunkt Kreisverkehr, Brille mitbringen"
                className="min-h-16 resize-none"
                value={draft.notes ?? ""}
                onChange={(e) => update("notes", e.target.value || undefined)}
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
                    <SelectTrigger id="event-repeat" className="w-full">
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
                {repeat !== "none" ? (
                  <Field>
                    <FieldLabel htmlFor="event-repeat-count">Anzahl Termine</FieldLabel>
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
                ) : (
                  <div className="hidden sm:block" />
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
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-5 py-3">
          <HintList hints={hints} />
          {saveError && (
            <div
              role="alert"
              className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
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
                  onClick={() => void save(true, chosenScope)}
                >
                  Trotzdem speichern
                </Button>
              )}
            </div>
          )}
          {askScope ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Serientermin ändern</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAskScope(false)}
                >
                  Zurück
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => void save(false, "single")}
                >
                  Nur diesen Termin
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void save(false, "following")}
                >
                  Diesen und alle folgenden
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" size="sm" onClick={cancel}>
                Abbrechen
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || hasError}
                onClick={() => void save()}
              >
                {saving
                  ? "Speichert…"
                  : hasWarning && !hasError
                    ? "Trotzdem speichern"
                    : "Speichern"}
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
