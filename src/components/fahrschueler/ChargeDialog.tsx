/* ------------------------------------------------------------------ */
/* Termin abrechnen (mehrzeilig) — confirm dialog for exam billing:    */
/* Vorstellungsentgelt + TÜV/DEKRA-Gebühr (durchlaufender Posten) are  */
/* booked as ONE guthaben_uebertragung with one line each, so a single */
/* Storno reverses the whole exam. Lines are prefilled from the        */
/* student's Preisplan and stay editable (amount, text, Konto).        */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { Plus, Receipt, Trash2 } from "lucide-react";

import type { CreateTransactionInput, StudentRef } from "@/lib/accounting-types";
import type { CalEvent } from "@/lib/calendar-data";
import { formatCents, parseEuroToCents } from "@/lib/money";
import type { ChargeProposal } from "@/lib/price-plan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type LineDraft = { description: string; amount: string; habenKonto: string };

const KONTO_OPTIONS: { value: string; label: string }[] = [
  { value: "4400", label: "4400 · Erlöse 19 %" },
  { value: "4300", label: "4300 · Erlöse 7 %" },
  { value: "4100", label: "4100 · steuerfrei" },
  { value: "1370", label: "1370 · durchlaufend" },
];

/** "2026-06-09" → "09.06.2026" */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function ChargeDialog({
  event,
  student,
  proposals,
  onClose,
  onSubmit,
}: {
  /** null = closed */
  event: CalEvent | null;
  student: StudentRef | null;
  proposals: ChargeProposal[];
  onClose: () => void;
  onSubmit: (input: CreateTransactionInput) => Promise<void>;
}) {
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!event) return;
    setError(null);
    setLines(
      proposals.length > 0
        ? proposals.map((p) => ({
            description: p.label,
            amount: formatCents(p.priceCents),
            habenKonto: p.habenKonto,
          }))
        : [{ description: event.title, amount: "", habenKonto: "4400" }],
    );
  }, [event, proposals]);

  const update = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const parsed = lines.map((line) => parseEuroToCents(line.amount));
  const total = parsed.every((c) => c != null && c > 0)
    ? parsed.reduce<number>((sum, c) => sum + (c ?? 0), 0)
    : null;

  const submit = async () => {
    if (!event || !student) return;
    if (lines.some((line) => !line.description.trim())) {
      setError("Jede Position braucht eine Beschreibung.");
      return;
    }
    if (total == null) {
      setError("Bitte für jede Position einen gültigen Betrag angeben (z. B. 129,83).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        type: "guthaben_uebertragung",
        date: event.date,
        amountCents: total,
        student,
        description: `FS ${student.name}${student.classes ? ` - ${student.classes}` : ""}, ${lines
          .map((l) => l.description.trim())
          .join(", ")}`,
        lines: lines.map((line, i) => ({
          habenKonto: line.habenKonto,
          amountCents: parsed[i]!,
          description: line.description.trim(),
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abrechnung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={event != null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Termin abrechnen</DialogTitle>
          <DialogDescription>
            {event
              ? `${event.title} am ${formatDate(event.date)} — wird als eine Buchung vom Guthaben abgerechnet.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_7rem_11rem_2rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>Position</span>
            <span>Betrag, EUR</span>
            <span>Konto</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_7rem_11rem_2rem] items-center gap-2"
            >
              <Input
                value={line.description}
                onChange={(e) => update(index, { description: e.target.value })}
                aria-label={`Beschreibung Position ${index + 1}`}
              />
              <Input
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => update(index, { amount: e.target.value })}
                aria-label={`Betrag Position ${index + 1}`}
              />
              <NativeSelect
                value={line.habenKonto}
                onChange={(e) => update(index, { habenKonto: e.target.value })}
                aria-label={`Konto Position ${index + 1}`}
                className="w-full"
              >
                {KONTO_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) => current.filter((_, i) => i !== index))
                }
                aria-label={`Position ${index + 1} entfernen`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setLines((current) => [
                ...current,
                { description: "", amount: "", habenKonto: "4400" },
              ])
            }
          >
            <Plus data-icon="inline-start" />
            Position hinzufügen
          </Button>
          <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
            <span>Summe</span>
            <span className="tabular-nums">
              {total != null ? `${formatCents(total)} €` : "–"}
            </span>
          </div>
          {lines.some((l) => l.habenKonto === "1370") && (
            <p className="text-xs text-muted-foreground">
              Konto 1370: durchlaufender Posten (§ 10 Abs. 1 UStG) — ohne Umsatzsteuer.
            </p>
          )}
          {!student && (
            <p className="text-xs text-destructive">
              Kein Fahrschüler verknüpft — Termin kann nicht abgerechnet werden.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !student}>
            <Receipt data-icon="inline-start" />
            {submitting ? "Wird abgerechnet…" : "Abrechnen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
