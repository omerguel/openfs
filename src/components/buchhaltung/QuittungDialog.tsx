/* ------------------------------------------------------------------ */
/* Quittung — gültiger Zahlungsbeleg nach § 368 BGB / § 14 UStG.       */
/*                                                                     */
/* QuittungSheet renders the A4 document. The dialog shows it as a     */
/* preview and additionally portals a copy into <div id="print-root">  */
/* (outside #root); @media print CSS in index.css hides everything     */
/* else, so window.print() emits exactly the receipt.                  */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, TriangleAlert } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { amountInWords } from "@/lib/amount-in-words";
import { PAYMENT_METHOD_LABELS, type QuittungData } from "@/lib/accounting-types";
import { printDocument } from "@/lib/print";
import { formatCents } from "@/lib/money";
import { accountingApi, formatIsoDate } from "./api";

/** "Lorscher Straße 6, 60489 Frankfurt am Main" → "Frankfurt am Main" */
function cityFromAddress(address: string): string {
  const last = address.split(",").pop() ?? "";
  return last.replace(/\d/g, "").trim();
}

function QuittungSheet({ data }: { data: QuittungData }) {
  const showVatColumns = data.lines.some((line) => (line.vatRate ?? 0) > 0);
  const hasDurchlaufend = data.lines.some((line) => line.durchlaufenderPosten);
  const hasSteuerfrei = data.lines.some(
    (line) => line.vatRate === 0 && !line.durchlaufenderPosten,
  );
  const taxIds = [
    data.issuer.steuernummer && `Steuernummer: ${data.issuer.steuernummer}`,
    data.issuer.ustIdNr && `USt-IdNr.: ${data.issuer.ustIdNr}`,
  ].filter(Boolean);

  return (
    <div className="flex w-full flex-col gap-6 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      {/* Kopf: Aussteller + Dokument */}
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">{data.issuer.name}</span>
          <span>{data.issuer.address}</span>
          <span>
            {[data.issuer.phone && `Tel. ${data.issuer.phone}`, data.issuer.email]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {taxIds.map((line) => (
            <span key={String(line)}>{line}</span>
          ))}
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-2xl font-bold tracking-wide">QUITTUNG</span>
          <span className="font-medium">Nr. {data.quittungNr}</span>
          <span>Datum: {formatIsoDate(data.date)}</span>
          {data.belegNr && <span>Beleg-Nr.: {data.belegNr}</span>}
        </div>
      </div>

      <div className="h-px bg-black/20" />

      {/* Empfänger / Zahler */}
      {data.recipient && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-black/60">
            Erhalten von
          </span>
          <span className="font-medium">{data.recipient.name}</span>
          {data.recipient.address && <span>{data.recipient.address}</span>}
        </div>
      )}

      {/* Leistung */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-black/60">
          Art und Umfang der Leistung / Verwendungszweck
        </span>
        <span>{data.verwendungszweck}</span>
      </div>

      {/* Beträge */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/30 text-left text-[11px] uppercase tracking-wide text-black/60">
            <th className="py-1.5 pr-2 font-medium">Bezeichnung</th>
            {showVatColumns && (
              <>
                <th className="py-1.5 pr-2 text-right font-medium">Netto, EUR</th>
                <th className="py-1.5 pr-2 text-right font-medium">USt-Satz</th>
                <th className="py-1.5 pr-2 text-right font-medium">USt, EUR</th>
              </>
            )}
            <th className="py-1.5 text-right font-medium">Brutto, EUR</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={index} className="border-b border-black/10">
              <td className="py-1.5 pr-2">
                {line.description}
                {line.durchlaufenderPosten && " *"}
                {line.vatRate === 0 && !line.durchlaufenderPosten && " **"}
              </td>
              {showVatColumns && (
                <>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatCents(line.netCents)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {line.vatRate == null ? "—" : `${line.vatRate} %`}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatCents(line.vatCents)}
                  </td>
                </>
              )}
              <td className="py-1.5 text-right tabular-nums">
                {formatCents(line.grossCents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={showVatColumns ? 4 : 1}
              className="py-2 pr-2 text-right font-semibold"
            >
              Gesamtbetrag
            </td>
            <td className="py-2 text-right text-base font-bold tabular-nums">
              {formatCents(data.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="flex flex-col gap-1">
        <span>
          <span className="text-black/60">Betrag in Worten:</span>{" "}
          <span className="font-medium">— {amountInWords(data.totalCents)} —</span>
        </span>
        {data.paymentMethod && (
          <span>
            <span className="text-black/60">Zahlungsart:</span>{" "}
            {PAYMENT_METHOD_LABELS[data.paymentMethod]}
          </span>
        )}
        <span className="pt-1 font-medium">Betrag dankend erhalten.</span>
      </div>

      {(hasDurchlaufend || hasSteuerfrei) && (
        <div className="flex flex-col gap-0.5 text-[11px] text-black/60">
          {hasDurchlaufend && (
            <span>
              * Durchlaufender Posten (§ 10 Abs. 1 UStG) — kein Entgelt, keine
              Umsatzsteuer.
            </span>
          )}
          {hasSteuerfrei && <span>** Steuerfreie Leistung nach § 4 Nr. 21 UStG.</span>}
        </div>
      )}

      {/* Unterschrift */}
      <div className="mt-8 flex items-end justify-between gap-8">
        <span>
          {cityFromAddress(data.issuer.address)}, den {formatIsoDate(data.date)}
        </span>
        <div className="flex w-64 flex-col items-center gap-1">
          <div className="w-full border-t border-black/60" />
          <span className="text-[11px] text-black/60">Unterschrift Aussteller</span>
        </div>
      </div>
    </div>
  );
}

export function QuittungDialog({
  transactionIds,
  onClose,
}: {
  transactionIds: number[];
  onClose: () => void;
}) {
  const [data, setData] = useState<QuittungData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!transactionIds.length) {
      setData([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData([]);

    Promise.allSettled(transactionIds.map((id) => accountingApi.quittung(id)))
      .then((results) => {
        if (cancelled) return;
        const nextData: QuittungData[] = [];
        let failed = 0;

        results.forEach((result) => {
          if (result.status === "fulfilled") {
            nextData.push(result.value);
          } else {
            failed += 1;
          }
        });

        if (!nextData.length) {
          if (failed > 0) {
            toast.error("Keine der ausgewählten Quittungen konnten geladen werden.");
          }
          onClose();
        } else if (failed > 0) {
          const parts = transactionIds.length === 1 ? "" : "n";
          toast.error(
            `${failed} Quittung${parts} im Batch konnten nicht geladen werden.`,
          );
        }

        setData(nextData);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Quittung nicht verfügbar.");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionIds.join(","), onClose]);

  const printRoot = document.getElementById("print-root");
  const missingTaxId = data.some(
    (entry) => !entry.issuer.steuernummer && !entry.issuer.ustIdNr,
  );
  const title =
    data.length === 1
      ? `Quittung ${data[0]!.quittungNr}`
      : data.length > 1
        ? `${data.length} Quittungen drucken`
        : "Quittung";
  const showDescription =
    data.length > 1
      ? `Quittungen (Zahlungsbelege) für alle ${data.length} Zahlungen im aktuellen Filter.`
      : "Gültiger Zahlungsbeleg nach § 368 BGB und § 14 UStG.";

  return (
    <Dialog
      open={transactionIds.length > 0}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{showDescription}</DialogDescription>
        </DialogHeader>

        {missingTaxId && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Es ist weder Steuernummer noch USt-IdNr hinterlegt — die Quittung ist so
              nicht als Rechnung i. S. d. § 14 UStG gültig. Bitte im Profil unter
              Schulinformationen ergänzen.
            </span>
          </div>
        )}

        {loading || !data.length ? (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-auto rounded-lg border shadow-sm">
              <div className="flex flex-col gap-6 p-2">
                {data.map((item) => (
                  <QuittungSheet key={item.quittungNr} data={item} />
                ))}
              </div>
            </div>
            {/* Print copy outside the app root — the only thing printed. */}
            {printRoot &&
              createPortal(
                <div className="bg-white">
                  {data.map((item, index) => (
                    <div
                      key={`${item.quittungNr}-${index}`}
                      style={{
                        breakAfter: index + 1 < data.length ? "page" : "auto",
                      }}
                    >
                      <QuittungSheet data={item} />
                    </div>
                  ))}
                </div>,
                printRoot,
              )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
          <Button
            type="button"
            disabled={!data.length}
            onClick={() =>
              printDocument(
                data.length === 1 ? `Quittung-${data[0]!.quittungNr}` : "Quittungen",
              )
            }
          >
            <Printer data-icon="inline-start" />
            Drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
