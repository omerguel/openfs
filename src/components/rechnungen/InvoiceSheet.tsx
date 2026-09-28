/* ------------------------------------------------------------------ */
/* Rechnung / Stornorechnung / Mahnung as A4 sheets. Same print        */
/* mechanics as the Quittung: the dialog portals a copy into           */
/* #print-root, @media print (index.css) prints only that.             */
/*                                                                     */
/* § 14 Abs. 4 UStG contents: Aussteller + Empfänger, Steuernummer/    */
/* USt-IdNr, Ausstellungsdatum, fortlaufende Rechnungsnummer, Art und  */
/* Umfang + Zeitpunkt der Leistung, Entgelt nach Steuersätzen, Steuer- */
/* betrag bzw. Hinweis auf Steuerbefreiung. Already received payments  */
/* (Anzahlungen) are deducted as an Endrechnung (§ 14 Abs. 5 UStG).     */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatIsoDate } from "@/components/buchhaltung/api";
import { type Invoice, type InvoiceReminder, REMINDER_LABELS } from "@/lib/invoice-types";
import { formatCents, splitVat } from "@/lib/money";

function cityFromAddress(address: string): string {
  const last = address.split(",").pop() ?? "";
  return last.replace(/\d/g, "").trim();
}

function IssuerHeader({ invoice, title }: { invoice: Invoice; title: string }) {
  const { issuer } = invoice;
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
        <span className="text-2xl font-bold uppercase tracking-wide">{title}</span>
      </div>
      <div className="h-px bg-black/20" />
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{invoice.recipient.name}</span>
          {invoice.recipient.address
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => (
              <span key={part}>{part}</span>
            ))}
        </div>
        <div className="grid grid-cols-[auto_auto] gap-x-3 text-right">
          <span className="text-black/60">Rechnungsnr.</span>
          <span className="font-medium">{invoice.invoiceNr}</span>
          <span className="text-black/60">Rechnungsdatum</span>
          <span>{formatIsoDate(invoice.date)}</span>
          <span className="text-black/60">Kundennr.</span>
          <span>{invoice.customerNo}</span>
          {invoice.contractNo && (
            <>
              <span className="text-black/60">Vertrag</span>
              <span>{invoice.contractNo}</span>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function BankFooter({ invoice }: { invoice: Invoice }) {
  const { issuer } = invoice;
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

export function InvoiceSheet({ invoice }: { invoice: Invoice }) {
  const isStorno = invoice.kind === "storno";
  const hasVat = invoice.lines.some((line) => (line.vatRate ?? 0) > 0);
  const hasDurchlaufend = invoice.lines.some((line) => line.durchlaufend);
  const hasSteuerfrei = invoice.lines.some((line) => line.steuerfrei);
  const hasNichtSteuerbar = invoice.lines.some(
    (line) => line.vatRate == null && !line.durchlaufend,
  );
  const due = invoice.totalCents - invoice.prepaidCents;

  return (
    <div className="flex min-h-[1000px] w-full flex-col gap-5 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      <IssuerHeader invoice={invoice} title={isStorno ? "Stornorechnung" : "Rechnung"} />

      {isStorno && invoice.stornoOf && (
        <p>
          Hiermit stornieren wir die Rechnung{" "}
          <strong>{invoice.stornoOf.invoiceNr}</strong>
          {invoice.stornoReason ? ` (Grund: ${invoice.stornoReason})` : ""}.
        </p>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/30 text-left text-[11px] uppercase tracking-wide text-black/60">
            <th className="py-1.5 pr-2 font-medium">Leistungsdatum</th>
            <th className="py-1.5 pr-2 font-medium">Leistung</th>
            <th className="py-1.5 pr-2 text-right font-medium">Netto</th>
            <th className="py-1.5 pr-2 text-right font-medium">USt</th>
            <th className="whitespace-nowrap py-1.5 text-right font-medium">
              Brutto, EUR
            </th>
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

      <div className="ml-auto grid w-80 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        {invoice.vatSummary.map((row) => (
          <FragmentRow
            key={String(row.vatRate)}
            label={
              row.vatRate == null
                ? "Ohne USt"
                : `Netto ${row.vatRate} % (${formatCents(row.netCents)}) · USt`
            }
            value={row.vatRate == null ? row.grossCents : row.vatCents}
          />
        ))}
        <span className="border-t border-black/30 pt-1 font-semibold">Gesamtbetrag</span>
        <span className="border-t border-black/30 pt-1 text-right font-bold tabular-nums">
          {formatCents(invoice.totalCents)} €
        </span>
        {!isStorno && invoice.prepaidCents > 0 && (
          <>
            <span className="text-black/70">
              abzgl. erhaltener Anzahlungen
              <br />
              <span className="text-[11px]">
                (darin USt 19 %:{" "}
                {formatCents(splitVat(invoice.prepaidCents, 19).vatCents)} €)
              </span>
            </span>
            <span className="text-right tabular-nums">
              −{formatCents(invoice.prepaidCents)} €
            </span>
            <span className="font-semibold">Zu zahlen</span>
            <span className="text-right font-bold tabular-nums">
              {formatCents(due)} €
            </span>
          </>
        )}
      </div>

      {!isStorno && (
        <p>
          {due > 0
            ? `Bitte überweisen Sie ${formatCents(due)} € bis zum ${formatIsoDate(invoice.dueDate)} unter Angabe der Rechnungsnummer ${invoice.invoiceNr}.`
            : "Der Rechnungsbetrag ist durch Ihre Anzahlungen bereits beglichen."}
        </p>
      )}
      {!isStorno && invoice.prepaidCents > 0 && (
        <p className="text-[11px] text-black/60">
          Endrechnung: Die Anzahlungen wurden bei Zahlungseingang mit 19 % Umsatzsteuer
          versteuert und sind hier samt enthaltener Steuer abgesetzt (§ 14 Abs. 5 UStG).
        </p>
      )}
      {invoice.note && <p>{invoice.note}</p>}

      {(hasDurchlaufend || hasSteuerfrei || hasNichtSteuerbar || !hasVat) && (
        <div className="flex flex-col gap-0.5 text-[11px] text-black/60">
          {hasDurchlaufend && (
            <span>
              * Durchlaufender Posten (§ 10 Abs. 1 UStG) — im Namen und für Rechnung des
              Fahrschülers verauslagt, keine Umsatzsteuer.
            </span>
          )}
          {hasSteuerfrei && <span>** Steuerfreie Leistung nach § 4 Nr. 21 UStG.</span>}
          {hasNichtSteuerbar && <span>*** Nicht steuerbar (kein Leistungsentgelt).</span>}
        </div>
      )}

      <span>
        {cityFromAddress(invoice.issuer.address)}, den {formatIsoDate(invoice.date)}
      </span>
      <BankFooter invoice={invoice} />
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span className="text-black/70">{label}</span>
      <span className="text-right tabular-nums">{formatCents(value)} €</span>
    </>
  );
}

export function ReminderSheet({
  invoice,
  reminder,
}: {
  invoice: Invoice;
  reminder: InvoiceReminder;
}) {
  const label = REMINDER_LABELS[reminder.level];
  const total = reminder.openCents + reminder.feeCents;
  return (
    <div className="flex min-h-[1000px] w-full flex-col gap-5 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      <IssuerHeader invoice={invoice} title={label} />
      <p className="font-medium">
        {label} zu Rechnung {invoice.invoiceNr} vom {formatIsoDate(invoice.date)}
      </p>
      <p>
        {reminder.level === 1
          ? "sicherlich ist es Ihrer Aufmerksamkeit entgangen: Zu der oben genannten Rechnung konnten wir bisher keinen vollständigen Zahlungseingang feststellen."
          : "trotz unserer bisherigen Erinnerung ist die oben genannte Rechnung noch nicht vollständig beglichen."}
      </p>
      <div className="ml-auto grid w-80 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        <span className="text-black/70">Offener Rechnungsbetrag</span>
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
        <strong>{formatIsoDate(reminder.dueDate)}</strong> unter Angabe der
        Rechnungsnummer {invoice.invoiceNr}.
        {reminder.level === 3 &&
          " Sollte bis dahin kein Zahlungseingang erfolgen, behalten wir uns weitere Schritte vor."}
      </p>
      <p>
        Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben
        bitte als gegenstandslos.
      </p>
      <span>
        {cityFromAddress(invoice.issuer.address)}, den {formatIsoDate(reminder.date)}
      </span>
      <BankFooter invoice={invoice} />
    </div>
  );
}

/* One dialog for all printable invoice documents. */
export type PrintTarget =
  | { kind: "invoice"; invoice: Invoice }
  | { kind: "reminder"; invoice: Invoice; reminder: InvoiceReminder };

export function InvoicePrintDialog({
  target,
  onClose,
}: {
  target: PrintTarget | null;
  onClose: () => void;
}) {
  const [printRoot] = useState(() => document.getElementById("print-root"));
  const sheet =
    target == null ? null : target.kind === "invoice" ? (
      <InvoiceSheet invoice={target.invoice} />
    ) : (
      <ReminderSheet invoice={target.invoice} reminder={target.reminder} />
    );
  const missingTaxId =
    target != null &&
    !target.invoice.issuer.steuernummer &&
    !target.invoice.issuer.ustIdNr;

  return (
    <Dialog
      open={target != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {target?.kind === "reminder"
              ? `${REMINDER_LABELS[target.reminder.level]} · ${target.invoice.invoiceNr}`
              : target?.invoice.kind === "storno"
                ? `Stornorechnung ${target.invoice.invoiceNr}`
                : `Rechnung ${target?.invoice.invoiceNr ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            Vorschau — Drucken erzeugt das A4-Dokument.
          </DialogDescription>
        </DialogHeader>
        {missingTaxId && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Weder Steuernummer noch USt-IdNr hinterlegt — ohne sie ist die Rechnung
              nicht § 14 UStG-konform. Bitte im Profil ergänzen.
            </span>
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto rounded-lg border shadow-sm">
          {sheet}
        </div>
        {printRoot &&
          sheet &&
          createPortal(<div className="bg-white">{sheet}</div>, printRoot)}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer data-icon="inline-start" />
            Drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
