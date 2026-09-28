import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Car,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  Clock3,
  GraduationCap,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Repeat,
  Route,
  StickyNote,
  Tag,
  Trash2,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { fetchAttestationsForStudent } from "@/hooks/use-ausbildungsnachweis";
import { CANCELLATION_KIND_LABELS } from "@/lib/cancellation";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { parseISODate, type CalEvent } from "@/lib/calendar-data";
import { cn } from "@/lib/utils";

type CalendarEventInspectorProps = {
  event: CalEvent | null;
  onEdit: (event: CalEvent) => void;
  /** Asks for confirmation before anything is deleted. */
  onDelete: (event: CalEvent) => void;
  onCreate: () => void;
  onClear: () => void;
  /** Absage / Nichterscheinen — opens the cancel dialog. */
  onCancelEvent?: (event: CalEvent) => void;
  onUncancelEvent?: (event: CalEvent) => void;
  /** Delete this and all later occurrences of the event's series. */
  onDeleteFollowing?: (event: CalEvent) => void;
  /** Ausbildungsnachweis for a practical lesson (content + signature). */
  onAttest?: (event: CalEvent) => void;
  /** Theorie-Anwesenheit for a theory Termin. */
  onAttendance?: (event: CalEvent) => void;
  /** Linked student's phone (for the call button). */
  studentPhone?: string;
  /** Conflicts this Termin is part of (overlap / absent instructor). */
  conflicts?: string[];
};

function formatDate(value: string) {
  return parseISODate(value).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* Label above value: the inspector is narrow, a three-column row broke
   words mid-word ("Serientermi n"). */
function DetailRow({
  icon: Icon,
  label,
  children,
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2.5 px-3 py-2">
      <Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground/75" />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
        <dd
          className={cn(
            "text-sm leading-snug text-pretty tabular-nums [overflow-wrap:break-word]",
            muted && "text-muted-foreground",
          )}
        >
          {children}
        </dd>
      </div>
    </div>
  );
}

export function CalendarEventInspector({
  event,
  onEdit,
  onDelete,
  onCreate,
  onClear,
  onCancelEvent,
  onUncancelEvent,
  onDeleteFollowing,
  onAttest,
  onAttendance,
  studentPhone,
  conflicts = [],
}: CalendarEventInspectorProps) {
  // A lesson gets one Nachweis; offering a second one only ends in an error.
  const attestStudentId =
    onAttest && event?.type === "Praktisch" ? (event.studentId ?? null) : null;
  const attestations = useQuery({
    queryKey: ["attestations", "student", attestStudentId],
    queryFn: () => fetchAttestationsForStudent(attestStudentId!),
    enabled: attestStudentId != null,
  });

  if (!event) {
    return (
      <aside
        aria-label="Termindetails"
        className="flex h-full min-h-0 w-full flex-col bg-background"
      >
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <CalendarDays
            aria-hidden="true"
            className="mb-4 size-5 text-muted-foreground"
          />
          <h2 className="text-sm font-medium">Kein Termin ausgewählt</h2>
          <p className="mt-1.5 max-w-56 text-sm leading-relaxed text-muted-foreground text-pretty">
            Wählen Sie einen Termin im Kalender aus, um die Details zu sehen.
          </p>
          <Button type="button" size="sm" className="mt-5" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            Termin erstellen
          </Button>
        </div>
      </aside>
    );
  }

  const student = event.subtitle?.trim();
  const hasVehicle = Boolean(event.vehicle?.trim());
  const hasLocation = Boolean(event.location?.trim());
  const cancelled = Boolean(event.cancelledAt);
  const StatusIcon = cancelled ? Ban : event.tentative ? CircleDashed : CircleCheck;
  const statusLabel = cancelled
    ? CANCELLATION_KIND_LABELS[event.cancellationKind ?? "abgesagt"]
    : event.tentative
      ? "Vorläufig"
      : "Bestätigt";
  const statusDot = cancelled
    ? "bg-destructive"
    : event.tentative
      ? "bg-amber-500"
      : "bg-emerald-500";
  // Billed lessons must be storniert before they can be cancelled.
  const canCancel =
    !cancelled && !(event.billedTransactionId != null && event.billedActive);
  const attestable =
    onAttest != null &&
    event.type === "Praktisch" &&
    !cancelled &&
    event.studentId != null;
  const attested =
    attestations.data?.some((a) => String(a.eventId) === String(event.id)) ?? false;
  const canAttest = attestable && attestations.isSuccess && !attested;
  const canRecordAttendance = onAttendance && event.type === "Theorie" && !cancelled;
  const personal = event.type !== "Theorie" && event.type !== "Andere";
  const title = (personal && student) || event.title;

  return (
    <aside
      aria-label="Termindetails"
      className="flex h-full min-h-0 w-full flex-col bg-background"
    >
      <header className="shrink-0 border-b border-border/70 px-3 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[11px] font-medium text-muted-foreground">
              {title === event.title ? "Termin" : event.title}
            </p>
            <h2
              id="calendar-event-inspector-title"
              aria-live="polite"
              className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-balance"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {event.start}–{event.end} Uhr
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="-mt-1 -mr-2 text-muted-foreground"
            aria-label="Termindetails schließen"
            title="Schließen"
            onClick={onClear}
          >
            <X />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(event)}>
            <Pencil data-icon="inline-start" />
            Bearbeiten
          </Button>
          {canCancel && onCancelEvent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCancelEvent(event)}
            >
              <Ban data-icon="inline-start" />
              Absagen
            </Button>
          )}
          {cancelled && onUncancelEvent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onUncancelEvent(event)}
            >
              <Undo2 data-icon="inline-start" />
              Zurücknehmen
            </Button>
          )}
          {canAttest && (
            <Button
              type="button"
              size="sm"
              className="col-span-2"
              onClick={() => onAttest(event)}
            >
              <ClipboardList data-icon="inline-start" />
              Nachweis erfassen
            </Button>
          )}
          {attestable && attested && (
            <p className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ClipboardList className="size-3.5" />
              Nachweis erfasst
            </p>
          )}
          {canRecordAttendance && (
            <Button
              type="button"
              size="sm"
              className="col-span-2"
              onClick={() => onAttendance(event)}
            >
              <Users data-icon="inline-start" />
              Anwesenheit erfassen
            </Button>
          )}
          {studentPhone && (
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`tel:${studentPhone.replace(/[^\d+]/g, "")}`}>
                <Phone data-icon="inline-start" />
                Anrufen
              </a>
            </Button>
          )}
          {event.studentId != null && (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link
                to="/fahrschueler/$studentId"
                params={{ studentId: String(event.studentId) }}
              >
                <UserRound data-icon="inline-start" />
                Fahrschüler
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {conflicts.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">
            {conflicts.map((message) => (
              <li key={message} className="flex items-start gap-1.5">
                <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
                <span className="text-pretty">{message}</span>
              </li>
            ))}
          </ul>
        )}
        <section aria-labelledby="calendar-event-inspector-title">
          <dl className="divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
            <DetailRow icon={CalendarDays} label="Datum">
              {formatDate(event.date)}
            </DetailRow>
            <DetailRow icon={Clock3} label="Uhrzeit">
              {event.start}–{event.end} Uhr
            </DetailRow>
            <DetailRow
              icon={UserRound}
              label={personal ? "Fahrschüler/in" : "Teilnehmer / Info"}
              muted={!student}
            >
              {student || "Nicht zugeordnet"}
              {studentPhone && (
                <a
                  href={`tel:${studentPhone.replace(/[^\d+]/g, "")}`}
                  className="block text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {studentPhone}
                </a>
              )}
            </DetailRow>
            <DetailRow
              icon={GraduationCap}
              label="Fahrlehrer/in"
              muted={!event.instructor}
            >
              {event.instructor || "Nicht zugeteilt"}
            </DetailRow>
            <DetailRow icon={Car} label="Fahrzeug" muted={!hasVehicle}>
              {event.vehicle?.trim() || "Kein Fahrzeug"}
            </DetailRow>
            <DetailRow icon={MapPin} label="Ort" muted={!hasLocation}>
              {event.location?.trim() || "Nicht angegeben"}
            </DetailRow>
            <DetailRow icon={Tag} label="Ereignistyp">
              {event.type}
            </DetailRow>
            {event.lessonKind && (
              <DetailRow icon={Route} label="Fahrtart">
                {event.lessonKind}
              </DetailRow>
            )}
            {event.notes && (
              <DetailRow icon={StickyNote} label="Notiz">
                <span className="whitespace-pre-line">{event.notes}</span>
              </DetailRow>
            )}
            {event.seriesId && (
              <DetailRow icon={Repeat} label="Serie">
                Teil einer Terminserie
              </DetailRow>
            )}
            <DetailRow icon={StatusIcon} label="Status">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", statusDot)}
                />
                {statusLabel}
              </span>
            </DetailRow>
            {event.cancellationFeeTransactionId != null && (
              <DetailRow
                icon={Tag}
                label="Ausfallgebühr"
                muted={!event.cancellationFeeActive}
              >
                {event.cancellationFeeCents != null
                  ? `${formatCents(event.cancellationFeeCents)} €`
                  : "Gebucht"}
                {event.cancellationFeeActive ? "" : " · storniert"}
              </DetailRow>
            )}
          </dl>
        </section>

        {/* Destructive actions live apart from the everyday buttons. */}
        <div className="mt-6 flex flex-col gap-1 border-t border-border/70 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(event)}
          >
            <Trash2 data-icon="inline-start" />
            Termin löschen…
          </Button>
          {event.seriesId && onDeleteFollowing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDeleteFollowing(event)}
            >
              <Repeat data-icon="inline-start" />
              Folgetermine der Serie löschen…
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
