/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Übersicht tab. Three-column overview with the  */
/* same inline edit mode the old detail dialog had: Bearbeiten starts  */
/* a draft, Speichern PATCHes via the students API.                    */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { Car, Check, Edit3, FileText, GraduationCap, User, X } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import { type CalEvent, isCancelled } from "@/lib/calendar-data";
import { formatGermanDate } from "@/lib/working-time";
import type { ExamEventType } from "@/lib/exams";
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
import { useStudentFiles } from "@/hooks/use-student-files";
import { getStudentFileMeta } from "@/lib/student-documents";
import { ageInYears, allowsAccompaniedDriving } from "@/lib/license-classes";
import { BALANCE_TONE_CLASS, describeBalance } from "@/lib/student-balance";
import { cn } from "@/lib/utils";

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

/* The student's exam of one type from the calendar: a result, else the
   next booked date; null when there is none. */
function examStatus(
  events: CalEvent[],
  studentId: number,
  type: ExamEventType,
): string | null {
  const own = events
    .filter((e) => e.studentId === studentId && e.type === type && !isCancelled(e))
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const passed = own.find((e) => e.examResult === "bestanden");
  if (passed) return `Bestanden am ${formatGermanDate(passed.date)}`;
  const today = new Date().toLocaleDateString("sv-SE");
  const next = own.find((e) => !e.examResult && e.date >= today);
  if (next) return `${formatGermanDate(next.date)}, ${next.start} Uhr`;
  const failed = own.findLast((e) => e.examResult === "nicht_bestanden");
  return failed ? `Nicht bestanden am ${formatGermanDate(failed.date)}` : null;
}

export function UebersichtTab({
  student,
  instructorOptions,
  vehicleOptions,
  canSeeMoney,
  canEdit = true,
  onSave,
}: {
  student: StudentRecord;
  instructorOptions: string[];
  vehicleOptions: string[];
  /** false for Fahrlehrer/innen — no balances. */
  canSeeMoney: boolean;
  /** Fahrlehrer/innen cannot change student records. */
  canEdit?: boolean;
  onSave: (updates: StudentEdit) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StudentEdit | null>(null);
  const [saving, setSaving] = useState(false);
  // Documents are office-only (the API refuses them for Fahrlehrer/innen).
  const { files } = useStudentFiles(student.id, canEdit);
  const { events } = useCalendarEvents();
  const practicalExam = examStatus(events, student.id, "Vorstellung zur prakt. Prüfung");
  const theoryExam = examStatus(events, student.id, "Theorieprüfung");

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
  const balance = describeBalance(student.balanceCents);
  const age = formatAge(editValue.birthday);
  const years = ageInYears(editValue.birthday);
  const showCompanion =
    allowsAccompaniedDriving(editValue.classes) &&
    ((years != null && years < 18) || Boolean(editValue.companion));

  const updateCompanion = (key: "name" | "phone", value: string) => {
    setDraft((current) => {
      const base = current ?? student;
      const companion = { name: "", phone: "", ...(base.companion ?? {}), [key]: value };
      return { ...base, companion };
    });
  };

  const updateDraft = (
    key: Exclude<keyof StudentEdit, "documents" | "companion">,
    value: string,
  ) => {
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
      companion: student.companion ?? null,
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
        ) : !canEdit ? null : (
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
                  label="Klasse"
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

          {showCompanion && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Begleitperson (BF17)</CardTitle>
                <CardDescription>Begleitetes Fahren ab 17</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="gap-3">
                  <EditableField
                    id="student-companion-name"
                    label="Name"
                    value={
                      editValue.companion?.name || (editing ? "" : "Nicht hinterlegt")
                    }
                    editing={editing}
                    onChange={(value) => updateCompanion("name", value)}
                  />
                  <EditableField
                    id="student-companion-phone"
                    label="Telefon"
                    value={editValue.companion?.phone || (editing ? "" : "–")}
                    editing={editing}
                    onChange={(value) => updateCompanion("phone", value)}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
          )}
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
                          {lesson.done.replace(/min$/, " Min.")}
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
                          (theoryExam ?? student.theory.exam) === "Nicht geplant"
                            ? "text-muted-foreground"
                            : undefined
                        }
                      >
                        {theoryExam ?? student.theory.exam}
                      </TableCell>
                      <TableCell
                        className={practicalExam ? undefined : "text-muted-foreground"}
                      >
                        {practicalExam ?? "Nicht geplant"}
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
          {canSeeMoney && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Kontostand</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {balance.label}
                  </span>
                  <span
                    className={cn(
                      "text-lg font-semibold tabular-nums",
                      BALANCE_TONE_CLASS[balance.tone],
                    )}
                  >
                    {balance.amount}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Aus der Buchhaltung: Zahlungen abzüglich abgerechneter Leistungen.
                </p>
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Termine</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <DetailItem label="Letzte Stunde" value={student.lastLesson} />
                <DetailItem label="Nächste Stunde" value={student.nextLesson} />
              </FieldGroup>
            </CardContent>
          </Card>

          {canEdit && <PortalLinkCard student={student} />}

          {canEdit && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Dokumente</CardTitle>

                <CardDescription>Verwaltung im Tab „Dokumente"</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {student.documents.length === 0 && files.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Noch keine Dokumente hinterlegt.
                  </p>
                ) : (
                  <>
                    {files.map((file) => (
                      <div
                        key={`file-${file.id}`}
                        className="flex min-w-0 items-start gap-2 text-sm"
                      >
                        <FileText />
                        <span className="flex min-w-0 flex-col">
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noopener"
                            className="truncate hover:underline"
                          >
                            {file.name}
                          </a>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {getStudentFileMeta(file)}
                          </span>
                        </span>
                      </div>
                    ))}
                    {student.documents.map((document, index) => (
                      <div
                        key={`checklist-${document}-${index}`}
                        className="flex min-w-0 items-start gap-2 text-sm"
                      >
                        <FileText />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{document}</span>
                          <span className="text-xs text-muted-foreground">
                            Checkliste
                          </span>
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Theorie</CardTitle>

              <CardAction>
                <Badge variant="secondary">{student.theory.status}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-3">
                <DetailItem
                  label="Theoriestunden"
                  value={`${student.theory.attendedUnits} von ${student.theory.requiredUnits} Doppelstunden (${student.theory.progress} %)`}
                />
                <DetailItem
                  label="Letzte Theoriestunde"
                  value={student.theory.lastSession}
                />
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
