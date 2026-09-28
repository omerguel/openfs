import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  Car,
  Check,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Upload,
  X,
} from "lucide-react";

import { FormSection as Section, FormSectionIndex } from "./components/FormSection.tsx";
import { PageHeader } from "./components/PageHeader.tsx";
import { OPEN_CONTRACT_EVENT } from "./components/VertragDialog.tsx";
import { instructorName, useInstructors } from "@/hooks/use-instructors";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import { createStudent, useStudents } from "@/hooks/use-students";
import { uploadStudentFile } from "@/hooks/use-student-files";
import { StudentFilePreview } from "@/components/fahrschueler/DokumenteTab";
import {
  linkAppointmentRequestStudent,
  useAppointmentRequests,
} from "@/hooks/use-appointment-requests";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { nextStudentNumbers } from "@/lib/student-numbers";
import { defaultPlanForClasses } from "@/lib/price-plan";
import {
  ageInYears,
  allowsAccompaniedDriving,
  hasClassBSpecialDrives,
  LICENSE_CLASS_GROUPS,
} from "@/lib/license-classes";
import { useArchivedContracts } from "@/hooks/use-archive";
import { useCompanyProfile } from "@/hooks/use-company-profile";
import { useFinanceAccess } from "@/hooks/use-finance-access";
import { usePricePlans } from "@/hooks/use-price-plans";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SPECIAL_DRIVE_REQUIREMENTS_B } from "@/lib/special-drives";
import {
  DEFAULT_CHECKLIST,
  formatStudentDocumentSize,
  STUDENT_FILE_ACCEPT,
  validateStudentFile,
} from "@/lib/student-documents";
import { cn } from "@/lib/utils";

const documentOptions = DEFAULT_CHECKLIST;

const now = new Date();
const TODAY = `${String(now.getDate()).padStart(2, "0")}.${String(
  now.getMonth() + 1,
).padStart(2, "0")}.${now.getFullYear()}`;

const formatDate = (date: Date) =>
  [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join(".");

const parseDate = (value: string): Date | undefined => {
  const [day, month, year] = value.split(".").map(Number);
  if (!day || !month || !year) return undefined;
  return new Date(year, month - 1, day);
};

type Status = "aktiv" | "inaktiv";

type FormState = {
  firstName: string;
  lastName: string;
  birthday: string;
  classes: string;
  phone: string;
  email: string;
  address: string;
  instructor: string;
  vehicle: string;
  customerNumber: string;
  registrationDate: string;
  contractNumber: string;
  drivingSchool: string;
  status: Status;
  documents: string[];
  /** "" = class default (first matching plan). */
  pricePlanId: string;
  companionName: string;
  companionPhone: string;
};

const initialForm: FormState = {
  firstName: "",
  lastName: "",
  birthday: "",
  classes: "B",
  phone: "",
  email: "",
  address: "",
  instructor: "Nicht zugeteilt",
  vehicle: "Nicht zugeteilt",
  customerNumber: "",
  registrationDate: TODAY,
  contractNumber: "",
  // Filled from the school profile once it has loaded.
  drivingSchool: "",
  status: "aktiv",
  documents: [],
  pricePlanId: "",
  companionName: "",
  companionPhone: "",
};

const sections = [
  { id: "stammdaten", label: "Stammdaten" },
  { id: "zuteilung", label: "Zuteilung" },
  { id: "kontakt", label: "Kontakt" },
  { id: "dokumente", label: "Dokumente" },
  { id: "ausbildung", label: "Ausbildung" },
  { id: "vertrag", label: "Vertrag & Preise" },
];

/* A file picked before the student exists — uploaded right after the
   student is created. Previews from a local blob URL. */
function PendingFileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {url ? (
        <StudentFilePreview file={{ name: file.name, mimeType: file.type, url }} />
      ) : (
        <div className="size-12 shrink-0 rounded-md border bg-muted/40" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{file.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatStudentDocumentSize(file.size)} · wird beim Anlegen hochgeladen
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`${file.name} entfernen`}
      >
        <X />
      </Button>
    </div>
  );
}

/* System-assigned identifier, shown read-only. IDs keep the mono face. */
function AutoNumber({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex h-8 items-center rounded-lg border bg-muted/40 px-3 font-mono text-[13px] tabular-nums text-muted-foreground">
        {value}
      </div>
      <FieldDescription>Automatisch vergeben</FieldDescription>
    </Field>
  );
}

/** "Anna Lena Schmidt" → first "Anna Lena", last "Schmidt". */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

export function NeueSchueler() {
  const { students, refresh } = useStudents();
  const { contracts: archivedContracts } = useArchivedContracts();
  const { plans } = usePricePlans();
  const { profile } = useCompanyProfile();
  const { canSeeMoney } = useFinanceAccess();
  const { anfrage } = useSearch({ from: "/_portal/neue-schueler" });
  const navigate = useNavigate();
  const { requests } = useAppointmentRequests();
  const sourceRequest =
    anfrage === undefined ? null : (requests.find((r) => r.id === anfrage) ?? null);
  const prefilledFrom = useRef<number | null>(null);
  const { vehicleOptions } = useVehicleOptions();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    ...nextStudentNumbers([]),
  }));
  // Archived students keep their numbers (a restore must not collide).
  const nextNumbers = useMemo(
    () => nextStudentNumbers([...students, ...archivedContracts]),
    [students, archivedContracts],
  );
  const schoolName = profile?.name ?? "";
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Assignable instructors come from the DB-backed roster (/fahrlehrer).
  const { assignableNames: instructorOptions, instructors } = useInstructors();

  /* Picking an instructor brings their Stammfahrzeug along (still
     changeable) — unless a vehicle was chosen by hand already. */
  const withInstructor = (current: FormState, name: string): FormState => {
    const instructor = instructors.find((i) => instructorName(i) === name);
    const vehicle = instructor?.vehicle;
    const takeVehicle =
      vehicle &&
      vehicleOptions.includes(vehicle) &&
      current.vehicle === initialForm.vehicle;
    return { ...current, instructor: name, ...(takeVehicle ? { vehicle } : {}) };
  };

  // IDs are assigned by the system, not entered by hand: they continue the
  // numbering range of the students in the DB, which loads async.
  useEffect(() => {
    setForm((current) => ({ ...current, ...nextNumbers }));
  }, [nextNumbers]);

  // The school's own name, not a demo placeholder.
  useEffect(() => {
    if (!schoolName) return;
    setForm((current) =>
      current.drivingSchool ? current : { ...current, drivingSchool: schoolName },
    );
  }, [schoolName]);

  const defaultPlan = defaultPlanForClasses(plans, form.classes);
  const chosenPlan =
    plans.find((plan) => String(plan.id) === form.pricePlanId) ?? defaultPlan;
  const age = ageInYears(form.birthday);
  const showCompanion = allowsAccompaniedDriving(form.classes) && age != null && age < 18;
  const classBDrives = hasClassBSpecialDrives(form.classes);

  // Prefill once from the Terminanfrage this page was opened for.
  useEffect(() => {
    if (!sourceRequest || prefilledFrom.current === sourceRequest.id) return;
    prefilledFrom.current = sourceRequest.id;
    setForm((current) => ({
      ...current,
      ...splitName(sourceRequest.name),
      phone: sourceRequest.phone,
      email: sourceRequest.email,
    }));
    setDirty(true);
  }, [sourceRequest]);

  // The confirmed appointment's instructor becomes the student's (once
  // the roster has loaded).
  const instructorFrom = useRef<number | null>(null);
  useEffect(() => {
    const booked = sourceRequest?.appointmentInstructor;
    if (!sourceRequest || !booked || instructorFrom.current === sourceRequest.id) return;
    if (!instructorOptions.includes(booked)) return;
    instructorFrom.current = sourceRequest.id;
    setForm((current) => withInstructor(current, booked));
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const toggleDocument = (doc: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      documents: checked
        ? [...current.documents, doc]
        : current.documents.filter((item) => item !== doc),
    }));
    setDirty(true);
  };

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const invalid = picked.map(validateStudentFile).find(Boolean);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    if (picked.length === 0) return;
    setPendingFiles((current) => [...current, ...picked]);
    setDirty(true);
  };

  const reset = () => {
    setForm({
      ...initialForm,
      drivingSchool: schoolName,
      ...nextNumbers,
    });
    setPendingFiles([]);
    setDirty(false);
  };

  const canSubmit =
    !submitting && form.firstName.trim() !== "" && form.lastName.trim() !== "";

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { pricePlanId, companionName, companionPhone, ...fields } = form;
      const created = await createStudent({
        ...fields,
        progress: 0,
        // Explicit plan (default = first plan for the class, also
        // decided by the server when omitted).
        pricePlanId: chosenPlan?.id ?? null,
        companion:
          showCompanion && (companionName.trim() || companionPhone.trim())
            ? { name: companionName.trim(), phone: companionPhone.trim() }
            : null,
        openDocuments: [],
      });
      if (sourceRequest) {
        try {
          await linkAppointmentRequestStudent(sourceRequest.id, created.id);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `Anfrage konnte nicht verknüpft werden: ${error.message}`
              : "Anfrage konnte nicht verknüpft werden.",
          );
        }
      }
      const openStudent = () =>
        void navigate({
          to: "/fahrschueler/$studentId",
          params: { studentId: String(created.id) },
        });
      toast.success("Schüler/in angelegt", {
        description: `${form.firstName} ${form.lastName} · Vertrag ${created.contractNumber}`,
        duration: 10_000,
        action: {
          label: "Vertrag öffnen",
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent(OPEN_CONTRACT_EVENT, { detail: created.id }),
            ),
        },
      });
      // Files can only be attached once the student has an id.
      const failed: string[] = [];
      for (const file of pendingFiles) {
        try {
          await uploadStudentFile(created.id, file);
        } catch (error) {
          failed.push(
            `${file.name}: ${error instanceof Error ? error.message : "Upload fehlgeschlagen."}`,
          );
        }
      }
      if (failed.length > 0) {
        toast.error("Nicht alle Dateien wurden hochgeladen", {
          description: `${failed.join(" · ")} — bitte im Tab „Dokumente" erneut hochladen.`,
        });
      }
      await refresh();
      setDirty(false);
      // Continue with the new student (contract, first lessons) instead of
      // an empty form.
      openStudent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Anlegen fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={reset}
              className="hidden sm:inline-flex"
            >
              Verwerfen
            </Button>
            <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
              <Check data-icon="inline-start" />
              Schüler anlegen
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="mx-auto flex w-full max-w-[1080px] gap-10">
          <FormSectionIndex sections={sections} />

          <div className="stagger-in flex min-w-0 flex-1 flex-col gap-8 pb-[50svh]">
            {/* Stammdaten */}
            <Section
              id="stammdaten"
              title="Stammdaten"
              description="Persönliche Angaben des Fahrschülers."
            >
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="firstName">Vorname</FieldLabel>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={(event) => update("firstName", event.target.value)}
                    placeholder="Vorname"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lastName">Nachname</FieldLabel>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(event) => update("lastName", event.target.value)}
                    placeholder="Nachname"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="birthday">Geburtsdatum</FieldLabel>
                  <Input
                    id="birthday"
                    value={form.birthday}
                    onChange={(event) => update("birthday", event.target.value)}
                    placeholder="TT.MM.JJJJ"
                    className="tabular-nums"
                  />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>Klasse</FieldLabel>
                  <div className="flex flex-col gap-2">
                    {LICENSE_CLASS_GROUPS.map((group) => (
                      <div
                        key={group.label}
                        className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <span className="shrink-0 text-xs text-muted-foreground sm:w-24">
                          {group.label}
                        </span>
                        {/* One class per student; each row is a slice of it. */}
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          value={group.classes.includes(form.classes) ? form.classes : ""}
                          onValueChange={(value) => {
                            if (value) update("classes", value);
                          }}
                          className="flex-wrap justify-start gap-1.5"
                          aria-label={`Führerscheinklasse ${group.label}`}
                        >
                          {group.classes.map((option) => (
                            <ToggleGroupItem
                              key={option}
                              value={option}
                              className="min-w-11 rounded-md data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                            >
                              {option}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                    ))}
                  </div>
                </Field>
                {showCompanion && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="companionName">
                        Begleitperson (BF17)
                      </FieldLabel>
                      <Input
                        id="companionName"
                        value={form.companionName}
                        onChange={(event) => update("companionName", event.target.value)}
                        placeholder="Vor- und Nachname"
                        autoComplete="off"
                      />
                      <FieldDescription>
                        Unter 18 — optional für Begleitetes Fahren ab 17.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="companionPhone">
                        Telefon der Begleitperson
                      </FieldLabel>
                      <Input
                        id="companionPhone"
                        value={form.companionPhone}
                        onChange={(event) => update("companionPhone", event.target.value)}
                        placeholder="Telefonnummer"
                        className="tabular-nums"
                      />
                    </Field>
                  </>
                )}
              </FieldGroup>
            </Section>

            {/* Zuteilung */}
            <Section
              id="zuteilung"
              title="Zuteilung"
              description="Fahrlehrer/in und Fahrzeug."
            >
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Fahrlehrer/in</FieldLabel>
                  <Select
                    value={form.instructor}
                    onValueChange={(value) => {
                      setForm((current) => withInstructor(current, value));
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger>
                      <GraduationCap className="text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {instructorOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Fahrzeug</FieldLabel>
                  <Select
                    value={form.vehicle}
                    onValueChange={(value) => update("vehicle", value)}
                  >
                    <SelectTrigger>
                      <Car className="text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {vehicleOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </Section>

            {/* Kontakt */}
            <Section id="kontakt" title="Kontakt">
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="phone">Telefon</FieldLabel>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="phone"
                      className="pl-9 tabular-nums"
                      value={form.phone}
                      onChange={(event) => update("phone", event.target.value)}
                      placeholder="Mobilnummer"
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">E-Mail</FieldLabel>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      className="pl-9"
                      value={form.email}
                      onChange={(event) => update("email", event.target.value)}
                      placeholder="name@beispiel.de"
                    />
                  </div>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="address">Adresse</FieldLabel>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
                    <Textarea
                      id="address"
                      className="min-h-16 pl-9"
                      value={form.address}
                      onChange={(event) => update("address", event.target.value)}
                      placeholder="Straße Hausnummer, PLZ Ort"
                    />
                  </div>
                </Field>
              </FieldGroup>
            </Section>

            {/* Dokumente */}
            <Section
              id="dokumente"
              title="Dokumente"
              description="Vorliegende Unterlagen und hochgeladene Dateien."
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {documentOptions.map((doc) => {
                  const checked = form.documents.includes(doc);
                  return (
                    <Label
                      key={doc}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm font-normal transition-colors",
                        checked
                          ? "border-primary bg-secondary"
                          : "hover:border-ring hover:bg-muted",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleDocument(doc, value === true)}
                      />
                      {doc}
                    </Label>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/20 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Upload className="size-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      PDF oder Bild (PNG, JPEG, WebP, HEIC) bis 12 MB
                    </span>
                  </div>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept={STUDENT_FILE_ACCEPT}
                    onChange={pickFiles}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload data-icon="inline-start" />
                    Datei auswählen
                  </Button>
                </div>
                {pendingFiles.map((file, index) => (
                  <PendingFileRow
                    key={`${file.name}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() =>
                      setPendingFiles((current) => current.filter((_, i) => i !== index))
                    }
                  />
                ))}
              </div>
            </Section>

            {/* Ausbildung */}
            <Section
              id="ausbildung"
              title="Ausbildung"
              description={
                classBDrives
                  ? `Sonderfahrten für Klasse ${form.classes} (Mindestumfang Klasse B, Anlage 4 FahrschAusbO). Der Stand wird aus den Fahrstunden im Kalender berechnet.`
                  : `Die Sonderfahrten für Klasse ${form.classes} richten sich nach Anlage 4 FahrschAusbO. Fahrstunden mit Fahrtart werden im Kalender erfasst.`
              }
            >
              {classBDrives && (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead>Bereich</TableHead>
                        <TableHead className="text-right">Stand</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(SPECIAL_DRIVE_REQUIREMENTS_B).map(
                        ([kind, minutes]) => (
                          <TableRow key={kind}>
                            <TableCell>{kind}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              0/{minutes} Min.
                            </TableCell>
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>

            {/* Vertrag */}
            <Section
              id="vertrag"
              title="Vertrag & Preise"
              description="Vertragsdaten, Fahrschule und Preisplan für die Abrechnung."
            >
              <FieldGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {canSeeMoney && (
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="pricePlan">Preisplan</FieldLabel>
                    <NativeSelect
                      id="pricePlan"
                      value={form.pricePlanId}
                      onChange={(event) => update("pricePlanId", event.target.value)}
                      className="w-full"
                      disabled={plans.length === 0}
                    >
                      <NativeSelectOption value="">
                        {defaultPlan
                          ? `${defaultPlan.name} (Standard für Klasse ${form.classes})`
                          : "Kein Preisplan hinterlegt"}
                      </NativeSelectOption>
                      {plans.map((plan) => (
                        <NativeSelectOption key={plan.id} value={String(plan.id)}>
                          {plan.name}
                          {(plan.classes ?? []).length > 0
                            ? ` · ${(plan.classes ?? []).join(", ")}`
                            : ""}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>
                      Bestimmt die Preise im Ausbildungsvertrag und beim Abrechnen.
                    </FieldDescription>
                  </Field>
                )}
                <AutoNumber label="Kundennummer" value={form.customerNumber} />
                <AutoNumber label="Vertragsnummer" value={form.contractNumber} />
                <Field>
                  <FieldLabel>Anmeldedatum</FieldLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 justify-start px-2.5 font-normal data-[empty=true]:text-muted-foreground"
                        data-empty={!form.registrationDate}
                      >
                        <CalendarDays
                          data-icon="inline-start"
                          className="text-muted-foreground"
                        />
                        <span className="tabular-nums">
                          {form.registrationDate || "Datum wählen"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={parseDate(form.registrationDate)}
                        defaultMonth={parseDate(form.registrationDate)}
                        weekStartsOn={1}
                        onSelect={(date) => {
                          if (date) update("registrationDate", formatDate(date));
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </Field>
                <Field>
                  <FieldLabel htmlFor="drivingSchool">Fahrschule</FieldLabel>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="drivingSchool"
                      className="pl-9"
                      value={form.drivingSchool}
                      onChange={(event) => update("drivingSchool", event.target.value)}
                      placeholder="Name der Fahrschule"
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={form.status}
                    onValueChange={(value) => {
                      if (value === "aktiv" || value === "inaktiv") {
                        update("status", value);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    spacing={0}
                    aria-label="Status"
                    className="w-full"
                  >
                    <ToggleGroupItem value="aktiv" className="flex-1">
                      Aktiv
                    </ToggleGroupItem>
                    <ToggleGroupItem value="inaktiv" className="flex-1">
                      Inaktiv
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NeueSchueler;
