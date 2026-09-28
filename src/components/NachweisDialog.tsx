/* ------------------------------------------------------------------ */
/* Ausbildungsnachweis erfassen — content + student signature for one  */
/* practical lesson. Used from the calendar sheet and "Mein Tag"; the  */
/* Stunden tab of the student detail has the same flow.                */
/* ------------------------------------------------------------------ */

import { useRef, useState } from "react";
import { toast } from "sonner";

import { saveAttestation } from "@/hooks/use-ausbildungsnachweis";
import { type CalEvent, parseISODate, toMinutes } from "@/lib/calendar-data";
import type { Attestation } from "@/server/ausbildungsnachweis";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function NachweisDialog({
  event,
  studentId,
  onClose,
  onSaved,
}: {
  /** The lesson; null closes the dialog. */
  event: CalEvent | null;
  studentId: number | undefined;
  onClose: () => void;
  onSaved?: (attestation: Attestation) => void;
}) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [content, setContent] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!event) return null;
  const durationMin = toMinutes(event.end) - toMinutes(event.start);
  const dateLabel = parseISODate(event.date).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const save = async () => {
    if (!sigRef.current?.hasStrokes || studentId == null) return;
    setSaving(true);
    try {
      const attestation = await saveAttestation(event.id, {
        studentId,
        instructor: event.instructor,
        content: content || event.lessonKind || "",
        durationMin,
        signatureDataUrl: sigRef.current.toDataURL(),
      });
      toast.success("Ausbildungsnachweis gespeichert.");
      setContent("");
      onSaved?.(attestation);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ausbildungsnachweis erfassen</DialogTitle>
          <DialogDescription className="tabular-nums">
            {event.subtitle ?? "Ohne Fahrschüler"} · {dateLabel} · {event.start}–
            {event.end} ({durationMin} Min.)
          </DialogDescription>
        </DialogHeader>

        {studentId == null ? (
          <p className="text-sm text-destructive">
            Kein Fahrschüler verknüpft — bitte den Termin zuerst einem Fahrschüler
            zuordnen.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground">
                  Fahrlehrer/in
                </dt>
                <dd>{event.instructor}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted-foreground">
                  Fahrzeug
                </dt>
                <dd>{event.vehicle ?? "–"}</dd>
              </div>
              {event.lessonKind && (
                <div>
                  <dt className="text-[11px] font-medium text-muted-foreground">
                    Fahrtart
                  </dt>
                  <dd>{event.lessonKind}</dd>
                </div>
              )}
            </dl>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nachweis-inhalt">Unterrichtsinhalt</Label>
              <Textarea
                id="nachweis-inhalt"
                placeholder="z. B. Stadtfahrt, Einparken, Autobahnauffahrt"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                maxLength={2000}
                className="resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Unterschrift Fahrschüler/in</Label>
              <SignaturePad ref={sigRef} onChange={setHasSignature} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!hasSignature || saving || studentId == null}
          >
            {saving ? "Speichert…" : "Unterschreiben & speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
