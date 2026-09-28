/* ------------------------------------------------------------------ */
/* Umsatzsteuer-Übersicht — a helper to prepare the USt-Voranmeldung   */
/* (month or quarter). It only reads the bookings; filing happens via  */
/* ELSTER or the Steuerberater (DATEV export). Clearly labelled as     */
/* "Vorbereitung, keine Abgabe".                                       */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Info, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import type { VatPeriod, VatReport } from "@/lib/accounting-report-types";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { accountingApi, useApi } from "./api";
import { PrintTable, type PrintJob } from "./ReportPrint";

const COLUMNS: { key: keyof VatPeriod; label: string; hint?: string }[] = [
  { key: "revenue19NetCents", label: "Umsätze 19 % (netto)" },
  { key: "revenue19VatCents", label: "USt 19 %" },
  { key: "revenue7NetCents", label: "Umsätze 7 % (netto)" },
  { key: "revenue7VatCents", label: "USt 7 %" },
  {
    key: "prepayment19VatCents",
    label: "USt auf Anzahlungen",
    hint: "Eingang minus Verrechnung mit Leistungen",
  },
  { key: "taxFreeCents", label: "Steuerfrei 0 %" },
  { key: "outputVatCents", label: "USt gesamt" },
  { key: "inputVatCents", label: "Vorsteuer" },
  { key: "payableCents", label: "Zahllast" },
];

function vatPrintJob(report: VatReport): PrintJob {
  return {
    title: `Umsatzsteuer-Übersicht ${report.year}`,
    subtitle:
      "Vorbereitung der Umsatzsteuer-Voranmeldung — keine Abgabe. Werte aus den Buchungen, bitte mit dem Steuerberater abstimmen.",
    body: (
      <PrintTable
        head={["Zeitraum", ...COLUMNS.map((c) => c.label)]}
        numeric={COLUMNS.map((_, i) => i + 1)}
        rows={report.periods.map((p) => [
          p.label,
          ...COLUMNS.map((c) => formatCents(p[c.key] as number)),
        ])}
        foot={[
          [
            report.total.label,
            ...COLUMNS.map((c) => formatCents(report.total[c.key] as number)),
          ],
        ]}
      />
    ),
  };
}

export function VatTab({
  refresh,
  onPrint,
}: {
  refresh: number;
  onPrint: (job: PrintJob) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState<"month" | "quarter">("quarter");
  const report = useApi(
    () => accountingApi.vatReport(year, period),
    [year, period, refresh],
  );
  const data = report.data;

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-pretty text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Vorbereitung, keine Abgabe.</span>{" "}
          Die Übersicht rechnet die Umsatzsteuer aus Ihren Buchungen zusammen — so wie
          DATEV sie aus dem Export ableitet. Die Voranmeldung selbst geben Sie über ELSTER
          oder Ihren Steuerberater ab. Durchlaufende Posten (TÜV/DEKRA) und Mahngebühren
          sind nicht steuerbar und fehlen hier bewusst.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Jahr"
          value={String(year)}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <NativeSelectOption key={y} value={String(y)}>
              {y}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={period}
          onValueChange={(value) => value && setPeriod(value as "month" | "quarter")}
          aria-label="Zeitraum"
        >
          <ToggleGroupItem value="month">Monate</ToggleGroupItem>
          <ToggleGroupItem value="quarter">Quartale</ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sm:ml-auto"
          disabled={!data}
          onClick={() => data && onPrint(vatPrintJob(data))}
        >
          <Printer data-icon="inline-start" />
          Drucken
        </Button>
      </div>

      {report.loading && !data ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : !data ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {report.error ?? "Keine Daten."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card pl-4">Zeitraum</TableHead>
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c.key}
                    className="text-right whitespace-normal"
                    title={c.hint}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.periods.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="sticky left-0 bg-card pl-4 font-medium">
                    {p.label}
                  </TableCell>
                  {COLUMNS.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "text-right tabular-nums",
                        c.key === "payableCents" && "font-medium",
                        (p[c.key] as number) === 0 && "text-muted-foreground",
                      )}
                    >
                      {formatCents(p[c.key] as number)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 bg-muted pl-4">
                  {data.total.label}
                </TableCell>
                {COLUMNS.map((c) => (
                  <TableCell key={c.key} className="text-right tabular-nums">
                    {formatCents(data.total[c.key] as number)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      <p className="text-xs text-pretty text-muted-foreground">
        Zahllast = Umsatzsteuer gesamt − Vorsteuer (negativ: Erstattung). Die Umsatzsteuer
        auf Anzahlungen entsteht bei Zahlungseingang und wird verrechnet, sobald
        Leistungen vom Ausbildungskonto abgerechnet werden.
      </p>
    </div>
  );
}
