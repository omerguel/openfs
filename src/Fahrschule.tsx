/* ------------------------------------------------------------------ */
/* Fahrschule & Einstellungen — one place for the school's settings    */
/* (formerly Profil, Schulprofil and Fahrschule):                      */
/*   Stammdaten & Steuer · Bankverbindung · Öffentliches Profil ·      */
/*   Öffnungszeiten · Standorte · Rechtliches · Terminabsagen          */
/* /profil and /schulprofil redirect here (?tab=…).                    */
/*                                                                     */
/* Editing model: the server state comes from react-query; the page    */
/* keeps a draft only once something was changed. "Ungespeichert" is   */
/* draft ≠ server state (see lib/settings-form.ts) — never derived     */
/* from input events, which used to swallow the first keystroke.       */
/* Steuer- und Bankdaten: editable by the Inhaber only (server too).   */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle, Check, ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";

import { FormField, RequiredLegend } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { ChipSelect, HoursEditor, TagInput } from "@/components/fahrschule/editors";
import { Standorte } from "@/components/fahrschule/Standorte";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStatus } from "@/hooks/use-auth";
import {
  fetchCancellationPolicy,
  saveCancellationPolicy,
} from "@/hooks/use-calendar-events";
import {
  companyProfileQueryOptions,
  saveCompanyProfile,
} from "@/hooks/use-company-profile";
import {
  type SchoolProfile,
  saveSchoolProfile,
  schoolProfileQueryOptions,
} from "@/hooks/use-school-profile";
import type { CompanyProfile } from "@/lib/accounting-types";
import { toInstagramUrl } from "@/lib/instagram";
import { parseEuroToCents } from "@/lib/money";
import { formatIban } from "@/lib/sepa";
import {
  changedParts,
  type FieldErrors,
  policyToDraft,
  type SettingsDraft,
  tabOfField,
  validateSettings,
} from "@/lib/settings-form";
import {
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  type SettingsTab,
} from "@/lib/settings-tabs";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

const LICENSE_CLASSES = [
  "AM",
  "A1",
  "A2",
  "A",
  "A80",
  "B",
  "B96",
  "B196",
  "B197",
  "B Automatik",
  "BE",
  "C1",
  "C1E",
  "C",
  "CE",
  "D1",
  "D1E",
  "D",
  "DE",
  "L",
  "T",
  "Mofa",
  "ASF",
  "FES",
  "MPU",
];
const BKF_CLASSES = ["C (BKF)", "C+CE (BKF)", "D (BKF)", "GC", "GD", "WC", "WD"];
const FEATURES = [
  "Eignungstest",
  "ASF",
  "Sehtest",
  "Erste Hilfe",
  "Weibliche Fahrlehrer",
  "FES",
  "Finanzierung",
  "Amtliche Anmeldung",
  "Intensivkurs",
  "Online lernen",
  "Fahrsimulator",
];
const PAYMENT_METHODS = [
  "Banküberweisung",
  "Lastschrift",
  "Bar",
  "Giro / EC-Karte",
  "Kredit- / Debitkarte",
];

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

function OwnerOnlyNote() {
  return (
    <Alert>
      <Lock />
      <AlertDescription>
        Steuer- und Bankdaten kann nur die Inhaberin bzw. der Inhaber ändern. Sie sehen
        sie hier zur Information.
      </AlertDescription>
    </Alert>
  );
}

type TabProps = {
  value: SettingsDraft;
  errors: FieldErrors;
  setCompany: (patch: Partial<CompanyProfile>) => void;
  setSchool: (patch: Partial<SchoolProfile>) => void;
  setPolicy: (patch: Partial<SettingsDraft["policy"]>) => void;
  ownerOnlyLocked: boolean;
};

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function StammdatenTab({ value, errors, setCompany, ownerOnlyLocked }: TabProps) {
  const c = value.company;
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Fahrschule"
        description="Grunddaten — erscheinen auf Rechnungen, Quittungen, im Impressum und im DATEV-Export."
      >
        <Grid>
          <FormField
            id="company-name"
            label="Name der Fahrschule"
            required
            error={errors["company-name"]}
          >
            <Input
              value={c.name}
              onChange={(e) => setCompany({ name: e.target.value })}
            />
          </FormField>
          <FormField
            id="company-inhaber"
            label="Inhaber/in bzw. vertretungsberechtigte Person"
            hint="Pflichtangabe im Impressum (§ 5 DDG)."
          >
            <Input
              placeholder="Vor- und Nachname"
              value={c.inhaber}
              onChange={(e) => setCompany({ inhaber: e.target.value })}
            />
          </FormField>
          <FormField id="company-address" label="Anschrift">
            <Input
              placeholder="Straße Nr., PLZ Ort"
              value={c.address}
              onChange={(e) => setCompany({ address: e.target.value })}
            />
          </FormField>
          <FormField id="company-phone" label="Telefon">
            <Input
              type="tel"
              value={c.phone}
              onChange={(e) => setCompany({ phone: e.target.value })}
            />
          </FormField>
          <FormField
            id="company-email"
            label="E-Mail"
            hint="Kontaktadresse der Fahrschule — auch Antwortadresse für E-Mails an Schüler."
            error={errors["company-email"]}
          >
            <Input
              type="email"
              value={c.email}
              onChange={(e) => setCompany({ email: e.target.value })}
            />
          </FormField>
          <FormField id="company-website" label="Webseite">
            <Input
              type="url"
              placeholder="https://…"
              value={c.website}
              onChange={(e) => setCompany({ website: e.target.value })}
            />
          </FormField>
        </Grid>
      </Section>
      <Section
        title="Steuer & DATEV"
        description="Steuernummer oder USt-IdNr. muss auf jeder Rechnung stehen (§ 14 UStG)."
      >
        {ownerOnlyLocked && <OwnerOnlyNote />}
        <Grid>
          <FormField
            id="company-steuernummer"
            label="Steuernummer"
            hint="Vom Finanzamt, z. B. 045/123/45678."
          >
            <Input
              className="font-mono text-[13px]"
              disabled={ownerOnlyLocked}
              value={c.steuernummer}
              onChange={(e) => setCompany({ steuernummer: e.target.value })}
            />
          </FormField>
          <FormField
            id="company-ustidnr"
            label="USt-IdNr. (Umsatzsteuer-Identifikationsnummer)"
            hint="Optional — z. B. DE123456789."
          >
            <Input
              className="font-mono text-[13px]"
              disabled={ownerOnlyLocked}
              value={c.ustIdNr}
              onChange={(e) => setCompany({ ustIdNr: e.target.value })}
            />
          </FormField>
          <FormField
            id="company-beraternr"
            label="DATEV-Beraternummer"
            hint="Nummer Ihres Steuerberaters (1001–9999999)."
            error={errors["company-beraternr"]}
          >
            <Input
              inputMode="numeric"
              className="font-mono text-[13px]"
              disabled={ownerOnlyLocked}
              value={c.beraterNr}
              onChange={(e) =>
                setCompany({ beraterNr: e.target.value.replace(/\D/g, "") })
              }
            />
          </FormField>
          <FormField
            id="company-mandantnr"
            label="DATEV-Mandantennummer"
            hint="Ihre Mandantennummer beim Steuerberater (1–99999)."
            error={errors["company-mandantnr"]}
          >
            <Input
              inputMode="numeric"
              className="font-mono text-[13px]"
              disabled={ownerOnlyLocked}
              value={c.mandantNr}
              onChange={(e) =>
                setCompany({ mandantNr: e.target.value.replace(/\D/g, "") })
              }
            />
          </FormField>
        </Grid>
      </Section>
    </div>
  );
}

function BankTab({ value, errors, setCompany, ownerOnlyLocked }: TabProps) {
  const c = value.company;
  return (
    <Section
      title="Bankverbindung"
      description="Erscheint auf Rechnungen und ist das Gläubigerkonto für SEPA-Lastschriften."
    >
      {ownerOnlyLocked && <OwnerOnlyNote />}
      <Grid>
        <FormField id="company-bankname" label="Bank">
          <Input
            placeholder="z. B. Sparkasse Darmstadt"
            disabled={ownerOnlyLocked}
            value={c.bankName}
            onChange={(e) => setCompany({ bankName: e.target.value })}
          />
        </FormField>
        <FormField
          id="company-iban"
          label="IBAN"
          hint="Wird mit der Prüfziffer kontrolliert."
          error={errors["company-iban"]}
        >
          <Input
            className="font-mono text-[13px]"
            placeholder="DE00 0000 0000 0000 0000 00"
            autoComplete="off"
            disabled={ownerOnlyLocked}
            value={c.iban}
            onChange={(e) => setCompany({ iban: e.target.value.toUpperCase() })}
            onBlur={() => {
              if (c.iban.trim() && !errors["company-iban"])
                setCompany({ iban: formatIban(c.iban) });
            }}
          />
        </FormField>
        <FormField
          id="company-bic"
          label="BIC"
          hint="Optional bei Inlandszahlungen."
          error={errors["company-bic"]}
        >
          <Input
            className="font-mono text-[13px]"
            placeholder="z. B. HELADEF1DAS"
            disabled={ownerOnlyLocked}
            value={c.bic}
            onChange={(e) => setCompany({ bic: e.target.value.toUpperCase() })}
          />
        </FormField>
        <FormField
          id="company-glaeubigerid"
          label="Gläubiger-ID"
          hint="SEPA-Gläubiger-Identifikationsnummer der Bundesbank — nur für Lastschriften."
          error={errors["company-glaeubigerid"]}
        >
          <Input
            className="font-mono text-[13px]"
            placeholder="z. B. DE98ZZZ09999999999"
            disabled={ownerOnlyLocked}
            value={c.glaeubigerId}
            onChange={(e) => setCompany({ glaeubigerId: e.target.value.toUpperCase() })}
          />
        </FormField>
      </Grid>
    </Section>
  );
}

function ProfilTab({ value, errors, setSchool }: TabProps) {
  const s = value.school;
  const setBrands = (group: keyof SchoolProfile["vehicle_brands"], next: string[]) =>
    setSchool({ vehicle_brands: { ...s.vehicle_brands, [group]: next } });
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Auftritt"
        description="So stellt sich Ihre Fahrschule öffentlich vor, z. B. auf der Anfrageseite."
      >
        <Grid>
          <FormField
            id="school-slogan"
            label="Slogan"
            hint="Ein kurzer, prägnanter Satz."
          >
            <Input
              placeholder="z. B. Mit Ruhe zum Führerschein."
              value={s.slogan}
              onChange={(e) => setSchool({ slogan: e.target.value })}
            />
          </FormField>
          <FormField
            id="school-founded"
            label="Dabei seit"
            hint="Gründungsjahr (optional)."
            error={errors["school-founded"]}
          >
            <Input
              inputMode="numeric"
              maxLength={4}
              placeholder="z. B. 1998"
              value={s.founded_year ?? ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                setSchool({ founded_year: digits ? Number(digits) : null });
              }}
            />
          </FormField>
          <FormField
            id="school-description"
            label="Beschreibung"
            className="md:col-span-2"
          >
            <Textarea
              rows={4}
              placeholder="Beschreiben Sie Ihre Fahrschule in wenigen Sätzen …"
              value={s.description}
              onChange={(e) => setSchool({ description: e.target.value })}
            />
          </FormField>
        </Grid>
      </Section>
      <Section title="Social Media & Google">
        <Grid>
          <FormField
            id="school-instagram"
            label="Instagram"
            hint="Link oder @Name — wird zum Profil-Link ergänzt."
            error={errors["school-instagram"]}
          >
            <Input
              placeholder="@fahrschule"
              value={s.instagram}
              onChange={(e) => setSchool({ instagram: e.target.value })}
              onBlur={() => {
                const url = toInstagramUrl(s.instagram);
                if (url && url !== s.instagram) setSchool({ instagram: url });
              }}
            />
          </FormField>
          <FormField id="school-facebook" label="Facebook">
            <Input
              placeholder="https://facebook.com/…"
              value={s.facebook}
              onChange={(e) => setSchool({ facebook: e.target.value })}
            />
          </FormField>
          <FormField id="school-maps" label="Google Maps">
            <Input
              placeholder="https://maps.google.com/…"
              value={s.google_maps_url}
              onChange={(e) => setSchool({ google_maps_url: e.target.value })}
            />
          </FormField>
          <FormField
            id="school-place-id"
            label="Google Place ID"
            hint="Für den Import der Google-Bewertungen. Die ID beginnt meist mit „ChIJ“ (Place ID Finder von Google)."
            error={errors["school-place-id"]}
          >
            <Input
              className="font-mono"
              placeholder="ChIJ…"
              spellCheck={false}
              value={s.google_place_id}
              onChange={(e) => setSchool({ google_place_id: e.target.value.trim() })}
            />
          </FormField>
        </Grid>
      </Section>
      <Section title="Angebot" description="Welche Klassen und Leistungen bieten Sie an?">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Führerscheinklassen</span>
          <ChipSelect
            label="Führerscheinklassen"
            options={LICENSE_CLASSES}
            value={s.license_classes}
            onChange={(license_classes) => setSchool({ license_classes })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Berufskraftfahrer</span>
          <ChipSelect
            label="Berufskraftfahrer-Klassen"
            options={BKF_CLASSES}
            value={s.bkf_classes}
            onChange={(bkf_classes) => setSchool({ bkf_classes })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Merkmale</span>
          <ChipSelect
            label="Merkmale"
            options={FEATURES}
            value={s.features}
            onChange={(features) => setSchool({ features })}
          />
        </div>
        <Grid>
          <FormField
            id="school-services"
            label="Leistungen"
            hint="Enter drückt einen Eintrag fest."
          >
            <TagInput
              value={s.services}
              onChange={(services) => setSchool({ services })}
              placeholder="z. B. Intensivkurse"
            />
          </FormField>
          <FormField
            id="school-highlights"
            label="Highlights"
            hint="Was macht Sie besonders?"
          >
            <TagInput
              value={s.highlights}
              onChange={(highlights) => setSchool({ highlights })}
              placeholder="z. B. Moderne Fahrzeugflotte"
            />
          </FormField>
          <FormField id="school-languages" label="Sprachen" hint="Unterrichtssprachen.">
            <TagInput
              value={s.languages}
              onChange={(languages) => setSchool({ languages })}
              placeholder="z. B. Deutsch"
            />
          </FormField>
          <FormField id="school-certificates" label="Zertifikate">
            <TagInput
              value={s.certificates}
              onChange={(certificates) => setSchool({ certificates })}
              placeholder="z. B. DEKRA-zertifiziert"
            />
          </FormField>
        </Grid>
      </Section>
      <Section
        title="Fahrzeugmarken"
        description="Marken Ihrer Schulungsfahrzeuge je Klasse."
      >
        <Grid>
          {(
            [
              ["A", "Klasse A (Motorrad)"],
              ["B", "Klasse B (Pkw)"],
              ["C", "Klasse C (Lkw)"],
              ["D", "Klasse D (Bus)"],
            ] as const
          ).map(([group, label]) => (
            <FormField key={group} id={`school-brands-${group}`} label={label}>
              <TagInput
                value={s.vehicle_brands[group]}
                onChange={(next) => setBrands(group, next)}
                placeholder="Marke hinzufügen …"
              />
            </FormField>
          ))}
        </Grid>
      </Section>
      <Section title="Zahlungsarten" description="Welche Zahlungsarten akzeptieren Sie?">
        <ChipSelect
          label="Zahlungsarten"
          options={PAYMENT_METHODS}
          value={s.payment_methods}
          onChange={(payment_methods) => setSchool({ payment_methods })}
        />
      </Section>
    </div>
  );
}

function ZeitenTab({ value, errors, setSchool }: TabProps) {
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Bürozeiten"
        description="Wann ist Ihr Büro für Anmeldung und Fragen erreichbar?"
      >
        <HoursEditor
          idPrefix="opening"
          value={value.school.opening_hours}
          errors={errors}
          onChange={(opening_hours) => setSchool({ opening_hours })}
        />
      </Section>
      <Section
        title="Theorieunterricht"
        description="Feste Theoriezeiten, falls vorhanden."
      >
        <HoursEditor
          idPrefix="theory"
          value={value.school.theory_hours}
          errors={errors}
          onChange={(theory_hours) => setSchool({ theory_hours })}
        />
      </Section>
    </div>
  );
}

function RechtTab({ value, errors, setCompany }: TabProps) {
  const c = value.company;
  return (
    <Section
      title="Impressum & Datenschutz"
      description={
        <>
          Ergänzt die öffentlichen Seiten{" "}
          <a
            href="/impressum"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Impressum
            <ExternalLink className="ml-0.5 inline size-3" />
          </a>{" "}
          und{" "}
          <a
            href="/datenschutz"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Datenschutzerklärung
            <ExternalLink className="ml-0.5 inline size-3" />
          </a>
          , zusammen mit Name, Anschrift, Inhaber/in und Steuerangaben aus „Stammdaten &
          Steuer“.
        </>
      }
    >
      <Grid>
        <FormField
          id="company-aufsichtsbehoerde"
          label="Aufsichtsbehörde"
          hint="Behörde, die die Fahrschulerlaubnis erteilt hat."
        >
          <Input
            placeholder="z. B. Stadt Darmstadt, Straßenverkehrsbehörde"
            value={c.aufsichtsbehoerde}
            onChange={(e) => setCompany({ aufsichtsbehoerde: e.target.value })}
          />
        </FormField>
        <FormField
          id="company-datenschutzemail"
          label="E-Mail für Datenschutzanfragen"
          hint="Optional — sonst gilt die E-Mail der Fahrschule."
          error={errors["company-datenschutzemail"]}
        >
          <Input
            type="email"
            value={c.datenschutzEmail}
            onChange={(e) => setCompany({ datenschutzEmail: e.target.value })}
          />
        </FormField>
        <FormField
          id="company-registergericht"
          label="Registergericht"
          hint="Nur bei Eintragung im Handelsregister."
        >
          <Input
            placeholder="z. B. Amtsgericht Darmstadt"
            value={c.registergericht}
            onChange={(e) => setCompany({ registergericht: e.target.value })}
          />
        </FormField>
        <FormField
          id="company-registernummer"
          label="Registernummer"
          hint="z. B. HRB 12345."
        >
          <Input
            className="font-mono text-[13px]"
            value={c.registernummer}
            onChange={(e) => setCompany({ registernummer: e.target.value })}
          />
        </FormField>
        <FormField
          id="company-impressumzusatz"
          label="Zusatz zum Impressum"
          hint="Optional — erscheint am Ende des Impressums."
          className="md:col-span-2"
        >
          <Textarea
            rows={3}
            value={c.impressumZusatz}
            onChange={(e) => setCompany({ impressumZusatz: e.target.value })}
          />
        </FormField>
      </Grid>
    </Section>
  );
}

function AbsagenTab({ value, errors, setPolicy }: TabProps) {
  return (
    <Section
      title="Terminabsagen"
      description="Regeln für kurzfristige Absagen und Nichterscheinen — steuern die Vorauswahl der Ausfallgebühr beim Absagen eines Termins."
    >
      <Grid>
        <FormField
          id="policy-hours"
          label="Absagefrist (Stunden vor Beginn)"
          required
          hint="Spätere Absagen gelten als kurzfristig. Nichterscheinen ist immer gebührenpflichtig."
          error={errors["policy-hours"]}
        >
          <Input
            inputMode="numeric"
            className="tabular-nums"
            value={value.policy.hours}
            onChange={(e) => setPolicy({ hours: e.target.value.replace(/\D/g, "") })}
          />
        </FormField>
        <FormField
          id="policy-fee"
          label="Ausfallgebühr (EUR)"
          hint="Leer lassen, um den Preis einer Fahrstunde aus dem Preisplan des Fahrschülers zu verwenden."
          error={errors["policy-fee"]}
        >
          <Input
            inputMode="decimal"
            className="tabular-nums"
            placeholder="Preis der Fahrstunde"
            value={value.policy.fee}
            onChange={(e) => setPolicy({ fee: e.target.value })}
          />
        </FormField>
      </Grid>
    </Section>
  );
}

const TAB_CONTENT: Record<
  Exclude<SettingsTab, "standorte">,
  (props: TabProps) => React.ReactNode
> = {
  stammdaten: StammdatenTab,
  bank: BankTab,
  profil: ProfilTab,
  zeiten: ZeitenTab,
  recht: RechtTab,
  absagen: AbsagenTab,
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function useSavedSettings() {
  const company = useQuery(companyProfileQueryOptions);
  const school = useQuery(schoolProfileQueryOptions);
  const policy = useQuery({
    queryKey: ["cancellation-policy"],
    queryFn: fetchCancellationPolicy,
  });
  const saved = useMemo<SettingsDraft | null>(
    () =>
      company.data && school.data && policy.data
        ? {
            company: company.data,
            school: school.data,
            policy: policyToDraft(policy.data),
          }
        : null,
    [company.data, school.data, policy.data],
  );
  const error = company.error ?? school.error ?? policy.error;
  return {
    saved,
    error,
    refetch: () => Promise.all([company.refetch(), school.refetch(), policy.refetch()]),
  };
}

export function Fahrschule() {
  const { tab = "stammdaten" } = useSearch({ from: "/_portal/fahrschule" });
  const navigate = useNavigate({ from: "/fahrschule" });
  const queryClient = useQueryClient();
  const role = useAuthStatus().data?.user?.role;
  const ownerOnlyLocked = role !== "inhaber";
  const { saved, error, refetch } = useSavedSettings();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;

  const parts = value && saved ? changedParts(value, saved) : null;
  const dirty = parts ? parts.company || parts.school || parts.policy : false;
  const errors = useMemo(() => (value ? validateSettings(value) : {}), [value]);
  const errorIds = Object.keys(errors);
  const errorsPerTab = errorIds.reduce<Partial<Record<SettingsTab, number>>>(
    (acc, id) => {
      const t = tabOfField(id);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (update: (current: SettingsDraft) => SettingsDraft) => {
    if (!saved) return;
    setDraft((current) => update(current ?? saved));
  };
  const setCompany = (patch: Partial<CompanyProfile>) =>
    edit((d) => ({
      ...d,
      company: { ...d.company, ...patch },
      // The website is shared with the public profile.
      school:
        patch.website === undefined ? d.school : { ...d.school, website: patch.website },
    }));
  const setSchool = (patch: Partial<SchoolProfile>) =>
    edit((d) => ({ ...d, school: { ...d.school, ...patch } }));
  const setPolicy = (patch: Partial<SettingsDraft["policy"]>) =>
    edit((d) => ({ ...d, policy: { ...d.policy, ...patch } }));

  const save = async () => {
    if (!value || !saved || !parts || errorIds.length > 0) return;
    setSaving(true);
    try {
      if (parts.company) {
        queryClient.setQueryData(
          companyProfileQueryOptions.queryKey,
          await saveCompanyProfile(value.company),
        );
      }
      if (parts.school) {
        queryClient.setQueryData(
          schoolProfileQueryOptions.queryKey,
          await saveSchoolProfile(value.school),
        );
      }
      if (parts.policy) {
        const fee = value.policy.fee.trim() ? parseEuroToCents(value.policy.fee) : 0;
        queryClient.setQueryData(
          ["cancellation-policy"],
          await saveCancellationPolicy({
            hoursBefore: Number(value.policy.hours),
            feeCents: fee ?? 0,
          }),
        );
      }
      // Website edits sync the other record on the server — reload both.
      await queryClient.invalidateQueries({ queryKey: ["public-legal"] });
      setDraft(null);
      toast.dismiss();
      toast.success("Einstellungen gespeichert.");
    } catch (err) {
      // Parts saved so far are in the cache; the rest stays as draft.
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const setTab = (next: string) =>
    void navigate({ search: { tab: next as SettingsTab }, replace: true });

  const status = !dirty
    ? "Alle Änderungen gespeichert"
    : errorIds.length > 0
      ? `${errorIds.length} ${errorIds.length === 1 ? "Eingabe" : "Eingaben"} prüfen`
      : "Ungespeicherte Änderungen";

  const firstErrorTab = errorIds[0] ? tabOfField(errorIds[0]) : null;
  const TabBody = tab === "standorte" ? null : TAB_CONTENT[tab];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <button
              type="button"
              disabled={!(dirty && firstErrorTab)}
              onClick={() => firstErrorTab && setTab(firstErrorTab)}
              className={cn(
                "hidden items-center gap-1.5 text-xs whitespace-nowrap lg:flex",
                dirty && errorIds.length > 0
                  ? "text-destructive hover:underline"
                  : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {dirty && errorIds.length > 0 && <AlertCircle className="size-3.5" />}
              {status}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || saving}
              className="hidden sm:inline-flex"
              onClick={() => setDraft(null)}
            >
              Verwerfen
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving || errorIds.length > 0}
              title={
                !dirty
                  ? "Keine Änderungen zu speichern"
                  : errorIds.length > 0
                    ? "Bitte zuerst die markierten Eingaben korrigieren"
                    : undefined
              }
              onClick={() => void save()}
            >
              <Check data-icon="inline-start" />
              {saving ? "Speichert …" : "Speichern"}
            </Button>
          </>
        }
      >
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
          <span className="hidden sm:inline">Fahrschule &amp; Einstellungen</span>
          <span className="sm:hidden">Einstellungen</span>
        </h1>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background">
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="mx-auto w-full max-w-[980px] gap-0"
        >
          <div className="sticky top-0 z-10 border-b bg-background px-2 pt-2">
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto [scrollbar-width:none]"
            >
              {SETTINGS_TABS.map((t) => (
                <TabsTrigger key={t} value={t} className="flex-none px-2.5">
                  {SETTINGS_TAB_LABELS[t]}
                  {dirty && errorsPerTab[t] ? (
                    <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white">
                      {errorsPerTab[t]}
                      <span className="sr-only"> Fehler</span>
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="p-4 pb-24 2xl:p-6">
            {tab === "standorte" ? (
              <TabsContent value="standorte">
                <Standorte />
              </TabsContent>
            ) : error && !value ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>
                  Die Einstellungen konnten nicht geladen werden.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void refetch()}
                  >
                    Erneut versuchen
                  </button>
                </AlertDescription>
              </Alert>
            ) : !value || !TabBody ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : (
              <TabsContent value={tab} className="flex flex-col gap-6">
                <TabBody
                  value={value}
                  errors={dirty ? errors : {}}
                  setCompany={setCompany}
                  setSchool={setSchool}
                  setPolicy={setPolicy}
                  ownerOnlyLocked={ownerOnlyLocked}
                />
                {(tab === "stammdaten" || tab === "absagen") && <RequiredLegend />}
                <div className="flex items-center justify-between gap-3 border-t pt-4 sm:hidden">
                  <span className="text-xs text-muted-foreground">{status}</span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || saving || errorIds.length > 0}
                    onClick={() => void save()}
                  >
                    Speichern
                  </Button>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}

export default Fahrschule;
