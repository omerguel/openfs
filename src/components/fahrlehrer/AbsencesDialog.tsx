/* ------------------------------------------------------------------ */
/* Abwesenheiten of one instructor — list, add, delete. Termine on     */
/* these days are blocked in the calendar (server-side check).         */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ABSENCE_KIND_OPTIONS,
  type AbsenceKind,
  createAbsence,
  deleteAbsence,
  useAbsences,
} from "@/hooks/use-absences";
import { type Instructor, instructorName } from "@/hooks/use-instructors";
import { toISODate } from "@/lib/calendar-data";
import { formatGermanDate } from "@/lib/working-time";
import { Button } from "@/components/ui/button";
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

  const { data: absences = [], isPending } = useAbsences({
    instructorId: instructor.id,
  });

  const name = instructorName(instructor);

  // Absences feed the Kalendar banner and conflict count as well.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["absences"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar-conflicts"] }),
    ]);

  const add = async () => {
    setSaving(true);
    try {
      await createAbsence({
        instructorId: instructor.id,
        fromDate,
        toDate: toDate || fromDate,
        kind,
        note,
      });
      await invalidate();
      setNote("");
      toast.success("Abwesenheit eingetragen.");
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Abwesenheiten · {name}</DialogTitle>
          <DialogDescription>
            An diesen Tagen können keine Termine für {name} eingeplant werden.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border">
          {isPending ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Lädt…</p>
          ) : absences.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Keine Abwesenheiten eingetragen.
            </p>
          ) : (
            <ul className="max-h-60 divide-y overflow-y-auto">
              {absences.map((absence) => (
                <li
                  key={absence.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="w-44 shrink-0 tabular-nums">
                    {absence.fromDate === absence.toDate
                      ? formatGermanDate(absence.fromDate)
                      : `${formatGermanDate(absence.fromDate)} – ${formatGermanDate(absence.toDate)}`}
                  </span>
                  <span className="font-medium">{absence.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {absence.note}
                  </span>
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

        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="absence-from">Von</FieldLabel>
            <Input
              id="absence-from"
              type="date"
              className="tabular-nums"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (toDate < e.target.value) setToDate(e.target.value);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="absence-to">Bis</FieldLabel>
            <Input
              id="absence-to"
              type="date"
              className="tabular-nums"
              min={fromDate}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
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
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
