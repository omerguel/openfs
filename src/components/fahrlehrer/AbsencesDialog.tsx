/* ------------------------------------------------------------------ */
/* Abwesenheiten of one instructor — list, add, delete. New Termine on */
/* these days are blocked in the calendar (server-side check); Termine */
/* that were booked before are listed right away and can be handed to  */
/* a colleague or cancelled without a fee.                             */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarSearch, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ABSENCE_KIND_OPTIONS,
  type AbsenceKind,
  cancelLessonsWithoutFee,
  createAbsence,
  deleteAbsence,
  type LessonActionResult,
  reassignLessons,
  useAbsences,
  useAffectedLessons,
} from "@/hooks/use-absences";
import { type Instructor, instructorName, useInstructors } from "@/hooks/use-instructors";
import { parseISODate, toISODate } from "@/lib/calendar-data";
import { formatGermanDate } from "@/lib/working-time";
import { DatePickerField } from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const rangeLabel = (from: string, to: string) =>
  from === to
    ? formatGermanDate(from)
    : `${formatGermanDate(from)} – ${formatGermanDate(to)}`;

/* Affected Termine of one absence range with bulk hand-over / cancel. */
function AffectedLessons({
  instructor,
  from,
  to,
  onClose,
}: {
  instructor: Instructor;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { instructors } = useInstructors();
  const {
    data: lessons = [],
    isPending,
    refetch,
  } = useAffectedLessons(instructor.id, from, to);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const colleagues = instructors.filter(
    (candidate) => candidate.id !== instructor.id && candidate.status === "aktiv",
  );
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Everything is selected until the user unticks something.
  const chosen = selected ?? new Set(lessons.map((lesson) => lesson.id));

  const report = (result: LessonActionResult, verb: string) => {
    if (result.done.length) {
      toast.success(
        `${result.done.length} ${result.done.length === 1 ? "Termin" : "Termine"} ${verb}.`,
      );
    }
    for (const failure of result.failed) {
      toast.error(
        `${formatGermanDate(failure.date)} ${failure.start} „${failure.title}“: ${failure.reason}`,
      );
    }
  };

  const run = async (action: () => Promise<LessonActionResult>, verb: string) => {
    setBusy(true);
    try {
      report(await action(), verb);
      setSelected(null);
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-conflicts"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const ids = lessons.map((lesson) => lesson.id).filter((id) => chosen.has(id));

  return (
    <section
      aria-label="Betroffene Termine"
      className="flex flex-col gap-3 rounded-md border px-3 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            Betroffene Termine · {rangeLabel(from, to)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isPending
              ? "Wird geprüft…"
              : lessons.length === 0
                ? "Keine gebuchten Termine in diesem Zeitraum."
                : `${lessons.length} ${lessons.length === 1 ? "Termin ist" : "Termine sind"} bei ${instructorName(instructor)} gebucht.`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Schließen
        </Button>
      </div>

      {lessons.length > 0 && (
        <>
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm">
                  <Checkbox
                    checked={chosen.has(lesson.id)}
                    onCheckedChange={(value) => {
                      const next = new Set(chosen);
                      if (value === true) next.add(lesson.id);
                      else next.delete(lesson.id);
                      setSelected(next);
                    }}
                  />
                  <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                    {parseISODate(lesson.date).toLocaleDateString("de-DE", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                    })}{" "}
                    {lesson.start}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {lesson.subtitle || lesson.title}
                    {lesson.subtitle && (
                      <span className="text-muted-foreground"> · {lesson.title}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="absence-reassign">Übergeben an</FieldLabel>
              <NativeSelect
                id="absence-reassign"
                className="w-full"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <NativeSelectOption value="">Fahrlehrer/in wählen</NativeSelectOption>
                {colleagues.map((colleague) => (
                  <NativeSelectOption key={colleague.id} value={String(colleague.id)}>
                    {instructorName(colleague)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button
              type="button"
              disabled={busy || !target || ids.length === 0}
              onClick={() =>
                void run(() => reassignLessons(ids, Number(target)), "übergeben")
              }
            >
              {ids.length} übergeben
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || ids.length === 0}
              onClick={() => {
                if (
                  window.confirm(
                    `${ids.length} ${ids.length === 1 ? "Termin" : "Termine"} ohne Ausfallgebühr absagen?`,
                  )
                ) {
                  void run(() => cancelLessonsWithoutFee(ids), "abgesagt (ohne Gebühr)");
                }
              }}
            >
              Absagen (ohne Gebühr)
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function AbsencesDialog({
  instructor,
  onOpenChange,
}: {
  instructor: Instructor;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const today = toISODate(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [kind, setKind] = useState<AbsenceKind>("Urlaub");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [impact, setImpact] = useState<{ from: string; to: string } | null>(null);

  const { data: absences = [], isPending } = useAbsences({
    instructorId: instructor.id,
  });
  // Live preview while the range is being entered.
  const { data: preview = [] } = useAffectedLessons(
    instructor.id,
    fromDate,
    toDate || fromDate,
  );
  // Current and planned absences first, history (newest first) below.
  const upcoming = useMemo(
    () => [
      ...absences.filter((absence) => absence.toDate >= today),
      ...absences.filter((absence) => absence.toDate < today).reverse(),
    ],
    [absences, today],
  );

  const name = instructorName(instructor);

  // Absences feed the Kalendar banner and conflict count as well.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["absences"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar-conflicts"] }),
      queryClient.invalidateQueries({ queryKey: ["instructor-hours"] }),
    ]);

  const add = async () => {
    setSaving(true);
    try {
      const created = await createAbsence({
        instructorId: instructor.id,
        fromDate,
        toDate: toDate || fromDate,
        kind,
        note,
      });
      await invalidate();
      toast.success(
        `Abwesenheit eingetragen: ${rangeLabel(created.fromDate, created.toDate)}.`,
      );
      setImpact({ from: created.fromDate, to: created.toDate });
      // Fresh form for the next entry.
      setFromDate(today);
      setToDate(today);
      setKind("Urlaub");
      setNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteAbsence(id);
      await invalidate();
      toast.success("Abwesenheit gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Abwesenheiten · {name}</DialogTitle>
          <DialogDescription>
            An diesen Tagen können keine neuen Termine für {name} eingeplant werden.
            Bereits gebuchte Termine werden angezeigt und können übergeben oder abgesagt
            werden.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border">
          {isPending ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Lädt…</p>
          ) : upcoming.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Keine Abwesenheiten eingetragen.
            </p>
          ) : (
            <ul className="max-h-48 divide-y overflow-y-auto">
              {upcoming.map((absence) => (
                <li
                  key={absence.id}
                  className="flex items-center gap-3 px-3 py-1.5 text-sm"
                >
                  <span className="shrink-0 tabular-nums">
                    {rangeLabel(absence.fromDate, absence.toDate)}
                  </span>
                  <span className="font-medium">{absence.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {absence.note}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Betroffene Termine anzeigen"
                    title="Betroffene Termine anzeigen"
                    onClick={() =>
                      setImpact({ from: absence.fromDate, to: absence.toDate })
                    }
                  >
                    <CalendarSearch />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Abwesenheit löschen"
                    onClick={() => void remove(absence.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {impact && (
          <AffectedLessons
            key={`${impact.from}-${impact.to}`}
            instructor={instructor}
            from={impact.from}
            to={impact.to}
            onClose={() => setImpact(null)}
          />
        )}

        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="absence-from">Von</FieldLabel>
            <DatePickerField
              id="absence-from"
              value={fromDate}
              onChange={(value) => {
                setFromDate(value);
                if (toDate < value) setToDate(value);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="absence-to">Bis</FieldLabel>
            <DatePickerField
              id="absence-to"
              value={toDate}
              min={fromDate}
              onChange={setToDate}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="absence-kind">Art</FieldLabel>
            <NativeSelect
              id="absence-kind"
              className="w-full"
              value={kind}
              onChange={(e) => setKind(e.target.value as AbsenceKind)}
            >
              {ABSENCE_KIND_OPTIONS.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {option}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="absence-note">Notiz</FieldLabel>
            <Input
              id="absence-note"
              placeholder="optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full"
              disabled={saving || !fromDate}
              onClick={() => void add()}
            >
              <Plus data-icon="inline-start" />
              Eintragen
            </Button>
          </div>
          {preview.length > 0 && !impact && (
            <p className="text-xs text-amber-700 sm:col-span-3 dark:text-amber-400">
              Im gewählten Zeitraum {preview.length === 1 ? "ist" : "sind"}{" "}
              {preview.length} {preview.length === 1 ? "Termin" : "Termine"} gebucht —
              nach dem Eintragen können Sie sie übergeben oder absagen.
            </p>
          )}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
