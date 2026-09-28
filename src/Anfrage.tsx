/* ------------------------------------------------------------------ */
/* Public appointment-request form — /anfrage                          */
/* Unauthenticated; no admin chrome. Posts to POST /api/appointment-   */
/* requests (omits status — server defaults to "offen"). A campaign    */
/* tracking code from ?kampagne=… (or utm_campaign) is sent along so   */
/* the request counts as a lead of that campaign (Marketing).          */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { toast } from "sonner";

import { useSchoolProfile } from "@/hooks/use-school-profile";
import { Button } from "@/components/ui/button";
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

  const set = (field: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required check — mirrors server validation
    if (!form.name.trim()) {
      toast.error("Name ist ein Pflichtfeld.");
      return;
    }
    if (!form.requestedDate) {
      toast.error("Bitte ein Wunschdatum angeben.");
      return;
    }
    if (!form.requestedTime) {
      toast.error("Bitte eine Wunschzeit angeben.");
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
                      onChange={(e) => set("requestedTime", e.target.value)}
                      required
                    />
                  </div>
                </div>

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

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Wird gesendet …" : "Anfrage senden"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
