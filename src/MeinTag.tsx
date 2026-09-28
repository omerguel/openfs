/* ------------------------------------------------------------------ */
/* Mein Tag — the instructor's lessons today and tomorrow, phone first */
/*                                                                     */
/* The logged-in user's linked Fahrlehrer/in (users.instructor_id);    */
/* office users pick an instructor. Each lesson: student + phone,      */
/* Abholort / note, Fahrtart, and the actions an instructor needs in   */
/* the car: Nachweis erfassen (content + signature), Notiz, Absagen.   */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Ban,
  CalendarDays,
  Car,
  CircleCheck,
  ClipboardList,
  MapPin,
  Phone,
  StickyNote,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { LESSON_KIND_BADGE } from "./components/CalendarEventCard.tsx";
import { CancelEventDialog } from "./components/CancelEventDialog.tsx";
import { NachweisDialog } from "./components/NachweisDialog.tsx";
import {
  AttendanceDialog,
  type AttendancePrefill,
} from "./components/theorie/AttendanceDialog.tsx";
import { fetchAttestationsForStudent } from "@/hooks/use-ausbildungsnachweis";
import { useAuthStatus } from "@/hooks/use-auth";
import { updateCalendarEvent, useCalendarEvents } from "@/hooks/use-calendar-events";
import { instructorName, useInstructors } from "@/hooks/use-instructors";
import { useStudents } from "@/hooks/use-students";
import { useTheoryGroups } from "@/hooks/use-theory-groups";
import {
  addDays,
  type CalEvent,
  parseISODate,
  toISODate,
  toMinutes,
} from "@/lib/calendar-data";
import { CANCELLATION_KIND_LABELS } from "@/lib/cancellation";
import { formatDuration } from "@/lib/scheduling";
import { theoryLessonFromTitle } from "@/lib/theory-lessons";
import { formatGermanDate, PRACTICAL_EVENT_TYPES } from "@/lib/working-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type DayKey = "heute" | "morgen";

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function NoteDialog({
  event,
  onClose,
  onSaved,
}: {
  event: CalEvent | null;
  onClose: () => void;
  onSaved: (event: CalEvent) => void;
}) {
  const [text, setText] = useState(event?.notes ?? "");
  const [saving, setSaving] = useState(false);
  if (!event) return null;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updateCalendarEvent(Number(event.id), { notes: text.trim() });
      toast.success("Notiz gespeichert.");
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notiz zur Fahrstunde</DialogTitle>
          <DialogDescription>
            {event.subtitle || event.title} · {event.start}–{event.end}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Notiz"
          rows={4}
          maxLength={2000}
          autoFocus
          placeholder="z. B. Abholung am Bahnhof, nächstes Mal Autobahn üben"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Speichert…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LessonCard({
  event,
  phone,
  attested,
  isNext,
  onAttest,
  onAttendance,
  onNote,
  onCancel,
}: {
  event: CalEvent;
  phone?: string;
  attested: boolean;
  isNext: boolean;
  onAttest: () => void;
  onAttendance: () => void;
  onNote: () => void;
  onCancel: () => void;
}) {
  const cancelled = Boolean(event.cancelledAt);
  const personal = event.type !== "Theorie" && event.type !== "Andere";
  const primary = (personal && event.subtitle) || event.title;
  const kind = event.lessonKind ? LESSON_KIND_BADGE[event.lessonKind] : undefined;
  const duration = toMinutes(event.end) - toMinutes(event.start);
  const practical = event.type === "Praktisch";

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-background p-3",
        isNext && "border-primary/50 ring-1 ring-primary/20",
        cancelled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex w-14 shrink-0 flex-col tabular-nums">
          <span className="text-[15px] font-semibold">{event.start}</span>
          <span className="text-xs text-muted-foreground">{event.end}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn("text-[15px] font-semibold", cancelled && "line-through")}
            >
              {primary}
            </span>
            {isNext && !cancelled && (
              <span className="text-xs font-medium text-primary">Als Nächstes</span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {kind ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <kind.Icon className="size-3.5" />
                {event.lessonKind}
              </span>
            ) : (
              <span>{personal && event.subtitle ? event.title : event.type}</span>
            )}
            <span className="tabular-nums">{formatDuration(duration)}</span>
            {event.vehicle && (
              <span className="inline-flex items-center gap-1">
                <Car className="size-3.5" />
                {event.vehicle}
              </span>
            )}
          </p>
          {event.location && (
            <p className="mt-1 flex items-start gap-1 text-sm">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {event.location}
            </p>
          )}
          {event.notes && (
            <p className="mt-1 flex items-start gap-1 text-sm text-pretty whitespace-pre-line">
              <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {event.notes}
            </p>
          )}
          {cancelled && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-destructive">
              <Ban className="size-3.5" />
              {CANCELLATION_KIND_LABELS[event.cancellationKind ?? "abgesagt"]}
            </p>
          )}
          {attested && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
              <CircleCheck className="size-3.5" />
              Durchgeführt · Nachweis erfasst
            </p>
          )}
        </div>
      </div>

      {!cancelled && (
        <div className="grid grid-cols-2 gap-2">
          {phone && (
            <Button variant="outline" className="h-10" asChild>
              <a href={telHref(phone)} aria-label={`${primary} anrufen: ${phone}`}>
                <Phone data-icon="inline-start" />
                Anrufen
              </a>
            </Button>
          )}
          {practical && !attested && event.studentId != null && (
            <Button className="h-10" onClick={onAttest}>
              <ClipboardList data-icon="inline-start" />
              Nachweis erfassen
            </Button>
          )}
          {event.type === "Theorie" && (
            <Button className="h-10" onClick={onAttendance}>
              <Users data-icon="inline-start" />
              Anwesenheit
            </Button>
          )}
          <Button variant="outline" className="h-10" onClick={onNote}>
            <StickyNote data-icon="inline-start" />
            Notiz
          </Button>
          {!attested && (
            <Button variant="outline" className="h-10" onClick={onCancel}>
              <Ban data-icon="inline-start" />
              Absagen
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function MeinTag() {
  const { data: auth } = useAuthStatus();
  const { instructors, loading: instructorsLoading } = useInstructors();
  const { events, loading: eventsLoading, refresh } = useCalendarEvents();
  const { students } = useStudents();
  const { groups } = useTheoryGroups();
  const [day, setDay] = useState<DayKey>("heute");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [attestTarget, setAttestTarget] = useState<CalEvent | null>(null);
  const [noteTarget, setNoteTarget] = useState<CalEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CalEvent | null>(null);
  const [attendance, setAttendance] = useState<AttendancePrefill | null>(null);

  const linkedId = auth?.user?.instructorId ?? null;
  const isInstructorRole = auth?.user?.role === "fahrlehrer";
  const activeInstructors = instructors.filter((item) => item.status === "aktiv");
  const instructorId = linkedId ?? pickedId ?? activeInstructors[0]?.id ?? null;
  const instructor = instructors.find((item) => item.id === instructorId) ?? null;

  const [now] = useState(() => new Date());
  const today = toISODate(now);
  const tomorrow = toISODate(addDays(now, 1));
  const date = day === "heute" ? today : tomorrow;

  const mine = useMemo(
    () =>
      events.filter(
        (event) => instructorId != null && event.instructorId === instructorId,
      ),
    [events, instructorId],
  );
  const byDay = (iso: string) =>
    mine
      .filter((event) => event.date === iso)
      .toSorted((a, b) => a.start.localeCompare(b.start));
  const lessons = byDay(date);
  const countFor = (iso: string) =>
    byDay(iso).filter((event) => !event.cancelledAt).length;

  const phoneById = useMemo(
    () => new Map(students.map((student) => [student.id, student.phone])),
    [students],
  );

  const attestable = lessons.filter(
    (event) =>
      event.type === "Praktisch" && event.studentId != null && !event.cancelledAt,
  );
  // One request per student of the day (not per lesson) — the per-event
  // endpoint answers 404 for lessons without a Nachweis.
  const studentIds = [...new Set(attestable.map((event) => event.studentId!))].sort();
  const attestations = useQuery({
    queryKey: ["attestations-for", studentIds.join(",")],
    queryFn: async () => {
      const lists = await Promise.all(studentIds.map(fetchAttestationsForStudent));
      return new Set(lists.flat().map((attestation) => String(attestation.eventId)));
    },
    enabled: studentIds.length > 0,
  });
  const attested = attestations.data ?? new Set<string>();

  const practicalMinutes = lessons
    .filter((event) => !event.cancelledAt && PRACTICAL_EVENT_TYPES.includes(event.type))
    .reduce((sum, event) => sum + toMinutes(event.end) - toMinutes(event.start), 0);
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nextId =
    day === "heute"
      ? lessons.find((event) => !event.cancelledAt && event.end > nowTime)?.id
      : undefined;

  const openAttendance = (event: CalEvent) => {
    const weekday = parseISODate(event.date).toLocaleDateString("de-DE", {
      weekday: "long",
    });
    const own = groups.filter((group) => group.instructorId === event.instructorId);
    const group =
      own.find((g) => g.weekday === weekday && g.time === event.start) ?? own[0];
    setAttendance({
      groupId: group?.id,
      date: event.date,
      topic: theoryLessonFromTitle(event.title) ?? undefined,
      eventId: Number(event.id),
      label: `${event.title} · ${formatGermanDate(event.date)} ${event.start}`,
    });
  };

  const dateLabel = parseISODate(date).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const loading = eventsLoading || instructorsLoading;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/kalender">
              <CalendarDays data-icon="inline-start" />
              <span className="hidden sm:inline">Kalender</span>
            </Link>
          </Button>
        }
      >
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
          Mein Tag
        </h1>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={day}
              onValueChange={(value) => {
                if (value) setDay(value as DayKey);
              }}
              variant="outline"
              spacing={0}
              aria-label="Tag"
            >
              <ToggleGroupItem value="heute" className="px-4">
                Heute
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {countFor(today)}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="morgen" className="px-4">
                Morgen
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {countFor(tomorrow)}
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
            {linkedId == null && !isInstructorRole && activeInstructors.length > 0 && (
              <NativeSelect
                aria-label="Fahrlehrer/in"
                className="ml-auto w-48"
                value={instructorId != null ? String(instructorId) : ""}
                onChange={(e) => setPickedId(Number(e.target.value))}
              >
                {activeInstructors.map((item) => (
                  <NativeSelectOption key={item.id} value={String(item.id)}>
                    {instructorName(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>

          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] capitalize">
              {dateLabel}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {instructor ? instructorName(instructor) : "—"} · {countFor(date)}{" "}
              {countFor(date) === 1 ? "Termin" : "Termine"}
              {practicalMinutes > 0 && ` · ${formatDuration(practicalMinutes)} Praxis`}
            </p>
          </div>

          {isInstructorRole && linkedId == null ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Kein Fahrlehrer-Profil verknüpft</EmptyTitle>
                <EmptyDescription>
                  Ihr Benutzerkonto ist noch keinem Fahrlehrer zugeordnet. Bitte wenden
                  Sie sich an das Büro (Benutzer verwalten).
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : lessons.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Keine Termine</EmptyTitle>
                <EmptyDescription>
                  {day === "heute" ? "Heute" : "Morgen"} sind keine Termine eingeplant.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {lessons.map((event) => (
                <LessonCard
                  key={event.id}
                  event={event}
                  phone={
                    event.studentId != null ? phoneById.get(event.studentId) : undefined
                  }
                  attested={attested.has(event.id)}
                  isNext={event.id === nextId}
                  onAttest={() => setAttestTarget(event)}
                  onAttendance={() => openAttendance(event)}
                  onNote={() => setNoteTarget(event)}
                  onCancel={() => setCancelTarget(event)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <NachweisDialog
        event={attestTarget}
        studentId={attestTarget?.studentId}
        onClose={() => setAttestTarget(null)}
        onSaved={() => void attestations.refetch()}
      />
      {noteTarget && (
        <NoteDialog
          key={noteTarget.id}
          event={noteTarget}
          onClose={() => setNoteTarget(null)}
          onSaved={() => void refresh()}
        />
      )}
      <CancelEventDialog
        event={cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onCancelled={() => void refresh()}
      />
      <AttendanceDialog
        groups={groups}
        prefill={attendance ?? undefined}
        open={attendance !== null}
        onOpenChange={(open) => {
          if (!open) setAttendance(null);
        }}
      />
    </div>
  );
}

export default MeinTag;
