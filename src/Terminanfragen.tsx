import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  Clock,
  Inbox,
  Mail,
  Phone,
  Trash2,
  TriangleAlert,
  Copy,
  UserPlus,
  ArrowDownUp,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { useInstructors } from "@/hooks/use-instructors";
import {
  acceptAppointmentRequest,
  declineAppointmentRequest,
  deleteAppointmentRequest,
  useAppointmentRequests,
  type AppointmentRequest,
  type AppointmentRequestStatus,
} from "@/hooks/use-appointment-requests";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type StatusFilter = "alle" | AppointmentRequestStatus;

const statusLabels: Record<AppointmentRequestStatus, string> = {
  offen: "Offen",
  bestätigt: "Bestätigt",
  abgelehnt: "Abgelehnt",
};

const statusDot: Record<AppointmentRequestStatus, string> = {
  offen: "bg-amber-500",
  bestätigt: "bg-green-500",
  abgelehnt: "bg-red-500",
};

type SortOrder = "eingang" | "wunschtermin";

/* created_at is SQLite UTC ("YYYY-MM-DD HH:MM:SS") → local German date. */
function formatReceived(createdAt: string): string {
  const date = new Date(`${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return createdAt;
  return `${date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

const typeAccents: Record<string, string> = {
  Praktisch: "bg-sky-500/10 text-sky-600",
  Theorie: "bg-emerald-500/10 text-emerald-600",
  "Vorstellung zur prakt. Prüfung": "bg-amber-500/10 text-amber-600",
  Theorieprüfung: "bg-violet-500/10 text-violet-600",
  Andere: "bg-slate-500/10 text-slate-600",
};

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/* "HH:MM" + minutes → "HH:MM" (default duration for the accept draft). */
function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

type AcceptDraft = {
  date: string;
  start: string;
  end: string;
  instructor: string;
};

function draftFromRequest(request: AppointmentRequest): AcceptDraft {
  return {
    date: request.requestedDate,
    start: request.requestedTime,
    end: /^\d{2}:\d{2}$/.test(request.requestedTime)
      ? addMinutes(request.requestedTime, 60)
      : "",
    instructor: "Nicht zugeteilt",
  };
}

function AcceptDialog({
  request,
  open,
  saving,
  instructorOptions,
  onOpenChange,
  onConfirm,
}: {
  request: AppointmentRequest | null;
  open: boolean;
  saving: boolean;
  instructorOptions: string[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (draft: AcceptDraft) => void;
}) {
  const [draft, setDraft] = useState<AcceptDraft | null>(null);

  useEffect(() => {
    setDraft(open && request ? draftFromRequest(request) : null);
  }, [open, request?.id]);

  function update<Key extends keyof AcceptDraft>(key: Key, value: AcceptDraft[Key]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  if (!request || !draft) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Terminanfrage annehmen</DialogTitle>
          <DialogDescription>
            {request.name} · {request.type} — Datum, Uhrzeit und Fahrlehrer/in vor dem
            Bestätigen anpassen. Der Termin landet im Kalender.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="accept-date">Datum</FieldLabel>
            <Input
              id="accept-date"
              type="date"
              value={draft.date}
              onChange={(event) => update("date", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="accept-start">Beginn</FieldLabel>
            <Input
              id="accept-start"
              type="time"
              value={draft.start}
              onChange={(event) => update("start", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="accept-end">Ende</FieldLabel>
            <Input
              id="accept-end"
              type="time"
              value={draft.end}
              onChange={(event) => update("end", event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="accept-instructor">Fahrlehrer/in</FieldLabel>
            <Select
              value={draft.instructor}
              onValueChange={(value) => update("instructor", value)}
            >
              <SelectTrigger id="accept-instructor" className="w-full">
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
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={saving || !draft.date || !draft.start || !draft.end}
            onClick={() => onConfirm(draft)}
          >
            <Check data-icon="inline-start" />
            Termin bestätigen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({
  request,
  duplicates,
  saving,
  onAccept,
  onDecline,
  onDelete,
  onCreateStudent,
}: {
  request: AppointmentRequest;
  duplicates: AppointmentRequest[];
  saving: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onDelete: () => void;
  onCreateStudent: () => void;
}) {
  const contact = [
    { Icon: Phone, value: request.phone },
    { Icon: Mail, value: request.email },
  ].filter((item) => item.value);

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "hidden size-11 shrink-0 items-center justify-center rounded-lg sm:flex",
              typeAccents[request.type] ?? typeAccents.Andere,
            )}
          >
            <Inbox className="size-6" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <CardTitle className="text-base">{request.name}</CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{request.type}</Badge>
                <Badge variant="outline" className="gap-1.5 font-normal">
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", statusDot[request.status])}
                  />
                  {statusLabels[request.status]}
                </Badge>
              </div>
            </div>
            <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {contact.map(({ Icon, value }) => (
                <span key={value} className="flex min-w-0 items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{value}</span>
                </span>
              ))}
              {contact.length === 0 && <span>Keine Kontaktdaten angegeben</span>}
            </CardDescription>
            <p className="text-xs text-muted-foreground tabular-nums">
              Eingegangen am {formatReceived(request.createdAt)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {request.message && (
          <p className="text-sm text-muted-foreground">{request.message}</p>
        )}
        {(request.campaignName || request.studentId !== null) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {request.campaignName && (
              <span>
                Über Kampagne{" "}
                <span className="font-medium text-foreground">
                  {request.campaignName}
                </span>
              </span>
            )}
            {request.studentId !== null && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-green-500" />
                Angelegt als{" "}
                <Link
                  to="/fahrschueler/$studentId"
                  params={{ studentId: String(request.studentId) }}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {request.studentName}
                </Link>
              </span>
            )}
          </div>
        )}
        {duplicates.length > 0 && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <Copy className="mt-0.5 size-4 shrink-0" />
            <span>
              Mögliches Duplikat — innerhalb von 14 Tagen kam bereits eine Anfrage mit
              gleichem Namen, gleicher Telefonnummer oder E-Mail-Adresse:{" "}
              {duplicates
                .map((d) => `${d.name} (eingegangen ${formatReceived(d.createdAt)})`)
                .join(", ")}
            </span>
          </div>
        )}
        {request.conflicts && request.conflicts.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <span className="flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-4 shrink-0" />
              Terminkonflikt — zur Wunschzeit ist bereits belegt:
            </span>
            <ul className="flex flex-col gap-0.5 pl-[22px]">
              {request.conflicts.map((conflict) => (
                <li key={conflict.id}>
                  {conflict.start}–{conflict.end} Uhr · {conflict.title} (
                  {conflict.instructor})
                </li>
              ))}
            </ul>
          </div>
        )}
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4 text-muted-foreground" />
              <span className="sr-only">Wunschtermin:</span>
              {formatDate(request.requestedDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" />
              {request.requestedTime} Uhr
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {request.studentId === null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={onCreateStudent}
              >
                <UserPlus data-icon="inline-start" />
                Als Fahrschüler anlegen
              </Button>
            )}
            {request.status !== "bestätigt" && (
              <Button type="button" size="sm" disabled={saving} onClick={onAccept}>
                <Check data-icon="inline-start" />
                Annehmen
              </Button>
            )}
            {request.status === "offen" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={onDecline}
              >
                <X data-icon="inline-start" />
                Ablehnen
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  disabled={saving}
                  aria-label={`Anfrage von ${request.name} löschen`}
                >
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Terminanfrage löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Die Anfrage von {request.name} ({formatDate(request.requestedDate)},{" "}
                    {request.requestedTime} Uhr) wird endgültig entfernt. Bereits
                    angelegte Kalendertermine bleiben bestehen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Terminanfragen() {
  const { requests, loading, refresh } = useAppointmentRequests();
  const navigate = useNavigate();
  const { assignableNames: instructorOptions } = useInstructors();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");
  const [sortOrder, setSortOrder] = useState<SortOrder>("eingang");
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const next: Record<AppointmentRequestStatus, number> = {
      offen: 0,
      bestätigt: 0,
      abgelehnt: 0,
    };
    for (const request of requests) next[request.status] += 1;
    return next;
  }, [requests]);

  const visibleRequests = useMemo(() => {
    const filtered =
      statusFilter === "alle"
        ? requests
        : requests.filter((request) => request.status === statusFilter);
    // The server lists newest received first; "Wunschtermin" re-sorts
    // by the requested slot (soonest first).
    if (sortOrder === "eingang") return filtered;
    return filtered.toSorted(
      (a, b) =>
        a.requestedDate.localeCompare(b.requestedDate) ||
        a.requestedTime.localeCompare(b.requestedTime) ||
        a.id - b.id,
    );
  }, [requests, statusFilter, sortOrder]);

  const byId = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);

  const acceptingRequest = requests.find((request) => request.id === acceptingId) ?? null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Select
            value={sortOrder}
            onValueChange={(value) => setSortOrder(value as SortOrder)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Sortierung"
              className="hidden w-auto gap-1.5 md:flex"
            >
              <ArrowDownUp className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="eingang">Neueste zuerst</SelectItem>
              <SelectItem value="wunschtermin">Nach Wunschtermin</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <div className="-my-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
          <ToggleGroup
            type="single"
            value={statusFilter}
            onValueChange={(value) => {
              if (
                value === "alle" ||
                value === "offen" ||
                value === "bestätigt" ||
                value === "abgelehnt"
              ) {
                setStatusFilter(value);
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Terminanfragen Status"
            className="shrink-0"
          >
            <ToggleGroupItem value="alle" aria-label="Alle Anfragen">
              Alle
            </ToggleGroupItem>
            <ToggleGroupItem value="offen" aria-label="Offene Anfragen">
              Offen
              <Badge variant="secondary" data-icon="inline-end">
                {counts.offen}
              </Badge>
            </ToggleGroupItem>
            <ToggleGroupItem value="bestätigt" aria-label="Bestätigte Anfragen">
              Bestätigt
              <Badge variant="secondary" data-icon="inline-end">
                {counts.bestätigt}
              </Badge>
            </ToggleGroupItem>
            <ToggleGroupItem value="abgelehnt" aria-label="Abgelehnte Anfragen">
              Abgelehnt
              <Badge variant="secondary" data-icon="inline-end">
                {counts.abgelehnt}
              </Badge>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Inbox className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Keine Terminanfragen in dieser Ansicht.
            </p>
          </div>
        ) : (
          <div className="stagger-in flex flex-col gap-4 2xl:gap-5">
            <div className="flex items-center justify-between gap-2 md:hidden">
              <span className="text-xs text-muted-foreground tabular-nums">
                {visibleRequests.length}{" "}
                {visibleRequests.length === 1 ? "Anfrage" : "Anfragen"}
              </span>
              <Select
                value={sortOrder}
                onValueChange={(value) => setSortOrder(value as SortOrder)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Sortierung"
                  className="w-auto gap-1.5"
                >
                  <ArrowDownUp className="size-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="eingang">Neueste zuerst</SelectItem>
                  <SelectItem value="wunschtermin">Nach Wunschtermin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibleRequests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                duplicates={(request.duplicateOf ?? [])
                  .map((id) => byId.get(id))
                  .filter((r): r is AppointmentRequest => r !== undefined)}
                saving={saving}
                onAccept={() => setAcceptingId(request.id)}
                onDecline={() =>
                  void run(
                    () => declineAppointmentRequest(request.id),
                    "Anfrage abgelehnt.",
                  )
                }
                onDelete={() =>
                  void run(
                    () => deleteAppointmentRequest(request.id),
                    "Anfrage gelöscht.",
                  )
                }
                onCreateStudent={() =>
                  void navigate({ to: "/neue-schueler", search: { anfrage: request.id } })
                }
              />
            ))}
          </div>
        )}
      </div>

      <AcceptDialog
        request={acceptingRequest}
        open={acceptingId !== null && acceptingRequest !== null}
        saving={saving}
        instructorOptions={instructorOptions}
        onOpenChange={(open) => {
          if (!open) setAcceptingId(null);
        }}
        onConfirm={(draft) =>
          void run(async () => {
            await acceptAppointmentRequest(acceptingId!, {
              date: draft.date,
              start: draft.start,
              end: draft.end,
              instructor: draft.instructor,
            });
            setAcceptingId(null);
          }, "Anfrage bestätigt — Termin wurde im Kalender angelegt.")
        }
      />
    </div>
  );
}

export default Terminanfragen;
