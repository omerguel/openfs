import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  GraduationCap,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { panelActionsClass, panelInteractiveClass } from "./components/Panel.tsx";
import { useInstructors } from "@/hooks/use-instructors";
import { useStudents } from "@/hooks/use-students";
import {
  useTheoryGroups,
  createTheoryGroup,
  updateTheoryGroup,
  deleteTheoryGroup,
  fetchAttendance,
  putAttendance,
  type AttendanceEntry,
  type AttendanceSession,
  type TheoryGroup,
  type TheoryGroupInput,
  type TheoryGroupStatus,
} from "@/hooks/use-theory-groups";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const WEEKDAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const CLASS_OPTIONS = ["A", "A1", "B", "B197", "BE"] as const;

/* ------------------------------------------------------------------ */
/* Create/Edit dialog                                                  */
/* ------------------------------------------------------------------ */

type GroupDraft = {
  name: string;
  klass: string;
  weekday: string;
  time: string;
  room: string;
  instructor: string;
  capacity: string;
  status: TheoryGroupStatus;
};

function createEmptyDraft(): GroupDraft {
  return {
    name: "",
    klass: "B",
    weekday: "Montag",
    time: "18:00",
    room: "",
    instructor: "Nicht zugeteilt",
    capacity: "20",
    status: "aktiv",
  };
}

function groupToDraft(group: TheoryGroup): GroupDraft {
  return {
    name: group.name,
    klass: group.klass,
    weekday: group.weekday,
    time: group.time,
    room: group.room,
    instructor: group.instructor,
    capacity: String(group.capacity),
    status: group.status,
  };
}

function draftToPayload(draft: GroupDraft): Partial<TheoryGroupInput> {
  return {
    name: draft.name,
    klass: draft.klass,
    weekday: draft.weekday,
    time: draft.time,
    room: draft.room,
    instructor: draft.instructor,
    capacity: Number(draft.capacity),
    status: draft.status,
  };
}

function GroupEditDialog({
  group,
  open,
  onOpenChange,
  onSave,
  instructorOptions,
  mode,
}: {
  group: TheoryGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Partial<TheoryGroupInput>) => Promise<void>;
  instructorOptions: string[];
  mode: "create" | "edit";
}) {
  const [draft, setDraft] = useState<GroupDraft | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }
    setDraft(group ? groupToDraft(group) : createEmptyDraft());
  }, [open, group?.id]);

  function update<Key extends keyof GroupDraft>(key: Key, value: GroupDraft[Key]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  if (!draft) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Gruppe hinzufügen" : "Gruppe bearbeiten"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Neue Theorie-Gruppe anlegen."
              : "Termin, Raum, Fahrlehrer/in und Kapazität aktualisieren."}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="group-name">Name</FieldLabel>
            <Input
              id="group-name"
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-class">Klasse</FieldLabel>
            <Select value={draft.klass} onValueChange={(value) => update("klass", value)}>
              <SelectTrigger id="group-class" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(CLASS_OPTIONS.includes(draft.klass as never)
                    ? [...CLASS_OPTIONS]
                    : [draft.klass, ...CLASS_OPTIONS]
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
            <FieldLabel htmlFor="group-weekday">Wochentag</FieldLabel>
            <Select
              value={draft.weekday}
              onValueChange={(value) => update("weekday", value)}
            >
              <SelectTrigger id="group-weekday" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {WEEKDAYS.map((weekday) => (
                    <SelectItem key={weekday} value={weekday}>
                      {weekday}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="group-time">Uhrzeit</FieldLabel>
            <Input
              id="group-time"
              type="time"
              value={draft.time}
              onChange={(event) => update("time", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-room">Raum</FieldLabel>
            <Input
              id="group-room"
              value={draft.room}
              placeholder="z. B. Schulungsraum 1"
              onChange={(event) => update("room", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-instructor">Fahrlehrer/in</FieldLabel>
            <Select
              value={draft.instructor}
              onValueChange={(value) => update("instructor", value)}
            >
              <SelectTrigger id="group-instructor" className="w-full">
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
            <FieldLabel htmlFor="group-capacity">Kapazität</FieldLabel>
            <Input
              id="group-capacity"
              type="number"
              min={1}
              value={draft.capacity}
              onChange={(event) => update("capacity", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-status">Status</FieldLabel>
            <Select
              value={draft.status}
              onValueChange={(value) => update("status", value as TheoryGroupStatus)}
            >
              <SelectTrigger id="group-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="aktiv">Aktiv</SelectItem>
                  <SelectItem value="abgeschlossen">Abgeschlossen</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={async () => {
              try {
                await onSave(draftToPayload(draft));
                onOpenChange(false);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Gruppe konnte nicht gespeichert werden.",
                );
              }
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Manage members dialog                                               */
/* ------------------------------------------------------------------ */

function MembersDialog({
  group,
  students,
  open,
  onOpenChange,
  onChangeMembers,
}: {
  group: TheoryGroup | null;
  students: { id: number; firstName: string; lastName: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeMembers: (group: TheoryGroup, nextIds: number[]) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setSelectedId("");
  }, [open, group?.id]);

  const availableStudents = useMemo(() => {
    if (!group) return [];
    const memberIds = new Set(group.studentIds);
    return students.filter((student) => !memberIds.has(student.id));
  }, [group, students]);

  if (!group) {
    return null;
  }

  const occupied = group.members.length;
  const isFull = group.studentIds.length >= group.capacity;

  async function change(nextIds: number[], successMessage: string) {
    if (!group) return;
    setBusy(true);
    try {
      await onChangeMembers(group, nextIds);
      setSelectedId("");
      toast.success(successMessage);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Teilnehmerliste konnte nicht aktualisiert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Teilnehmer verwalten</DialogTitle>
          <DialogDescription>
            {group.name} · {occupied} von {group.capacity} Plätzen belegt
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="member-select">Fahrschüler/in hinzufügen</FieldLabel>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
                disabled={isFull || availableStudents.length === 0}
              >
                <SelectTrigger id="member-select" className="w-full">
                  <SelectValue
                    placeholder={
                      isFull
                        ? "Gruppe ist voll"
                        : availableStudents.length === 0
                          ? "Keine weiteren Fahrschüler"
                          : "Fahrschüler/in wählen"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {availableStudents.map((student) => (
                      <SelectItem key={student.id} value={String(student.id)}>
                        {student.firstName} {student.lastName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Button
              type="button"
              disabled={busy || isFull || selectedId === ""}
              onClick={() =>
                void change(
                  [...group.studentIds, Number(selectedId)],
                  "Teilnehmer/in hinzugefügt.",
                )
              }
            >
              <UserPlus data-icon="inline-start" />
              Hinzufügen
            </Button>
          </div>

          <Separator />

          {group.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Teilnehmer in dieser Gruppe.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
              {group.members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                >
                  <span className="truncate text-sm font-medium">{member.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`${member.name} entfernen`}
                    disabled={busy}
                    onClick={() =>
                      void change(
                        group.studentIds.filter((id) => id !== member.id),
                        "Teilnehmer/in entfernt.",
                      )
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Schließen
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance helpers                                                  */
/* ------------------------------------------------------------------ */

const WEEKDAY_ISO: Record<string, number> = {
  Montag: 1,
  Dienstag: 2,
  Mittwoch: 3,
  Donnerstag: 4,
  Freitag: 5,
  Samstag: 6,
  Sonntag: 0,
};

/** Returns the ISO "YYYY-MM-DD" of today or the most recent past occurrence
 *  of the given weekday name (German). */
function lastOccurrence(weekday: string): string {
  const targetDow = WEEKDAY_ISO[weekday] ?? 1;
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun…6=Sat
  const diff = (todayDow - targetDow + 7) % 7;
  const date = new Date(today);
  date.setDate(today.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Attendance dialog                                                   */
/* ------------------------------------------------------------------ */

function AttendanceDialog({
  group,
  open,
  onOpenChange,
}: {
  group: TheoryGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [sessionDate, setSessionDate] = useState<string>("");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load attendance whenever the dialog opens for a group
  useEffect(() => {
    if (!open || !group) {
      setSessions([]);
      setChecked({});
      return;
    }

    const defaultDate = lastOccurrence(group.weekday);
    setSessionDate(defaultDate);

    setLoading(true);
    fetchAttendance(group.id)
      .then((fetched) => {
        setSessions(fetched);
        // Pre-fill the checkboxes from the most recent session for this date
        const existing = fetched.find((s) => s.sessionDate === defaultDate);
        if (existing) {
          const map: Record<number, boolean> = {};
          for (const e of existing.entries) map[e.studentId] = e.attended;
          setChecked(map);
        } else {
          // Default: all members checked (present)
          const map: Record<number, boolean> = {};
          for (const m of group.members) map[m.id] = true;
          setChecked(map);
        }
      })
      .catch(() => toast.error("Anwesenheit konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [open, group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the date changes, re-populate checkboxes from existing session data
  function handleDateChange(date: string) {
    setSessionDate(date);
    if (!group) return;
    const existing = sessions.find((s) => s.sessionDate === date);
    if (existing) {
      const map: Record<number, boolean> = {};
      for (const e of existing.entries) map[e.studentId] = e.attended;
      setChecked(map);
    } else {
      const map: Record<number, boolean> = {};
      for (const m of group.members) map[m.id] = true;
      setChecked(map);
    }
  }

  async function save() {
    if (!group || !sessionDate) return;
    setBusy(true);
    try {
      const entries: AttendanceEntry[] = group.members.map((m) => ({
        studentId: m.id,
        attended: checked[m.id] ?? false,
      }));
      const updated = await putAttendance(group.id, sessionDate, entries);
      setSessions(updated);
      toast.success("Anwesenheit gespeichert.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Anwesenheit konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!group) return null;

  // Build per-member attended counts from all sessions
  const countByMember: Record<number, number> = {};
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.attended) {
        countByMember[entry.studentId] = (countByMember[entry.studentId] ?? 0) + 1;
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Anwesenheit</DialogTitle>
          <DialogDescription>{group.name}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="attendance-date">Datum</FieldLabel>
            <Input
              id="attendance-date"
              type="date"
              value={sessionDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </Field>

          <Separator />

          {loading ? (
            <p className="text-sm text-muted-foreground">Lade Anwesenheit…</p>
          ) : group.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Teilnehmer in dieser Gruppe.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
              {group.members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      id={`attendance-${member.id}`}
                      checked={checked[member.id] ?? false}
                      onCheckedChange={(value) =>
                        setChecked((prev) => ({ ...prev, [member.id]: !!value }))
                      }
                    />
                    <label
                      htmlFor={`attendance-${member.id}`}
                      className="truncate text-sm font-medium cursor-pointer"
                    >
                      {member.name}
                    </label>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {countByMember[member.id] ?? 0}{" "}
                    {(countByMember[member.id] ?? 0) === 1 ? "Einheit" : "Einheiten"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Schließen
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={busy || loading || group.members.length === 0 || !sessionDate}
            onClick={() => void save()}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Group card                                                          */
/* ------------------------------------------------------------------ */

const STATUS_DOTS: Record<TheoryGroupStatus, string> = {
  aktiv: "bg-green-500",
  abgeschlossen: "bg-muted-foreground/50",
};

const STATUS_LABELS: Record<TheoryGroupStatus, string> = {
  aktiv: "Aktiv",
  abgeschlossen: "Abgeschlossen",
};

/* Status as a colored dot + plain label in an outline badge (guideline §3). */
function StatusBadge({ status }: { status: TheoryGroupStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOTS[status])} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/* Quiet readout: micro-label over value, no icon chips (guideline §3, §5). */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-medium leading-none text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

function GroupCard({
  group,
  onEdit,
  onMembers,
  onAttendance,
  onDelete,
}: {
  group: TheoryGroup;
  onEdit: () => void;
  onMembers: () => void;
  onAttendance: () => void;
  onDelete: () => void;
}) {
  const occupied = group.members.length;
  const percent =
    group.capacity > 0 ? Math.min(100, Math.round((occupied / group.capacity) * 100)) : 0;

  return (
    <Card className={cn("border-border/70", panelInteractiveClass)}>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="truncate text-sm font-semibold">{group.name}</CardTitle>
          <CardDescription className="text-xs">
            {group.weekday}, {group.time} Uhr
          </CardDescription>
        </div>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <div className={cn("flex items-center", panelActionsClass)}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${group.name} bearbeiten`}
                onClick={onEdit}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`${group.name} löschen`}
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            </div>
            <StatusBadge status={group.status} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit font-normal text-muted-foreground">
          Klasse {group.klass}
        </Badge>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5">
          <Detail label="Raum" value={group.room || "Kein Raum"} />
          <Detail label="Fahrlehrer/in" value={group.instructor} />
        </dl>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Belegung</span>
            <span className="tabular-nums">
              {occupied}/{group.capacity}
            </span>
          </div>
          <Progress value={percent} className="h-1.5" />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onMembers}>
            <Users data-icon="inline-start" />
            Teilnehmer verwalten
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onAttendance}
          >
            <CheckSquare data-icon="inline-start" />
            Anwesenheit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function TheorieGruppen() {
  const { groups, loading, refresh } = useTheoryGroups();
  const { assignableNames: instructorOptions } = useInstructors();
  const { students } = useStudents();

  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [membersGroupId, setMembersGroupId] = useState<number | null>(null);
  const [attendanceGroupId, setAttendanceGroupId] = useState<number | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<number | null>(null);

  const editingMode: "create" | "edit" = isCreateOpen ? "create" : "edit";
  const editingGroup = isCreateOpen
    ? null
    : (groups.find((group) => group.id === editingGroupId) ?? null);
  const isEditDialogOpen = isCreateOpen || editingGroup !== null;
  const membersGroup = groups.find((group) => group.id === membersGroupId) ?? null;
  const attendanceGroup = groups.find((group) => group.id === attendanceGroupId) ?? null;
  const deleteGroup = groups.find((group) => group.id === deleteGroupId) ?? null;

  async function saveGroup(payload: Partial<TheoryGroupInput>) {
    if (editingMode === "create") {
      await createTheoryGroup(payload);
      toast.success("Gruppe angelegt.");
    } else if (editingGroupId !== null) {
      await updateTheoryGroup(editingGroupId, payload);
      toast.success("Gruppe gespeichert.");
    } else {
      return;
    }
    await refresh();
    setEditingGroupId(null);
    setIsCreateOpen(false);
  }

  async function changeMembers(group: TheoryGroup, nextIds: number[]) {
    await updateTheoryGroup(group.id, { studentIds: nextIds });
    await refresh();
  }

  async function confirmDelete() {
    if (deleteGroup === null) return;
    try {
      await deleteTheoryGroup(deleteGroup.id);
      await refresh();
      toast.success("Gruppe gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteGroupId(null);
      if (editingGroupId === deleteGroup.id) setEditingGroupId(null);
      if (membersGroupId === deleteGroup.id) setMembersGroupId(null);
    }
  }

  // DB-backed list — same students/instructors sources as the other pages.
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingGroupId(null);
              setIsCreateOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            Gruppe hinzufügen
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:gap-5">
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-72 rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
            <GraduationCap className="size-5" />
            <span className="text-sm">Noch keine Theorie-Gruppen angelegt.</span>
          </div>
        ) : (
          <div className="stagger-in grid gap-4 md:grid-cols-2 2xl:gap-5">
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onEdit={() => {
                  setIsCreateOpen(false);
                  setEditingGroupId(group.id);
                }}
                onMembers={() => setMembersGroupId(group.id)}
                onAttendance={() => setAttendanceGroupId(group.id)}
                onDelete={() => setDeleteGroupId(group.id)}
              />
            ))}
          </div>
        )}
      </div>

      <GroupEditDialog
        group={editingGroup}
        instructorOptions={instructorOptions}
        mode={editingMode}
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditingGroupId(null);
            setIsCreateOpen(false);
          }
        }}
        onSave={saveGroup}
      />

      <MembersDialog
        group={membersGroup}
        students={students}
        open={membersGroup !== null}
        onOpenChange={(open) => {
          if (!open) setMembersGroupId(null);
        }}
        onChangeMembers={changeMembers}
      />

      <AttendanceDialog
        group={attendanceGroup}
        open={attendanceGroup !== null}
        onOpenChange={(open) => {
          if (!open) setAttendanceGroupId(null);
        }}
      />

      <AlertDialog
        open={deleteGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gruppe löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{deleteGroup?.name}“ wird dauerhaft gelöscht. Die Fahrschüler selbst
              bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TheorieGruppen;
