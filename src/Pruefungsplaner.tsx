/* ------------------------------------------------------------------ */
/* Prüfungsplaner — planning view over calendar exam events + students */
/*                                                                     */
/* Reads the same DB-backed sources as /kalendar and /fahrschueler     */
/* (use-calendar-events, use-students); creating/editing/deleting a    */
/* Prüfung goes through the shared calendar-events API, so the         */
/* calendar shows the exact same Termine.                              */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Car,
  CircleDashed,
  GraduationCap,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { EventEditDialog, type EventSaveOptions } from "./components/EventEditDialog.tsx";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  recordExamResult,
  updateCalendarEvent,
  useCalendarEvents,
} from "@/hooks/use-calendar-events";
import { useInstructors, UNASSIGNED_INSTRUCTOR } from "@/hooks/use-instructors";
import { updateStudent, useStudents, type StudentRecord } from "@/hooks/use-students";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import {
  TODAY,
  addDays,
  isSameDay,
  parseISODate,
  toISODate,
  type CalEvent,
} from "@/lib/calendar-data";
import {
  EXAM_EVENT_TYPES,
  examStats,
  examTypeLabel,
  groupExamsByDate,
  rankByReadiness,
  suggestedExamType,
  upcomingExams,
  type ExamEventType,
} from "@/lib/exams";
import type { TheoryStatus } from "@/lib/student-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* Sentinel id for a not-yet-persisted exam event — same trick as the
   calendar's NEW_EVENT_ID, just scoped to this page. */
const NEW_EXAM_ID = "__new_exam_event__";

const HORIZON_DAYS = 60;

const examBadgeClass: Record<ExamEventType, string> = {
  Theorieprüfung: "border-transparent bg-sky-500/10 text-sky-600",
  "Vorstellung zur prakt. Prüfung":
    "border-transparent bg-emerald-500/10 text-emerald-600",
};

const theoryBadgeClass: Record<TheoryStatus, string> = {
  Bereit: "border-transparent bg-emerald-500/10 text-emerald-600",
  "In Prüfung": "border-transparent bg-amber-500/10 text-amber-600",
  Aktiv: "border-transparent bg-sky-500/10 text-sky-600",
  Pausiert: "border-transparent bg-muted text-muted-foreground",
};

const studentName = (student: StudentRecord) =>
  `${student.firstName} ${student.lastName}`.trim();

const dayHeading = (iso: string) => {
  const date = parseISODate(iso);
  const formatted = date.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (isSameDay(date, TODAY)) return `Heute · ${formatted}`;
  if (isSameDay(date, addDays(TODAY, 1))) return `Morgen · ${formatted}`;
  return formatted;
};

/* ------------------------------------------------------------------ */
/* Compact KPI band                                                    */
/* ------------------------------------------------------------------ */

function StatCards({ exams }: { exams: CalEvent[] }) {
  const stats = examStats(exams, toISODate(TODAY));
  const items = [
    {
      label: "Anstehende Theorieprüfungen",
      value: stats.theory,
      hint: `Nächste ${HORIZON_DAYS} Tage`,
    },
    {
      label: "Anstehende praktische Prüfungen",
      value: stats.practical,
      hint: `Nächste ${HORIZON_DAYS} Tage`,
    },
    {
      label: "Prüfungen diese Woche",
      value: stats.thisWeek,
      hint: "Montag bis Sonntag",
    },
    {
      label: "Vorläufige Termine",
      value: stats.tentative,
      hint: "Noch unbestätigt",
    },
  ];

  return (
    <dl className="stagger-in grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/80 shadow-none sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-4 py-3.5">
          <dt className="text-[11px] font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold tracking-[-0.01em] tabular-nums">
            {item.value}
          </dd>
          <p className="mt-1 truncate text-xs text-muted-foreground">{item.hint}</p>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming exam list                                                  */
/* ------------------------------------------------------------------ */

function ExamResultControl({
  result,
  onChange,
}: {
  result: "bestanden" | "nicht_bestanden" | undefined;
  onChange: (result: "bestanden" | "nicht_bestanden" | null) => void;
}) {
  const current = result ?? "offen";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <span
            className={cn(
              "size-2 rounded-full",
              current === "bestanden"
                ? "bg-emerald-500"
                : current === "nicht_bestanden"
                  ? "bg-rose-500"
                  : "bg-muted-foreground/40",
            )}
          />
          {current === "bestanden"
            ? "Bestanden"
            : current === "nicht_bestanden"
              ? "Nicht bestanden"
              : "Offen"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(
          [
            { value: "bestanden" as const, label: "Bestanden", dot: "bg-emerald-500" },
            {
              value: "nicht_bestanden" as const,
              label: "Nicht bestanden",
              dot: "bg-rose-500",
            },
            { value: null, label: "Offen", dot: "bg-muted-foreground/40" },
          ] as const
        ).map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            onSelect={() => onChange(opt.value)}
            className="gap-2"
          >
            <span className={cn("size-2 rounded-full", opt.dot)} />
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExamRow({
  exam,
  onEdit,
  onDelete,
  onResult,
}: {
  exam: CalEvent;
  onEdit: () => void;
  onDelete: () => void;
  onResult: (result: "bestanden" | "nicht_bestanden" | null) => void;
}) {
  const typeLabel = examTypeLabel[exam.type as ExamEventType] ?? exam.type;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted/40">
      <div className="flex min-w-24 flex-col">
        <span className="text-sm font-medium tabular-nums">
          {exam.start}–{exam.end}
        </span>
        <Badge
          variant="outline"
          className={cn("mt-1 w-fit", examBadgeClass[exam.type as ExamEventType])}
        >
          {typeLabel}
        </Badge>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {exam.subtitle || exam.title}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {exam.subtitle && exam.subtitle !== exam.title && (
            <span className="truncate">{exam.title}</span>
          )}
          {exam.location && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3 shrink-0" />
              {exam.location}
            </span>
          )}
          <span className="flex items-center gap-1">
            <User className="size-3 shrink-0" />
            {exam.instructor}
          </span>
        </div>
      </div>

      {exam.tentative && (
        <Badge variant="outline" className="text-muted-foreground">
          <CircleDashed />
          Vorläufig
        </Badge>
      )}

      <ExamResultControl result={exam.examResult} onChange={onResult} />

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Prüfung am ${exam.date} bearbeiten`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          aria-label={`Prüfung am ${exam.date} löschen`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function ExamListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prüfungsreife panel                                                 */
/* ------------------------------------------------------------------ */

function ReadinessPanel({
  students,
  loading,
  onPlan,
}: {
  students: StudentRecord[];
  loading: boolean;
  onPlan: (type: ExamEventType, name: string) => void;
}) {
  const ranked = useMemo(() => rankByReadiness(students), [students]);

  return (
    <Card size="sm" className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="size-4 text-muted-foreground" />
          Prüfungsreife
        </CardTitle>
        <CardDescription>
          Aktive Fahrschüler nach Ausbildungsstand — wer ist bereit für die nächste
          Prüfung?
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))
        ) : ranked.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserCheck />
              </EmptyMedia>
              <EmptyTitle>Keine aktiven Fahrschüler</EmptyTitle>
              <EmptyDescription>
                Sobald Fahrschüler aktiv sind, erscheinen sie hier sortiert nach
                Fortschritt.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          ranked.map((student, index) => {
            const name = studentName(student);
            const examType = suggestedExamType(student);
            return (
              <div key={student.id} className="flex flex-col gap-2">
                {index > 0 && <Separator />}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {name}
                  </span>
                  <Badge variant="outline">Klasse {student.classes}</Badge>
                  <Badge
                    variant="outline"
                    className={theoryBadgeClass[student.theory.status]}
                  >
                    Theorie: {student.theory.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={student.progress}
                    aria-label={`Praxis-Fortschritt von ${name}`}
                    className="flex-1"
                  />
                  <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                    {student.progress}%
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    Theorie {student.theory.progress}% · Prüfung: {student.theory.exam}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onPlan(examType, name)}
                  >
                    <CalendarPlus data-icon="inline-start" />
                    {examTypeLabel[examType]} planen
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Pruefungsplaner() {
  const { events, loading: eventsLoading, refresh } = useCalendarEvents();
  const { students, loading: studentsLoading } = useStudents();
  const { names: instructorOptions } = useInstructors();
  const { vehicleOptions } = useVehicleOptions();
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);

  const todayISO = toISODate(TODAY);
  const exams = useMemo(
    () => upcomingExams(events, todayISO, HORIZON_DAYS),
    [events, todayISO],
  );
  const dayGroups = useMemo(() => groupExamsByDate(exams), [exams]);

  // Same option list the calendar's edit dialog uses.
  const studentOptions = useMemo(
    () =>
      Array.from(new Set(students.map(studentName).filter(Boolean))).toSorted(
        (left, right) => left.localeCompare(right, "de"),
      ),
    [students],
  );

  const openCreateDialog = (type: ExamEventType, student?: string) => {
    // Deferred so the dropdown finishes closing (and clears its body
    // `pointer-events: none`) before the dialog mounts — same trick as
    // the calendar's openNewEventDialog.
    setTimeout(
      () =>
        setEditingEvent({
          id: NEW_EXAM_ID,
          date: todayISO,
          start: "09:00",
          end: "09:45",
          title: examTypeLabel[type],
          subtitle: student,
          location: "TÜV Darmstadt",
          instructor: instructorOptions[0] ?? UNASSIGNED_INSTRUCTOR,
          type,
          tentative: true,
        }),
      0,
    );
  };

  /* Rejections propagate to the dialog, which shows the message and —
     for overlaps / absences — offers "Trotzdem speichern". */
  const handleEventSave = async (
    id: string,
    updates: CalEvent,
    options: EventSaveOptions,
  ) => {
    const { id: _id, ...rest } = updates;
    const payload = { ...rest, allowConflicts: options.allowConflicts === true };
    const saved =
      id === NEW_EXAM_ID
        ? await createCalendarEvent(payload)
        : await updateCalendarEvent(Number(id), payload);
    toast.success(id === NEW_EXAM_ID ? "Prüfung geplant." : "Prüfung aktualisiert.");
    for (const warning of saved.warnings ?? []) toast.warning(warning);
    void refresh();
  };

  const handleEventDelete = (exam: CalEvent) => {
    const label = examTypeLabel[exam.type as ExamEventType] ?? exam.type;
    const confirmed = window.confirm(
      `${label} am ${dayHeading(exam.date)} um ${exam.start} Uhr wirklich löschen?`,
    );
    if (!confirmed) return;

    void deleteCalendarEvent(Number(exam.id))
      .then(() => {
        toast.success("Prüfung gelöscht.");
        void refresh();
      })
      .catch(() => {
        toast.error("Prüfung konnte nicht gelöscht werden.");
        void refresh();
      });
  };

  const handleExamResult = (
    exam: CalEvent,
    result: "bestanden" | "nicht_bestanden" | null,
  ) => {
    void recordExamResult(exam.id, result)
      .then((updated) => {
        void refresh();
        // If a practical exam was just marked bestanden AND has a student,
        // offer to set the license date.
        if (
          result === "bestanden" &&
          updated.type === "Vorstellung zur prakt. Prüfung" &&
          updated.studentId != null
        ) {
          const confirmed = window.confirm(
            "Führerschein-Datum setzen? Datum des Prüfungstermins wird als Ausstellungsdatum gespeichert.",
          );
          if (confirmed) {
            void updateStudent(updated.studentId, { licenseDate: updated.date })
              .then(() => {
                toast.success("Führerschein-Datum gespeichert.");
              })
              .catch(() => {
                toast.error("Führerschein-Datum konnte nicht gespeichert werden.");
              });
          }
        }
      })
      .catch(() => {
        toast.error("Ergebnis konnte nicht gespeichert werden.");
      });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm">
                <Plus data-icon="inline-start" />
                Prüfung planen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {EXAM_EVENT_TYPES.map((type) => (
                <DropdownMenuItem key={type} onSelect={() => openCreateDialog(type)}>
                  {type === "Theorieprüfung" ? <GraduationCap /> : <Car />}
                  {examTypeLabel[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <span className="text-sm font-medium">Prüfungsplaner</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="flex flex-col gap-4 2xl:gap-5">
          <StatCards exams={exams} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 2xl:gap-5">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  Anstehende Prüfungen
                </CardTitle>
                <CardDescription>
                  Theorieprüfungen und Vorstellungen zur praktischen Prüfung der nächsten{" "}
                  {HORIZON_DAYS} Tage.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {eventsLoading ? (
                  <ExamListSkeleton />
                ) : dayGroups.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CalendarX2 />
                      </EmptyMedia>
                      <EmptyTitle>Keine Prüfungen geplant</EmptyTitle>
                      <EmptyDescription>
                        In den nächsten {HORIZON_DAYS} Tagen stehen keine Prüfungen an.
                        Über „Prüfung planen“ legen Sie den ersten Termin an.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="stagger-in flex flex-col gap-4">
                    {dayGroups.map((group) => (
                      <section key={group.date} className="flex flex-col gap-2">
                        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {dayHeading(group.date)}
                        </h3>
                        {group.exams.map((exam) => (
                          <ExamRow
                            key={exam.id}
                            exam={exam}
                            onEdit={() => setEditingEvent(exam)}
                            onDelete={() => handleEventDelete(exam)}
                            onResult={(result) => handleExamResult(exam, result)}
                          />
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <ReadinessPanel
              students={students}
              loading={studentsLoading}
              onPlan={(type, name) => openCreateDialog(type, name)}
            />
          </div>
        </div>
      </div>

      <EventEditDialog
        event={editingEvent}
        open={editingEvent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null);
        }}
        onSave={handleEventSave}
        instructorOptions={instructorOptions}
        studentOptions={studentOptions}
        vehicleOptions={vehicleOptions}
      />
    </div>
  );
}

export default Pruefungsplaner;
