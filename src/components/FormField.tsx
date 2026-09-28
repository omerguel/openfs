/* ------------------------------------------------------------------ */
/* FormField — label + control + hint/error, the shared building block  */
/* for dialogs and settings forms. Required fields get a visible "*"    */
/* and aria-required; an error is shown right under the field (instead */
/* of a far-away toast) and wired up via aria-invalid/-describedby.    */
/* The single child control receives id and the aria attributes.       */
/* ------------------------------------------------------------------ */

import { cloneElement, isValidElement, type ReactElement } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ControlProps = {
  id?: string;
  required?: boolean;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function RequiredMark() {
  return (
    <span aria-hidden className="text-destructive">
      *
    </span>
  );
}

export function FormField({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  /** Shown instead of the hint; marks the control invalid. */
  error?: string | null;
  className?: string;
  children: ReactElement<ControlProps>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })
    : children;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <RequiredMark />}
      </Label>
      {control}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Footnote for forms with required fields. */
export function RequiredLegend({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Felder mit <RequiredMark /> sind Pflichtfelder.
    </p>
  );
}
