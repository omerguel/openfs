import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Globe,
  ImagePlus,
  Info,
  Landmark,
  Mail,
  MapPin,
  Phone,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CompanyProfile } from "@/lib/accounting-types";
import {
  fetchCancellationPolicy,
  saveCancellationPolicy,
} from "@/hooks/use-calendar-events";
import { DEFAULT_CANCELLATION_POLICY } from "@/lib/cancellation";
import { formatCents, parseEuroToCents } from "@/lib/money";
import {
  saveSchoolProfile,
  useSchoolProfile,
  type OpeningHoursEntry,
} from "@/hooks/use-school-profile";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSection as Section, FormSectionIndex } from "./components/FormSection.tsx";
import { PageHeader } from "./components/PageHeader.tsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Primitives composed from shadcn                                     */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value ? "ja" : "nein"}
      onValueChange={(v) => v && onChange(v === "ja")}
      className="shrink-0"
    >
      <ToggleGroupItem value="ja" className="px-3">
        Ja
      </ToggleGroupItem>
      <ToggleGroupItem value="nein" className="px-3">
        Nein
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/* License classes as compact toggle chips; selected = filled primary. */
function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      value={value}
      onValueChange={onChange}
      className="w-full flex-wrap justify-start gap-2"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="rounded-md data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function TagInput({
  placeholder,
  initial = [],
}: {
  placeholder: string;
  initial?: string[];
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [val, setVal] = useState("");
  const add = () => {
    const t = val.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setVal("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1">
          {t}
          <button
            type="button"
            onClick={() => setTags(tags.filter((x) => x !== t))}
            className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !val && tags.length) setTags(tags.slice(0, -1));
        }}
        placeholder={tags.length ? "" : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1.5 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

type Hours = { day: string; open: string; close: string; note: string; closed: boolean };

const days = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

const officeDefaults: Hours[] = days.map((day) => ({
  day,
  open: day === "Sonntag" ? "" : "10:00",
  close: day === "Sonntag" ? "" : "17:00",
  note: day === "Sonntag" ? "" : "Büro - Anmeldung",
  closed: day === "Sonntag",
}));

const theoryDefaults: Hours[] = days.map((day) => ({
  day,
  open: "",
  close: "",
  note: "",
  closed: true,
}));

const licenseClasses = [
  "A",
  "A1",
  "A2",
  "A80",
  "AM",
  "ASF",
  "Andere",
  "Auff-BA",
  "Auff-BS",
  "B",
  "B Auto + B197",
  "B Automatik",
  "B17",
  "B196",
  "B197",
  "B96",
  "BE",
  "C",
  "C+CE",
  "C1",
  "C1+C1E",
  "C1E",
  "CE",
  "D",
  "D1",
  "D1E",
  "DE",
  "FES",
  "IAS-A",
  "IAS-S",
  "L",
  "MPU",
  "Mofa",
  "T",
];

const bkfClasses = ["C (BKF)", "C+CE (BKF)", "D (BKF)", "GC", "GD", "WC", "WD"];

const merkmaleList = [
  "Eignungstest",
  "ASF",
  "Sehtest",
  "Weibliche Fahrlehrer",
  "FES",
  "Finanzierung",
  "Erste Hilfe",
  "Amtliche Anmeldung",
  "Intensivkurs",
  "Online lernen",
  "Fahrsimulator",
];

const paymentMethods = [
  "Banküberweisung",
  "Kredit- / Debitkarte",
  "Bar",
  "Giro / EC-Karten",
];

const sections = [
  { id: "stammdaten", label: "Stammdaten" },
  { id: "oeffnungszeiten", label: "Öffnungszeiten" },
  { id: "theorie", label: "Theorie" },
  { id: "klassen", label: "Klassen" },
  { id: "merkmale", label: "Merkmale" },
  { id: "fahrzeuge", label: "Fahrzeuge" },
  { id: "zahlung", label: "Zahlung" },
  { id: "absagen", label: "Terminabsagen" },
];

/* ------------------------------------------------------------------ */
/* Hours editor                                                        */
/* ------------------------------------------------------------------ */

const HoursEditor = memo(function HoursEditor({
  initial,
  value,
  onChange,
}: {
  initial: Hours[];
  value?: Hours[];
  onChange?: (rows: Hours[]) => void;
}) {
  const [localRows, setLocalRows] = useState(initial);
  const rows = value ?? localRows;
  const update = (i: number, patch: Partial<Hours>) =>
    (onChange ?? setLocalRows)(
      rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );

  return (
    <div className="flex flex-col divide-y">
      {rows.map((r, i) => (
        <div
          key={r.day}
          className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex w-32 shrink-0 items-center gap-2">
            <Switch
              checked={!r.closed}
              onCheckedChange={(v) => update(i, { closed: !v })}
            />
            <span className="text-sm font-medium">{r.day}</span>
          </div>

          {r.closed ? (
            <span className="text-sm text-muted-foreground sm:flex-1">Geschlossen</span>
          ) : (
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={r.open}
                  onChange={(e) => update(i, { open: e.target.value })}
                  className="w-[120px] tabular-nums"
                />
                <span className="text-sm text-muted-foreground">bis</span>
                <Input
                  type="time"
                  value={r.close}
                  onChange={(e) => update(i, { close: e.target.value })}
                  className="w-[120px] tabular-nums"
                />
              </div>
              <Input
                value={r.note}
                onChange={(e) => update(i, { note: e.target.value })}
                placeholder="Weitere Anmerkungen"
                className="flex-1"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const EMPTY_COMPANY: CompanyProfile = {
  name: "",
  address: "",
  email: "",
  phone: "",
  website: "",
  steuernummer: "",
  ustIdNr: "",
  beraterNr: "",
  mandantNr: "",
  bankName: "",
  iban: "",
  bic: "",
  glaeubigerId: "",
  inhaber: "",
  registergericht: "",
  registernummer: "",
  aufsichtsbehoerde: "",
  datenschutzEmail: "",
  impressumZusatz: "",
};

export function Profil() {
  const [classes, setClasses] = useState<string[]>(["B", "B197", "A1", "AM"]);
  const [bkf, setBkf] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  // Company block is persisted server-side — it feeds the Quittungen.
  const [company, setCompany] = useState<CompanyProfile>(EMPTY_COMPANY);
  const {
    profile: schoolProfile,
    setProfile: setSchoolProfile,
    refresh: refreshSchoolProfile,
  } = useSchoolProfile(() => toast.error("Schulprofil konnte nicht geladen werden."));

  useEffect(() => {
    fetch("/api/profile")
      .then((res) => {
        if (!res.ok) throw new Error("Profil-Request fehlgeschlagen.");
        return res.json();
      })
      .then((profile: CompanyProfile) => setCompany(profile))
      .catch(() => toast.error("Profil konnte nicht geladen werden."));
  }, [formVersion]);

  const updateCompany = (patch: Partial<CompanyProfile>) =>
    setCompany((current) => ({ ...current, ...patch }));

  // Late-cancellation policy — edited as text, validated on save.
  const queryClient = useQueryClient();
  const [policyHours, setPolicyHours] = useState(
    String(DEFAULT_CANCELLATION_POLICY.hoursBefore),
  );
  const [policyFee, setPolicyFee] = useState("");
  useEffect(() => {
    fetchCancellationPolicy()
      .then((policy) => {
        setPolicyHours(String(policy.hoursBefore));
        setPolicyFee(policy.feeCents > 0 ? formatCents(policy.feeCents) : "");
      })
      .catch(() => toast.error("Absage-Regeln konnten nicht geladen werden."));
  }, [formVersion]);

  const save = async () => {
    const hoursBefore = Number(policyHours);
    const feeCents = policyFee.trim() ? parseEuroToCents(policyFee) : 0;
    if (!Number.isInteger(hoursBefore) || hoursBefore < 0 || hoursBefore > 720) {
      toast.error("Absagefrist muss eine ganze Zahl zwischen 0 und 720 Stunden sein.");
      return;
    }
    if (feeCents == null) {
      toast.error("Ausfallgebühr ist kein gültiger Betrag.");
      return;
    }
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      if (!res.ok) throw new Error();
      const savedCompany = (await res.json()) as CompanyProfile;
      setCompany(savedCompany);
      setSchoolProfile(
        await saveSchoolProfile({ ...schoolProfile, website: savedCompany.website }),
      );
      await saveCancellationPolicy({ hoursBefore, feeCents });
      await queryClient.invalidateQueries({ queryKey: ["cancellation-policy"] });
      setDirty(false);
      toast.success("Profil gespeichert.");
    } catch {
      toast.error("Profil konnte nicht gespeichert werden.");
    }
  };
  const [merkmale, setMerkmale] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      merkmaleList.map((m) => [
        m,
        ["Sehtest", "Erste Hilfe", "Finanzierung", "Online lernen"].includes(m),
      ]),
    ),
  );
  const [payments, setPayments] = useState<string[]>(["Banküberweisung", "Bar"]);
  const markDirty = () => setDirty(true);

  const officeHours = useMemo(
    () =>
      schoolProfile.opening_hours.map((entry) => {
        const match = entry.hours.match(
          /^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})(?:\s+(.+))?$/,
        );
        return {
          day: entry.day,
          open: match?.[1] ?? "",
          close: match?.[2] ?? "",
          note: match?.[3] ?? "",
          closed: entry.hours === "Geschlossen" || !match,
        };
      }),
    [schoolProfile.opening_hours],
  );

  const updateOfficeHours = useCallback(
    (rows: Hours[]) => {
      const opening_hours: OpeningHoursEntry[] = rows.map((row) => ({
        day: row.day,
        hours: row.closed
          ? "Geschlossen"
          : `${row.open} – ${row.close}${row.note.trim() ? ` ${row.note.trim()}` : ""}`,
      }));
      setSchoolProfile((current) => ({ ...current, opening_hours }));
    },
    [setSchoolProfile],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      {/* Header */}
      <PageHeader
        end={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty}
              className="hidden sm:inline-flex"
              onClick={() => {
                setDirty(false);
                setFormVersion((v) => v + 1);
                void refreshSchoolProfile();
              }}
            >
              Verwerfen
            </Button>
            <Button type="button" disabled={!dirty} onClick={save}>
              <Check />
              Speichern
            </Button>
          </>
        }
      />

      {/* Body */}
      <div
        key={formVersion}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6"
        onInputCapture={markDirty}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("button")) markDirty();
        }}
      >
        <div className="mx-auto flex w-full max-w-[1080px] gap-10">
          <FormSectionIndex sections={sections} />

          <div className="stagger-in flex min-w-0 flex-1 flex-col gap-8 pb-[50svh]">
            {/* Stammdaten */}
            <Section
              id="stammdaten"
              title="Stammdaten"
              description="Grunddaten Ihrer Fahrschule — erscheinen auf Quittungen und im DATEV-Export."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Fahrschulname" htmlFor="name">
                  <Input
                    id="name"
                    value={company.name}
                    onChange={(e) => updateCompany({ name: e.target.value })}
                  />
                </Field>
                <Field label="Anschrift" htmlFor="address">
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="address"
                      className="pl-9"
                      value={company.address}
                      onChange={(e) => updateCompany({ address: e.target.value })}
                    />
                  </div>
                </Field>
                <Field
                  label="E-Mail"
                  htmlFor="email"
                  hint="Über diese E-Mail erhalten Sie alle Buchungen."
                >
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      className="pl-9"
                      value={company.email}
                      onChange={(e) => updateCompany({ email: e.target.value })}
                    />
                  </div>
                </Field>
                <Field label="Telefon" htmlFor="phone">
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      className="pl-9"
                      value={company.phone}
                      onChange={(e) => updateCompany({ phone: e.target.value })}
                    />
                  </div>
                </Field>
                <Field label="Webseite" htmlFor="web">
                  <div className="relative">
                    <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="web"
                      type="url"
                      className="pl-9"
                      value={company.website}
                      onChange={(e) => {
                        updateCompany({ website: e.target.value });
                        setSchoolProfile((current) => ({
                          ...current,
                          website: e.target.value,
                        }));
                      }}
                    />
                  </div>
                </Field>
                <Field label="Beschreibung" htmlFor="desc">
                  <Textarea
                    id="desc"
                    rows={3}
                    placeholder="Beschreiben Sie Ihre Fahrschule in wenigen Sätzen…"
                    value={schoolProfile.description}
                    onChange={(e) =>
                      setSchoolProfile((current) => ({
                        ...current,
                        description: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Steuernummer"
                  htmlFor="steuernummer"
                  hint="Erscheint auf Quittungen (§ 14 UStG)."
                >
                  <div className="relative">
                    <Landmark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="steuernummer"
                      className="pl-9 font-mono text-[13px]"
                      placeholder="z. B. 045 123 45678"
                      value={company.steuernummer}
                      onChange={(e) => updateCompany({ steuernummer: e.target.value })}
                    />
                  </div>
                </Field>
                <Field
                  label="USt-IdNr"
                  htmlFor="ustidnr"
                  hint="Optional — alternativ zur Steuernummer auf Quittungen."
                >
                  <div className="relative">
                    <Landmark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="ustidnr"
                      className="pl-9 font-mono text-[13px]"
                      placeholder="z. B. DE123456789"
                      value={company.ustIdNr}
                      onChange={(e) => updateCompany({ ustIdNr: e.target.value })}
                    />
                  </div>
                </Field>
                <Field
                  label="DATEV-Beraternummer"
                  htmlFor="beraternr"
                  hint="Nummer Ihres Steuerberaters (1001–9999999) — für den DATEV-Export."
                >
                  <div className="relative">
                    <Landmark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="beraternr"
                      className="pl-9 font-mono text-[13px]"
                      inputMode="numeric"
                      placeholder="z. B. 29098"
                      value={company.beraterNr}
                      onChange={(e) => updateCompany({ beraterNr: e.target.value })}
                    />
                  </div>
                </Field>
                <Field
                  label="DATEV-Mandantennummer"
                  htmlFor="mandantnr"
                  hint="Ihre Mandantennummer beim Steuerberater (1–99999)."
                >
                  <div className="relative">
                    <Landmark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="mandantnr"
                      className="pl-9 font-mono text-[13px]"
                      inputMode="numeric"
                      placeholder="z. B. 55003"
                      value={company.mandantNr}
                      onChange={(e) => updateCompany({ mandantNr: e.target.value })}
                    />
                  </div>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Bank"
                  htmlFor="bankname"
                  hint="Bankverbindung für Rechnungen und Lastschriften."
                >
                  <Input
                    id="bankname"
                    placeholder="z. B. Sparkasse Darmstadt"
                    value={company.bankName}
                    onChange={(e) => updateCompany({ bankName: e.target.value })}
                  />
                </Field>
                <Field label="IBAN" htmlFor="iban" hint="Erscheint auf Rechnungen.">
                  <Input
                    id="iban"
                    className="font-mono text-[13px]"
                    placeholder="DE00 0000 0000 0000 0000 00"
                    value={company.iban}
                    onChange={(e) => updateCompany({ iban: e.target.value })}
                  />
                </Field>
                <Field
                  label="BIC"
                  htmlFor="bic"
                  hint="Optional bei SEPA-Inlandszahlungen."
                >
                  <Input
                    id="bic"
                    className="font-mono text-[13px]"
                    placeholder="z. B. HELADEF1DAS"
                    value={company.bic}
                    onChange={(e) => updateCompany({ bic: e.target.value })}
                  />
                </Field>
                <Field
                  label="Gläubiger-ID"
                  htmlFor="glaeubigerid"
                  hint="SEPA-Gläubiger-Identifikationsnummer der Bundesbank — für Lastschriften."
                >
                  <Input
                    id="glaeubigerid"
                    className="font-mono text-[13px]"
                    placeholder="z. B. DE98ZZZ09999999999"
                    value={company.glaeubigerId}
                    onChange={(e) => updateCompany({ glaeubigerId: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Die Fahrschule in Bildern</Label>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 px-4 py-8 text-center transition-colors hover:border-ring hover:bg-muted">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ImagePlus className="size-5" />
                  </div>
                  <p className="text-sm text-foreground">
                    Lassen Sie Ihre Bilder hier oder{" "}
                    <span className="font-medium underline underline-offset-2">
                      wählen Sie die Datei
                    </span>
                  </p>
                  <span className="text-xs text-muted-foreground">
                    PNG, JPG bis 10 MB
                  </span>
                  <input type="file" accept="image/*" multiple className="hidden" />
                </label>
              </div>
            </Section>

            {/* Öffnungszeiten */}
            <Section
              id="oeffnungszeiten"
              title="Öffnungszeiten"
              description="Teilen Sie Ihre Öffnungszeiten mit und erleichtern Sie Ihren Kunden die Terminvereinbarung."
            >
              <HoursEditor
                initial={officeDefaults}
                value={officeHours}
                onChange={updateOfficeHours}
              />
            </Section>

            {/* Theorieunterricht */}
            <Section
              id="theorie"
              title="Theorieunterricht"
              description="Veröffentlichen Sie Ihre Theorie-Stunden und machen Sie es den Schülern leichter."
            >
              <HoursEditor initial={theoryDefaults} />
            </Section>

            {/* Klassen */}
            <Section
              id="klassen"
              title="Klassen"
              description="Welche Führerscheinklassen bieten Sie an?"
            >
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Führerscheinklassen</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {classes.length} ausgewählt
                    </span>
                  </div>
                  <ChipGroup
                    options={licenseClasses}
                    value={classes}
                    onChange={setClasses}
                  />
                </div>

                <Separator />

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Führerscheinklassen Berufskraftfahrer</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {bkf.length} ausgewählt
                    </span>
                  </div>
                  <ChipGroup options={bkfClasses} value={bkf} onChange={setBkf} />
                </div>
              </div>
            </Section>

            {/* Merkmale */}
            <Section
              id="merkmale"
              title="Merkmale"
              description="Welche Leistungen bietet Ihre Fahrschule?"
            >
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                {merkmaleList.map((m) => (
                  <div
                    key={m}
                    className="flex items-center justify-between border-b py-3 last:border-0"
                  >
                    <span className="text-sm">{m}</span>
                    <YesNo
                      value={merkmale[m] ?? false}
                      onChange={(v) => setMerkmale({ ...merkmale, [m]: v })}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Sprachen" hint="Enter drücken zum Hinzufügen">
                  <TagInput
                    placeholder="Sprache hinzufügen…"
                    initial={["Deutsch", "Türkisch"]}
                  />
                </Field>
                <Field label="Zertifikate" hint="Enter drücken zum Hinzufügen">
                  <TagInput placeholder="Zertifikat hinzufügen…" />
                </Field>
              </div>
            </Section>

            {/* Fahrzeuge */}
            <Section
              id="fahrzeuge"
              title="Fahrzeuge"
              description="Marken Ihrer Schulungsfahrzeuge je Klasse."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Klasse A (Motorrad) — Marken">
                  <TagInput placeholder="Marke hinzufügen…" initial={["Honda"]} />
                </Field>
                <Field label="Klasse B (PKW) — Marken">
                  <TagInput placeholder="Marke hinzufügen…" initial={["VW", "Audi"]} />
                </Field>
                <Field label="Klasse C — Marken">
                  <TagInput placeholder="Marke hinzufügen…" />
                </Field>
                <Field label="Klasse D — Marken">
                  <TagInput placeholder="Marke hinzufügen…" />
                </Field>
              </div>
            </Section>

            {/* Zahlungsmethode */}
            <Section
              id="zahlung"
              title="Zahlungsmethode"
              description="Welche Zahlungsarten akzeptieren Sie?"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {paymentMethods.map((p) => {
                  const active = payments.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setPayments(
                          active ? payments.filter((x) => x !== p) : [...payments, p],
                        )
                      }
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-[background-color,border-color,transform] duration-150 ease-snappy hover:duration-0 active:duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
                        active ? "border-primary bg-secondary" : "hover:border-ring",
                      )}
                    >
                      <span className="text-sm font-medium">{p}</span>
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-transparent",
                        )}
                      >
                        <Check className="size-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Terminabsagen */}
            <Section
              id="absagen"
              title="Terminabsagen"
              description="Regeln für kurzfristige Absagen und Nichterscheinen — steuern die Vorauswahl der Ausfallgebühr beim Absagen eines Termins."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field
                  label="Absagefrist (Stunden vor Beginn)"
                  htmlFor="policy-hours"
                  hint="Spätere Absagen gelten als kurzfristig. Nichterscheinen ist immer gebührenpflichtig."
                >
                  <Input
                    id="policy-hours"
                    type="number"
                    min={0}
                    max={720}
                    className="tabular-nums"
                    value={policyHours}
                    onChange={(e) => setPolicyHours(e.target.value)}
                  />
                </Field>
                <Field
                  label="Ausfallgebühr (EUR)"
                  htmlFor="policy-fee"
                  hint="Leer lassen, um den Preis einer Fahrübungsstunde aus dem Preisplan des Fahrschülers zu verwenden."
                >
                  <Input
                    id="policy-fee"
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder="Preis der Fahrstunde"
                    value={policyFee}
                    onChange={(e) => setPolicyFee(e.target.value)}
                  />
                </Field>
              </div>
            </Section>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t pt-6">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Info className="size-4 shrink-0" />
                <span className="text-sm">
                  Änderungen werden erst nach dem Speichern öffentlich sichtbar.
                </span>
              </div>
              <Button className="shrink-0" onClick={save}>
                Speichern
                <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profil;
