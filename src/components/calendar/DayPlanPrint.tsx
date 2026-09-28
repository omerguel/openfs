/* ------------------------------------------------------------------ */
/* Printable day plan — one page per instructor with every Termin of   */
/* the day (time, student, phone, Fahrtart, vehicle, place, note).     */
/* Rendered into #print-root; index.css hides everything else when     */
/* printing (same mechanism as Quittung / Vertrag).                    */
/* ------------------------------------------------------------------ */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { type CalEvent, parseISODate } from "@/lib/calendar-data";
import { CANCELLATION_KIND_LABELS } from "@/lib/cancellation";

export type DayPlan = {
  date: string;
  events: CalEvent[];
  /** studentId → phone */
  phones: Map<number, string>;
};

export function DayPlanPrint({ plan, onDone }: { plan: DayPlan; onDone: () => void }) {
  const printRoot = document.getElementById("print-root");

  const done = useRef(onDone);
  done.current = onDone;

  // Print once per plan; the parent unmounts us afterwards.
  useEffect(() => {
    const finish = () => done.current();
    window.addEventListener("afterprint", finish, { once: true });
    // Let the portal paint before the print dialog snapshots the page.
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, []);

  if (!printRoot) return null;

  const byInstructor = new Map<string, CalEvent[]>();
  for (const event of plan.events.toSorted((a, b) => a.start.localeCompare(b.start))) {
    const key = event.instructor || "Nicht zugeteilt";
    const list = byInstructor.get(key) ?? [];
    list.push(event);
    byInstructor.set(key, list);
  }
  const dateLabel = parseISODate(plan.date).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return createPortal(
    <div className="text-[11pt] text-black">
      {byInstructor.size === 0 && (
        <p>
          Keine Termine am {dateLabel}.
        </p>
      )}
      {[...byInstructor.entries()].map(([instructor, events], index) => (
        <section
          key={instructor}
          style={{ breakAfter: index < byInstructor.size - 1 ? "page" : "auto" }}
        >
          <h1 className="text-[15pt] font-semibold">Tagesplan · {instructor}</h1>
          <p className="mb-4 text-[10pt]">
            {dateLabel} · {events.length} {events.length === 1 ? "Termin" : "Termine"}
          </p>
          <table className="w-full border-collapse text-left text-[10pt]">
            <thead>
              <tr className="border-b border-black">
                <th className="py-1 pr-2">Zeit</th>
                <th className="py-1 pr-2">Fahrschüler/in</th>
                <th className="py-1 pr-2">Telefon</th>
                <th className="py-1 pr-2">Art</th>
                <th className="py-1 pr-2">Fahrzeug</th>
                <th className="py-1 pr-2">Ort / Notiz</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-neutral-300 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                    {event.start}–{event.end}
                  </td>
                  <td className="py-1.5 pr-2">
                    {event.subtitle || event.title}
                    {event.cancelledAt && (
                      <span>
                        {" "}
                        ({CANCELLATION_KIND_LABELS[event.cancellationKind ?? "abgesagt"]})
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                    {event.studentId != null ? (plan.phones.get(event.studentId) ?? "") : ""}
                  </td>
                  <td className="py-1.5 pr-2">{event.lessonKind ?? event.type}</td>
                  <td className="py-1.5 pr-2">{event.vehicle ?? ""}</td>
                  <td className="py-1.5 pr-2">
                    {[event.location, event.notes].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>,
    printRoot,
  );
}
