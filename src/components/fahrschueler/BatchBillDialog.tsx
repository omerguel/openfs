/* ------------------------------------------------------------------ */
/* Batch billing confirmation dialog: lists all open Fahrstunden of a  */
/* student with the resolved per-lesson price and a sum row. Nothing   */
/* posts until the operator explicitly confirms (GoBD confirm-style).  */
/* Follow-up (deliberately out of v1): per-row deselection — operator  */
/* cancels and bills individually if the set is wrong.                 */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Receipt } from "lucide-react";

import { toMinutes, type CalEvent } from "@/lib/calendar-data";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** "2026-06-09" → "09.06.2026" */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

type BatchBillDialogProps = {
  open: boolean;
  /** Open (billable, un-billed) lessons, sorted by date ascending. */
  lessons: CalEvent[];
  /** Resolved per-lesson price (same price logic as the single-lesson path), or null if unresolvable. */
  priceCents: number | null;
  onClose: () => void;
  /** Sequential submit lives in the caller; the dialog only awaits it. */
  onConfirm: () => Promise<void>;
};

export function BatchBillDialog({
  open,
  lessons,
  priceCents,
  onClose,
  onConfirm,
}: BatchBillDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const sumCents = priceCents != null ? lessons.length * priceCents : null;
  const canConfirm = priceCents != null && lessons.length > 0 && !submitting;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Offene Fahrstunden abrechnen</DialogTitle>
          <DialogDescription>
            Jede Fahrstunde wird als eigene Buchung vom Guthaben abgerechnet.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-72 overflow-y-auto">
              {lessons.map((lesson) => {
                const durationMin = toMinutes(lesson.end) - toMinutes(lesson.start);
                return (
                  <div
                    key={lesson.id}
                    className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs last:border-b-0"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{formatDate(lesson.date)}</span>
                      <span className="text-muted-foreground">
                        {lesson.start} – {lesson.end} · {durationMin} Min
                      </span>
                    </div>
                    <span className="tabular-nums">
                      {priceCents != null ? `${formatCents(priceCents)} €` : "–"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-2 text-xs font-medium">
              <span>
                Summe ({lessons.length}{" "}
                {lessons.length === 1 ? "Fahrstunde" : "Fahrstunden"})
              </span>
              <span className="tabular-nums">
                {sumCents != null ? `${formatCents(sumCents)} €` : "–"}
              </span>
            </div>
          </div>

          {priceCents == null && (
            <p className="text-xs text-muted-foreground">
              Im Tarif ist kein Preis für „Fahrübungsstunde“ hinterlegt — bitte die
              Stunden einzeln abrechnen.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!canConfirm}>
            <Receipt className="mr-1 size-3.5" />
            {submitting
              ? "Wird abgerechnet…"
              : `${lessons.length} ${lessons.length === 1 ? "Fahrstunde" : "Fahrstunden"} abrechnen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
