/* ------------------------------------------------------------------ */
/* Invoice table + its row actions (Anzeigen/Drucken, Mahnen,          */
/* Stornieren). Shared by the /rechnungen page and the student         */
/* Zahlung tab so both behave identically.                             */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { BellRing, FileText, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import {
  createReminder,
  stornoInvoice,
  useInvoicingSettings,
} from "@/hooks/use-invoices";
import { type Invoice, type InvoiceStatus, REMINDER_LABELS } from "@/lib/invoice-types";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { InvoicePrintDialog, type PrintTarget } from "./InvoiceSheet";

const STATUS_META: Record<InvoiceStatus, { label: string; dot: string }> = {
  offen: { label: "Offen", dot: "bg-amber-500" },
  teilbezahlt: { label: "Teilbezahlt", dot: "bg-sky-500" },
  bezahlt: { label: "Bezahlt", dot: "bg-green-500" },
  storniert: { label: "Storniert", dot: "bg-muted-foreground/50" },
  storno: { label: "Stornorechnung", dot: "bg-muted-foreground/50" },
};

export function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  const meta = STATUS_META[invoice.status];
  const lastReminder = invoice.reminders.at(-1);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
        {meta.label}
      </Badge>
      {invoice.overdueDays > 0 && (
        <Badge variant="outline" className="font-normal text-destructive">
          {invoice.overdueDays} Tage überfällig
        </Badge>
      )}
      {lastReminder && invoice.openCents > 0 && (
        <Badge variant="secondary" className="font-normal">
          {REMINDER_LABELS[lastReminder.level]}
        </Badge>
      )}
    </div>
  );
}

function StornoInvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: Invoice | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [stornoCharges, setStornoCharges] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!invoice) return;
    if (!reason.trim()) {
      toast.error("Bitte einen Stornogrund angeben.");
      return;
    }
    setSubmitting(true);
    try {
      const { storno } = await stornoInvoice(invoice.id, {
        reason: reason.trim(),
        date,
        stornoCharges,
      });
      toast.success(`Stornorechnung ${storno.invoiceNr} erstellt.`);
      setReason("");
      setStornoCharges(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storno fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={invoice != null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechnung {invoice?.invoiceNr} stornieren</DialogTitle>
          <DialogDescription>
            Rechnungen werden nie gelöscht: Es entsteht eine Stornorechnung mit eigener
            Nummer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="storno-reason">Stornogrund</Label>
            <Input
              id="storno-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="z. B. falscher Rechnungsempfänger"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="storno-date">Datum</Label>
            <Input
              id="storno-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={stornoCharges}
              onCheckedChange={(value) => setStornoCharges(value === true)}
              className="mt-0.5"
            />
            <span>
              Auch die Buchungen der Leistungen stornieren
              <span className="block text-xs text-muted-foreground">
                Nur wenn die Leistungen ganz entfallen. Sonst bleiben sie gebucht und
                können neu abgerechnet werden.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={submitting}
          >
            Stornorechnung erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReminderDialog({
  invoice,
  onClose,
  onCreated,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onCreated: (target: PrintTarget) => void;
}) {
  const settings = useInvoicingSettings();
  const level = ((invoice?.reminders.at(-1)?.level ?? 0) + 1) as 1 | 2 | 3;
  const defaultFee = settings.data?.reminderFeeCents[level - 1] ?? 0;
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [fee, setFee] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!invoice) return;
    const feeCents =
      fee == null || fee.trim() === "" ? defaultFee : parseEuroToCents(fee);
    if (feeCents == null) {
      toast.error("Mahngebühr ist ungültig (z. B. 5,00).");
      return;
    }
    setSubmitting(true);
    try {
      const reminder = await createReminder(invoice.id, { date, feeCents });
      toast.success(`${REMINDER_LABELS[reminder.level]} erstellt.`);
      setFee(null);
      onCreated({ kind: "reminder", invoice, reminder });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mahnung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={invoice != null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {level <= 3 ? REMINDER_LABELS[level] : "Mahnung"} · {invoice?.invoiceNr}
          </DialogTitle>
          <DialogDescription>
            Offen: {invoice ? formatCents(invoice.openCents) : "–"} €. Die Mahngebühr wird
            als nicht steuerbarer Ertrag (4830) vom Guthaben gebucht.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reminder-date">Datum</Label>
            <Input
              id="reminder-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reminder-fee">Mahngebühr, EUR</Label>
            <Input
              id="reminder-fee"
              inputMode="decimal"
              value={fee ?? formatCents(defaultFee)}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            Erstellen und drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceList({
  invoices,
  showStudent = true,
  emptyText = "Noch keine Rechnungen.",
}: {
  invoices: Invoice[];
  showStudent?: boolean;
  emptyText?: string;
}) {
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const [stornoTarget, setStornoTarget] = useState<Invoice | null>(null);
  const [remindTarget, setRemindTarget] = useState<Invoice | null>(null);

  if (invoices.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Nr.</TableHead>
              <TableHead>Datum</TableHead>
              {showStudent && <TableHead>Fahrschüler/in</TableHead>}
              <TableHead className="text-right">Betrag</TableHead>
              <TableHead className="text-right">Offen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4 text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const canAct =
                invoice.kind === "rechnung" && invoice.status !== "storniert";
              const lastDue = invoice.reminders.at(-1)?.dueDate ?? invoice.dueDate;
              const canRemind =
                canAct &&
                invoice.openCents > 0 &&
                invoice.reminders.length < 3 &&
                lastDue < toIsoDate(new Date());
              return (
                <TableRow key={invoice.id}>
                  <TableCell className="pl-4 font-medium tabular-nums">
                    {invoice.invoiceNr}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatIsoDate(invoice.date)}
                  </TableCell>
                  {showStudent && <TableCell>{invoice.recipient.name}</TableCell>}
                  <TableCell className="text-right tabular-nums">
                    {formatCents(invoice.totalCents)} €
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {invoice.kind === "rechnung" && invoice.status !== "storniert"
                      ? `${formatCents(invoice.openCents)} €`
                      : "–"}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge invoice={invoice} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPrintTarget({ kind: "invoice", invoice })}
                      >
                        <FileText data-icon="inline-start" />
                        Anzeigen
                      </Button>
                      {invoice.reminders.map((reminder) => (
                        <Button
                          key={reminder.id}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPrintTarget({ kind: "reminder", invoice, reminder })
                          }
                        >
                          {REMINDER_LABELS[reminder.level]}
                        </Button>
                      ))}
                      {canRemind && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRemindTarget(invoice)}
                        >
                          <BellRing data-icon="inline-start" />
                          Mahnen
                        </Button>
                      )}
                      {canAct && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Rechnung ${invoice.invoiceNr} stornieren`}
                          onClick={() => setStornoTarget(invoice)}
                        >
                          <Undo2 />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <InvoicePrintDialog target={printTarget} onClose={() => setPrintTarget(null)} />
      <StornoInvoiceDialog invoice={stornoTarget} onClose={() => setStornoTarget(null)} />
      <ReminderDialog
        invoice={remindTarget}
        onClose={() => setRemindTarget(null)}
        onCreated={(target) => {
          setRemindTarget(null);
          setPrintTarget(target);
        }}
      />
    </>
  );
}
