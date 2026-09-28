/* ------------------------------------------------------------------ */
/* Kassenbuch / Bankbuch: every movement of one Geldkonto in the       */
/* chosen period with running balance, totals, CSV export and a        */
/* printable view. A Kasse must never go below zero — rows where the   */
/* running balance is negative are highlighted.                        */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Download, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Cashbook } from "@/lib/accounting-report-types";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { accountingApi, downloadFile, formatIsoDate, toIsoDate, useApi } from "./api";
import { money, PrintTable, type PrintJob } from "./ReportPrint";

function rangeQuery(range: DateRange | undefined): string {
  const params = new URLSearchParams();
  if (range?.from) {
    params.set("from", toIsoDate(range.from));
    params.set("to", toIsoDate(range.to ?? range.from));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function rangeLabel(book: Cashbook): string {
  if (!book.from && !book.to) return "Gesamter Zeitraum";
  return `${book.from ? formatIsoDate(book.from) : "…"} – ${book.to ? formatIsoDate(book.to) : "…"}`;
}

export function cashbookPrintJob(book: Cashbook): PrintJob {
  const kind = book.account.number === "1600" ? "Kassenbuch" : "Bankbuch";
  return {
    title: `${kind} ${book.account.number} ${rangeLabel(book)}`,
    subtitle: `${book.account.name} · Anfangsbestand ${formatCents(book.openingCents)} € · Endbestand ${formatCents(book.closingCents)} €`,
    body: (
      <PrintTable
        head={["Datum", "Beleg", "Beschreibung", "Einnahme", "Ausgabe", "Saldo"]}
        numeric={[3, 4, 5]}
        rows={[
          ["", "", "Anfangsbestand", "", "", formatCents(book.openingCents)],
          ...book.rows.map((row) => [
            formatIsoDate(row.date),
            row.belegNr ?? "",
            `${row.description}${row.studentName && !row.description.includes(row.studentName) ? ` (${row.studentName})` : ""}${row.isStorno ? " — Stornobuchung" : row.storniert ? " — storniert" : ""}`,
            money(row.inCents),
            money(row.outCents),
            formatCents(row.balanceCents),
          ]),
        ]}
        foot={[
          [
            "",
            "",
            "Summen / Endbestand",
            formatCents(book.totalInCents),
            formatCents(book.totalOutCents),
            formatCents(book.closingCents),
          ],
        ]}
      />
    ),
  };
}

export function CashbookTab({
  range,
  refresh,
  onPrint,
}: {
  range: DateRange | undefined;
  refresh: number;
  onPrint: (job: PrintJob) => void;
}) {
  const [account, setAccount] = useState("1600");
  const query = rangeQuery(range);
  const book = useApi(
    () => accountingApi.cashbook(account, query),
    [account, query, refresh],
  );

  const exportCsv = async () => {
    try {
      const name = await downloadFile(
        `/api/accounting/cashbook/${account}${query ? `${query}&` : "?"}format=csv`,
        `Kassenbuch_${account}.csv`,
      );
      toast.success(`${name} exportiert.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export fehlgeschlagen.");
    }
  };

  const data = book.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={account}
          onValueChange={(value) => value && setAccount(value)}
          aria-label="Geldkonto"
        >
          <ToggleGroupItem value="1600">Kasse · 1600</ToggleGroupItem>
          <ToggleGroupItem value="1800">Bank · 1800</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
          >
            <Download data-icon="inline-start" />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!data}
            onClick={() => data && onPrint(cashbookPrintJob(data))}
          >
            <Printer data-icon="inline-start" />
            Drucken
          </Button>
        </div>
      </div>

      {book.loading && !data ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : book.error || !data ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {book.error ?? "Keine Daten."}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Anfangsbestand", data.openingCents],
              ["Einnahmen", data.totalInCents],
              ["Ausgaben", data.totalOutCents],
              ["Endbestand", data.closingCents],
            ].map(([label, cents]) => (
              <div
                key={label as string}
                className="flex flex-col gap-0.5 rounded-lg border p-3"
              >
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    (cents as number) < 0 && "text-destructive",
                  )}
                >
                  {formatCents(cents as number)} €
                </dd>
              </div>
            ))}
          </dl>
          {data.negativeRows > 0 && account === "1600" && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Der Kassenbestand ist nach {data.negativeRows}{" "}
              {data.negativeRows === 1 ? "Buchung" : "Buchungen"} negativ. Eine Kasse kann
              nicht unter null fallen — bitte die markierten Buchungen prüfen und ggf. per
              Storno korrigieren.
            </p>
          )}
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Keine Bewegungen im gewählten Zeitraum.
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y rounded-lg border sm:hidden">
                {data.rows.map((row) => (
                  <li
                    key={row.transactionId}
                    className={cn(
                      "flex flex-col gap-0.5 px-3 py-2 text-sm",
                      (row.storniert || row.isStorno) && "opacity-60",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatIsoDate(row.date)} · {row.belegNr ?? "ohne Beleg"}
                      </span>
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          row.inCents > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive",
                        )}
                      >
                        {row.inCents > 0
                          ? `+${formatCents(row.inCents)}`
                          : `−${formatCents(row.outCents)}`}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{row.description}</span>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums text-muted-foreground",
                          row.balanceCents < 0 && "text-destructive",
                        )}
                      >
                        Saldo {formatCents(row.balanceCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Datum</TableHead>
                      <TableHead>Beleg</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Einnahme, EUR</TableHead>
                      <TableHead className="text-right">Ausgabe, EUR</TableHead>
                      <TableHead className="pr-4 text-right">Saldo, EUR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="text-muted-foreground">
                      <TableCell className="pl-4" colSpan={5}>
                        Anfangsbestand
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        {formatCents(data.openingCents)}
                      </TableCell>
                    </TableRow>
                    {data.rows.map((row) => (
                      <TableRow
                        key={row.transactionId}
                        className={cn((row.storniert || row.isStorno) && "opacity-60")}
                      >
                        <TableCell className="pl-4 tabular-nums text-muted-foreground">
                          {formatIsoDate(row.date)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.belegNr ?? "–"}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {row.description}
                          <span className="block text-muted-foreground">
                            {row.typeLabel}
                            {row.isStorno ? " · Stornobuchung" : ""}
                            {row.storniert ? " · storniert" : ""}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {money(row.inCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {money(row.outCents)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "pr-4 text-right font-medium tabular-nums",
                            row.balanceCents < 0 && "text-destructive",
                          )}
                        >
                          {formatCents(row.balanceCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="pl-4" colSpan={3}>
                        Summen / Endbestand
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(data.totalInCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(data.totalOutCents)}
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        {formatCents(data.closingCents)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
