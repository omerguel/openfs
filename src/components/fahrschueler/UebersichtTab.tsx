/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Übersicht tab. Three-column overview with the  */
/* same inline edit mode the old detail dialog had: Bearbeiten starts  */
/* a draft, Speichern PATCHes via the students API.                    */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { Car, Check, Edit3, FileText, GraduationCap, User, X } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  classOptions,
  DetailItem,
  EditableField,
  EditableSelectField,
  type StudentEdit,
} from "./fields";
import { PortalLinkCard } from "./PortalLinkCard";
import {
  getStudentDocumentKey,
  getStudentDocumentMeta,
  getStudentDocumentName,
} from "@/lib/student-documents";

/** "11.08.1999" → "26 Jahre" (empty string when unparsable). */
function formatAge(birthday: string): string {
  const [day, month, year] = birthday.split(".").map(Number);
  if (!day || !month || !year) return "";
  const now = new Date();
  let age = now.getFullYear() - year;
  if (
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day)
  ) {
    age -= 1;
  }
  return age > 0 && age < 120 ? `${age} Jahre` : "";
}

export function UebersichtTab({
  student,
  instructorOptions,
  vehicleOptions,
  onSave,
}: {
  student: StudentRecord;
  instructorOptions: string[];
  vehicleOptions: string[];
  onSave: (updates: StudentEdit) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StudentEdit | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Sie sind im Bearbeitungsmodus. Wirklich verlassen?";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editing]);

  const editValue = draft ?? student;
  // Balance and lessons are derived by the server (ledger + calendar).
  const hasDebt = student.balance.startsWith("-");
  const age = formatAge(editValue.birthday);

  const updateDraft = (key: Exclude<keyof StudentEdit, "documents">, value: string) => {
    setDraft((current) => ({ ...(current ?? student), [key]: value }));
  };

  const startEditing = () => {
    setDraft({
      firstName: student.firstName,
      lastName: student.lastName,
      classes: student.classes,
      phone: student.phone,
      email: student.email,
      address: student.address,
      birthday: student.birthday,
      drivingSchool: student.drivingSchool,
      registrationDate: student.registrationDate,
      instructor: student.instructor,
      vehicle: student.vehicle,
      status: student.status,
      documents: student.documents,
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(null);
    setEditing(false);
  };

  const saveEditing = async () => {
    if (!draft) return;

    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      setDraft(null);
      toast.success("Änderungen gespeichert.");
    } catch (error) {
      // Stay in edit mode so nothing typed is lost.
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <>
            <ToggleGroup
              type="single"
              value={editValue.status}
              onValueChange={(value) => {
                if (value === "aktiv" || value === "inaktiv") {
                  setDraft((current) => ({
                    ...(current ?? student),
                    status: value,
                  }));
                }
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Fahrschueler Status bearbeiten"
            >
              <ToggleGroupItem value="aktiv" aria-label="Als aktiv markieren">
                Aktiv
              </ToggleGroupItem>
              <ToggleGroupItem value="inaktiv" aria-label="Als inaktiv markieren">
                Inaktiv
              </ToggleGroupItem>
            </ToggleGroup>
            <Button type="button" size="sm" disabled={saving} onClick={saveEditing}>
              <Check data-icon="inline-start" />
              Speichern
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={cancelEditing}>
              <X data-icon="inline-start" />
              Abbrechen
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            <Edit3 data-icon="inline-start" />
            Bearbeiten
          </Button>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(16rem,20rem)]">
        {/* Left column — person + contract details */}
        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <User />
                </div>
                <div className="flex flex-col">
                  <CardTitle>
                    {editValue.firstName} {editValue.lastName}
                  </CardTitle>
                  <CardDescription>
                    {age ? `${age} · ` : ""}Kundennummer {student.customerNumber}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <EditableField
                  id="student-birthday"
                  label="Geburtsdatum"
                  value={editValue.birthday}
                  editing={editing}
                  onChange={(value) => updateDraft("birthday", value)}
                />
                <EditableField
                  id="student-address"
                  label="Anschrift"
                  value={editValue.address}
                  editing={editing}
                  onChange={(value) => updateDraft("address", value)}
                />
                <EditableField
                  id="student-phone"
                  label="Telefon"
                  value={editValue.phone}
                  editing={editing}
                  onChange={(value) => updateDraft("phone", value)}
                />
                <EditableField
                  id="student-email"
                  label="E-Mail"
                  value={editValue.email}
                  editing={editing}
                  onChange={(value) => updateDraft("email", value)}
                />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Fahrschülerdetails</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <EditableField
                  id="student-first-name"
                  label="Vorname"
                  value={editValue.firstName}
                  editing={editing}
                  onChange={(value) => updateDraft("firstName", value)}
                />
                <EditableField
                  id="student-last-name"
                  label="Nachname"
                  value={editValue.lastName}
                  editing={editing}
                  onChange={(value) => updateDraft("lastName", value)}
                />
                <EditableSelectField
                  label="Bildungstyp"
                  value={editValue.classes}
                  editing={editing}
                  options={classOptions}
                  onChange={(value) => updateDraft("classes", value)}
                />
                <DetailItem label="Vertragsnummer" value={student.contractNumber} />
                <EditableField
                  id="student-registration-date"
                  label="Anmeldedatum"
                  value={editValue.registrationDate}
                  editing={editing}
                  onChange={(value) => updateDraft("registrationDate", value)}
                />
                <EditableField
                  id="student-driving-school"
                  label="Fahrschule"
                  value={editValue.drivingSchool}
                  editing={editing}
                  onChange={(value) => updateDraft("drivingSchool", value)}
                />
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        {/* Middle column — training progress, exams, assignments */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Ausbildung</CardTitle>
              <CardDescription>
                Fortschritt, Fahrstunden und nächste Planung
              </CardDescription>
              <CardAction>
                <Badge variant="outline">{editValue.classes}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Progress value={student.progress} className="h-2" />
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {student.progress}%
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Bereich</TableHead>
                      <TableHead className="text-right">Stand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {student.lessons.map((lesson) => (
                      <TableRow key={lesson.label}>
                        <TableCell>{lesson.label}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {lesson.done}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Prüfungen</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Klasse</TableHead>
                      <TableHead>Theorie</TableHead>
                      <TableHead>Praktische</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">{editValue.classes}</TableCell>
                      <TableCell
                        className={
                          student.theory.exam === "Nicht geplant"
                            ? "text-muted-foreground"
                            : undefined
                        }
                      >
                        {student.theory.exam}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        Nicht geplant
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Fahrlehrer/in</CardTitle>
                <CardDescription>{editValue.classes}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <GraduationCap />
                {editing ? (
                  <div className="min-w-0 flex-1">
                    <EditableSelectField
                      label=""
                      value={editValue.instructor}
                      editing
                      options={instructorOptions}
                      onChange={(value) => updateDraft("instructor", value)}
                    />
                  </div>
                ) : (
                  <span>{editValue.instructor}</span>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Fahrzeug</CardTitle>
                <CardDescription>{editValue.classes}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Car />
                {editing ? (
                  <div className="min-w-0 flex-1">
                    <EditableSelectField
                      label=""
                      value={editValue.vehicle}
                      editing
                      options={vehicleOptions}
                      onChange={(value) => updateDraft("vehicle", value)}
                    />
                  </div>
                ) : (
                  <span>{editValue.vehicle}</span>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right column — balance, documents, theory */}
        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Beträge</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Bilanz</span>
                <span
                  className={
                    hasDebt
                      ? "text-lg font-semibold tabular-nums text-destructive"
                      : "text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {student.balance}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Aus der Buchhaltung (Zahlungen abzgl. abgerechneter Leistungen).
              </p>
              <p className="text-xs text-muted-foreground">
                Letzte Stunde {student.lastLesson} · Nächste Stunde {student.nextLesson}
              </p>
            </CardContent>
          </Card>

          <PortalLinkCard student={student} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>Dokumente</CardTitle>
              <CardDescription>Verwaltung im Tab „Dokumente"</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {student.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Noch keine Dokumente hinterlegt.
                </p>
              ) : (
                student.documents.map((document, index) => (
                  <div
                    key={getStudentDocumentKey(document, index)}
                    className="flex min-w-0 items-start gap-2 text-sm"
                  >
                    <FileText />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{getStudentDocumentName(document)}</span>
                      <span className="text-xs text-muted-foreground">
                        {getStudentDocumentMeta(document)}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Theorie</CardTitle>
              <CardAction>
                <Badge variant="secondary">{student.theory.status}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <DetailItem label="Letzter Login" value={student.theory.lastLogin} />
                <DetailItem label="Vorprüfungen" value={student.theory.preExams} />
                <DetailItem label="Prüfungstermin" value={student.theory.exam} />
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
