import { useEffect, useState } from "react";
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
} from "lucide-react";

import { FormSection as Section, FormSectionIndex } from "./components/FormSection.tsx";
import { PageHeader } from "./components/PageHeader.tsx";
import { useInstructors } from "@/hooks/use-instructors";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import { createStudent, useStudents } from "@/hooks/use-students";
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
import { SPECIAL_DRIVE_REQUIREMENTS_B } from "@/lib/special-drives";
import { cn } from "@/lib/utils";

const classOptions = ["A", "B", "B197", "BE"];
const documentOptions = ["Personalausweis", "Passbild", "Sehtest", "Vertrag"];

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
  drivingSchool: "Fahrschule Demo",
  status: "aktiv",
  documents: [],
};

const sections = [
  { id: "stammdaten", label: "Stammdaten" },
  { id: "zuteilung", label: "Zuteilung" },
  { id: "kontakt", label: "Kontakt" },
  { id: "dokumente", label: "Dokumente" },
  { id: "ausbildung", label: "Ausbildung" },
  { id: "vertrag", label: "Vertrag" },
];

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

export function NeueSchueler() {
  const { students, refresh } = useStudents();
  const { vehicleOptions } = useVehicleOptions();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    ...nextStudentNumbers([]),
  }));
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Assignable instructors come from the DB-backed roster (/fahrlehrer).
  const { assignableNames: instructorOptions } = useInstructors();

  // IDs are assigned by the system, not entered by hand: they continue the
  // numbering range of the students in the DB, which loads async.
  useEffect(() => {
    setForm((current) => ({ ...current, ...nextStudentNumbers(students) }));
  }, [students]);

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

  const reset = () => {
    setForm({ ...initialForm, ...nextStudentNumbers(students) });
    setDirty(false);
  };

  const canSubmit =
    !submitting && form.firstName.trim() !== "" && form.lastName.trim() !== "";

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createStudent({
        ...form,
        progress: 0,
      });
      toast.success("Schüler/in angelegt", {
        description: `${form.firstName} ${form.lastName} wurde zur Fahrschule hinzugefügt.`,
      });
      await refresh();
      reset();
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
                    placeholder="Lena"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lastName">Nachname</FieldLabel>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(event) => update("lastName", event.target.value)}
                    placeholder="Braun"
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
                <Field>
                  <FieldLabel>Klasse</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={form.classes}
                    onValueChange={(value) => {
                      if (value) update("classes", value);
                    }}
                    className="justify-start gap-2"
                    aria-label="Führerscheinklasse"
                  >
                    {classOptions.map((option) => (
                      <ToggleGroupItem
                        key={option}
                        value={option}
                        className="rounded-md data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                      >
                        {option}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
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
                    onValueChange={(value) => update("instructor", value)}
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
                      placeholder="+49 151 23456780"
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
                      placeholder="lena.braun@example.com"
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
                      placeholder="Weidingweg 31, 64297 Darmstadt"
                    />
                  </div>
                </Field>
              </FieldGroup>
            </Section>

            {/* Dokumente */}
            <Section
              id="dokumente"
              title="Dokumente"
              description="Vorliegende Unterlagen."
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
            </Section>

            {/* Ausbildung */}
            <Section
              id="ausbildung"
              title="Ausbildung"
              description="Pflichtstunden (Klasse B). Der Stand wird aus den Fahrstunden im Kalender berechnet."
            >
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
                            0/{minutes} min
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            </Section>

            {/* Vertrag */}
            <Section
              id="vertrag"
              title="Vertrag"
              description="Vertragsdaten, Fahrschule und Abrechnungszuordnung."
            >
              <FieldGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
