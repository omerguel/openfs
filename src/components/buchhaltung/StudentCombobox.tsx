/* ------------------------------------------------------------------ */
/* Searchable student picker (name, Kundennummer, Klassen). No         */
/* preselection: a booking or invoice for the wrong student is worse   */
/* than one more click.                                                */
/* ------------------------------------------------------------------ */

import { useMemo } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import type { StudentRecord } from "@/hooks/use-students";

export function studentOptionLabel(student: StudentRecord): string {
  return `${student.firstName} ${student.lastName} · Kd.-Nr. ${student.customerNumber}${
    student.classes ? ` · ${student.classes}` : ""
  }`;
}

export function StudentCombobox({
  id,
  students,
  value,
  onChange,
  invalid,
  placeholder = "Namen oder Kundennummer eingeben…",
}: {
  id?: string;
  students: StudentRecord[];
  /** Selected customer number ("" = none). */
  value: string;
  onChange: (customerNo: string) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const { labels, byLabel } = useMemo(() => {
    const sorted = students.toSorted((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "de"),
    );
    return {
      labels: sorted.map(studentOptionLabel),
      byLabel: new Map(sorted.map((s) => [studentOptionLabel(s), s.customerNumber])),
    };
  }, [students]);
  const selected = students.find((s) => s.customerNumber === value);
  const selectedLabel = selected ? studentOptionLabel(selected) : null;

  return (
    <Combobox
      items={labels}
      value={selectedLabel}
      onValueChange={(label) => onChange(label ? (byLabel.get(label) ?? "") : "")}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        className="w-full"
        aria-invalid={invalid || undefined}
        showClear
      />
      <ComboboxContent>
        <ComboboxEmpty>Keine Fahrschüler/innen gefunden.</ComboboxEmpty>
        <ComboboxList>
          {(option: string) => (
            <ComboboxItem key={option} value={option}>
              {option}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
