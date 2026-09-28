/* ------------------------------------------------------------------ */
/* Rechnung erstellen — pick the student's not-yet-invoiced charges    */
/* (Fahrstunden, Prüfungen, … already booked from the Guthaben) and    */
/* optionally add new positions (e.g. Grundbetrag) that are booked     */
/* together with the invoice. The number is assigned by the server.    */
/*                                                                     */
/* Before creating: missing IBAN / Steuernummer in the Profil and      */
/* dates that break the number/date order (before the last invoice,    */
/* past month, future) are shown and must be confirmed — an issued     */
/* invoice is frozen and can only be corrected by Storno + new one.    */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Info, Plus, Trash2, TriangleAlert } from "lucide-react";
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
import { dateWarnings, formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import { WarningConfirm } from "@/components/buchhaltung/WarningConfirm";
import { useCompanyProfile } from "@/hooks/use-company-profile";
import { createInvoice, useInvoices, useUninvoicedCharges } from "@/hooks/use-invoices";
import type { Invoice } from "@/lib/invoice-types";
import { cleanPositionText } from "@/lib/invoice-text";
import { formatCents, parseEuroToCents } from "@/lib/money";

type NewLine = { description: string; amount: string; habenKonto: string };

const KONTO_OPTIONS = [
  { value: "4400", label: "Fahrstunden & Leistungen · 4400 · 19 %" },
  { value: "4300", label: "Leistungen 7 % · 4300" },
  { value: "4100", label: "Ausbildung steuerfrei · 4100 · 0 %" },
  { value: "1370", label: "Durchlaufender Posten (TÜV/DEKRA) · 1370" },
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
  const navigate = useNavigate();
  const charges = useUninvoicedCharges(open ? studentId : null);
  const invoices = useInvoices();
  const { profile } = useCompanyProfile();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [lineErrors, setLineErrors] = useState<Set<number>>(() => new Set());

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
    setConfirmed(false);
    setLineErrors(new Set());
  }, [open]);

  const parsedNew = newLines.map((line) => parseEuroToCents(line.amount));
  const total = useMemo(() => {
    const fromCharges = (charges.data ?? [])
      .filter((c) => selected.has(c.transactionId))
      .reduce((sum, c) => sum + c.grossCents, 0);
    return fromCharges + parsedNew.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  }, [charges.data, selected, parsedNew]);

  const lastInvoice = useMemo(
    () =>
      (invoices.data ?? [])
        .filter((invoice) => invoice.kind === "rechnung")
        .reduce<Invoice | null>(
          (latest, invoice) => (!latest || invoice.date > latest.date ? invoice : latest),
          null,
        ),
    [invoices.data],
  );

  const warnings = [
    ...(lastInvoice && date < lastInvoice.date
      ? [
          `Das Rechnungsdatum liegt vor der letzten Rechnung ${lastInvoice.invoiceNr} vom ${formatIsoDate(
            lastInvoice.date,
          )} — Rechnungsnummern und -daten wären dann nicht mehr in derselben Reihenfolge.`,
        ]
      : []),
    ...dateWarnings(date),
  ];
  const missingIban = profile != null && !profile.iban.trim();
  const missingTaxId =
    profile != null && !profile.steuernummer.trim() && !profile.ustIdNr.trim();

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateLine = (index: number, patch: Partial<NewLine>) => {
    setNewLines((current) =>
      current.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
    setLineErrors((current) => {
      if (!current.has(index)) return current;
      const next = new Set(current);
      next.delete(index);
      return next;
    });
  };

  const submit = async () => {
    const invalid = new Set(
      newLines
        .map((line, i) => (!line.description.trim() || !parsedNew[i] ? i : -1))
        .filter((i) => i >= 0),
    );
    setLineErrors(invalid);
    if (invalid.size > 0) return;
    if (selected.size === 0 && newLines.length === 0) {
      toast.error("Bitte mindestens eine Position auswählen.");
      return;
    }
    if (warnings.length > 0 && !confirmed) return;
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
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rechnung erstellen</DialogTitle>
          <DialogDescription className="text-pretty">
            {studentName} — abgerechnete Leistungen, die noch auf keiner Rechnung stehen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {(missingIban || missingTaxId) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="text-pretty">
                {missingIban &&
                  "Im Profil ist keine IBAN hinterlegt — die Rechnung nennt dann kein Konto für die Überweisung. "}
                {missingTaxId &&
                  "Weder Steuernummer noch USt-IdNr. hinterlegt — ohne sie ist die Rechnung nicht § 14 UStG-konform. "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => {
                    onClose();
                    void navigate({ to: "/profil" });
                  }}
                >
                  Profil ergänzen
                </button>
              </span>
            </div>
          )}

          {charges.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offenen Leistungen — Positionen können unten neu erfasst werden.
            </p>
          ) : (
            <div className="min-w-0 overflow-hidden rounded-lg border">
              {list.map((charge) => (
                <label
                  key={charge.transactionId}
                  className="flex min-w-0 cursor-pointer items-start gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(charge.transactionId)}
                    onCheckedChange={() => toggle(charge.transactionId)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="shrink-0 tabular-nums text-muted-foreground sm:w-24">
                      {formatIsoDate(charge.date)}
                    </span>
                    <span className="min-w-0 flex-1 text-pretty sm:truncate">
                      {cleanPositionText(charge.description, { name: studentName })}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCents(charge.grossCents)} €
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <Label>Neue Positionen (werden mit der Rechnung gebucht)</Label>
            {newLines.map((line, index) => (
              <div
                key={index}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem_2rem] items-start gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,14rem)_2rem] sm:border-0 sm:p-0"
              >
                <Input
                  className="col-span-3 sm:col-span-1"
                  value={line.description}
                  placeholder="z. B. Grundbetrag"
                  aria-invalid={
                    lineErrors.has(index) && !line.description.trim() ? true : undefined
                  }
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  aria-label={`Beschreibung neue Position ${index + 1}`}
                />
                <Input
                  className="order-2 sm:order-none"
                  inputMode="decimal"
                  value={line.amount}
                  placeholder="0,00"
                  aria-invalid={
                    lineErrors.has(index) && !parsedNew[index] ? true : undefined
                  }
                  onChange={(e) => updateLine(index, { amount: e.target.value })}
                  aria-label={`Betrag neue Position ${index + 1}`}
                />
                <NativeSelect
                  value={line.habenKonto}
                  onChange={(e) => updateLine(index, { habenKonto: e.target.value })}
                  aria-label={`Art der Leistung, neue Position ${index + 1}`}
                  className="order-1 w-full min-w-0 sm:order-none"
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
                  className="order-3 sm:order-none"
                  onClick={() =>
                    setNewLines((current) => current.filter((_, i) => i !== index))
                  }
                  aria-label={`Neue Position ${index + 1} entfernen`}
                >
                  <Trash2 />
                </Button>
                {lineErrors.has(index) && (
                  <p className="order-4 col-span-3 text-xs text-destructive sm:col-span-4">
                    Bitte Beschreibung und Betrag (z. B. 349,90) angeben.
                  </p>
                )}
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

          <div className="grid min-w-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-date">Rechnungsdatum</Label>
              <Input
                id="invoice-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConfirmed(false);
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="invoice-note">Hinweis auf der Rechnung (optional)</Label>
              <Textarea
                id="invoice-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <WarningConfirm
            warnings={warnings}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            label="Datum geprüft — Rechnung trotzdem so erstellen"
          />

          <div className="flex items-center justify-between gap-3 border-t pt-2 text-sm font-medium">
            <span>Rechnungsbetrag</span>
            <span className="tabular-nums">{formatCents(total)} €</span>
          </div>
          <p className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Nach dem Erstellen ist die Rechnung festgeschrieben (GoBD) und kann nicht mehr
            geändert werden. Korrekturen erfolgen über „Stornieren“ und eine neue
            Rechnung.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || (warnings.length > 0 && !confirmed)}
          >
            {submitting ? "Wird erstellt…" : "Rechnung erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
