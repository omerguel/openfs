/* ------------------------------------------------------------------ */
/* Rechnung / Stornorechnung / Mahnung as A4 sheets. Same print        */
/* mechanics as the Quittung: the dialog portals a copy into           */
/* #print-root, @media print (index.css) prints only that. The same    */
/* documents are rendered server-side as real PDFs                     */
/* (src/server/invoice-documents.ts) for download and e-mail.          */
/*                                                                     */
/* § 14 Abs. 4 UStG contents: Aussteller + Empfänger, Steuernummer/    */
/* USt-IdNr, Ausstellungsdatum, fortlaufende Rechnungsnummer, Art und  */
/* Umfang + Zeitpunkt der Leistung, Entgelt nach Steuersätzen, Steuer- */
/* betrag bzw. Hinweis auf Steuerbefreiung. Already received payments  */
/* (Anzahlungen) are deducted as an Endrechnung (§ 14 Abs. 5 UStG).     */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Mail, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadFile, formatIsoDate } from "@/components/buchhaltung/api";
import { sendDocumentMail } from "@/hooks/use-invoices";
import { useStudents } from "@/hooks/use-students";
import {
  type Invoice,
  type InvoiceIssuer,
  type InvoiceReminder,
  type OpeningBalanceItem,
  type OpeningBalanceReminder,
  REMINDER_LABELS,
} from "@/lib/invoice-types";
import {
  ENDRECHNUNG_NOTE,
  LETTER_CLOSING,
  invoiceFootnotes,
  letterSalutation,
  paymentSentence,
  prepaidVatLabel,
  reminderFileStem,
  reminderIntro,
  vatRateLabel,
} from "@/lib/invoice-text";
import { formatCents } from "@/lib/money";
import { printDocument } from "@/lib/print";

function cityFromAddress(address: string): string {
  const last = address.split(",").pop() ?? "";
  return last.replace(/\d/g, "").trim();
}

type Letterhead = {
  issuer: InvoiceIssuer;
  recipient: { name: string; address: string };
  meta: [string, string][];
};

function IssuerHeader({ head, title }: { head: Letterhead; title: string }) {
  const { issuer } = head;
  const taxIds = [
    issuer.steuernummer && `Steuernummer: ${issuer.steuernummer}`,
    issuer.ustIdNr && `USt-IdNr.: ${issuer.ustIdNr}`,
  ].filter(Boolean);
  return (
    <>
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">{issuer.name}</span>
          <span>{issuer.address}</span>
          <span>
            {[issuer.phone && `Tel. ${issuer.phone}`, issuer.email]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {taxIds.map((line) => (
            <span key={String(line)}>{line}</span>
          ))}
        </div>
        <span className="text-2xl font-bold">{title}</span>
      </div>
      <div className="h-px bg-black/20" />
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{head.recipient.name}</span>
          {head.recipient.address
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => (
              <span key={part}>{part}</span>
            ))}
        </div>
        <div className="grid grid-cols-[auto_auto] gap-x-3 text-right">
          {head.meta.map(([label, value]) => (
            <FragmentMeta key={label} label={label} value={value} />
          ))}
        </div>
      </div>
    </>
  );
}

function FragmentMeta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-black/60">{label}</span>
      <span>{value}</span>
    </>
  );
}

function BankFooter({ issuer }: { issuer: InvoiceIssuer }) {
  if (!issuer.iban) return null;
  return (
    <div className="mt-auto border-t border-black/20 pt-2 text-[11px] text-black/60">
      Bankverbindung:{" "}
      {[issuer.bankName, `IBAN ${issuer.iban}`, issuer.bic && `BIC ${issuer.bic}`]
        .filter(Boolean)
        .join(" · ")}
    </div>
  );
}

function invoiceHead(invoice: Invoice): Letterhead {
  return {
    issuer: invoice.issuer,
    recipient: invoice.recipient,
    meta: [
      ["Rechnungsnr.", invoice.invoiceNr],
      ["Rechnungsdatum", formatIsoDate(invoice.date)],
      ["Kundennr.", invoice.customerNo],
      ...(invoice.contractNo
        ? ([["Vertrag", invoice.contractNo]] as [string, string][])
        : []),
    ],
  };
}

export function InvoiceSheet({ invoice }: { invoice: Invoice }) {
  const isStorno = invoice.kind === "storno";
  const due = invoice.totalCents - invoice.prepaidCents;
  const prepaidVat = invoice.prepaidVat ?? [];

  return (
    <div className="flex min-h-[1000px] w-full flex-col gap-5 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      <IssuerHeader
        head={invoiceHead(invoice)}
        title={isStorno ? "Stornorechnung" : "Rechnung"}
      />

      {isStorno && invoice.stornoOf && (
        <p>
          Hiermit stornieren wir die Rechnung{" "}
          <strong>{invoice.stornoOf.invoiceNr}</strong>
          {invoice.stornoReason ? ` (Grund: ${invoice.stornoReason})` : ""}.
        </p>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/30 text-left text-[11px] text-black/60">
            <th className="py-1.5 pr-2 font-medium">Datum</th>
            <th className="py-1.5 pr-2 font-medium">Leistung</th>
            <th className="py-1.5 pr-2 text-right font-medium">Netto €</th>
            <th className="py-1.5 pr-2 text-right font-medium">USt</th>
            <th className="whitespace-nowrap py-1.5 text-right font-medium">Brutto €</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={index} className="border-b border-black/10 align-top">
              <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                {formatIsoDate(line.date)}
              </td>
              <td className="py-1.5 pr-2">
                {line.description}
                {line.durchlaufend && " *"}
                {line.steuerfrei && " **"}
                {line.vatRate == null && !line.durchlaufend && " ***"}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {formatCents(line.netCents)}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                {line.vatRate == null ? "—" : `${line.vatRate} %`}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatCents(line.grossCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto flex w-full max-w-md flex-col gap-1">
        <table className="w-full border-collapse text-right tabular-nums">
          <thead>
            <tr className="text-[11px] text-black/60">
              <th className="py-0.5 text-left font-medium">Steuersatz</th>
              <th className="py-0.5 font-medium">Netto €</th>
              <th className="py-0.5 font-medium">USt €</th>
              <th className="py-0.5 font-medium">Brutto €</th>
            </tr>
          </thead>
          <tbody>
            {invoice.vatSummary.map((row) => (
              <tr key={String(row.vatRate)}>
                <td className="py-0.5 text-left">{vatRateLabel(row.vatRate, invoice)}</td>
                <td className="py-0.5">{formatCents(row.netCents)}</td>
                <td className="py-0.5">{formatCents(row.vatCents)}</td>
                <td className="py-0.5">{formatCents(row.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-t border-black/30 pt-1">
          <span className="font-semibold">Gesamtbetrag</span>
          <span className="text-right font-bold tabular-nums">
            {formatCents(invoice.totalCents)} €
          </span>
          {!isStorno && invoice.prepaidCents > 0 && (
            <>
              <span className="text-black/70">
                abzgl. erhaltener Anzahlungen
                {prepaidVat.map((row) => (
                  <span key={String(row.vatRate)} className="block text-[11px]">
                    {prepaidVatLabel(row)}
                  </span>
                ))}
              </span>
              <span className="text-right tabular-nums">
                – {formatCents(invoice.prepaidCents)} €
              </span>
              <span className="font-semibold">Zu zahlen</span>
              <span className="text-right font-bold tabular-nums">
                {formatCents(due)} €
              </span>
            </>
          )}
        </div>
      </div>

      {!isStorno && <p>{paymentSentence(invoice, due)}</p>}
      {!isStorno && invoice.prepaidCents > 0 && (
        <p className="text-[11px] text-black/60">{ENDRECHNUNG_NOTE}</p>
      )}
      {invoice.note && <p>{invoice.note}</p>}

      {invoiceFootnotes(invoice).length > 0 && (
        <div className="flex flex-col gap-0.5 text-[11px] text-black/60">
          {invoiceFootnotes(invoice).map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      )}

      <span>
        {cityFromAddress(invoice.issuer.address)}, den {formatIsoDate(invoice.date)}
      </span>
      <BankFooter issuer={invoice.issuer} />
    </div>
  );
}

/* ------------------------------ Mahnung ----------------------------- */

type DunningView = {
  head: Letterhead;
  heading: string;
  reference: string;
  paymentReference: string;
  fileStem: string;
};

function invoiceDunning(invoice: Invoice): DunningView {
  return {
    head: {
      issuer: invoice.issuer,
      recipient: invoice.recipient,
      meta: [
        ["Rechnungsnr.", invoice.invoiceNr],
        ["Kundennr.", invoice.customerNo],
      ],
    },
    heading: `zu Rechnung ${invoice.invoiceNr} vom ${formatIsoDate(invoice.date)}`,
    reference: "der oben genannten Rechnung",
    paymentReference: `der Rechnungsnummer ${invoice.invoiceNr}`,
    fileStem: invoice.invoiceNr,
  };
}

function openingDunning(item: OpeningBalanceItem): DunningView {
  return {
    head: {
      issuer: item.issuer,
      recipient: item.recipient,
      meta: [
        ["Kundennr.", item.customerNo],
        ["Bezug", item.belegNr ? `Beleg ${item.belegNr}` : "Saldovortrag"],
      ],
    },
    heading: `zum offenen Saldo vom ${formatIsoDate(item.date)} (Übernahme aus dem Vorsystem)`,
    reference: "dem oben genannten offenen Betrag",
    paymentReference: `Ihrer Kundennummer ${item.customerNo}`,
    fileStem: `Saldovortrag-${item.customerNo}`,
  };
}

export function ReminderSheet({
  view,
  reminder,
}: {
  view: DunningView;
  reminder: Pick<
    InvoiceReminder,
    "level" | "date" | "dueDate" | "openCents" | "feeCents"
  >;
}) {
  const label = REMINDER_LABELS[reminder.level];
  const total = reminder.openCents + reminder.feeCents;
  const { issuer } = view.head;
  return (
    <div className="flex min-h-[1000px] w-full flex-col gap-5 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      <IssuerHeader
        head={{
          ...view.head,
          meta: [["Datum", formatIsoDate(reminder.date)], ...view.head.meta],
        }}
        title={label}
      />
      <p className="font-medium">
        {label} {view.heading}
      </p>
      <p>{letterSalutation(view.head.recipient.name)}</p>
      <p>{reminderIntro(reminder.level, view.reference)}</p>
      <div className="ml-auto grid w-80 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        <span className="text-black/70">Offener Betrag</span>
        <span className="text-right tabular-nums">
          {formatCents(reminder.openCents)} €
        </span>
        {reminder.feeCents > 0 && (
          <>
            <span className="text-black/70">Mahngebühr</span>
            <span className="text-right tabular-nums">
              {formatCents(reminder.feeCents)} €
            </span>
          </>
        )}
        <span className="border-t border-black/30 pt-1 font-semibold">Zu zahlen</span>
        <span className="border-t border-black/30 pt-1 text-right font-bold tabular-nums">
          {formatCents(total)} €
        </span>
      </div>
      <p>
        Bitte überweisen Sie den Betrag bis zum{" "}
        <strong>{formatIsoDate(reminder.dueDate)}</strong> unter Angabe{" "}
        {view.paymentReference}.
        {reminder.level === 3 &&
          " Sollte bis dahin kein Zahlungseingang erfolgen, behalten wir uns weitere Schritte vor."}
      </p>
      <p>
        Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben
        bitte als gegenstandslos.
      </p>
      <p>
        {LETTER_CLOSING}
        <br />
        {issuer.name}
      </p>
      <span>
        {cityFromAddress(issuer.address)}, den {formatIsoDate(reminder.date)}
      </span>
      <BankFooter issuer={issuer} />
    </div>
  );
}

/* ------------------------------ dialog ------------------------------ */

/* One dialog for all printable invoice documents. autoPrint opens the
   browser print dialog as soon as the sheet is rendered ("Erstellen und
   drucken"). */
export type PrintTarget =
  | { kind: "invoice"; invoice: Invoice; autoPrint?: boolean }
  | {
      kind: "reminder";
      invoice: Invoice;
      reminder: InvoiceReminder;
      autoPrint?: boolean;
    }
  | {
      kind: "opening-reminder";
      item: OpeningBalanceItem;
      reminder: OpeningBalanceReminder;
      autoPrint?: boolean;
    };

type TargetMeta = {
  title: string;
  fileStem: string;
  pdfUrl: string;
  sendUrl: string;
  sendBody: Record<string, unknown>;
  studentId: number | null;
  issuer: InvoiceIssuer;
};

function targetMeta(target: PrintTarget): TargetMeta {
  if (target.kind === "invoice") {
    const { invoice } = target;
    return {
      title: `${invoice.kind === "storno" ? "Stornorechnung" : "Rechnung"} ${invoice.invoiceNr}`,
      fileStem: invoice.invoiceNr,
      pdfUrl: `/api/invoices/${invoice.id}/pdf`,
      sendUrl: `/api/invoices/${invoice.id}/send`,
      sendBody: {},
      studentId: invoice.studentId,
      issuer: invoice.issuer,
    };
  }
  const label = REMINDER_LABELS[target.reminder.level];
  if (target.kind === "reminder") {
    const { invoice, reminder } = target;
    return {
      title: `${label} · ${invoice.invoiceNr}`,
      fileStem: reminderFileStem(label, invoice.invoiceNr),
      pdfUrl: `/api/invoices/${invoice.id}/reminders/${reminder.id}/pdf`,
      sendUrl: `/api/invoices/${invoice.id}/send`,
      sendBody: { reminderId: reminder.id },
      studentId: invoice.studentId,
      issuer: invoice.issuer,
    };
  }
  const { item, reminder } = target;
  const base = `/api/open-items/saldovortrag/${item.transactionId}/reminders/${reminder.id}`;
  return {
    title: `${label} · Saldovortrag ${item.recipient.name}`,
    fileStem: reminderFileStem(label, `Saldovortrag-${item.customerNo}`),
    pdfUrl: `${base}/pdf`,
    sendUrl: `${base}/send`,
    sendBody: {},
    studentId: item.studentId,
    issuer: item.issuer,
  };
}

function SendMailDialog({
  meta,
  open,
  onClose,
}: {
  meta: TargetMeta | null;
  open: boolean;
  onClose: () => void;
}) {
  const { students } = useStudents();
  const studentEmail =
    students.find((s) => s.id === meta?.studentId)?.email?.trim() ?? "";
  const [recipient, setRecipient] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const value = recipient ?? studentEmail;

  const send = async () => {
    if (!meta) return;
    setSending(true);
    try {
      const entry = await sendDocumentMail(meta.sendUrl, {
        ...meta.sendBody,
        recipient: value.trim(),
        message,
      });
      toast.success(`E-Mail an ${entry.recipient} liegt im Postausgang.`);
      setRecipient(null);
      setMessage("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Versand fehlgeschlagen.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Per E-Mail senden</DialogTitle>
          <DialogDescription>
            {meta?.title} wird als PDF ({meta?.fileStem}.pdf) angehängt und über den
            Postausgang versendet.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-recipient">Empfänger</Label>
            <Input
              id="send-recipient"
              type="email"
              value={value}
              placeholder="name@example.de"
              onChange={(e) => setRecipient(e.target.value)}
            />
            {!studentEmail && (
              <p className="text-xs text-muted-foreground">
                Für diese/n Fahrschüler/in ist keine E-Mail-Adresse hinterlegt.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-message">Zusätzliche Nachricht (optional)</Label>
            <Textarea
              id="send-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Abbrechen
          </Button>
          <Button onClick={() => void send()} disabled={sending || !value.trim()}>
            <Mail data-icon="inline-start" />
            Senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvoicePrintDialog({
  target,
  onClose,
}: {
  target: PrintTarget | null;
  onClose: () => void;
}) {
  const [printRoot] = useState(() => document.getElementById("print-root"));
  const [mailOpen, setMailOpen] = useState(false);
  const sheet =
    target == null ? null : target.kind === "invoice" ? (
      <InvoiceSheet invoice={target.invoice} />
    ) : target.kind === "reminder" ? (
      <ReminderSheet view={invoiceDunning(target.invoice)} reminder={target.reminder} />
    ) : (
      <ReminderSheet view={openingDunning(target.item)} reminder={target.reminder} />
    );
  const meta = target ? targetMeta(target) : null;
  const missingTaxId = meta != null && !meta.issuer.steuernummer && !meta.issuer.ustIdNr;
  const missingIban = meta != null && !meta.issuer.iban;

  // "Erstellen und drucken": print once the sheet is in #print-root.
  useEffect(() => {
    if (!target?.autoPrint || !meta) return;
    const timer = setTimeout(() => printDocument(meta.fileStem), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const download = async () => {
    if (!meta) return;
    try {
      const name = await downloadFile(meta.pdfUrl, `${meta.fileStem}.pdf`);
      toast.success(`${name} heruntergeladen.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download fehlgeschlagen.");
    }
  };

  return (
    <>
      <Dialog
        open={target != null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{meta?.title ?? ""}</DialogTitle>
            <DialogDescription>
              Vorschau — ausgestellte Dokumente sind festgeschrieben und werden immer so
              wiedergegeben.
            </DialogDescription>
          </DialogHeader>
          {(missingTaxId || missingIban) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="text-pretty">
                {missingTaxId &&
                  "Weder Steuernummer noch USt-IdNr. hinterlegt — ohne sie ist die Rechnung nicht § 14 UStG-konform. "}
                {missingIban &&
                  "Keine IBAN hinterlegt — das Dokument nennt kein Konto für die Überweisung. "}
                Bitte im Profil ergänzen; bereits ausgestellte Rechnungen bleiben
                unverändert (Korrektur über Storno und neue Rechnung).
              </span>
            </div>
          )}
          <div className="max-h-[55vh] overflow-auto rounded-lg border shadow-sm">
            <div className="min-w-[640px]">{sheet}</div>
          </div>
          {printRoot &&
            sheet &&
            createPortal(<div className="bg-white">{sheet}</div>, printRoot)}
          <DialogFooter className="sm:flex-wrap">
            <Button type="button" variant="outline" onClick={onClose}>
              Schließen
            </Button>
            <Button type="button" variant="outline" onClick={() => setMailOpen(true)}>
              <Mail data-icon="inline-start" />
              Per E-Mail senden
            </Button>
            <Button type="button" variant="outline" onClick={() => void download()}>
              <Download data-icon="inline-start" />
              PDF herunterladen
            </Button>
            <Button type="button" onClick={() => meta && printDocument(meta.fileStem)}>
              <Printer data-icon="inline-start" />
              Drucken
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SendMailDialog meta={meta} open={mailOpen} onClose={() => setMailOpen(false)} />
    </>
  );
}
