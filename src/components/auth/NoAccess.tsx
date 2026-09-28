/* Shown instead of a page the signed-in role may not open (see         */
/* canSeeRoute in src/lib/navigation.ts) — a clear message instead of   */
/* a half-rendered page full of "Fehler beim Laden" toasts.             */

import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ROLE_LABELS, useAuthStatus } from "@/hooks/use-auth";
import { ACCESS_LABELS, routeAccess } from "@/lib/navigation";

export function NoAccess({ path }: { path: string }) {
  const role = useAuthStatus().data?.user?.role;
  const access = routeAccess(path);
  const audience = access === "all" ? "berechtigten Rollen" : ACCESS_LABELS[access];
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader>
        <span className="text-sm font-medium">Kein Zugriff</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <Empty className="min-h-[60svh]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lock />
            </EmptyMedia>
            <EmptyTitle>Kein Zugriff</EmptyTitle>
            <EmptyDescription>
              Diese Seite ist {audience} vorbehalten.
              {role && ` Sie sind als ${ROLE_LABELS[role]} angemeldet.`} Wenden Sie sich
              an die Inhaberin bzw. den Inhaber der Fahrschule, wenn Sie Zugriff
              benötigen.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/">Zur Übersicht</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}
