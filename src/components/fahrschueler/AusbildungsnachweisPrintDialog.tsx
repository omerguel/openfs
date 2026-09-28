/* ------------------------------------------------------------------ */
/* Ausbildungsnachweis — kumulierter, druckbarer Nachweis aller        */
/* unterschriebenen Fahrstunden eines Fahrschülers.                    */
/*                                                                     */
/* NachweisSheet renders the A4 document. The dialog shows it as a     */
/* preview and additionally portals a copy into <div id="print-root">  */
/* (outside #root); @media print CSS in index.css hides everything     */
/* else, so window.print() emits exactly the Nachweis.                 */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ScaledPreview } from "@/components/ScaledPreview";
import { fetchAttestationsForStudent } from "@/hooks/use-ausbildungsnachweis";
import type { StudentRecord } from "@/hooks/use-students";
import type { CompanyProfile } from "@/lib/accounting-types";
import type { Attestation } from "@/server/ausbildungsnachweis";

/** "2026-06-09" → "09.06.2026" */
function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function NachweisSheet({
  student,
  school,
  attestations,
}: {
  student: StudentRecord;
  school: CompanyProfile | null;
  attestations: Attestation[];
}) {
  const totalMinutes = attestations.reduce((sum, att) => sum + att.durationMin, 0);
  const printedOn = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="flex w-full flex-col gap-6 bg-white p-10 font-sans text-[13px] leading-relaxed text-black">
      {/* Kopf: Fahrschule + Dokumenttitel */}
      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">{school?.name ?? ""}</span>
          <span>{school?.address ?? ""}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-2xl font-bold tracking-wide">Ausbildungsnachweis</span>
        </div>
      </div>

      <div className="h-px bg-black/20" />

      {/* Fahrschüler */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-black/60">
            Fahrschüler
          </span>
          <span className="font-medium">
            {student.firstName} {student.lastName}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-black/60">
            Geburtsdatum
          </span>
          <span>{student.birthday}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-black/60">
            Klassen
          </span>
          <span>{student.classes}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-black/60">
            Vertragsnummer
          </span>
          <span>{student.contractNumber}</span>
        </div>
        {student.licenseDate && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-black/60">
              Führerschein erteilt am
            </span>
            <span>{formatIsoDate(student.licenseDate)}</span>
          </div>
        )}
      </div>

      {/* Fahrstunden */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/30 text-left text-[11px] uppercase tracking-wide text-black/60">
            <th className="py-1.5 pr-2 font-medium">Datum</th>
            <th className="py-1.5 pr-2 text-right font-medium">Dauer (Min)</th>
            <th className="py-1.5 pr-2 font-medium">Fahrtart</th>
            <th className="py-1.5 pr-2 font-medium">Fahrlehrer</th>
            <th className="py-1.5 pr-2 font-medium">Unterrichtsinhalt</th>
            <th className="py-1.5 font-medium">Unterschrift</th>
          </tr>
        </thead>
        <tbody>
          {attestations.map((att) => (
            <tr key={att.id} className="border-b border-black/10">
              <td className="py-1.5 pr-2 align-top">
                {formatIsoDate(att.lessonDate ?? att.signedAt.slice(0, 10))}
              </td>
              <td className="py-1.5 pr-2 text-right align-top tabular-nums">
                {att.durationMin}
              </td>
              <td className="py-1.5 pr-2 align-top">{att.lessonKind || "Übungsfahrt"}</td>
              <td className="py-1.5 pr-2 align-top">{att.instructor || "–"}</td>
              <td className="py-1.5 pr-2 align-top whitespace-pre-wrap">
                {att.content || "–"}
              </td>
              <td className="py-1.5">
                <img
                  src={att.signatureDataUrl}
                  alt="Unterschrift des Fahrschülers"
                  className="h-10 w-auto"
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 pr-2 font-semibold">Gesamt</td>
            <td className="py-2 pr-2 text-right font-semibold tabular-nums">
              {totalMinutes}
            </td>
            <td colSpan={4} className="py-2 text-black/60">
              {attestations.length}{" "}
              {attestations.length === 1 ? "Fahrstunde" : "Fahrstunden"}
            </td>
          </tr>
        </tfoot>
      </table>

      <span className="text-[11px] text-black/60">Gedruckt am {printedOn}</span>
    </div>
  );
}

export function AusbildungsnachweisPrintDialog({
  open,
  student,
  onClose,
}: {
  open: boolean;
  student: StudentRecord;
  onClose: () => void;
}) {
  const [attestations, setAttestations] = useState<Attestation[] | null>(null);
  const [school, setSchool] = useState<CompanyProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchAttestationsForStudent(student.id)
      .then((list) => {
        if (cancelled) return;
        setAttestations(
          list.toSorted((a, b) =>
            (a.lessonDate ?? a.signedAt).localeCompare(b.lessonDate ?? b.signedAt),
          ),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Nachweise konnten nicht geladen werden.",
        );
        onClose();
      });

    fetch("/api/profile")
      .then((response) => response.json())
      .then((profile: CompanyProfile) => {
        if (!cancelled) setSchool(profile);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(
            "Firmenprofil konnte nicht geladen werden — Briefkopf unvollständig.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, onClose]);

  const printRoot = document.getElementById("print-root");
  const loading = attestations == null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ausbildungsnachweis drucken</DialogTitle>
          <DialogDescription>
            Kumulierter Nachweis aller unterschriebenen Fahrstunden von{" "}
            {student.firstName} {student.lastName}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            <ScaledPreview className="max-h-[60vh] overflow-y-auto rounded-lg border shadow-sm">
              <NachweisSheet
                student={student}
                school={school}
                attestations={attestations}
              />
            </ScaledPreview>
            {/* Print copy outside the app root — the only thing printed. */}
            {printRoot &&
              createPortal(
                <div className="bg-white">
                  <NachweisSheet
                    student={student}
                    school={school}
                    attestations={attestations}
                  />
                </div>,
                printRoot,
              )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
          <Button
            type="button"
            disabled={loading || attestations.length === 0}
            onClick={() => window.print()}
          >
            <Printer data-icon="inline-start" />
            Drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
