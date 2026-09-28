/* ------------------------------------------------------------------ */
/* Shared display/edit field primitives for the Fahrschüler detail     */
/* page — view mode renders a definition pair, edit mode an input.     */
/* ------------------------------------------------------------------ */

import type { Student } from "@/lib/student-data";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type StudentEdit = Pick<
  Student,
  | "firstName"
  | "lastName"
  | "classes"
  | "phone"
  | "email"
  | "address"
  | "birthday"
  | "drivingSchool"
  | "registrationDate"
  | "instructor"
  | "vehicle"
  | "status"
  | "documents"
>;

export const classOptions = ["A", "B", "B197", "BE"];

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function EditableField({
  id,
  label,
  value,
  editing,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}) {
  if (!editing) {
    return <DetailItem label={label} value={value} />;
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function EditableSelectField({
  label,
  value,
  editing,
  options,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  options: string[];
  onChange: (value: string) => void;
}) {
  if (!editing) {
    return <DetailItem label={label} value={value} />;
  }

  // Keep the current value selectable even when it is not in the options.
  const allOptions = options.includes(value) ? options : [value, ...options];

  return (
    <Field>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {allOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
