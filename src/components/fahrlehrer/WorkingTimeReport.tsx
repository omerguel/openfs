/* ------------------------------------------------------------------ */
/* Arbeitszeiten — per instructor and day: practical / theory / other  */
/* minutes from the calendar (cancelled Termine excluded), with the    */
/* Fahrlehrergesetz daily limit for practical instruction flagged.     */
/* Absences (Urlaub, Krank, …) in the period are listed per person.    */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { type Absence, useAbsences, useInstructorHours } from "@/hooks/use-absences";
import { addDays, parseISODate, startOfWeek, toISODate } from "@/lib/calendar-data";
import { formatGermanDate, PRACTICAL_LIMIT_LABEL } from "@/lib/working-time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "woche" | "monat";

/** 450 → "7:30 Std." */
const formatHours = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} Std.`;

const weekdayLabel = (iso: string) =>
  parseISODate(iso).toLocaleDateString("de-DE", { weekday: "short" });

function rangeFor(mode: Mode, anchor: Date): { from: string; to: string; label: string } {
  if (mode === "woche") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return {
      from: toISODate(start),
      to: toISODate(end),
      label: `${formatGermanDate(toISODate(start))} – ${formatGermanDate(toISODate(end))}`,
    };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    from: toISODate(start),
    to: toISODate(end),
    label: start.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
  };
}

export function WorkingTimeReport() {
  const [mode, setMode] = useState<Mode>("woche");
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const { data: report, isPending, error } = useInstructorHours(range.from, range.to);
  const { data: absences = [] } = useAbsences({ from: range.from, to: range.to });
  const absencesFor = (instructorId: number): Absence[] =>
    absences.filter((absence) => absence.instructorId === instructorId);
  const absentOn = (instructorId: number, date: string) =>
    absences.find(
      (absence) =>
        absence.instructorId === instructorId &&
        absence.fromDate <= date &&
        absence.toDate >= date,
    );

  const move = (direction: -1 | 1) =>
    setAnchor((current) =>
      mode === "woche"
        ? addDays(current, 7 * direction)
        : new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as Mode);
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Zeitraum"
        >
          <ToggleGroupItem value="woche">Woche</ToggleGroupItem>
          <ToggleGroupItem value="monat">Monat</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zurück"
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Weiter"
            onClick={() => move(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <span className="text-sm font-medium tabular-nums capitalize">{range.label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Praxis = Fahrstunden und Prüfungsfahrten, abgesagte Termine zählen nicht.
        </span>
      </div>

      {isPending ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : error || !report ? (
        <p className="text-sm text-destructive">
          Arbeitszeiten konnten nicht geladen werden.
        </p>
      ) : report.instructors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Fahrlehrer/innen vorhanden.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {report.instructors.map((row) => (
            <section
              key={row.instructorId}
              className="overflow-hidden rounded-lg border"
              aria-label={`Arbeitszeiten ${row.instructor}`}
            >
              <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b bg-muted/30 px-4 py-2.5">
                <h3 className="text-sm font-medium">{row.instructor}</h3>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Praxis</dt>
                    <dd className="font-medium tabular-nums">
                      {formatHours(row.practicalMinutes)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Theorie</dt>
                    <dd className="font-medium tabular-nums">
                      {formatHours(row.theoryMinutes)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Gesamt</dt>
                    <dd className="font-medium tabular-nums">
                      {formatHours(row.totalMinutes)}
                    </dd>
                  </div>
                  {row.overLimitDays > 0 && (
                    <div className="flex items-center gap-1.5 text-destructive">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-destructive"
                      />
                      <dt className="sr-only">Überschreitungen</dt>
                      <dd className="tabular-nums">
                        {row.overLimitDays} {row.overLimitDays === 1 ? "Tag" : "Tage"}{" "}
                        über {report.limitMinutes} Min.
                      </dd>
                    </div>
                  )}
                </dl>
              </header>
              {absencesFor(row.instructorId).length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
                  {absencesFor(row.instructorId).map((absence) => (
                    <li key={absence.id} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-amber-500"
                      />
                      <span className="font-medium text-foreground">{absence.kind}</span>
                      <span className="tabular-nums">
                        {absence.fromDate === absence.toDate
                          ? formatGermanDate(absence.fromDate)
                          : `${formatGermanDate(absence.fromDate)} – ${formatGermanDate(absence.toDate)}`}
                      </span>
                      {absence.note && <span>· {absence.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {row.days.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  Keine Termine im Zeitraum.
                </p>
              ) : (
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Datum</TableHead>
                      <TableHead className="text-right">Praxis</TableHead>
                      <TableHead className="text-right">Theorie</TableHead>
                      <TableHead className="text-right">Sonstiges</TableHead>
                      <TableHead className="text-right">Gesamt</TableHead>
                      <TableHead className="pr-4">Hinweis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.days.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="pl-4 tabular-nums">
                          <span className="mr-1.5 text-muted-foreground">
                            {weekdayLabel(day.date)}
                          </span>
                          {formatGermanDate(day.date)}
                        </TableCell>
                        <TableCell
                          className={
                            day.overLimit
                              ? "text-right font-medium text-destructive tabular-nums"
                              : "text-right tabular-nums"
                          }
                        >
                          {day.practicalMinutes} Min.
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {day.theoryMinutes} Min.
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {day.otherMinutes} Min.
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHours(day.totalMinutes)}
                        </TableCell>
                        <TableCell className="pr-4 whitespace-normal">
                          {absentOn(row.instructorId, day.date) && (
                            <span className="mr-3 inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                              <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-amber-500"
                              />
                              Termine trotz Abwesenheit (
                              {absentOn(row.instructorId, day.date)!.kind})
                            </span>
                          )}
                          {day.overLimit && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                              <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full bg-destructive"
                              />
                              {PRACTICAL_LIMIT_LABEL}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
