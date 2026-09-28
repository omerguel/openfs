/* "Erste Schritte" card on the dashboard (Inhaber/Büro) — live done   */
/* state from the regular APIs; hidden once complete or dismissed.      */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuthStatus } from "@/hooks/use-auth";
import { companyProfileQueryOptions } from "@/hooks/use-company-profile";
import { useInstructors } from "@/hooks/use-instructors";
import { useStudents } from "@/hooks/use-students";
import { useVehicles } from "@/hooks/use-vehicles";
import { parseOrThrow } from "@/lib/api";
import { setupChecklist } from "@/lib/setup-checklist";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "openfs:setup-checklist-dismissed";
const PRICES_KEY = "openfs:setup-prices-reviewed";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // storage unavailable — the card simply shows again next time
  }
}

export function SetupChecklist() {
  const role = useAuthStatus().data?.user?.role;
  const navigate = useNavigate();
  const owner = role === "inhaber";
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISSED_KEY));
  const [pricesReviewed, setPricesReviewed] = useState(() => readFlag(PRICES_KEY));
  const company = useQuery(companyProfileQueryOptions);
  const { instructors, loading: instructorsLoading } = useInstructors();
  const { vehicles, loading: vehiclesLoading } = useVehicles();
  const { students, loading: studentsLoading } = useStudents();
  const users = useQuery({
    queryKey: ["users", "list"],
    queryFn: async () =>
      (await parseOrThrow<{ users: unknown[] }>(await fetch("/api/users"))).users,
    enabled: owner,
  });
  const backups = useQuery({
    queryKey: ["admin-backups"],
    queryFn: async () =>
      parseOrThrow<{ enabled: boolean; backups: unknown[] }>(
        await fetch("/api/admin/backups"),
      ),
    enabled: owner,
  });

  if (role !== "inhaber" && role !== "buero") return null;
  if (dismissed) return null;
  if (company.isPending || instructorsLoading || vehiclesLoading || studentsLoading)
    return null;

  const items = setupChecklist(
    {
      company: company.data ?? null,
      instructors: instructors.length,
      vehicles: vehicles.length,
      students: students.length,
      users: users.data?.length ?? null,
      backups: backups.data
        ? { enabled: backups.data.enabled, count: backups.data.backups.length }
        : null,
      pricesReviewed,
    },
    role,
  );
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return null;

  const open = (href: string, id: string) => {
    if (id === "preise") {
      writeFlag(PRICES_KEY);
      setPricesReviewed(true);
    }
    void navigate({ href });
  };

  return (
    <Card className="rounded-lg border border-border/80 shadow-none ring-0">
      <CardHeader className="border-b border-border/70">
        <CardTitle className="text-sm font-medium">Erste Schritte</CardTitle>
        <CardDescription>
          <span className="tabular-nums">
            {done} von {items.length}
          </span>{" "}
          erledigt — danach ist Ihre Fahrschule startklar.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Erste Schritte ausblenden"
            title="Ausblenden"
            onClick={() => {
              writeFlag(DISMISSED_KEY);
              setDismissed(true);
            }}
          >
            <X />
          </Button>
        </CardAction>
        <Progress
          value={(done / items.length) * 100}
          className="col-span-full mt-2 h-1.5"
        />
      </CardHeader>
      <CardContent className="p-2">
        <ol className="grid gap-1 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open(item.href, item.id)}
                className="group/step flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    item.done
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-muted-foreground/40",
                  )}
                >
                  {item.done && <Check className="size-3" />}
                  <span className="sr-only">{item.done ? "Erledigt:" : "Offen:"}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      item.done && "text-muted-foreground line-through",
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="text-xs text-pretty text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/step:opacity-100" />
              </button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
