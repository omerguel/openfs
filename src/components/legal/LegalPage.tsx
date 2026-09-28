/* ------------------------------------------------------------------ */
/* Shared chrome for the public legal pages (/impressum, /datenschutz) */
/* — rendered outside the staff app shell, like /anfrage.              */
/* ------------------------------------------------------------------ */

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

import { useLegalInfo } from "@/hooks/use-legal-info";
import {
  LEGAL_FIELD_LABELS,
  addressLines,
  type LegalField,
  type LegalInfo,
} from "@/lib/legal";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Footer links to the legal pages — used on every public surface. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Rechtliches"
      className={cn(
        "flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <Link
        to="/impressum"
        className="inline-flex min-h-10 items-center hover:text-foreground"
      >
        Impressum
      </Link>
      <Link
        to="/datenschutz"
        className="inline-flex min-h-10 items-center hover:text-foreground"
      >
        Datenschutz
      </Link>
    </nav>
  );
}

export function MissingFieldsNotice({ fields }: { fields: LegalField[] }) {
  if (fields.length === 0) return null;
  return (
    <Alert>
      <TriangleAlert className="text-amber-700 dark:text-amber-400" />
      <AlertTitle>Angaben unvollständig</AlertTitle>
      <AlertDescription>
        Im Profil der Fahrschule fehlen noch:{" "}
        {fields.map((field) => LEGAL_FIELD_LABELS[field]).join(", ")}. Die Fahrschule
        ergänzt diese Angaben unter Profil → Stammdaten.
      </AlertDescription>
    </Alert>
  );
}

/** A heading + body block; `children` is plain prose. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-balance">
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-pretty text-foreground/90">
        {children}
      </div>
    </section>
  );
}

/** Loads the public legal data and hands it to `children`. */
export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: (info: LegalInfo) => ReactNode;
}) {
  const legal = useLegalInfo();
  return (
    <div className="min-h-svh bg-background px-4 py-8 sm:py-12">
      <title>{title}</title>
      <main className="mx-auto w-full max-w-2xl space-y-8">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {legal.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : legal.isError ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Die Angaben konnten nicht geladen werden.
            </p>
            <Button type="button" variant="outline" onClick={() => void legal.refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : (
          children(legal.data)
        )}
        <footer className="border-t border-border/70 pt-4">
          <LegalLinks />
        </footer>
      </main>
    </div>
  );
}

/** Renders a value or a visible placeholder — never invented data. */
export function Value({ value, label }: { value: string; label: string }) {
  if (value.trim()) return <>{value}</>;
  return <span className="text-muted-foreground italic">[{label} fehlt]</span>;
}

/** The free-form address, one line per comma/newline segment. */
export function Address({ address }: { address: string }) {
  const lines = addressLines(address);
  if (lines.length === 0) return <Value value="" label="Anschrift" />;
  return (
    <>
      {lines.map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </>
  );
}
