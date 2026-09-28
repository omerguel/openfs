/* ------------------------------------------------------------------ */
/* Benutzer + Protokoll (Inhaber only): staff accounts with their role, */
/* activation and password reset, plus the audit log of every change.  */
/* The server enforces the same rules (auth.ts).                        */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, RequiredLegend } from "@/components/FormField";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ROLE_LABELS, type Role, useAuthStatus } from "@/hooks/use-auth";
import { instructorName, useInstructors } from "@/hooks/use-instructors";
import { parseOrThrow } from "@/lib/api";
import { describeAudit } from "@/lib/audit-labels";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";

type User = {
  id: number;
  email: string;
  name: string;
  role: Role;
  instructorId: number | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type AuditEntry = {
  id: number;
  at: string;
  userEmail: string;
  method: string;
  path: string;
  status: number;
  ip: string;
};

const ROLE_HINTS: Record<Role, string> = {
  inhaber: "Alles, inkl. Benutzerverwaltung, Protokoll und Datensicherung.",
  buero:
    "Alles außer Benutzerverwaltung, Protokoll und Datensicherung; Steuer- und Bankdaten nur lesend.",
  fahrlehrer: "Kalender, Ausbildungsnachweise, Theorie, Chat — keine Finanzen.",
};

async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const result = await parseOrThrow<T>(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await queryClient.invalidateQueries({ queryKey: ["users"] });
  return result;
}

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
const formatDateTime = (iso: string | null) =>
  iso
    ? dateTime.format(new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`))
    : "–";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MIN_PASSWORD = 10;

type InviteResult = { url: string; expiresAt: string; mailed: boolean; name: string };

async function createInviteLink(user: {
  id: number;
  name: string;
}): Promise<InviteResult> {
  const result = await parseOrThrow<Omit<InviteResult, "name">>(
    await fetch(`/api/users/${user.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  await queryClient.invalidateQueries({ queryKey: ["users"] });
  return { ...result, name: user.name };
}

/** Shows a fresh Einladungslink to copy (and whether it was e-mailed). */
function InviteDialog({
  invite,
  onClose,
}: {
  invite: InviteResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      toast.error("Kopieren nicht möglich — bitte den Link markieren und kopieren.");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Einladungslink für {invite.name}</DialogTitle>
          <DialogDescription>
            {invite.mailed
              ? "Der Link wurde per E-Mail verschickt. Sie können ihn zusätzlich kopieren und z. B. per Messenger weitergeben."
              : "Es ist kein E-Mail-Versand eingerichtet — bitte kopieren Sie den Link und geben Sie ihn persönlich weiter."}{" "}
            Mit dem Link legt die Person ihr Passwort selbst fest. Er ist 7 Tage gültig
            und nur einmal verwendbar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            aria-label="Einladungslink"
            value={invite.url}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? (
              <Check data-icon="inline-start" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
            {copied ? "Kopiert" : "Kopieren"}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Fertig
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type UserForm = {
  name: string;
  email: string;
  role: Role;
  instructorId: string;
  access: "invite" | "password";
  password: string;
};

function userFormErrors(form: UserForm, isNew: boolean) {
  const errors: Partial<Record<keyof UserForm, string>> = {};
  if (!form.name.trim()) errors.name = "Bitte einen Namen angeben.";
  if (isNew && !EMAIL.test(form.email.trim()))
    errors.email = "Bitte eine gültige E-Mail-Adresse angeben — sie ist der Anmeldename.";
  const needsPassword = isNew ? form.access === "password" : form.password !== "";
  if (needsPassword && form.password.length < MIN_PASSWORD)
    errors.password = `Mindestens ${MIN_PASSWORD} Zeichen.`;
  return errors;
}

function UserDialog({
  user,
  onClose,
  onInvite,
}: {
  /** null = new user */
  user: User | null;
  onClose: () => void;
  onInvite: (invite: InviteResult) => void;
}) {
  const { instructors } = useInstructors();
  const [form, setForm] = useState<UserForm>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "fahrlehrer",
    instructorId: user?.instructorId ? String(user.instructorId) : "",
    access: "invite",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? userFormErrors(form, !user) : {};
  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Linking a Fahrlehrer fills in name and e-mail (when still empty or
  // taken from the previously linked instructor).
  const linkInstructor = (id: string) => {
    const previous = instructors.find((i) => String(i.id) === form.instructorId);
    const next = instructors.find((i) => String(i.id) === id);
    setForm((current) => ({
      ...current,
      instructorId: id,
      ...(next &&
      (!current.name.trim() || (previous && current.name === instructorName(previous)))
        ? { name: instructorName(next) }
        : {}),
      ...(next &&
      !user &&
      (!current.email.trim() || (previous && current.email === previous.email))
        ? { email: next.email }
        : {}),
    }));
  };

  const save = async () => {
    setSubmitted(true);
    const problems = userFormErrors(form, !user);
    const first = Object.keys(problems)[0];
    if (first) {
      document.getElementById(`user-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        role: form.role,
        instructorId:
          form.role === "fahrlehrer" && form.instructorId
            ? Number(form.instructorId)
            : null,
      };
      if (user) {
        await send(`/api/users/${user.id}`, "PATCH", {
          ...payload,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success("Benutzer gespeichert.");
        onClose();
      } else {
        const invite = form.access === "invite";
        const created = await send<User>("/api/users", "POST", {
          ...payload,
          email: form.email,
          ...(invite ? { invite: true } : { password: form.password }),
        });
        toast.success("Benutzer angelegt.");
        onClose();
        if (invite) onInvite(await createInviteLink(created));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? "Benutzer bearbeiten" : "Benutzer anlegen"}</DialogTitle>
          <DialogDescription>{ROLE_HINTS[form.role]}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormField id="user-role" label="Rolle" required>
            <NativeSelect
              className="w-full"
              value={form.role}
              onChange={(e) => set("role", e.target.value as Role)}
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                <NativeSelectOption key={role} value={role}>
                  {ROLE_LABELS[role]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          {form.role === "fahrlehrer" && (
            <FormField
              id="user-instructor"
              label="Verknüpfte/r Fahrlehrer/in"
              hint="Dann sieht die Person ihre eigenen Termine. Name und E-Mail werden übernommen."
            >
              <NativeSelect
                className="w-full"
                value={form.instructorId}
                onChange={(e) => linkInstructor(e.target.value)}
              >
                <NativeSelectOption value="">— nicht verknüpft —</NativeSelectOption>
                {instructors.map((instructor) => (
                  <NativeSelectOption key={instructor.id} value={String(instructor.id)}>
                    {instructorName(instructor)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="user-name" label="Name" required error={errors.name}>
            <Input
              autoComplete="off"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </FormField>
          <FormField
            id="user-email"
            label="E-Mail (Anmeldename)"
            required={!user}
            hint={user ? "Der Anmeldename lässt sich nicht ändern." : undefined}
            error={errors.email}
          >
            <Input
              type="email"
              autoComplete="off"
              disabled={user != null}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </FormField>
          {!user && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Zugang</legend>
              <RadioGroup
                value={form.access}
                onValueChange={(value) => set("access", value as UserForm["access"])}
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="invite" className="mt-0.5" />
                  <span>
                    Einladungslink (empfohlen)
                    <span className="block text-xs text-muted-foreground">
                      Die Person legt ihr Passwort selbst fest.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="password" className="mt-0.5" />
                  <span>Passwort selbst vergeben</span>
                </label>
              </RadioGroup>
            </fieldset>
          )}
          {(user || form.access === "password") && (
            <FormField
              id="user-password"
              label={user ? "Neues Passwort (leer = unverändert)" : "Passwort"}
              required={!user}
              hint={`Mindestens ${MIN_PASSWORD} Zeichen. Tipp: mehrere Wörter, z. B. „Kupplung-Ampel-Sommer“.`}
              error={errors.password}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </FormField>
          )}
          <RequiredLegend />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Speichert …" : user ? "Speichern" : "Benutzer anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const me = useAuthStatus().data?.user;
  const users = useQuery({
    queryKey: ["users", "list"],
    queryFn: async () =>
      (await parseOrThrow<{ users: User[] }>(await fetch("/api/users"))).users,
  });
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);

  const newInvite = async (user: User) => {
    try {
      setInvite(await createInviteLink(user));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fehlgeschlagen.");
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await send(`/api/users/${user.id}`, "PATCH", { active: !user.active });
      toast.success(user.active ? "Zugang gesperrt." : "Zugang aktiviert.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fehlgeschlagen.");
    }
  };

  if (users.isPending) return <Skeleton className="h-40 rounded-lg" />;
  return (
    <div className="flex flex-col gap-3">
      <Button className="self-end" onClick={() => setCreating(true)}>
        <Plus data-icon="inline-start" />
        Benutzer anlegen
      </Button>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Rolle</TableHead>
              <TableHead>Letzte Anmeldung</TableHead>
              <TableHead className="pr-4 text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data ?? []).map((user) => (
              <TableRow key={user.id} className={user.active ? undefined : "opacity-60"}>
                <TableCell className="pl-4 font-medium">
                  {user.name}
                  {user.id === me?.id && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(Sie)</span>
                  )}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  {!user.active && (
                    <Badge variant="secondary" className="ml-1.5 font-normal">
                      gesperrt
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(user.lastLoginAt)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(user)}>
                      Bearbeiten
                    </Button>
                    {user.id !== me?.id && user.active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Neuen Link erzeugen, mit dem die Person ihr Passwort (neu) setzt"
                        onClick={() => void newInvite(user)}
                      >
                        Einladungslink
                      </Button>
                    )}
                    {user.id !== me?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void toggleActive(user)}
                      >
                        {user.active ? "Sperren" : "Aktivieren"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {creating && (
        <UserDialog user={null} onClose={() => setCreating(false)} onInvite={setInvite} />
      )}
      {editing && (
        <UserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onInvite={setInvite}
        />
      )}
      {invite && <InviteDialog invite={invite} onClose={() => setInvite(null)} />}
    </div>
  );
}

function AuditTab() {
  const log = useQuery({
    queryKey: ["users", "audit"],
    queryFn: async () =>
      (
        await parseOrThrow<{ entries: AuditEntry[] }>(
          await fetch("/api/audit-log?limit=500"),
        )
      ).entries,
  });
  if (log.isPending) return <Skeleton className="h-40 rounded-lg" />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Zeitpunkt</TableHead>
            <TableHead>Benutzer</TableHead>
            <TableHead>Aktion</TableHead>
            <TableHead className="pr-4">IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(log.data ?? []).map((entry) => {
            const description = describeAudit(entry);
            return (
              <TableRow key={entry.id}>
                <TableCell className="pl-4 whitespace-nowrap">
                  {formatDateTime(entry.at)}
                </TableCell>
                <TableCell>{entry.userEmail || "–"}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "block text-[13px] font-medium",
                      description.failed && "text-destructive",
                    )}
                  >
                    {description.label}
                  </span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {description.detail}
                  </span>
                </TableCell>
                <TableCell className="pr-4 text-muted-foreground">{entry.ip}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function Benutzer() {
  const [tab, setTab] = useState<"benutzer" | "protokoll">("benutzer");
  const role = useAuthStatus().data?.user?.role;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <ToggleGroup
            type="single"
            value={tab}
            onValueChange={(value) => value && setTab(value as typeof tab)}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Benutzer Bereich"
          >
            <ToggleGroupItem value="benutzer">Benutzer</ToggleGroupItem>
            <ToggleGroupItem value="protokoll">Protokoll</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <h1 className="text-sm font-medium">Benutzer</h1>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <Card className="animate-enter min-h-full">
          <CardContent>
            {role !== "inhaber" ? (
              <p className="text-sm text-muted-foreground">
                Nur Inhaber/innen können Benutzer verwalten.
              </p>
            ) : tab === "benutzer" ? (
              <UsersTab />
            ) : (
              <AuditTab />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
