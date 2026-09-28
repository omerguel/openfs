/* ------------------------------------------------------------------ */
/* Benutzer & Protokoll (Inhaber only): staff accounts with their role, */
/* activation and password reset, plus the audit log of every change.  */
/* The server enforces the same rules (auth.ts).                        */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { queryClient } from "@/lib/query-client";

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
  buero: "Alles außer Benutzerverwaltung, Protokoll und Datensicherung.",
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

function UserDialog({
  user,
  open,
  onClose,
}: {
  /** null = new user */
  user: User | null;
  open: boolean;
  onClose: () => void;
}) {
  const { instructors } = useInstructors();
  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: (user?.role ?? "fahrlehrer") as Role,
    instructorId: user?.instructorId ? String(user.instructorId) : "",
    password: "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        role: form.role,
        instructorId: form.instructorId ? Number(form.instructorId) : null,
        ...(form.password ? { password: form.password } : {}),
      };
      if (user) {
        await send(`/api/users/${user.id}`, "PATCH", payload);
        toast.success("Benutzer gespeichert.");
      } else {
        await send("/api/users", "POST", { ...payload, email: form.email });
        toast.success("Benutzer angelegt.");
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? "Benutzer bearbeiten" : "Benutzer anlegen"}</DialogTitle>
          <DialogDescription>{ROLE_HINTS[form.role]}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-email">E-Mail (Anmeldename)</Label>
            <Input
              id="user-email"
              type="email"
              disabled={user != null}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-role">Rolle</Label>
              <NativeSelect
                id="user-role"
                className="w-full"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <NativeSelectOption key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-instructor">Verknüpfte/r Fahrlehrer/in</Label>
              <NativeSelect
                id="user-instructor"
                className="w-full"
                value={form.instructorId}
                onChange={(e) => setForm({ ...form, instructorId: e.target.value })}
              >
                <NativeSelectOption value="">—</NativeSelectOption>
                {instructors.map((instructor) => (
                  <NativeSelectOption key={instructor.id} value={String(instructor.id)}>
                    {instructorName(instructor)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-password">
              {user ? "Neues Passwort (leer = unverändert)" : "Passwort"}
            </Label>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Speichern
          </Button>
        </DialogFooter>
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
      {creating && <UserDialog user={null} open onClose={() => setCreating(false)} />}
      {editing && (
        <UserDialog
          key={editing.id}
          user={editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
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
            <TableHead>Pfad</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4">IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(log.data ?? []).map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="pl-4 whitespace-nowrap">
                {formatDateTime(entry.at)}
              </TableCell>
              <TableCell>{entry.userEmail || "–"}</TableCell>
              <TableCell className="font-mono">{entry.method}</TableCell>
              <TableCell className="font-mono">{entry.path}</TableCell>
              <TableCell className={entry.status >= 400 ? "text-destructive" : undefined}>
                {entry.status}
              </TableCell>
              <TableCell className="pr-4 text-muted-foreground">{entry.ip}</TableCell>
            </TableRow>
          ))}
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
        <span className="text-sm font-medium">Benutzer &amp; Protokoll</span>
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
