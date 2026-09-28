/* ------------------------------------------------------------------ */
/* Invoice table + its row actions (Anzeigen/PDF/E-Mail, Mahnen,       */
/* Stornieren). Shared by the /rechnungen page and the student         */
/* Zahlung tab so both behave identically. On phones the table turns   */
/* into a card list so amounts and actions stay visible.               */
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

/** "Mahnung ab 16.09." / "Mahnen möglich" / null when nothing is open. */
export function nextReminderHint(
  nextReminderOn: string | null,
  lastLevel: number,
  today = toIsoDate(new Date()),
): string | null {
  if (!nextReminderOn) return null;
  const next = REMINDER_LABELS[(lastLevel + 1) as 1 | 2 | 3];
  if (nextReminderOn <= today) return `${next} möglich`;
  return `${next} ab ${formatIsoDate(nextReminderOn)}`;
}

export function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  const meta = STATUS_META[invoice.status];
  const lastReminder = invoice.reminders.at(-1);
  const hint = nextReminderHint(invoice.nextReminderOn ?? null, lastReminder?.level ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
        {meta.label}
      </Badge>
      {invoice.overdueDays > 0 && (
        <Badge variant="outline" className="font-normal text-destructive">
          {invoice.overdueDays} {invoice.overdueDays === 1 ? "Tag" : "Tage"} überfällig
        </Badge>
      )}
      {lastReminder && invoice.openCents > 0 && (
        <Badge variant="secondary" className="font-normal">
          {REMINDER_LABELS[lastReminder.level]}
        </Badge>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
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
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!invoice) return;
    if (!reason.trim()) {
      setError("Bitte einen Stornogrund angeben.");
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Storno fehlgeschlagen.");
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
          <DialogDescription className="text-pretty">
            Rechnungen werden nie gelöscht oder geändert: Es entsteht eine Stornorechnung
            mit eigener Nummer. Danach können die Leistungen neu abgerechnet werden.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="storno-reason">Stornogrund</Label>
            <Input
              id="storno-reason"
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="z. B. falscher Rechnungsempfänger"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
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

/* Next Mahnstufe for an invoice or an opening debt. The fee is booked on
   the student's Ausbildungskonto as a nicht steuerbarer Ertrag (4830). */
export function ReminderDialog({
  subject,
  onClose,
  onCreate,
  onCreated,
}: {
  subject: { title: string; openCents: number; lastLevel: number } | null;
  onClose: () => void;
  /** Creates the reminder; returns the document to show afterwards. */
  onCreate: (input: { date: string; feeCents: number }) => Promise<PrintTarget>;
  /** Receives the new document (with autoPrint for "Erstellen und drucken"). */
  onCreated: (target: PrintTarget) => void;
}) {
  const settings = useInvoicingSettings();
  const level = Math.min((subject?.lastLevel ?? 0) + 1, 3) as 1 | 2 | 3;
  const defaultFee = settings.data?.reminderFeeCents[level - 1] ?? 0;
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [fee, setFee] = useState<string | null>(null);
  const [feeError, setFeeError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (print: boolean) => {
    if (!subject) return;
    const feeCents =
      fee == null || fee.trim() === "" ? defaultFee : parseEuroToCents(fee);
    if (feeCents == null) {
      setFeeError(true);
      return;
    }
    setSubmitting(true);
    try {
      const target = await onCreate({ date, feeCents });
      toast.success(`${REMINDER_LABELS[level]} erstellt.`);
      setFee(null);
      onClose();
      onCreated({ ...target, autoPrint: print });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mahnung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={subject != null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {REMINDER_LABELS[level]} · {subject?.title}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            Offen: {subject ? formatCents(subject.openCents) : "–"} €. Die Mahngebühr wird
            dem Ausbildungskonto belastet (nicht steuerbarer Ertrag, Konto 4830).
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
              aria-invalid={feeError ? true : undefined}
              value={fee ?? formatCents(defaultFee)}
              onChange={(e) => {
                setFee(e.target.value);
                setFeeError(false);
              }}
            />
            {feeError && (
              <p className="text-xs text-destructive">Ungültiger Betrag (z. B. 5,00).</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            variant="outline"
            onClick={() => void submit(false)}
            disabled={submitting}
          >
            Erstellen
          </Button>
          <Button onClick={() => void submit(true)} disabled={submitting}>
            Erstellen und drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceActions({
  invoice,
  onShow,
  onRemind,
  onStorno,
}: {
  invoice: Invoice;
  onShow: (target: PrintTarget) => void;
  onRemind: () => void;
  onStorno: () => void;
}) {
  const canAct = invoice.kind === "rechnung" && invoice.status !== "storniert";
  const today = toIsoDate(new Date());
  const canRemind =
    canAct &&
    invoice.openCents > 0 &&
    invoice.nextReminderOn != null &&
    invoice.nextReminderOn <= today;
  return (
    <div className="flex flex-wrap justify-end gap-1 lg:flex-nowrap">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onShow({ kind: "invoice", invoice })}
      >
        <FileText data-icon="inline-start" />
        Anzeigen
      </Button>
      {invoice.reminders.map((reminder) => (
        <Button
          key={reminder.id}
          variant="ghost"
          size="sm"
          onClick={() => onShow({ kind: "reminder", invoice, reminder })}
        >
          {REMINDER_LABELS[reminder.level]}
        </Button>
      ))}
      {canRemind && (
        <Button variant="outline" size="sm" onClick={onRemind}>
          <BellRing data-icon="inline-start" />
          Mahnen
        </Button>
      )}
      {canAct && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Rechnung ${invoice.invoiceNr} stornieren`}
          onClick={onStorno}
        >
          <Undo2 data-icon="inline-start" />
          Stornieren
        </Button>
      )}
    </div>
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

  const openCell = (invoice: Invoice) =>
    invoice.kind === "rechnung" && invoice.status !== "storniert"
      ? `${formatCents(invoice.openCents)} €`
      : "–";

  return (
    <>
      <ul className="flex flex-col gap-2 sm:hidden">
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium tabular-nums">{invoice.invoiceNr}</span>
              <span className="font-medium tabular-nums">
                {formatCents(invoice.totalCents)} €
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
              <span className="min-w-0 truncate">
                {formatIsoDate(invoice.date)}
                {showStudent && ` · ${invoice.recipient.name}`}
              </span>
              <span className="shrink-0 tabular-nums">offen {openCell(invoice)}</span>
            </div>
            <InvoiceStatusBadge invoice={invoice} />
            <InvoiceActions
              invoice={invoice}
              onShow={setPrintTarget}
              onRemind={() => setRemindTarget(invoice)}
              onStorno={() => setStornoTarget(invoice)}
            />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border sm:block">
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
            {invoices.map((invoice) => (
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
                  {openCell(invoice)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <InvoiceStatusBadge invoice={invoice} />
                </TableCell>
                <TableCell className="pr-4">
                  <InvoiceActions
                    invoice={invoice}
                    onShow={setPrintTarget}
                    onRemind={() => setRemindTarget(invoice)}
                    onStorno={() => setStornoTarget(invoice)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <InvoicePrintDialog target={printTarget} onClose={() => setPrintTarget(null)} />
      <StornoInvoiceDialog invoice={stornoTarget} onClose={() => setStornoTarget(null)} />
      <ReminderDialog
        subject={
          remindTarget && {
            title: remindTarget.invoiceNr,
            openCents: remindTarget.openCents,
            lastLevel: remindTarget.reminders.at(-1)?.level ?? 0,
          }
        }
        onClose={() => setRemindTarget(null)}
        onCreate={async (input) => {
          const invoice = remindTarget!;
          const reminder = await createReminder(invoice.id, input);
          return { kind: "reminder", invoice, reminder };
        }}
        onCreated={setPrintTarget}
      />
    </>
  );
}
