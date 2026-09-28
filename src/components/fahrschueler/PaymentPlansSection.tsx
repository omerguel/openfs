/* ------------------------------------------------------------------ */
/* Student Zahlung tab: SEPA-Lastschriftmandat + Ratenpläne.           */
/* The mandate is the signed paper form captured digitally (IBAN,      */
/* Kontoinhaber, Unterschriftsdatum); collections run from the         */
/* Rechnungen page. Rates are paid there by Lastschrift or here by hand. */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Ban, CalendarClock, Landmark, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import type { StudentRecord } from "@/hooks/use-students";
import {
  cancelInstalmentPlan,
  createInstalmentPlan,
  createMandate,
  payInstalment,
  revokeMandate,
  useInstalmentPlans,
  useMandates,
} from "@/hooks/use-payment-plans";
import type { PaymentMethod } from "@/lib/accounting-types";
import type { Instalment } from "@/lib/payment-plan-types";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { formatIban, isValidBic, isValidIban } from "@/lib/sepa";
import { cn } from "@/lib/utils";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function MandateDialog({
  student,
  open,
  onClose,
}: {
  student: StudentRecord;
  open: boolean;
  onClose: () => void;
}) {
  const [holder, setHolder] = useState(`${student.firstName} ${student.lastName}`);
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [signedOn, setSignedOn] = useState(() => toIsoDate(new Date()));
  const [saving, setSaving] = useState(false);
  const ibanOk = iban.trim() === "" || isValidIban(iban);

  const save = async () => {
    if (!isValidIban(iban)) {
      toast.error("Die IBAN ist ungültig.");
      return;
    }
    if (bic.trim() && !isValidBic(bic)) {
      toast.error("Die BIC ist ungültig.");
      return;
    }
    setSaving(true);
    try {
      const mandate = await createMandate({
        studentId: student.id,
        accountHolder: holder,
        iban,
        bic,
        signedOn,
      });
      toast.success(`Mandat ${mandate.mandateRef} erfasst.`);
      setIban("");
      setBic("");
      onClose();
    } catch (error) {
      toast.error(errorText(error, "Mandat konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>SEPA-Lastschriftmandat erfassen</DialogTitle>
          <DialogDescription>
            Angaben aus dem unterschriebenen Mandat übernehmen. Ein neues Mandat ersetzt
            das bisherige.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mandate-holder">Kontoinhaber/in</Label>
            <Input
              id="mandate-holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mandate-iban">IBAN</Label>
            <Input
              id="mandate-iban"
              className={cn("font-mono", !ibanOk && "border-destructive")}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="DE00 0000 0000 0000 0000 00"
            />
            {!ibanOk && (
              <span className="text-xs text-destructive">Prüfziffer stimmt nicht.</span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mandate-bic">BIC (optional)</Label>
              <Input
                id="mandate-bic"
                className="font-mono"
                value={bic}
                onChange={(e) => setBic(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mandate-signed">Unterschrieben am</Label>
              <Input
                id="mandate-signed"
                type="date"
                value={signedOn}
                onChange={(e) => setSignedOn(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Mandat speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({
  student,
  open,
  onClose,
}: {
  student: StudentRecord;
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("Ratenzahlung Führerscheinausbildung");
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("6");
  const [interval, setInterval] = useState("1");
  const [firstDue, setFirstDue] = useState(() => toIsoDate(new Date()));
  const [saving, setSaving] = useState(false);

  const totalCents = parseEuroToCents(total);
  const rate =
    totalCents && Number(count) > 0 ? Math.floor(totalCents / Number(count)) : null;

  const save = async () => {
    if (!totalCents) {
      toast.error("Bitte einen Gesamtbetrag angeben (z. B. 3.600,00).");
      return;
    }
    setSaving(true);
    try {
      await createInstalmentPlan({
        studentId: student.id,
        title,
        totalCents,
        count: Number(count),
        intervalMonths: Number(interval),
        firstDueDate: firstDue,
      });
      toast.success("Ratenplan angelegt.");
      setTotal("");
      onClose();
    } catch (error) {
      toast.error(errorText(error, "Ratenplan konnte nicht angelegt werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ratenplan anlegen</DialogTitle>
          <DialogDescription>
            Raten sind Anzahlungen auf das Ausbildungskonto — gebucht wird erst bei
            Eingang.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-title">Bezeichnung</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-total">Gesamtbetrag, EUR</Label>
              <Input
                id="plan-total"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-count">Anzahl Raten</Label>
              <Input
                id="plan-count"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-first">Erste Rate fällig am</Label>
              <Input
                id="plan-first"
                type="date"
                value={firstDue}
                onChange={(e) => setFirstDue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-interval">Abstand</Label>
              <NativeSelect
                id="plan-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full"
              >
                <NativeSelectOption value="1">monatlich</NativeSelectOption>
                <NativeSelectOption value="2">alle 2 Monate</NativeSelectOption>
                <NativeSelectOption value="3">vierteljährlich</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          {rate != null && (
            <p className="text-xs text-muted-foreground">
              ≈ {formatCents(rate)} € je Rate (Rundungsdifferenz auf der letzten Rate).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayRateDialog({
  rate,
  onClose,
}: {
  rate: Instalment | null;
  onClose: () => void;
}) {
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [method, setMethod] = useState<PaymentMethod>("ueberweisung");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!rate) return;
    setSaving(true);
    try {
      await payInstalment(rate.id, {
        date,
        paymentMethod: method,
        geldkonto: method === "bar" ? "1600" : "1800",
      });
      toast.success(`Rate ${rate.seq} als bezahlt gebucht.`);
      onClose();
    } catch (error) {
      toast.error(errorText(error, "Buchung fehlgeschlagen."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={rate != null} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rate {rate?.seq} verbuchen</DialogTitle>
          <DialogDescription>
            {rate ? `${formatCents(rate.amountCents)} € als Zahlung auf Guthaben.` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rate-date">Eingang am</Label>
            <Input
              id="rate-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rate-method">Zahlungsart</Label>
            <NativeSelect
              id="rate-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full"
            >
              <NativeSelectOption value="ueberweisung">Überweisung</NativeSelectOption>
              <NativeSelectOption value="bar">Bar</NativeSelectOption>
              <NativeSelectOption value="ec">EC-Karte</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Buchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentPlansSection({ student }: { student: StudentRecord }) {
  const mandates = useMandates(student.id);
  const plans = useInstalmentPlans(student.id);
  const [mandateOpen, setMandateOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [payRate, setPayRate] = useState<Instalment | null>(null);
  const today = toIsoDate(new Date());

  const active = mandates.data?.find((m) => m.active) ?? null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(errorText(error, "Aktion fehlgeschlagen."));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Landmark className="size-4 text-muted-foreground" />
              SEPA-Lastschriftmandat
            </h3>
            <Button size="sm" variant="outline" onClick={() => setMandateOpen(true)}>
              <Plus data-icon="inline-start" />
              {active ? "Neues Mandat" : "Erfassen"}
            </Button>
          </div>
          {active ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Referenz</dt>
              <dd className="font-mono">{active.mandateRef}</dd>
              <dt className="text-muted-foreground">Inhaber/in</dt>
              <dd>{active.accountHolder}</dd>
              <dt className="text-muted-foreground">IBAN</dt>
              <dd className="font-mono text-xs leading-5">{formatIban(active.iban)}</dd>
              <dt className="text-muted-foreground">Unterschrift</dt>
              <dd>{formatIsoDate(active.signedOn)}</dd>
              <dt className="text-muted-foreground">Zuletzt genutzt</dt>
              <dd>{active.lastUsedOn ? formatIsoDate(active.lastUsedOn) : "noch nie"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Kein gültiges Mandat — Rechnungen und Raten können nicht per Lastschrift
              eingezogen werden.
            </p>
          )}
          {active && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start text-destructive"
              onClick={() =>
                void run(() => revokeMandate(active.id, today), "Mandat widerrufen.")
              }
            >
              <Ban data-icon="inline-start" />
              Widerrufen
            </Button>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4 text-muted-foreground" />
              Ratenpläne
            </h3>
            <Button size="sm" variant="outline" onClick={() => setPlanOpen(true)}>
              <Plus data-icon="inline-start" />
              Ratenplan
            </Button>
          </div>
          {(plans.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Kein Ratenplan vereinbart.</p>
          ) : (
            (plans.data ?? []).map((plan) => (
              <div key={plan.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{plan.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatCents(plan.paidCents)} von {formatCents(plan.totalCents)} €
                    bezahlt
                  </span>
                </div>
                {plan.cancelledOn && (
                  <Badge variant="outline" className="self-start font-normal">
                    Beendet am {formatIsoDate(plan.cancelledOn)}
                  </Badge>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {plan.instalments.map((rate) => {
                    const overdue = !rate.paid && rate.dueDate < today;
                    return (
                      <button
                        type="button"
                        key={rate.id}
                        disabled={
                          rate.paid || rate.inCollection || plan.cancelledOn != null
                        }
                        onClick={() => setPayRate(rate)}
                        className={cn(
                          "flex flex-col rounded-md border px-2 py-1 text-left text-xs tabular-nums transition-colors enabled:hover:bg-muted disabled:cursor-default",
                          rate.paid && "border-green-500/40 bg-green-500/10",
                          overdue && "border-destructive/50 text-destructive",
                        )}
                        title={
                          rate.paid
                            ? "Bezahlt"
                            : rate.inCollection
                              ? "Im Lastschrifteinzug"
                              : "Als bezahlt buchen"
                        }
                      >
                        <span>
                          {rate.seq}. · {formatIsoDate(rate.dueDate)}
                        </span>
                        <span className="font-medium">
                          {formatCents(rate.amountCents)} €
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!plan.cancelledOn && plan.paidCents < plan.totalCents && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() =>
                      void run(
                        () => cancelInstalmentPlan(plan.id, today),
                        "Ratenplan beendet.",
                      )
                    }
                  >
                    Ratenplan beenden
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <MandateDialog
        student={student}
        open={mandateOpen}
        onClose={() => setMandateOpen(false)}
      />
      <PlanDialog student={student} open={planOpen} onClose={() => setPlanOpen(false)} />
      <PayRateDialog rate={payRate} onClose={() => setPayRate(null)} />
    </div>
  );
}
