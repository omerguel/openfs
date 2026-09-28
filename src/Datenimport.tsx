/* ------------------------------------------------------------------ */
/* Datenimport — Fahrschüler aus einer CSV-Datei übernehmen (Umstieg   */
/* von Fahrschulmanager, FahrschulOffice, ClickClickDrive oder Excel). */
/*                                                                     */
/* Datei wählen → Spalten zuordnen (automatisch vorbelegt) → Vorschau  */
/* mit Status je Zeile → Import (serverseitig in einer Transaktion).   */
/* Eine optionale Saldo-Spalte wird je Fahrschüler als Saldovortrag    */
/* (9000 ↔ 3272) zum gewählten Datum in derselben Transaktion gebucht.*/
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Download, FileUp, Info, Upload } from "lucide-react";
import { toast } from "sonner";

import { FormSection as Section } from "./components/FormSection.tsx";
import { PageHeader } from "./components/PageHeader.tsx";
import { commitStudentImport, previewStudentImport } from "@/hooks/use-student-import";
import {
  CSV_DELIMITERS,
  DELIMITER_LABELS,
  decodeCsvBytes,
  parseCsv,
  toCsv,
  type CsvDelimiter,
  type CsvEncoding,
} from "@/lib/csv";
import {
  autoMapHeaders,
  FIELD_LABELS,
  IMPORT_FIELDS,
  studentImportTemplate,
  type ImportCommitResult,
  type ImportField,
  type ImportMapping,
  type ImportPreview,
  type ImportRequest,
  type ImportRowResult,
  type ImportRowStatus,
} from "@/lib/student-import";
import { formatEuro } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const NONE = "__none";
const PREVIEW_LIMIT = 500;

type LoadedFile = {
  name: string;
  text: string;
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  rows: string[][];
};

const STATUS_META: Record<ImportRowStatus, { label: string; dot: string }> = {
  import: { label: "Bereit", dot: "bg-green-500" },
  skip: { label: "Übersprungen", dot: "bg-muted-foreground/50" },
  error: { label: "Fehler", dot: "bg-red-500" },
};

function StatusBadge({ status }: { status: ImportRowStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

function downloadTemplate() {
  // BOM so Excel opens the UTF-8 file with umlauts intact.
  const csv = `﻿${toCsv(studentImportTemplate(), ";")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "fahrschueler-vorlage.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function Readout({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function FileDrop({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <fieldset
      aria-label="CSV-Datei ablegen"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        "m-0 flex min-w-0 flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors duration-150 hover:duration-0",
        over ? "border-primary bg-muted" : "bg-muted/20",
      )}
    >
      <FileUp className="size-5 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">CSV-Datei hierher ziehen</span>
        <span className="text-sm text-pretty text-muted-foreground">
          Export aus Fahrschulmanager, FahrschulOffice, ClickClickDrive oder eine
          Excel-Liste („Speichern unter → CSV“).
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
      >
        <Upload data-icon="inline-start" />
        Datei auswählen
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </fieldset>
  );
}

function MappingTable({
  headers,
  sample,
  mapping,
  onChange,
}: {
  headers: string[];
  sample: string[];
  mapping: ImportMapping;
  onChange: (column: number, field: ImportField | null) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Spalte in der Datei</TableHead>
            <TableHead className="hidden sm:table-cell">Beispielwert</TableHead>
            <TableHead className="w-[220px]">Feld in OpenFS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {headers.map((header, column) => (
            <TableRow key={`${column}-${header}`}>
              <TableCell className="font-medium">{header}</TableCell>
              <TableCell className="hidden max-w-[280px] truncate text-muted-foreground sm:table-cell">
                {sample[column] || "—"}
              </TableCell>
              <TableCell>
                <Select
                  value={mapping[column] ?? NONE}
                  onValueChange={(value) =>
                    onChange(column, value === NONE ? null : (value as ImportField))
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={`Feld für Spalte ${header}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>Nicht importieren</SelectItem>
                      {IMPORT_FIELDS.map((f) => (
                        <SelectItem key={f.field} value={f.field}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Notes({ row }: { row: ImportRowResult }) {
  if (row.errors.length === 0 && row.warnings.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {row.errors.map((message) => (
        <li key={message} className="text-red-700 dark:text-red-400">
          {message}
        </li>
      ))}
      {row.warnings.map((message) => (
        <li key={message} className="text-amber-700 dark:text-amber-400">
          {message}
        </li>
      ))}
    </ul>
  );
}

function IdCell({ value, generated }: { value: string; generated: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn("font-mono text-[13px]", generated && "text-muted-foreground")}>
        {value || "—"}
      </span>
      {generated && <span className="ml-1.5 text-[11px] text-muted-foreground">neu</span>}
    </span>
  );
}

function BalanceCell({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        cents > 0
          ? "text-green-700 dark:text-green-400"
          : "text-red-700 dark:text-red-400",
      )}
    >
      {formatEuro(cents)}
    </span>
  );
}

function PreviewTable({
  rows,
  showBalance,
}: {
  rows: ImportRowResult[];
  showBalance: boolean;
}) {
  const shown = rows.slice(0, PREVIEW_LIMIT);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-14 text-right">Zeile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Geburtsdatum</TableHead>
              <TableHead>Klasse</TableHead>
              <TableHead>Kundennr.</TableHead>
              <TableHead>Vertragsnr.</TableHead>
              <TableHead>Fahrlehrer/in</TableHead>
              {showBalance && <TableHead className="text-right">Saldo</TableHead>}
              <TableHead className="min-w-[260px]">Hinweise</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.row} className="align-top">
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.row}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="font-medium whitespace-nowrap">
                  {`${row.student.firstName} ${row.student.lastName}`.trim() || "—"}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {row.student.birthday || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.student.classes || "—"}
                </TableCell>
                <TableCell>
                  <IdCell
                    value={row.student.customerNumber}
                    generated={row.generated.customerNumber}
                  />
                </TableCell>
                <TableCell>
                  <IdCell
                    value={row.student.contractNumber}
                    generated={row.generated.contractNumber}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.student.instructor}
                </TableCell>
                {showBalance && (
                  <TableCell className="text-right">
                    <BalanceCell cents={row.student.balanceCents} />
                  </TableCell>
                )}
                <TableCell className="whitespace-normal">
                  <Notes row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > shown.length && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {rows.length - shown.length} weitere Zeilen werden nicht angezeigt.
        </p>
      )}
    </div>
  );
}

function ImportDone({
  result,
  onRestart,
}: {
  result: ImportCommitResult;
  onRestart: () => void;
}) {
  const rest = [
    result.skipped > 0 && `${result.skipped} übersprungen`,
    result.failed > 0 && `${result.failed} fehlerhaft und nicht übernommen`,
  ].filter(Boolean);
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheck />
        </EmptyMedia>
        <EmptyTitle className="tabular-nums">
          {result.imported} Fahrschüler importiert
        </EmptyTitle>
        <EmptyDescription className="tabular-nums">
          {rest.length > 0 ? `${rest.join(", ")}.` : "Alle Zeilen wurden übernommen."}{" "}
          {result.openingBalances > 0
            ? `${result.openingBalances} Saldenvorträge gebucht (Buchhaltung → Journal).`
            : "Salden können in der Buchhaltung als Saldovortrag gebucht werden."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button asChild size="sm">
          <Link to="/fahrschueler">Zu den Fahrschülern</Link>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRestart}>
          Weitere Datei importieren
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function Datenimport() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [balanceDate, setBalanceDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
  });
  const balanceMapped = Object.values(mapping).includes("balance");

  const width = useMemo(
    () => (file ? Math.max(0, ...file.rows.map((row) => row.length)) : 0),
    [file],
  );
  const headers = useMemo(
    () =>
      Array.from({ length: width }, (_, i) =>
        hasHeader && file?.rows[0]?.[i]?.trim()
          ? file.rows[0][i]!.trim()
          : `Spalte ${i + 1}`,
      ),
    [file, hasHeader, width],
  );
  const sample = (file?.rows[hasHeader ? 1 : 0] ?? []) as string[];
  const dataRowCount = file ? Math.max(0, file.rows.length - (hasHeader ? 1 : 0)) : 0;

  const request = useMemo<ImportRequest | null>(
    () =>
      file
        ? {
            rows: file.rows,
            mapping: Object.fromEntries(Object.entries(mapping)),
            options: {
              hasHeader,
              ...(balanceMapped ? { openingBalanceDate: balanceDate } : {}),
            },
          }
        : null,
    [file, mapping, hasHeader, balanceMapped, balanceDate],
  );

  // Server-side check of every row, debounced while the mapping changes.
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    // Mark stale right away so the import button waits for the new result.
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        setPreview(await previewStudentImport(request, controller.signal));
        setPreviewError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(
          error instanceof Error ? error.message : "Prüfung fehlgeschlagen.",
        );
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  const load = (next: LoadedFile, header: boolean) => {
    setFile(next);
    setMapping(header && next.rows[0] ? autoMapHeaders(next.rows[0]) : {});
    setPreview(null);
    setPreviewError(null);
    setResult(null);
  };

  const readFile = async (picked: File) => {
    if (/\.(xlsx?|ods|numbers)$/i.test(picked.name)) {
      toast.error("Bitte als CSV speichern", {
        description:
          "Tabellen bitte in Excel über „Speichern unter → CSV UTF-8“ exportieren und die CSV-Datei hochladen.",
      });
      return;
    }
    try {
      const { text, encoding } = decodeCsvBytes(await picked.arrayBuffer());
      const { rows, delimiter } = parseCsv(text);
      if (rows.length === 0) {
        toast.error("Die Datei ist leer.");
        return;
      }
      load({ name: picked.name, text, encoding, delimiter, rows }, hasHeader);
    } catch {
      toast.error("Die Datei konnte nicht gelesen werden.");
    }
  };

  const changeDelimiter = (delimiter: CsvDelimiter) => {
    if (!file) return;
    const { rows } = parseCsv(file.text, delimiter);
    load({ ...file, delimiter, rows }, hasHeader);
  };

  const changeHeader = (value: boolean) => {
    setHasHeader(value);
    if (file) setMapping(value && file.rows[0] ? autoMapHeaders(file.rows[0]) : {});
  };

  // Each field belongs to one column: picking it here clears it elsewhere.
  const changeMapping = (column: number, field: ImportField | null) => {
    setMapping((current) => {
      const next: ImportMapping = {};
      for (const [key, value] of Object.entries(current)) {
        if (Number(key) !== column && value !== field) next[Number(key)] = value;
      }
      if (field) next[column] = field;
      return next;
    });
  };

  const restart = () => {
    setFile(null);
    setMapping({});
    setPreview(null);
    setPreviewError(null);
    setResult(null);
  };

  const importable = preview?.summary.importable ?? 0;
  const balances = preview?.openingBalances ?? null;
  const missingBalanceDate = balanceMapped && (balances?.count ?? 0) > 0 && !balanceDate;
  const canImport =
    !!request &&
    !!preview &&
    importable > 0 &&
    !checking &&
    !committing &&
    !missingBalanceDate;

  const runImport = async () => {
    if (!request) return;
    setCommitting(true);
    try {
      const done = await commitStudentImport(request);
      setResult(done);
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      toast.success(`${done.imported} Fahrschüler importiert`);
    } catch (error) {
      toast.error("Import fehlgeschlagen", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCommitting(false);
      setConfirmOpen(false);
    }
  };

  const mappedFields = new Set(Object.values(mapping));
  const missingNames = (["firstName", "lastName"] as const).filter(
    (field) => !mappedFields.has(field),
  );
  const visibleRows =
    preview?.rows.filter(
      (row) => filter === "all" || row.errors.length > 0 || row.warnings.length > 0,
    ) ?? [];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="hidden sm:inline-flex"
            >
              <Download data-icon="inline-start" />
              Vorlage herunterladen
            </Button>
            {!result && (
              <Button
                type="button"
                size="sm"
                disabled={!canImport}
                onClick={() => setConfirmOpen(true)}
                className="tabular-nums"
              >
                <Upload data-icon="inline-start" />
                {importable} Fahrschüler importieren
              </Button>
            )}
          </>
        }
      >
        <span className="text-sm font-medium">Datenimport</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="stagger-in mx-auto flex w-full max-w-[1080px] flex-col gap-8 pb-16">
          {result ? (
            <ImportDone result={result} onRestart={restart} />
          ) : (
            <>
              <Section
                id="datei"
                title="Datei"
                description="Fahrschülerliste als CSV-Datei. Trennzeichen und Zeichensatz werden automatisch erkannt."
              >
                <Alert>
                  <Info />
                  <AlertTitle>
                    Salden nur nach Absprache mit der Steuerberatung
                  </AlertTitle>
                  <AlertDescription className="text-pretty">
                    Eine Spalte „Saldo“ (positiv = Guthaben, negativ = offener Betrag)
                    wird je Fahrschüler als Saldovortrag gebucht: 9000 Saldenvorträge an
                    3272 Erhaltene Anzahlungen bzw. umgekehrt, ohne
                    Umsatzsteuer-Aufteilung. Wie Eröffnungssalden und die Umsatzsteuer auf
                    alte Anzahlungen zu behandeln sind, bitte vorher mit Ihrer
                    Steuerberatung abstimmen.
                  </AlertDescription>
                </Alert>

                {file ? (
                  <div className="flex flex-col gap-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                      <Readout
                        label="Datei"
                        value={
                          <span className="block max-w-[260px] truncate">
                            {file.name}
                          </span>
                        }
                      />
                      <Readout label="Zeichensatz" value={file.encoding} />
                      <Readout label="Datenzeilen" value={dataRowCount} />
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Trennzeichen
                        </span>
                        <Select
                          value={file.delimiter}
                          onValueChange={(value) =>
                            changeDelimiter(value as CsvDelimiter)
                          }
                        >
                          <SelectTrigger size="sm" aria-label="Trennzeichen">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {CSV_DELIMITERS.map((delimiter) => (
                                <SelectItem key={delimiter} value={delimiter}>
                                  {DELIMITER_LABELS[delimiter]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={restart}
                        className="ml-auto"
                      >
                        Andere Datei
                      </Button>
                    </div>
                    <Label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-normal">
                      <Checkbox
                        checked={hasHeader}
                        onCheckedChange={(value) => changeHeader(value === true)}
                      />
                      Erste Zeile enthält Spaltennamen
                    </Label>
                  </div>
                ) : (
                  <FileDrop onFile={readFile} />
                )}
              </Section>

              {file && (
                <Section
                  id="zuordnung"
                  title="Spaltenzuordnung"
                  description="Automatisch anhand der Spaltennamen vorbelegt. Getrennte Angaben zu Straße, PLZ und Ort werden zu einer Adresse zusammengefasst."
                >
                  {missingNames.length > 0 && (
                    <p className="text-sm text-red-700 dark:text-red-400">
                      Bitte{" "}
                      {missingNames.map((field) => FIELD_LABELS[field]).join(" und ")}{" "}
                      zuordnen.
                    </p>
                  )}
                  <MappingTable
                    headers={headers}
                    sample={sample}
                    mapping={mapping}
                    onChange={changeMapping}
                  />
                  {balanceMapped && (
                    <div className="flex flex-col gap-1.5 rounded-lg border p-4">
                      <Label htmlFor="balance-date">
                        Buchungsdatum der Saldenvorträge
                      </Label>
                      <Input
                        id="balance-date"
                        type="date"
                        className="w-44"
                        value={balanceDate}
                        onChange={(event) => setBalanceDate(event.target.value)}
                      />
                      <span className="text-xs text-pretty text-muted-foreground">
                        Üblich ist der Stichtag der Datenübernahme. Jeder Saldo wird als
                        eigener Beleg gebucht und kann nur per Storno korrigiert werden.
                      </span>
                    </div>
                  )}
                </Section>
              )}

              {file && (
                <Section
                  id="vorschau"
                  title="Vorschau"
                  description="Bereits vorhandene Fahrschüler (gleiche Kundennummer oder gleicher Name mit Geburtsdatum) werden übersprungen. Fehlende Kunden- und Vertragsnummern vergibt das System."
                >
                  {previewError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{previewError}</AlertDescription>
                    </Alert>
                  ) : preview ? (
                    <>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-center gap-4 text-sm tabular-nums">
                          <span className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-green-500" />
                            {preview.summary.importable} bereit
                          </span>
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                            {preview.summary.skipped} übersprungen
                          </span>
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-red-500" />
                            {preview.summary.failed} mit Fehlern
                          </span>
                          {balances && balances.count > 0 && (
                            <span className="text-muted-foreground">
                              {balances.count} Salden · {formatEuro(balances.creditCents)}{" "}
                              Guthaben · {formatEuro(balances.debitCents)} offen
                            </span>
                          )}
                          {checking && (
                            <span className="text-muted-foreground">Prüfe …</span>
                          )}
                        </div>
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          size="sm"
                          spacing={0}
                          value={filter}
                          onValueChange={(value) => {
                            if (value === "all" || value === "issues") setFilter(value);
                          }}
                          className="ml-auto"
                          aria-label="Zeilen filtern"
                        >
                          <ToggleGroupItem value="all">Alle</ToggleGroupItem>
                          <ToggleGroupItem value="issues">Mit Hinweisen</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                      <PreviewTable rows={visibleRows} showBalance={balanceMapped} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Prüfe Zeilen …</p>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="tabular-nums">
              {importable} Fahrschüler importieren?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Übersprungene und fehlerhafte Zeilen werden nicht übernommen. Der Import
              erfolgt vollständig oder gar nicht.
              {balances && balances.count > 0
                ? ` Dabei werden ${balances.count} Saldenvorträge zum ${balanceDate
                    .split("-")
                    .reverse()
                    .join(".")} gebucht.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={committing}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={committing}
              onClick={(event) => {
                event.preventDefault();
                void runImport();
              }}
            >
              Importieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default Datenimport;
