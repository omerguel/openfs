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
import { AccountSelect } from "@/components/preise/AccountSelect";

type LineDraft = { description: string; amount: string; habenKonto: string };

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
          {proposals.length === 0 && event && (
            <p className="text-xs text-muted-foreground text-pretty">
              Im Preisplan ist für diesen Termin kein Preis hinterlegt — bitte Betrag
              eintragen oder den Preisplan unter „Preise" ergänzen.
            </p>
          )}
          <div className="hidden grid-cols-[1fr_7rem_12rem_2rem] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Position</span>
            <span>Betrag, EUR</span>
            <span>Art</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 max-sm:border-b max-sm:pb-2 sm:grid-cols-[1fr_7rem_12rem_2rem]"
            >
              <Input
                value={line.description}
                onChange={(e) => update(index, { description: e.target.value })}
                aria-label={`Beschreibung Position ${index + 1}`}
                className="col-span-3 sm:col-span-1"
              />
              <Input
                inputMode="decimal"
                value={line.amount}
                onChange={(e) => update(index, { amount: e.target.value })}
                aria-label={`Betrag Position ${index + 1}`}
              />
              <AccountSelect
                value={line.habenKonto}
                onChange={(habenKonto) => update(index, { habenKonto })}
                ariaLabel={`Konto Position ${index + 1}`}
              />
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
              {total != null ? `${formatCents(total)} EUR` : "–"}
            </span>
          </div>
          {lines.some((l) => l.habenKonto === "1370") && (
            <p className="text-xs text-muted-foreground">
              TÜV/DEKRA-Gebühren sind durchlaufende Posten (Konto 1370, § 10 Abs. 1 UStG)
              und werden ohne Umsatzsteuer weitergereicht.
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
