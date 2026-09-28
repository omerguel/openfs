/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Stundenübersicht tab. Lists this student's     */
/* calendar appointments (matched via studentId FK, with subtitle      */
/* fallback for events created before the billing migration).          */
/* ------------------------------------------------------------------ */

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Ban, ClipboardCheck, ClipboardList, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";

import {
  eventTypeOptions,
  eventTypeShortLabel,
  isCancelled,
  isExamEvent,
  isFahrstunde,
  toISODate,
  toMinutes,
  type CalEvent,
  type EventType,
} from "@/lib/calendar-data";
import { CANCELLATION_KIND_LABELS } from "@/lib/cancellation";
import { computeSpecialDriveProgress } from "@/lib/special-drives";
import { CancelEventDialog } from "@/components/CancelEventDialog";
import {
  type BillableEventType,
  resolveEventCharges,
  resolveLessonPrice,
  resolveStudentPlan,
} from "@/lib/price-plan";
import { billCalendarEvent, useCalendarEvents } from "@/hooks/use-calendar-events";
import { usePricePlans } from "@/hooks/use-price-plans";
import { invalidateStudentMoney } from "@/hooks/use-finance-access";
import { hasClassBSpecialDrives } from "@/lib/license-classes";
import { useStudents } from "@/hooks/use-students";
import type { StudentRecord } from "@/hooks/use-students";
import { accountingApi, useApi } from "@/components/buchhaltung/api";
import { PaymentDialog } from "@/components/buchhaltung/PaymentDialog";
import { AusbildungsnachweisPrintDialog } from "@/components/fahrschueler/AusbildungsnachweisPrintDialog";
import { BatchBillDialog } from "@/components/fahrschueler/BatchBillDialog";
import { ChargeDialog } from "@/components/fahrschueler/ChargeDialog";
import { SignaturePad } from "@/components/SignaturePad";
import type { SignaturePadHandle } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreateTransactionInput, StudentRef } from "@/lib/accounting-types";
import {
  fetchAttestationsForStudent,
  saveAttestation,
} from "@/hooks/use-ausbildungsnachweis";
import type { Attestation } from "@/server/ausbildungsnachweis";

/** "2026-06-09" → "09.06.2026" */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function formatDuration(start: string, end: string): string {
  const minutes = toMinutes(end) - toMinutes(start);
  if (minutes <= 0) return "-";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} Min`;
  if (rest === 0) return `${hours} Std`;
  return `${hours} Std, ${rest} Min`;
}

type TypeFilter = "alle" | EventType;

/** Derive billing state for a practical event. Cancelled lessons are
    never billable (a fee is booked separately at cancellation). */
function billingState(event: CalEvent): "billed" | "open" | "cancelled" {
  if (event.billedTransactionId != null && event.billedActive) return "billed";
  if (isCancelled(event)) return "cancelled";
  return "open";
}

const SPECIAL_DRIVE_SHORT: Record<string, string> = {
  Überlandfahrt: "Überland",
  Autobahnfahrt: "Autobahn",
  Nachtfahrt: "Nacht",
};

/* ------------------------------------------------------------------ */
/* Nachweis capture dialog                                             */
/* ------------------------------------------------------------------ */

type NachweisDialogProps = {
  open: boolean;
  event: CalEvent;
  student: StudentRecord;
  onClose: () => void;
  onSaved: (attestation: Attestation) => void;
};

function NachweisDialog({ open, event, student, onClose, onSaved }: NachweisDialogProps) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [content, setContent] = useState("");
  const [sigHasStrokes, setSigHasStrokes] = useState(false);
  const [saving, setSaving] = useState(false);

  const durationMin = toMinutes(event.end) - toMinutes(event.start);
  const canSave = sigHasStrokes && !saving;

  const handleSave = async () => {
    if (!sigRef.current?.hasStrokes) return;
    setSaving(true);
    try {
      const attestation = await saveAttestation(event.id, {
        studentId: student.id,
        instructor: event.instructor,
        content,
        durationMin,
        signatureDataUrl: sigRef.current.toDataURL(),
      });
      toast.success("Ausbildungsnachweis gespeichert.");
      onSaved(attestation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler beim Speichern.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ausbildungsnachweis erfassen</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground rounded-lg border p-3">
            <div>
              <span className="font-medium text-foreground">Datum</span>
              <div>{formatDate(event.date)}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Dauer</span>
              <div>
                {durationMin} Min ({event.start} – {event.end})
              </div>
            </div>
            <div>
              <span className="font-medium text-foreground">Fahrlehrer</span>
              <div>{event.instructor}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Fahrzeug</span>
              <div>{event.vehicle ?? "–"}</div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nachweis-content">Unterrichtsinhalt</Label>
            <Textarea
              id="nachweis-content"
              placeholder="z.B. Stadtfahrt, Autobahn, Einparken…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              maxLength={2000}
              className="resize-none text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Unterschrift Fahrschüler</Label>
            <SignaturePad ref={sigRef} onChange={setSigHasStrokes} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? "Speichern…" : "Unterschreiben & speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Nachweis read-only view dialog                                      */
/* ------------------------------------------------------------------ */

type NachweisViewDialogProps = {
  open: boolean;
  attestation: Attestation;
  onClose: () => void;
};

function NachweisViewDialog({ open, attestation, onClose }: NachweisViewDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ausbildungsnachweis</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground rounded-lg border p-3">
            <div>
              <span className="font-medium text-foreground">Fahrlehrer</span>
              <div>{attestation.instructor || "–"}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Dauer</span>
              <div>{attestation.durationMin} Min</div>
            </div>
            <div className="col-span-2">
              <span className="font-medium text-foreground">Unterzeichnet am</span>
              <div>{attestation.signedAt.replace("T", " ").slice(0, 16)}</div>
            </div>
          </div>

          {attestation.content && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Unterrichtsinhalt</span>
              <p className="rounded-lg border p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {attestation.content}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Unterschrift</span>
            <img
              src={attestation.signatureDataUrl}
              alt="Unterschrift des Fahrschülers"
              className="rounded-lg border p-2 bg-background w-full"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Main StundenTab                                                     */
/* ------------------------------------------------------------------ */

/** Has the lesson already ended? Future lessons cannot be billed yet. */
function hasEnded(event: CalEvent, now: Date): boolean {
  const today = toISODate(now);
  if (event.date !== today) return event.date < today;
  return toMinutes(event.end) <= now.getHours() * 60 + now.getMinutes();
}

export function StundenTab({
  student,
  canSeeMoney,
}: {
  student: StudentRecord;
  /** false for Fahrlehrer/innen — no billing, no finance requests. */
  canSeeMoney: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("alle");
  const [billTarget, setBillTarget] = useState<CalEvent | null>(null);
  /* Exams bill through the multi-line ChargeDialog (service + Prüfgebühr). */
  const [examBillTarget, setExamBillTarget] = useState<CalEvent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CalEvent | null>(null);
  const [batchBillOpen, setBatchBillOpen] = useState(false);
  const [nachweisPrintOpen, setNachweisPrintOpen] = useState(false);
  const [nachweisTarget, setNachweisTarget] = useState<CalEvent | null>(null);
  const [viewAttestation, setViewAttestation] = useState<Attestation | null>(null);
  // Map of event id (string) → Attestation (or null = checked, none found)
  const [attestationMap, setAttestationMap] = useState<Map<string, Attestation | null>>(
    () => new Map(),
  );
  const [loadingAttestations, setLoadingAttestations] = useState(false);

  const fullName = `${student.firstName} ${student.lastName}`;
  const { events: allEvents, refresh: refreshEvents } = useCalendarEvents();
  const { plans } = usePricePlans();
  const { students } = useStudents();
  // Finance endpoints are forbidden for Fahrlehrer/innen — don't ask.
  const accounts = useApi(
    () => (canSeeMoney ? accountingApi.accounts() : Promise.resolve({ accounts: [] })),
    [canSeeMoney],
  );
  const now = new Date();

  // Assigned plan, else the class default — same rule as the Preise tab.
  const studentPlan = useMemo(() => resolveStudentPlan(plans, student), [plans, student]);

  const studentEvents = useMemo(
    () =>
      allEvents
        .filter((event) =>
          event.studentId != null
            ? event.studentId === student.id
            : event.subtitle === fullName,
        )
        .toSorted((left, right) =>
          `${left.date} ${left.start}`.localeCompare(`${right.date} ${right.start}`),
        ),
    [allEvents, fullName, student.id],
  );

  const events = useMemo(
    () =>
      studentEvents.filter((event) => typeFilter === "alle" || event.type === typeFilter),
    [studentEvents, typeFilter],
  );

  /* Billable-but-unbilled lessons — same predicate as the per-lesson
     Abrechnen button, sorted by date ascending (studentEvents already is). */
  const openLessons = useMemo(
    () =>
      studentEvents.filter(
        (event) =>
          isFahrstunde(event) &&
          billingState(event) === "open" &&
          event.studentId != null &&
          hasEnded(event, new Date()),
      ),
    [studentEvents],
  );

  /* Sonderfahrten (class B minimums) — completed, non-cancelled lessons. */
  const showSpecialDrives = hasClassBSpecialDrives(student.classes);
  const specialDrives = useMemo(
    () => computeSpecialDriveProgress(studentEvents, toISODate(new Date())),
    [studentEvents],
  );

  /* Bulk-load attestations for this student's practical events. */
  const refreshAttestations = useCallback(async () => {
    setLoadingAttestations(true);
    try {
      const list = await fetchAttestationsForStudent(student.id);
      const map = new Map<string, Attestation | null>();
      for (const att of list) {
        map.set(String(att.eventId), att);
      }
      setAttestationMap(map);
    } catch {
      // Non-fatal: attestation column will just be empty
    } finally {
      setLoadingAttestations(false);
    }
  }, [student.id]);

  useEffect(() => {
    void refreshAttestations();
  }, [refreshAttestations]);

  const studentRef = useMemo((): StudentRef | null => {
    const found = students.find((s) => s.id === student.id);
    if (!found) return null;
    return {
      customerNo: found.customerNumber,
      name: `${found.firstName} ${found.lastName}`,
      address: found.address,
      contractNo: found.contractNumber,
      classes: found.classes,
    };
  }, [students, student.id]);

  const billPrefill = useMemo(() => {
    if (!billTarget) return {};
    const durationMin = toMinutes(billTarget.end) - toMinutes(billTarget.start);
    const resolved = resolveLessonPrice(studentPlan);
    return {
      defaultType: "guthaben_uebertragung" as const,
      defaultDate: billTarget.date,
      defaultAmountCents: resolved?.priceCents ?? undefined,
      defaultDescription: `Fahrübungsstunde (${durationMin})`,
      defaultHabenKonto: "4400",
    };
  }, [billTarget, studentPlan]);

  const examProposals = useMemo(
    () =>
      examBillTarget && isExamEvent(examBillTarget)
        ? resolveEventCharges(studentPlan, examBillTarget.type as BillableEventType)
        : [],
    [examBillTarget, studentPlan],
  );

  const handleBillSubmit = async (input: CreateTransactionInput) => {
    if (!billTarget) return;
    await billCalendarEvent(billTarget.id, input);
    await refreshEvents();
    void invalidateStudentMoney();
    setBillTarget(null);
  };

  /* Same payload shape PaymentDialog builds from the single-lesson prefill
     (type guthaben_uebertragung, habenKonto 4400, "FS <name> - <classes>, …"). */
  const buildBatchBillInput = (
    event: CalEvent,
    ref: StudentRef,
    priceCents: number,
  ): CreateTransactionInput => {
    const durationMin = toMinutes(event.end) - toMinutes(event.start);
    return {
      type: "guthaben_uebertragung",
      date: event.date,
      amountCents: priceCents,
      habenKonto: "4400",
      student: ref,
      description: `FS ${ref.name} - ${ref.classes}, Fahrübungsstunde (${durationMin})`,
    };
  };

  /* Sequential submit: each lesson stays an individually-attributable GoBD
     transaction. Stop at the first failure; refresh ONCE at the end. */
  const handleBatchBillConfirm = async () => {
    const resolved = resolveLessonPrice(studentPlan);
    if (!studentRef || !resolved) return;
    const lessons = openLessons;
    let billed = 0;
    let failure: { date: string; message: string } | null = null;
    for (const lesson of lessons) {
      try {
        await billCalendarEvent(
          lesson.id,
          buildBatchBillInput(lesson, studentRef, resolved.priceCents),
        );
        billed += 1;
      } catch (err) {
        failure = {
          date: lesson.date,
          message: err instanceof Error ? err.message : "Unbekannter Fehler",
        };
        break;
      }
    }
    await refreshEvents();
    void invalidateStudentMoney();
    setBatchBillOpen(false);
    if (failure) {
      toast.error(
        `${billed} von ${lessons.length} abgerechnet — Fehler bei ${formatDate(failure.date)}: ${failure.message}`,
      );
    } else {
      toast.success(
        `${billed} ${billed === 1 ? "Fahrstunde" : "Fahrstunden"} abgerechnet.`,
      );
    }
  };

  /* Attestations with data — gates the cumulative print action. */
  const attestationCount = useMemo(() => {
    let count = 0;
    for (const att of attestationMap.values()) {
      if (att != null) count += 1;
    }
    return count;
  }, [attestationMap]);

  const handleNachweisCaptureDone = async (attestation: Attestation) => {
    setNachweisTarget(null);
    setAttestationMap((prev) =>
      new Map(prev).set(String(attestation.eventId), attestation),
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as TypeFilter)}
          >
            <SelectTrigger className="w-48" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="alle">Alle Stunden</SelectItem>
                {eventTypeOptions.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {canSeeMoney && openLessons.length >= 2 && (
              <Button variant="outline" size="sm" onClick={() => setBatchBillOpen(true)}>
                <Receipt className="mr-1 size-3.5" />
                Alle offenen abrechnen ({openLessons.length})
              </Button>
            )}
            {attestationCount === 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* aria-disabled instead of disabled: a disabled button
                      fires no hover/focus, so the reason could not show. */}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-disabled="true"
                    className="cursor-not-allowed opacity-50"
                    onClick={(event) => event.preventDefault()}
                  >
                    <Printer className="mr-1 size-3.5" />
                    Ausbildungsnachweis drucken
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-pretty">
                  Noch keine unterschriebenen Fahrstunden. Erfassen Sie zuerst einen
                  Nachweis in der Spalte „Nachweis" einer vergangenen Fahrstunde.
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNachweisPrintOpen(true)}
              >
                <Printer className="mr-1 size-3.5" />
                Ausbildungsnachweis drucken
              </Button>
            )}
          </div>
        </div>

        {showSpecialDrives && (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5">
            <dt className="text-[11px] font-medium text-muted-foreground">
              Sonderfahrten (Mindestumfang Klasse B)
            </dt>
            {specialDrives.map((row) => (
              <div key={row.kind} className="flex items-baseline gap-1.5 text-sm">
                <dt className="text-muted-foreground">{SPECIAL_DRIVE_SHORT[row.kind]}</dt>
                <dd className="flex items-center gap-1.5 font-medium tabular-nums">
                  {row.completedMinutes}/{row.requiredMinutes} Min.
                  <span
                    aria-hidden
                    className={
                      row.done
                        ? "size-1.5 rounded-full bg-green-500"
                        : "size-1.5 rounded-full bg-amber-500"
                    }
                  />
                  <span className="sr-only">{row.done ? "erfüllt" : "offen"}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {events.length === 0 ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyTitle>Keine Stunden gefunden</EmptyTitle>
              <EmptyDescription>
                Für {fullName} sind keine Termine im gewählten Filter geplant.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[46rem] text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Datum/Zeit</TableHead>
                  <TableHead>Dauer</TableHead>
                  <TableHead className="min-w-44">Termin</TableHead>
                  <TableHead>Fahrlehrer/in</TableHead>
                  <TableHead>Fahrzeug</TableHead>
                  <TableHead>{canSeeMoney ? "Abrechnung" : "Status"}</TableHead>
                  <TableHead className="pr-4">Nachweis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const isPraktisch = isFahrstunde(event);
                  const isExam = isExamEvent(event);
                  const isBillable = isPraktisch || isExam;
                  const cancelled = isCancelled(event);
                  const state = isBillable ? billingState(event) : null;
                  const ended = hasEnded(event, now);
                  const canCancel =
                    !cancelled &&
                    !(event.billedTransactionId != null && event.billedActive);
                  const cancelButton = canCancel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => setCancelTarget(event)}
                    >
                      <Ban className="mr-1 size-3" />
                      Absagen
                    </Button>
                  ) : null;
                  const hasStudent = event.studentId != null;
                  const billDisabledReason =
                    isBillable && !hasStudent ? "Kein Fahrschüler verknüpft" : null;

                  const attestation = attestationMap.get(event.id);
                  const nachweisChecked = attestationMap.has(event.id);
                  const nachweisAttested = attestation != null;

                  return (
                    <TableRow
                      key={event.id}
                      className={cancelled ? "text-muted-foreground" : undefined}
                    >
                      <TableCell className="pl-4">
                        <div className="flex flex-col">
                          <span className="font-medium">{formatDate(event.date)}</span>
                          <span className="text-muted-foreground">
                            {event.start} - {event.end}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDuration(event.start, event.end)}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          <span className={cancelled ? "line-through" : undefined}>
                            {event.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {eventTypeShortLabel[event.type]}
                            {event.lessonKind && event.lessonKind !== "Übungsfahrt"
                              ? ` · ${event.lessonKind}`
                              : ""}
                            {event.location ? ` · ${event.location}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.instructor}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.vehicle ?? "-"}
                      </TableCell>

                      {/* Abrechnung column */}
                      <TableCell>
                        {cancelled ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-destructive" />
                            {
                              CANCELLATION_KIND_LABELS[
                                event.cancellationKind ?? "abgesagt"
                              ]
                            }
                            {event.cancellationFeeActive && " · Gebühr gebucht"}
                          </span>
                        ) : !isBillable || !canSeeMoney ? (
                          cancelButton
                        ) : state === "billed" ? (
                          <span className="text-muted-foreground text-xs">
                            Abgerechnet
                          </span>
                        ) : !ended ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Geplant</span>
                            {cancelButton}
                          </div>
                        ) : billDisabledReason ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-xs cursor-not-allowed select-none">
                                <span className="size-1.5 rounded-full border border-current" />
                                Offen
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{billDisabledReason}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs">
                              <span className="size-1.5 rounded-full border border-current" />
                              Offen
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() =>
                                isExam ? setExamBillTarget(event) : setBillTarget(event)
                              }
                            >
                              <Receipt className="mr-1 size-3" />
                              Abrechnen
                            </Button>
                            {cancelButton}
                          </div>
                        )}
                      </TableCell>

                      {/* Nachweis column */}
                      <TableCell className="pr-4">
                        {!isPraktisch || cancelled ? null : nachweisAttested ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground gap-1"
                            onClick={() => setViewAttestation(attestation)}
                          >
                            <ClipboardCheck className="size-3 text-green-600" />
                            {formatDate(attestation.signedAt.slice(0, 10))}
                          </Button>
                        ) : !hasStudent ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground/50 text-xs cursor-not-allowed select-none">
                                <ClipboardList className="size-3" />
                                Nachweis
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Kein Fahrschüler verknüpft</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setNachweisTarget(event)}
                            disabled={loadingAttestations && !nachweisChecked}
                          >
                            <ClipboardList className="mr-1 size-3" />
                            Nachweis
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Billing dialog */}
        {billTarget && (
          <PaymentDialog
            open={true}
            onClose={() => setBillTarget(null)}
            accounts={accounts.data?.accounts ?? []}
            defaultCustomerNo={student.customerNumber}
            {...billPrefill}
            onSubmitOverride={handleBillSubmit}
            onCreated={() => {}}
          />
        )}

        {/* Exam billing: Vorstellungsentgelt + Prüfgebühr as one transaction */}
        <ChargeDialog
          event={examBillTarget}
          student={studentRef}
          proposals={examProposals}
          onClose={() => setExamBillTarget(null)}
          onSubmit={async (input) => {
            if (!examBillTarget) return;
            await billCalendarEvent(examBillTarget.id, input);
            await refreshEvents();
            void invalidateStudentMoney();
            setExamBillTarget(null);
            toast.success("Prüfung abgerechnet.");
          }}
        />

        {/* Batch billing confirmation dialog */}
        {batchBillOpen && (
          <BatchBillDialog
            open={true}
            lessons={openLessons}
            priceCents={resolveLessonPrice(studentPlan)?.priceCents ?? null}
            onClose={() => setBatchBillOpen(false)}
            onConfirm={handleBatchBillConfirm}
          />
        )}

        {/* Absage / Nichterscheinen dialog */}
        <CancelEventDialog
          event={cancelTarget}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null);
          }}
          onCancelled={() => void refreshEvents()}
        />

        {/* Nachweis capture dialog */}
        {nachweisTarget && (
          <NachweisDialog
            open={true}
            event={nachweisTarget}
            student={student}
            onClose={() => setNachweisTarget(null)}
            onSaved={(att) => void handleNachweisCaptureDone(att)}
          />
        )}

        {/* Cumulative Nachweis print dialog */}
        {nachweisPrintOpen && (
          <AusbildungsnachweisPrintDialog
            open={true}
            student={student}
            onClose={() => setNachweisPrintOpen(false)}
          />
        )}

        {/* Nachweis read-only view dialog */}
        {viewAttestation && (
          <NachweisViewDialog
            open={true}
            attestation={viewAttestation}
            onClose={() => setViewAttestation(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
