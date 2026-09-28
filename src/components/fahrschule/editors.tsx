/* Small controlled editors for "Fahrschule & Einstellungen":           */
/* weekly hours, tag lists and toggle chips. All are fully controlled — */
/* no local copies of the value that could drift from the draft.       */

import { memo, useState } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import type { OpeningHoursEntry } from "@/hooks/use-school-profile";
import { formatHours, parseHours } from "@/lib/settings-form";
import { cn } from "@/lib/utils";

/* 24-hour times in 15-minute steps (a native time input would follow the
   browser's locale and may show AM/PM). */
const TIMES = Array.from({ length: (22 - 6) * 4 + 1 }, (_, i) => {
  const minutes = 6 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

function TimeSelect({
  label,
  value,
  disabled,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const options = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className="w-[6.5rem] [&_select]:tabular-nums"
    >
      {options.map((time) => (
        <NativeSelectOption key={time} value={time}>
          {time}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export const HoursEditor = memo(function HoursEditor({
  idPrefix,
  value,
  errors,
  disabled,
  onChange,
}: {
  idPrefix: string;
  value: OpeningHoursEntry[];
  errors: Partial<Record<string, string>>;
  disabled?: boolean;
  onChange: (next: OpeningHoursEntry[]) => void;
}) {
  const update = (index: number, patch: Partial<ReturnType<typeof parseHours>>) =>
    onChange(
      value.map((entry, i) =>
        i === index
          ? { ...entry, hours: formatHours({ ...parseHours(entry.hours), ...patch }) }
          : entry,
      ),
    );

  return (
    <div className="flex flex-col divide-y">
      {value.map((entry, index) => {
        const hours = parseHours(entry.hours);
        const error = errors[`${idPrefix}-${index}`];
        return (
          <div
            key={entry.day}
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3"
          >
            <label className="flex w-36 shrink-0 items-center gap-2">
              <Switch
                checked={hours.open}
                disabled={disabled}
                aria-label={`${entry.day} geöffnet`}
                onCheckedChange={(open) => update(index, { open })}
              />
              <span className="text-sm font-medium">{entry.day}</span>
            </label>
            {hours.open ? (
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <TimeSelect
                    label={`${entry.day} von`}
                    value={hours.from}
                    disabled={disabled}
                    invalid={Boolean(error)}
                    onChange={(from) => update(index, { from })}
                  />
                  <span className="text-sm text-muted-foreground">bis</span>
                  <TimeSelect
                    label={`${entry.day} bis`}
                    value={hours.to}
                    disabled={disabled}
                    invalid={Boolean(error)}
                    onChange={(to) => update(index, { to })}
                  />
                  <Input
                    aria-label={`${entry.day} Anmerkung`}
                    value={hours.note}
                    disabled={disabled}
                    onChange={(e) => update(index, { note: e.target.value })}
                    placeholder="Anmerkung (optional)"
                    className="min-w-40 flex-1"
                  />
                </div>
                {error && (
                  <span role="alert" className="text-xs text-destructive">
                    {error}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {hours.set ? "Geschlossen" : "Keine Angabe"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

/** Controlled tag list — Enter or comma adds, Backspace removes the last. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const tag = text.trim().replace(/,$/, "");
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
  };
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border bg-background p-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`${tag} entfernen`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      <input
        id={id}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !text && value.length)
            onChange(value.slice(0, -1));
        }}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1.5 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/** Multi-select as toggle chips (aria-pressed buttons). */
export function ChipSelect({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const on = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== option) : [...value, option])
            }
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-60",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:border-ring",
            )}
          >
            {on && <Check className="size-3" />}
            {option}
          </button>
        );
      })}
    </fieldset>
  );
}
