/* ------------------------------------------------------------------ */
/* Theorie-Anwesenheit — who attended which lesson on which date.      */
/* Opened from a group card (/theorie-gruppen) or directly from a      */
/* Theorie Termin in the calendar (group, date and lesson prefilled,   */
/* session linked to the Termin).                                      */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type AttendanceEntry,
  type AttendanceSession,
  fetchAttendance,
  putAttendance,
  type TheoryGroup,
} from "@/hooks/use-theory-groups";
import { toISODate } from "@/lib/calendar-data";
import { theoryLessonOptions } from "@/lib/theory-lessons";
import { formatGermanDate } from "@/lib/working-time";
import { DatePickerField } from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_TOPIC = "__none__";

const WEEKDAY_INDEX: Record<string, number> = {
  Sonntag: 0,
  Montag: 1,
  Dienstag: 2,
  Mittwoch: 3,
  Donnerstag: 4,
  Freitag: 5,
  Samstag: 6,
};

/** Today or the most recent past occurrence of the group's weekday (local date). */
export function lastOccurrence(weekday: string, today = new Date()): string {
  const target = WEEKDAY_INDEX[weekday] ?? 1;
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - ((date.getDay() - target + 7) % 7));
  return toISODate(date);
}

const presentMap = (group: TheoryGroup, session?: AttendanceSession) => {
  const map: Record<number, boolean> = {};
  if (session) for (const entry of session.entries) map[entry.studentId] = entry.attended;
  else for (const member of group.members) map[member.id] = true;
  return map;
};

export type AttendancePrefill = {
  groupId?: number;
  date?: string;
  topic?: string;
  /** Theorie Termin the session is recorded from. */
  eventId?: number;
  /** Shown in the description, e.g. the Termin title. */
  label?: string;
};

export function AttendanceDialog({
  groups,
  prefill,
  open,
  onOpenChange,
}: {
  /** Selectable groups; with one group the picker is hidden. */
  groups: TheoryGroup[];
  prefill?: AttendancePrefill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sessionDate, setSessionDate] = useState("");
  const [topic, setTopic] = useState("");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const group = groups.find((candidate) => candidate.id === groupId) ?? null;

  // Pick the group once per opening.
  useEffect(() => {
    if (!open) return;
    setGroupId(prefill?.groupId ?? groups[0]?.id ?? null);
  }, [open, prefill?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the group's sessions and prefill date / topic / checkboxes.
  useEffect(() => {
    if (!open || !group) {
      setSessions([]);
      setChecked({});
      return;
    }
    const date = prefill?.date ?? lastOccurrence(group.weekday);
    setSessionDate(date);
    setTopic(prefill?.topic ?? "");
    setLoading(true);
    let active = true;
    fetchAttendance(group.id)
      .then((fetched) => {
        if (!active) return;
        setSessions(fetched);
        const existing = fetched.find((session) => session.sessionDate === date);
        setChecked(presentMap(group, existing));
        if (existing?.topic) setTopic(existing.topic);
      })
      .catch(() => toast.error("Anwesenheit konnte nicht geladen werden."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lessonOptions = useMemo(() => theoryLessonOptions(group?.klass ?? "B"), [group]);

  const changeDate = (date: string) => {
    setSessionDate(date);
    if (!group) return;
    const existing = sessions.find((session) => session.sessionDate === date);
    setChecked(presentMap(group, existing));
    setTopic(existing?.topic ?? "");
  };

  const save = async () => {
    if (!group || !sessionDate) return;
    setBusy(true);
    try {
      const entries: AttendanceEntry[] = group.members.map((member) => ({
        studentId: member.id,
        attended: checked[member.id] ?? false,
      }));
      const linkEvent = prefill?.eventId != null && sessionDate === prefill.date;
      const updated = await putAttendance(group.id, sessionDate, entries, {
        topic,
        ...(linkEvent ? { eventId: prefill!.eventId } : {}),
      });
      setSessions(updated);
      toast.success(
        `Anwesenheit gespeichert${topic ? ` (${topic})` : ""}: ${
          entries.filter((entry) => entry.attended).length
        } von ${entries.length} anwesend.`,
      );
      if (prefill?.eventId != null) onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Anwesenheit konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const countByMember: Record<number, number> = {};
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.attended) {
        countByMember[entry.studentId] = (countByMember[entry.studentId] ?? 0) + 1;
      }
    }
  }
  const recent = sessions.slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Anwesenheit erfassen</DialogTitle>
          <DialogDescription>
            {prefill?.label ?? group?.name ?? "Theorie-Gruppe wählen"}
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine Theorie-Gruppe vorhanden. Legen Sie zuerst unter „Theorie Gruppen“ eine
            Gruppe an.
          </p>
        ) : (
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {groups.length > 1 && (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="attendance-group">Gruppe</FieldLabel>
                <Select
                  value={groupId != null ? String(groupId) : undefined}
                  onValueChange={(value) => setGroupId(Number(value))}
                >
                  <SelectTrigger id="attendance-group" className="w-full">
                    <SelectValue placeholder="Gruppe wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {groups.map((candidate) => (
                        <SelectItem key={candidate.id} value={String(candidate.id)}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="attendance-date">Datum</FieldLabel>
              <DatePickerField
                id="attendance-date"
                value={sessionDate}
                onChange={changeDate}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="attendance-topic">Lektion</FieldLabel>
              <Select
                value={topic || NO_TOPIC}
                onValueChange={(value) => setTopic(value === NO_TOPIC ? "" : value)}
              >
                <SelectTrigger id="attendance-topic" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_TOPIC}>Keine Angabe</SelectItem>
                    {(topic && !lessonOptions.includes(topic)
                      ? [topic, ...lessonOptions]
                      : lessonOptions
                    ).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <div className="sm:col-span-2">
              {loading ? (
                <p className="text-sm text-muted-foreground">Lade Anwesenheit…</p>
              ) : !group || group.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine Teilnehmer in dieser Gruppe.
                </p>
              ) : (
                <ul className="flex max-h-64 flex-col divide-y overflow-auto rounded-md border">
                  {group.members.map((member) => (
                    <li
                      key={member.id}
                      className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <label className="flex min-w-0 cursor-pointer items-center gap-3 text-sm">
                        <Checkbox
                          checked={checked[member.id] ?? false}
                          onCheckedChange={(value) =>
                            setChecked((prev) => ({
                              ...prev,
                              [member.id]: value === true,
                            }))
                          }
                        />
                        <span className="truncate">{member.name}</span>
                      </label>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {countByMember[member.id] ?? 0} Einheiten
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {recent.length > 0 && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Zuletzt erfasst
                </span>
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground tabular-nums">
                  {recent.map((session) => (
                    <li key={session.sessionDate}>
                      {formatGermanDate(session.sessionDate)} ·{" "}
                      {session.topic || "ohne Lektion"} ·{" "}
                      {session.entries.filter((entry) => entry.attended).length}/
                      {session.entries.length} anwesend
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </FieldGroup>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Schließen
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={
              busy || loading || !group || group.members.length === 0 || !sessionDate
            }
            onClick={() => void save()}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
