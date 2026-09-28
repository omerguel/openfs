/* ------------------------------------------------------------------ */
/* Absage / Nichterscheinen dialog — shared by the calendar inspector  */
/* and the student's Stunden tab. The fee checkbox is pre-checked for  */
/* no-shows and late cancellations (school policy); the amount is      */
/* prefilled from the policy or the student's per-lesson price.        */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { cancelCalendarEvent, useCancellationPolicy } from "@/hooks/use-calendar-events";
import { useFinanceAccess } from "@/hooks/use-finance-access";
import { usePricePlans } from "@/hooks/use-price-plans";
import { useStudents } from "@/hooks/use-students";
import {
  CANCELLATION_KIND_LABELS,
  type CancellationKind,
  DEFAULT_CANCELLATION_POLICY,
  isLateCancellation,
  suggestCancellationFee,
} from "@/lib/cancellation";
import { type CalEvent, parseISODate } from "@/lib/calendar-data";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { resolveLessonPrice } from "@/lib/price-plan";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const KINDS: CancellationKind[] = ["abgesagt", "nicht_erschienen"];

export function CancelEventDialog({
  event,
  onOpenChange,
  onCancelled,
}: {
  /** The Termin to cancel; null closes the dialog. */
  event: CalEvent | null;
  onOpenChange: (open: boolean) => void;
  onCancelled: (updated: CalEvent) => void;
}) {
  const { data: policy = DEFAULT_CANCELLATION_POLICY } = useCancellationPolicy();
  const { students } = useStudents();
  const { plans } = usePricePlans();
  // Fahrlehrer/innen charge the school's fee as is — the amount (and the
  // booking date) is the office's call; the server refuses overrides.
  const { isInstructor } = useFinanceAccess();

  const [kind, setKind] = useState<CancellationKind>("abgesagt");
  const [chargeFee, setChargeFee] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const defaultFeeCents = useMemo(() => {
    if (policy.feeCents > 0) return policy.feeCents;
    const student = students.find((candidate) => candidate.id === event?.studentId);
    // No plan assigned → the default (first) plan, like the Preise tab
    // and the server.
    const plan =
      plans.find((candidate) => candidate.id === student?.pricePlanId) ?? plans[0];
    return resolveLessonPrice(plan)?.priceCents ?? null;
  }, [event?.studentId, plans, policy.feeCents, students]);

  // Fresh defaults for every opened event.
  useEffect(() => {
    if (!event) return;
    setKind("abgesagt");
    setChargeFee(suggestCancellationFee("abgesagt", event, policy, new Date()));
    setAmount(defaultFeeCents != null ? formatCents(defaultFeeCents) : "");
  }, [event, policy, defaultFeeCents]);

  if (!event) return null;

  const late = isLateCancellation(
    event.date,
    event.start,
    policy.hoursBefore,
    new Date(),
  );
  const hasStudent = event.studentId != null;
  const feeCents = parseEuroToCents(amount);
  const canSave =
    !saving &&
    (!chargeFee || (hasStudent && (isInstructor || (feeCents != null && feeCents > 0))));

  const changeKind = (next: CancellationKind) => {
    setKind(next);
    setChargeFee(suggestCancellationFee(next, event, policy, new Date()));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const result = await cancelCalendarEvent(event.id, {
        kind,
        chargeFee: chargeFee && hasStudent,
        feeCents: chargeFee && feeCents && !isInstructor ? feeCents : undefined,
      });
      toast.success(
        result.transaction
          ? `${CANCELLATION_KIND_LABELS[kind]} — Ausfallgebühr gebucht.`
          : `Termin als „${CANCELLATION_KIND_LABELS[kind]}“ markiert.`,
      );
      onCancelled(result.event);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Absage fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = parseISODate(event.date).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Termin absagen</DialogTitle>
          <DialogDescription>
            {event.title} · {dateLabel} · {event.start}–{event.end}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>Art</FieldLabel>
            <RadioGroup
              value={kind}
              onValueChange={(value) => changeKind(value as CancellationKind)}
              className="flex gap-5"
            >
              {KINDS.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <RadioGroupItem value={option} />
                  {CANCELLATION_KIND_LABELS[option]}
                </label>
              ))}
            </RadioGroup>
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              checked={chargeFee}
              disabled={!hasStudent}
              onCheckedChange={(checked) => setChargeFee(checked === true)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              Ausfallgebühr berechnen
              <span className="text-xs text-muted-foreground">
                {!hasStudent
                  ? "Kein Fahrschüler verknüpft."
                  : late
                    ? `Kurzfristig: weniger als ${policy.hoursBefore} Std. vor Beginn.`
                    : `Rechtzeitig: mehr als ${policy.hoursBefore} Std. vor Beginn.`}
              </span>
            </span>
          </label>

          {chargeFee && hasStudent && isInstructor && (
            <p className="text-xs text-muted-foreground">
              {policy.feeCents > 0
                ? `Es wird die Ausfallgebühr laut Regelung der Fahrschule gebucht (${formatCents(policy.feeCents)} €).`
                : "Es wird der Preis einer Fahrstunde laut Preisplan gebucht."}{" "}
              Einen anderen Betrag trägt das Büro ein.
            </p>
          )}

          {chargeFee && hasStudent && !isInstructor && (
            <Field>
              <FieldLabel htmlFor="cancel-fee">Betrag (EUR)</FieldLabel>
              {defaultFeeCents == null && (
                <p className="text-xs text-muted-foreground">
                  Im Preisplan ist kein Preis für eine Fahrübungsstunde hinterlegt — bitte
                  den Betrag eingeben.
                </p>
              )}
              <Input
                id="cancel-fee"
                inputMode="decimal"
                className="tabular-nums"
                placeholder="z. B. 65,00"
                value={amount}
                required
                aria-invalid={feeCents == null || feeCents <= 0}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void submit()}>
            Absage speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
