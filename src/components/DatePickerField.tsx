/* ------------------------------------------------------------------ */
/* German date picker (TT.MM.JJJJ label + day picker in a popover).    */
/* Replaces native <input type="date">, which shows the browser's      */
/* locale (MM/DD/YYYY in an English Chromium).                         */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { parseISODate, toISODate } from "@/lib/calendar-data";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const formatDateLabel = (value: string) =>
  parseISODate(value).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export function DatePickerField({
  id,
  value,
  onChange,
  min,
  className,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  /** ISO date ("2026-09-28"); empty shows a placeholder. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest selectable ISO date. */
  min?: string;
  className?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISODate(value) : undefined;
  // The visible month is our own state so the arrows can page freely;
  // it jumps back to the selected date every time the popover opens.
  const [month, setMonth] = useState<Date>(() => selected ?? new Date());

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(selected ?? new Date());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={ariaInvalid}
          className={cn("h-8 w-full justify-start px-2.5 font-normal tabular-nums", className)}
        >
          <CalendarDays data-icon="inline-start" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? formatDateLabel(value) : "Datum wählen"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          disabled={min ? { before: parseISODate(min) } : undefined}
          onSelect={(date) => {
            onChange(toISODate(date));
            setOpen(false);
          }}
          showOutsideDays
          className="p-0"
        />
      </PopoverContent>
    </Popover>
  );
}
