/* ------------------------------------------------------------------ */
/* Soft-stop for unusual but legal input (backdated or future dates,   */
/* a Kasse going negative, …): the warnings are listed and the primary */
/* action stays disabled until the user explicitly confirms them.      */
/* ------------------------------------------------------------------ */

import { TriangleAlert } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";

export function WarningConfirm({
  warnings,
  confirmed,
  onConfirmedChange,
  label = "Hinweise geprüft — trotzdem fortfahren",
}: {
  warnings: string[];
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  label?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
    >
      {warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-2 text-pretty">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{warning}</span>
        </p>
      ))}
      <label className="flex items-center gap-2 font-medium">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(value) => onConfirmedChange(value === true)}
        />
        {label}
      </label>
    </div>
  );
}

/** Inline field error below an input. */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}
