/* ------------------------------------------------------------------ */
/* Printable report views (Kassenbuch, Buchungsjournal, Umsatzsteuer). */
/* The report is portaled into #print-root (see index.css) and the     */
/* browser print dialog opens with the report name as document title,  */
/* so "Als PDF speichern" proposes a sensible file name.               */
/* ------------------------------------------------------------------ */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { printDocument } from "@/lib/print";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export type PrintJob = { title: string; subtitle?: string; body: ReactNode };

/** Mount once per page; call `print(job)` to print a report. */
export function useReportPrinter() {
  const [job, setJob] = useState<PrintJob | null>(null);
  const [root] = useState(() =>
    typeof document === "undefined" ? null : document.getElementById("print-root"),
  );
  useEffect(() => {
    if (!job) return;
    const timer = setTimeout(() => {
      printDocument(job.title);
      setJob(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [job]);
  const portal =
    job && root
      ? createPortal(
          <div className="bg-white p-2 font-sans text-[11px] leading-snug text-black">
            <h1 className="text-base font-semibold">{job.title}</h1>
            {job.subtitle && <p className="pb-3 text-black/60">{job.subtitle}</p>}
            {job.body}
          </div>,
          root,
        )
      : null;
  return { print: setJob, portal };
}

export function PrintTable({
  head,
  rows,
  foot,
  numeric = [],
}: {
  head: string[];
  rows: ReactNode[][];
  foot?: ReactNode[][];
  /** Column indexes that hold amounts (right-aligned). */
  numeric?: number[];
}) {
  const cell = (i: number) =>
    cn(
      "border-b border-black/10 px-1 py-0.5 align-top",
      numeric.includes(i) && "text-right tabular-nums",
    );
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {head.map((label, i) => (
            <th
              key={label}
              className={cn(
                "border-b border-black/40 px-1 py-1 text-left font-medium",
                numeric.includes(i) && "text-right",
              )}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((value, i) => (
              <td key={i} className={cell(i)}>
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          {foot.map((row, r) => (
            <tr key={r} className="font-semibold">
              {row.map((value, i) => (
                <td
                  key={i}
                  className={cn(
                    "border-t border-black/40 px-1 py-1",
                    numeric.includes(i) && "text-right tabular-nums",
                  )}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tfoot>
      )}
    </table>
  );
}

export const money = (cents: number | null | undefined) =>
  cents == null || cents === 0 ? "" : formatCents(cents);
