/* ------------------------------------------------------------------ */
/* Rechnung erstellen — pick the student's not-yet-invoiced charges    */
/* (Fahrstunden, Prüfungen, … already booked from the Guthaben) and    */
/* optionally add new positions (e.g. Grundbetrag) that are booked     */
/* together with the invoice. The number is assigned by the server.    */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import { createInvoice, useUninvoicedCharges } from "@/hooks/use-invoices";
import type { Invoice } from "@/lib/invoice-types";
import { formatCents, parseEuroToCents } from "@/lib/money";

type NewLine = { description: string; amount: string; habenKonto: string };

const KONTO_OPTIONS = [
  { value: "4400", label: "4400 · 19 %" },
  { value: "4300", label: "4300 · 7 %" },
  { value: "4100", label: "4100 · steuerfrei" },
  { value: "1370", label: "1370 · durchlaufend" },
];

export function CreateInvoiceDialog({
  studentId,
  studentName,
  open,
  onClose,
  onCreated,
}: {
  studentId: number;
  studentName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (invoice: Invoice) => void;
}) {
  const charges = useUninvoicedCharges(open ? studentId : null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Preselect every open charge whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set((charges.data ?? []).map((c) => c.transactionId)));
  }, [open, charges.data]);

  useEffect(() => {
    if (!open) return;
    setNewLines([]);
    setNote("");
    setDate(toIsoDate(new Date()));
  }, [open]);

  const parsedNew = newLines.map((line) => parseEuroToCents(line.amount));
  const total = useMemo(() => {
    const fromCharges = (charges.data ?? [])
      .filter((c) => selected.has(c.transactionId))
      .reduce((sum, c) => sum + c.grossCents, 0);
    return fromCharges + parsedNew.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  }, [charges.data, selected, parsedNew]);

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (newLines.some((line, i) => !line.description.trim() || !parsedNew[i])) {
      toast.error("Neue Positionen brauchen eine Beschreibung und einen Betrag.");
      return;
    }
    if (selected.size === 0 && newLines.length === 0) {
      toast.error("Bitte mindestens eine Position auswählen.");
      return;
    }
    setSubmitting(true);
    try {
      const invoice = await createInvoice({
        studentId,
        date,
        transactionIds: [...selected],
        newLines: newLines.map((line, i) => ({
          description: line.description.trim(),
          amountCents: parsedNew[i]!,
          habenKonto: line.habenKonto,
        })),
        note,
      });
      toast.success(`Rechnung ${invoice.invoiceNr} erstellt.`);
      onCreated(invoice);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rechnung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  const list = charges.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !submitting) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rechnung erstellen</DialogTitle>
          <DialogDescription>
            {studentName} — abgerechnete Leistungen, die noch auf keiner Rechnung stehen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {charges.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offenen Leistungen — Positionen können unten neu erfasst werden.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              {list.map((charge) => (
                <label
                  key={charge.transactionId}
                  className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <Checkbox
                    checked={selected.has(charge.transactionId)}
                    onCheckedChange={() => toggle(charge.transactionId)}
                  />
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                    {formatIsoDate(charge.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{charge.description}</span>
                  <span className="tabular-nums">{formatCents(charge.grossCents)} €</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Neue Positionen (werden mit der Rechnung gebucht)</Label>
            {newLines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_7rem_9rem_2rem] items-center gap-2"
              >
                <Input
                  value={line.description}
                  placeholder="z. B. Grundbetrag"
                  onChange={(e) =>
                    setNewLines((current) =>
                      current.map((l, i) =>
                        i === index ? { ...l, description: e.target.value } : l,
                      ),
                    )
                  }
                  aria-label={`Beschreibung neue Position ${index + 1}`}
                />
                <Input
                  inputMode="decimal"
                  value={line.amount}
                  placeholder="0,00"
                  onChange={(e) =>
                    setNewLines((current) =>
                      current.map((l, i) =>
                        i === index ? { ...l, amount: e.target.value } : l,
                      ),
                    )
                  }
                  aria-label={`Betrag neue Position ${index + 1}`}
                />
                <NativeSelect
                  value={line.habenKonto}
                  onChange={(e) =>
                    setNewLines((current) =>
                      current.map((l, i) =>
                        i === index ? { ...l, habenKonto: e.target.value } : l,
                      ),
                    )
                  }
                  aria-label={`Konto neue Position ${index + 1}`}
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
                  onClick={() =>
                    setNewLines((current) => current.filter((_, i) => i !== index))
                  }
                  aria-label={`Neue Position ${index + 1} entfernen`}
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
                setNewLines((current) => [
                  ...current,
                  { description: "", amount: "", habenKonto: "4400" },
                ])
              }
            >
              <Plus data-icon="inline-start" />
              Position hinzufügen
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-date">Rechnungsdatum</Label>
              <Input
                id="invoice-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-note">Hinweis auf der Rechnung (optional)</Label>
              <Textarea
                id="invoice-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
            <span>Rechnungsbetrag</span>
            <span className="tabular-nums">{formatCents(total)} €</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Wird erstellt…" : "Rechnung erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
