import { memo, useCallback, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  Globe,
  Info,
  MapPin,
  Quote,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  saveSchoolProfile,
  useSchoolProfile,
  type SchoolProfile,
} from "@/hooks/use-school-profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSection as Section, FormSectionIndex } from "./components/FormSection.tsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type IconCmp = React.ComponentType<{ className?: string }>;

/* ------------------------------------------------------------------ */
/* Primitives composed from shadcn (same shapes as Profil.tsx)          */
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

function IconInput({
  Icon,
  ...props
}: { Icon: IconCmp } & React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} className={cn("pl-9", props.className)} />
    </div>
  );
}

/** Controlled tag editor — Badge chips with X, Enter/Backspace to edit. */
const TagEditor = memo(function TagEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            aria-label={`${tag} entfernen`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1.5 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
});

const CLOSED_HOURS = "Geschlossen";
const DEFAULT_OPEN_TIME = "09:00";
const DEFAULT_CLOSE_TIME = "18:00";
const TIME_RANGE_RE = /(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/;

const TIME_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
});

function normalizeTime(value: string, fallback: string) {
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getTimeOptions(...selected: string[]) {
  return [...new Set([...TIME_OPTIONS, ...selected])].sort();
}

function parseOpeningHours(hours: string) {
  if (hours.toLocaleLowerCase("de-DE").includes("geschlossen")) {
    return {
      closed: true,
      opens: DEFAULT_OPEN_TIME,
      closes: DEFAULT_CLOSE_TIME,
    };
  }

  const match = hours.match(TIME_RANGE_RE);
  return {
    closed: false,
    opens: normalizeTime(match?.[1] ?? "", DEFAULT_OPEN_TIME),
    closes: normalizeTime(match?.[2] ?? "", DEFAULT_CLOSE_TIME),
  };
}

function formatOpeningHours({
  closed,
  opens,
  closes,
}: {
  closed: boolean;
  opens: string;
  closes: string;
}) {
  return closed ? CLOSED_HOURS : `${opens} – ${closes}`;
}

const OpeningHoursControls = memo(function OpeningHoursControls({
  index,
  day,
  value,
  onChange,
}: {
  index: number;
  day: string;
  value: string;
  onChange: (index: number, hours: string) => void;
}) {
  const parsed = parseOpeningHours(value);
  const timeOptions = getTimeOptions(parsed.opens, parsed.closes);

  return (
    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(8rem,10rem)_minmax(7rem,1fr)_minmax(7rem,1fr)]">
      <NativeSelect
        aria-label={`${day}: Status`}
        value={parsed.closed ? "closed" : "open"}
        onChange={(event) =>
          onChange(
            index,
            formatOpeningHours({
              ...parsed,
              closed: event.target.value === "closed",
            }),
          )
        }
        className="w-full"
      >
        <NativeSelectOption value="open">Geöffnet</NativeSelectOption>
        <NativeSelectOption value="closed">Geschlossen</NativeSelectOption>
      </NativeSelect>
      <NativeSelect
        aria-label={`${day}: Von`}
        value={parsed.opens}
        disabled={parsed.closed}
        onChange={(event) =>
          onChange(
            index,
            formatOpeningHours({
              ...parsed,
              opens: event.target.value,
            }),
          )
        }
        className="w-full [&_select]:tabular-nums"
      >
        {timeOptions.map((time) => (
          <NativeSelectOption key={time} value={time}>
            {time}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={`${day}: Bis`}
        value={parsed.closes}
        disabled={parsed.closed}
        onChange={(event) =>
          onChange(
            index,
            formatOpeningHours({
              ...parsed,
              closes: event.target.value,
            }),
          )
        }
        className="w-full [&_select]:tabular-nums"
      >
        {timeOptions.map((time) => (
          <NativeSelectOption key={time} value={time}>
            {time}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

const sections = [
  { id: "ueber-uns", label: "Über uns" },
  { id: "social-media", label: "Social Media" },
  { id: "oeffnungszeiten", label: "Öffnungszeiten" },
  { id: "leistungen", label: "Leistungen" },
  { id: "highlights", label: "Highlights" },
];

export function Schulprofil() {
  const { profile, setProfile, refresh } = useSchoolProfile();
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  const update = (patch: Partial<SchoolProfile>) =>
    setProfile((current) => ({ ...current, ...patch }));

  const updateHours = useCallback(
    (index: number, hours: string) => {
      setDirty(true);
      setProfile((current) => ({
        ...current,
        opening_hours: current.opening_hours.map((entry, i) =>
          i === index ? { ...entry, hours } : entry,
        ),
      }));
    },
    [setProfile],
  );
  const updateServices = useCallback(
    (services: string[]) => {
      setDirty(true);
      setProfile((current) => ({ ...current, services }));
    },
    [setProfile],
  );
  const updateHighlights = useCallback(
    (highlights: string[]) => {
      setDirty(true);
      setProfile((current) => ({ ...current, highlights }));
    },
    [setProfile],
  );

  const markDirty = () => setDirty(true);

  const discard = () => {
    setDirty(false);
    setFormVersion((v) => v + 1);
    void refresh();
  };

  const save = async () => {
    try {
      setProfile(await saveSchoolProfile(profile));
      setDirty(false);
      toast.success("Schulprofil gespeichert.");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Schulprofil konnte nicht gespeichert werden.",
      );
    }
  };

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
              onClick={discard}
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
            {/* Über uns */}
            <Section
              id="ueber-uns"
              title="Über uns"
              description="So stellt sich Ihre Fahrschule öffentlich vor."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field
                  label="Slogan"
                  htmlFor="slogan"
                  hint="Ein kurzer, prägnanter Satz."
                >
                  <IconInput
                    Icon={Quote}
                    id="slogan"
                    placeholder="z. B. Sicher ans Ziel."
                    value={profile.slogan}
                    onChange={(e) => update({ slogan: e.target.value })}
                  />
                </Field>
                <Field
                  label="Gegründet"
                  htmlFor="founded"
                  hint="Jahr der Gründung (optional)."
                >
                  <IconInput
                    Icon={CalendarDays}
                    id="founded"
                    inputMode="numeric"
                    placeholder="z. B. 1998"
                    value={profile.founded_year ?? ""}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      update({ founded_year: digits ? Number(digits) : null });
                    }}
                  />
                </Field>
                <Field label="Webseite" htmlFor="website">
                  <IconInput
                    Icon={Globe}
                    id="website"
                    type="url"
                    placeholder="https://…"
                    value={profile.website}
                    onChange={(e) => update({ website: e.target.value })}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Beschreibung" htmlFor="description">
                    <Textarea
                      id="description"
                      rows={4}
                      placeholder="Beschreiben Sie Ihre Fahrschule in wenigen Sätzen…"
                      value={profile.description}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </Section>

            {/* Social Media */}
            <Section
              id="social-media"
              title="Social Media"
              description="Verlinken Sie Ihre Kanäle und Ihren Google-Maps-Eintrag."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Instagram" htmlFor="instagram">
                  <IconInput
                    Icon={Camera}
                    id="instagram"
                    placeholder="https://instagram.com/…"
                    value={profile.instagram}
                    onChange={(e) => update({ instagram: e.target.value })}
                  />
                </Field>
                <Field label="Facebook" htmlFor="facebook">
                  <IconInput
                    Icon={ThumbsUp}
                    id="facebook"
                    placeholder="https://facebook.com/…"
                    value={profile.facebook}
                    onChange={(e) => update({ facebook: e.target.value })}
                  />
                </Field>
                <Field label="Google Maps" htmlFor="maps">
                  <IconInput
                    Icon={MapPin}
                    id="maps"
                    placeholder="https://maps.google.com/…"
                    value={profile.google_maps_url}
                    onChange={(e) => update({ google_maps_url: e.target.value })}
                  />
                </Field>
                <Field
                  label="Google Place ID"
                  htmlFor="place-id"
                  hint="Für den Import der Google-Bewertungen. Die ID (beginnt meist mit „ChIJ“) finden Sie mit dem Place ID Finder von Google."
                >
                  <Input
                    id="place-id"
                    className="font-mono"
                    placeholder="ChIJ…"
                    spellCheck={false}
                    value={profile.google_place_id}
                    onChange={(e) => update({ google_place_id: e.target.value })}
                  />
                </Field>
              </div>
            </Section>

            {/* Öffnungszeiten */}
            <Section
              id="oeffnungszeiten"
              title="Öffnungszeiten"
              description="Wann ist Ihr Büro erreichbar?"
            >
              <div className="flex flex-col divide-y">
                {profile.opening_hours.map((entry, i) => (
                  <div
                    key={entry.day}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="w-32 shrink-0 text-sm font-medium">{entry.day}</span>
                    <OpeningHoursControls
                      index={i}
                      day={entry.day}
                      value={entry.hours}
                      onChange={updateHours}
                    />
                  </div>
                ))}
              </div>
            </Section>

            {/* Leistungen */}
            <Section
              id="leistungen"
              title="Leistungen"
              description="Welche Angebote umfasst Ihre Fahrschule?"
            >
              <Field
                label="Leistungen"
                hint="Enter drücken zum Hinzufügen — z. B. Klasse B, Intensivkurse, Theorieunterricht online."
              >
                <TagEditor
                  value={profile.services}
                  onChange={updateServices}
                  placeholder="Leistung hinzufügen…"
                />
              </Field>
            </Section>

            {/* Highlights */}
            <Section
              id="highlights"
              title="Highlights"
              description="Was macht Ihre Fahrschule besonders?"
            >
              <Field
                label="Highlights"
                hint="Enter drücken zum Hinzufügen — z. B. Moderne Fahrzeugflotte, Hohe Bestehensquote."
              >
                <TagEditor
                  value={profile.highlights}
                  onChange={updateHighlights}
                  placeholder="Highlight hinzufügen…"
                />
              </Field>
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

export default Schulprofil;
