/* ------------------------------------------------------------------ */
/* Public appointment-request form — /anfrage                          */
/* Unauthenticated; no admin chrome. Posts to POST /api/appointment-   */
/* requests (omits status — server defaults to "offen"). A campaign    */
/* tracking code from ?kampagne=… (or utm_campaign) is sent along so   */
/* the request counts as a lead of that campaign (Marketing).          */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useSchoolProfile } from "@/hooks/use-school-profile";
import { LegalLinks } from "@/components/legal/LegalPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TerminartType =
  | "Praktisch"
  | "Theorie"
  | "Vorstellung zur prakt. Prüfung"
  | "Theorieprüfung"
  | "Andere";

const TERMINARTEN: TerminartType[] = [
  "Praktisch",
  "Theorie",
  "Vorstellung zur prakt. Prüfung",
  "Theorieprüfung",
  "Andere",
];

/* Plausible lesson window — mirrors PUBLIC_EARLIEST/LATEST_TIME in
   src/server/appointment-requests.ts (the server checks it again). */
const EARLIEST_TIME = "06:00";
const LATEST_TIME = "21:00";

/** Local "YYYY-MM-DD" of today — the earliest selectable Wunschdatum. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

type FormState = {
  name: string;
  phone: string;
  email: string;
  type: TerminartType;
  requestedDate: string;
  requestedTime: string;
  message: string;
};

/** Tracking code of the link the visitor came from (read once). */
function campaignFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return (params.get("kampagne") ?? params.get("utm_campaign") ?? "")
    .trim()
    .slice(0, 100);
}

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  type: "Praktisch",
  requestedDate: "",
  requestedTime: "",
  message: "",
};

export function Anfrage() {
  const { profile } = useSchoolProfile();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [campaign] = useState(campaignFromUrl);
  const [consent, setConsent] = useState(false);
  const minDate = todayIso();

  const set = (field: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required check — mirrors server validation
    if (!form.name.trim()) {
      toast.error("Name ist ein Pflichtfeld.");
      return;
    }
    if (!form.phone.trim() && !form.email.trim()) {
      toast.error("Bitte gib eine Telefonnummer oder E-Mail-Adresse an.", {
        description: "Sonst können wir dich nicht erreichen.",
      });
      return;
    }
    if (!form.requestedDate) {
      toast.error("Bitte ein Wunschdatum angeben.");
      return;
    }
    if (form.requestedDate < minDate) {
      toast.error("Das Wunschdatum darf nicht in der Vergangenheit liegen.");
      return;
    }
    if (!form.requestedTime) {
      toast.error("Bitte eine Wunschzeit angeben.");
      return;
    }
    if (form.requestedTime < EARLIEST_TIME || form.requestedTime > LATEST_TIME) {
      toast.error(
        `Bitte eine Uhrzeit zwischen ${EARLIEST_TIME} und ${LATEST_TIME} Uhr wählen.`,
      );
      return;
    }
    if (!consent) {
      toast.error("Bitte stimme der Verarbeitung deiner Angaben zu.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/appointment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          type: form.type,
          requestedDate: form.requestedDate,
          requestedTime: form.requestedTime,
          message: form.message,
          consent,
          ...(campaign ? { campaign } : {}),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Anfrage konnte nicht gesendet werden.");
        return;
      }

      setSubmitted(true);
    } catch {
      toast.error("Netzwerkfehler — bitte versuche es erneut.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="space-y-1 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {profile.slogan || "Terminanfrage"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Fahrschule — Terminanfrage stellen
          </p>
        </div>

        {submitted ? (
          /* Success state */
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-base font-medium text-green-700">
                Anfrage gesendet — wir melden uns.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Wir prüfen deinen Wunschtermin und kontaktieren dich in Kürze.
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setConsent(false);
                  setSubmitted(false);
                }}
              >
                Neue Anfrage stellen
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* Form */
          <Card>
            <CardHeader>
              <CardTitle>Terminanfrage</CardTitle>
              <CardDescription>
                Füll das Formular aus und wir melden uns bei dir.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    Name <span aria-hidden>*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Vor- und Nachname"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>

                <p id="contact-hint" className="text-xs text-muted-foreground">
                  Telefon oder E-Mail — mindestens eine Angabe, damit wir dich erreichen.
                </p>

                {/* Telefon */}
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="z. B. 0151 12345678"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    autoComplete="tel"
                    aria-describedby="contact-hint"
                  />
                </div>

                {/* E-Mail */}
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@beispiel.de"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    autoComplete="email"
                    aria-describedby="contact-hint"
                  />
                </div>

                {/* Terminart */}
                <div className="space-y-1.5">
                  <Label htmlFor="type">Terminart</Label>
                  <Select value={form.type} onValueChange={(v) => set("type", v)}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Terminart wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {TERMINARTEN.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Wunschdatum + Wunschzeit */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="requestedDate">
                      Datum <span aria-hidden>*</span>
                    </Label>
                    <Input
                      id="requestedDate"
                      type="date"
                      value={form.requestedDate}
                      min={minDate}
                      onChange={(e) => set("requestedDate", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="requestedTime">
                      Uhrzeit <span aria-hidden>*</span>
                    </Label>
                    <Input
                      id="requestedTime"
                      type="time"
                      value={form.requestedTime}
                      min={EARLIEST_TIME}
                      max={LATEST_TIME}
                      step={900}
                      onChange={(e) => set("requestedTime", e.target.value)}
                      required
                      aria-describedby="time-hint"
                    />
                  </div>
                </div>

                <p id="time-hint" className="-mt-2 text-xs text-muted-foreground">
                  Termine sind zwischen {EARLIEST_TIME} und {LATEST_TIME} Uhr möglich.
                </p>

                {/* Nachricht */}
                <div className="space-y-1.5">
                  <Label htmlFor="message">Nachricht</Label>
                  <Textarea
                    id="message"
                    placeholder="Weitere Informationen oder Wünsche …"
                    rows={3}
                    value={form.message}
                    onChange={(e) => set("message", e.target.value)}
                  />
                </div>

                {/* Datenschutz */}
                <div className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/40 p-3">
                  <Checkbox
                    id="consent"
                    checked={consent}
                    onCheckedChange={(value) => setConsent(value === true)}
                    className="mt-0.5"
                    aria-required
                  />
                  <Label
                    htmlFor="consent"
                    className="block text-xs leading-relaxed font-normal text-muted-foreground"
                  >
                    Ich bin einverstanden, dass die Fahrschule meine Angaben zur
                    Bearbeitung dieser Anfrage verarbeitet und mich dazu kontaktiert.
                    Details in der{" "}
                    <Link
                      to="/datenschutz"
                      target="_blank"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      Datenschutzerklärung
                    </Link>
                    . <span aria-hidden>*</span>
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Wird gesendet …" : "Anfrage senden"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <footer className="flex justify-center">
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}
