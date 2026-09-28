/* ------------------------------------------------------------------ */
/* Fahrschüler detail page — replaces the old detail dialog. The main  */
/* pane transitions here from the roster table (/fahrschueler/:id).    */
/* The top bar carries name, status and balance; the sections live in  */
/* a horizontally scrollable tab row of their own at the top of the    */
/* body, so title and tabs never compete for space (390 px … 1440 px). */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState } from "react";
import { notFound, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { Archive, ArrowLeft, MoreHorizontal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { OPEN_CONTRACT_EVENT } from "./components/VertragDialog.tsx";
import { DokumenteTab } from "./components/fahrschueler/DokumenteTab";
import { PreiseTab } from "./components/fahrschueler/PreiseTab";
import { StundenTab } from "./components/fahrschueler/StundenTab";
import { UebersichtTab } from "./components/fahrschueler/UebersichtTab";
import { ZahlungTab } from "./components/fahrschueler/ZahlungTab";
import { ARCHIVE_REASONS } from "@/lib/archive-reasons";
import type { Student } from "@/lib/student-data";
import { BALANCE_DOT_CLASS, describeBalance } from "@/lib/student-balance";
import { cn } from "@/lib/utils";
import { useFinanceAccess } from "@/hooks/use-finance-access";
import { useInstructors } from "@/hooks/use-instructors";
import {
  deleteStudent,
  type StudentRecord,
  updateStudent,
  useStudents,
} from "@/hooks/use-students";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import { queryClient } from "@/lib/query-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

type TabKey = "uebersicht" | "stunden" | "dokumente" | "zahlung" | "preise";

/* money: finance tabs; office: documents and contracts — both hidden for
   Fahrlehrer/innen, whose API access ends there (src/server/auth.ts). */
const tabs: { value: TabKey; label: string; money?: boolean; office?: boolean }[] = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "stunden", label: "Stundenübersicht" },
  { value: "dokumente", label: "Dokumente", office: true },
  { value: "zahlung", label: "Zahlungserfassung", money: true },
  { value: "preise", label: "Preise", money: true },
];

function ArchiveDialog({
  student,
  open,
  showBalance,
  onOpenChange,
  onConfirm,
}: {
  student: StudentRecord;
  open: boolean;
  showBalance: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("abgeschlossen");
  const [busy, setBusy] = useState(false);
  const balance = describeBalance(student.balanceCents);
  const fullName = `${student.firstName} ${student.lastName}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fullName} archivieren?</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            Der Eintrag verschwindet aus den aktiven Listen und kann jederzeit unter
            „Archiv" wiederhergestellt werden. Buchungen, Quittungen und
            Ausbildungsnachweise bleiben unverändert erhalten; der Vertrag bleibt unter
            Verträge → Archiviert sichtbar.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {showBalance && balance.tone !== "even" && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {balance.tone === "debt" ? (
                <>
                  Offener Betrag:{" "}
                  <span className="font-semibold tabular-nums">{balance.amount}</span>.
                  Bitte vor dem Archivieren begleichen lassen oder als Forderung
                  weiterverfolgen.
                </>
              ) : (
                <>
                  Restguthaben:{" "}
                  <span className="font-semibold tabular-nums">{balance.amount}</span>.
                  Bitte vor dem Archivieren auszahlen oder verrechnen.
                </>
              )}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="archive-reason">Grund</Label>
          <NativeSelect
            id="archive-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full"
          >
            {ARCHIVE_REASONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onConfirm(reason);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Archive data-icon="inline-start" />
            {busy ? "Wird archiviert…" : "Archivieren"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FahrschuelerDetail() {
  const { studentId: studentIdParam } = useParams({
    from: "/_portal/fahrschueler/$studentId",
  });
  const studentId = Number(studentIdParam);
  const navigate = useNavigate();
  const router = useRouter();
  const { students, loading, refresh } = useStudents();
  const { assignableNames: instructorOptions } = useInstructors();
  const { vehicleOptions } = useVehicleOptions();
  const { canSeeMoney, isInstructor } = useFinanceAccess();
  const [tab, setTab] = useState<TabKey>("uebersicht");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [contractSignal, setContractSignal] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new student page starts at the top (not at the scroll offset of
  // the page it was opened from).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [studentId]);

  // "Zum Vertrag" in the toast after Schüler anlegen.
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent<number>).detail !== studentId) return;
      setTab("dokumente");
      setContractSignal((value) => value + 1);
    };
    window.addEventListener(OPEN_CONTRACT_EVENT, open);
    return () => window.removeEventListener(OPEN_CONTRACT_EVENT, open);
  }, [studentId]);

  const student = students.find((entry) => entry.id === studentId) ?? null;
  const balance = describeBalance(student?.balanceCents);
  const visibleTabs = tabs.filter(
    (item) => canSeeMoney || !(item.money || item.office),
  );
  const activeTab = visibleTabs.some((item) => item.value === tab) ? tab : "uebersicht";

  if (!Number.isInteger(studentId) || studentId < 1) {
    throw notFound();
  }

  // The detail page is reached from several lists (/fahrschueler,
  // /theorie, …) — go back to wherever the user came from. The list
  // is only a fallback for direct-URL visits with no app history.
  const goBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      void navigate({ to: "/fahrschueler" });
    }
  };

  const save = async (updates: Partial<Student>) => {
    await updateStudent(studentId, updates);
    await refresh();
  };

  const handleArchive = async (reason: string) => {
    try {
      await deleteStudent(studentId, reason);
      toast.success("Fahrschüler/in archiviert.", {
        description: "Wiederherstellen jederzeit unter Archiv.",
      });
      setArchiveOpen(false);
      await refresh();
      void queryClient.invalidateQueries({ queryKey: ["archive"] });
      void navigate({ to: "/fahrschueler" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Archivieren fehlgeschlagen.");
    }
  };

  const renderTab = () => {
    if (!student) return null;
    switch (activeTab) {
      case "uebersicht":
        return (
          <UebersichtTab
            student={student}
            instructorOptions={instructorOptions}
            vehicleOptions={vehicleOptions}
            canSeeMoney={canSeeMoney}
            canEdit={!isInstructor}
            onSave={save}
          />
        );
      case "stunden":
        return <StundenTab student={student} canSeeMoney={canSeeMoney} />;
      case "dokumente":
        return (
          <DokumenteTab
            student={student}
            onSave={save}
            readOnly={isInstructor}
            showContract={canSeeMoney}
            openContractSignal={contractSignal}
          />
        );
      case "zahlung":
        return <ZahlungTab student={student} />;
      case "preise":
        return (
          <PreiseTab
            student={student}
            onSave={save}
            navigate={() => void navigate({ to: "/preisangebot" })}
          />
        );
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          student && (
            <>
              <Badge variant="outline" className="gap-1.5 font-normal max-md:hidden">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    student.status === "aktiv"
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/50",
                  )}
                />
                {student.status === "aktiv" ? "Aktiv" : "Inaktiv"}
              </Badge>
              {canSeeMoney && (
                <Badge
                  variant="outline"
                  className="gap-1.5 font-normal tabular-nums max-sm:hidden"
                  title="Kontostand aus der Buchhaltung"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      BALANCE_DOT_CLASS[balance.tone],
                    )}
                  />
                  {balance.tone === "even"
                    ? "Ausgeglichen"
                    : `${balance.label} ${balance.amount}`}
                </Badge>
              )}
              {!isInstructor && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Weitere Aktionen"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                      <Archive />
                      Archivieren…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )
        }
      >
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zurück"
            onClick={goBack}
          >
            <ArrowLeft />
          </Button>
          {student && (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-medium">
                {student.firstName} {student.lastName}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
                <span className="font-mono">{student.contractNumber}</span> · Klasse{" "}
                {student.classes}
              </span>
            </span>
          )}
        </div>
      </PageHeader>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background"
      >
        {student && (
          <div className="sticky top-0 z-20 border-b border-border/70 bg-background">
            <div
              role="tablist"
              aria-label="Fahrschüler Bereich"
              className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:px-3 2xl:px-5 [&::-webkit-scrollbar]:hidden"
            >
              {visibleTabs.map((item) => {
                const selected = item.value === activeTab;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(item.value)}
                    className={cn(
                      "h-8 shrink-0 rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150 outline-none hover:bg-muted hover:duration-0 focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-4 2xl:p-6">
          {loading && !student ? (
            <div className="flex min-h-64 items-center justify-center">
              <Spinner />
            </div>
          ) : !student ? (
            <Empty className="min-h-64 border-0">
              <EmptyHeader>
                <EmptyTitle>Fahrschüler nicht gefunden</EmptyTitle>
                <EmptyDescription>
                  Der Eintrag existiert nicht oder wurde archiviert.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void navigate({ to: "/fahrschueler" })}
              >
                <ArrowLeft data-icon="inline-start" />
                Zur Übersicht
              </Button>
            </Empty>
          ) : (
            <div className="animate-enter">
              <div key={activeTab} className="animate-agenda-fade">
                {renderTab()}
              </div>
            </div>
          )}
        </div>
      </div>

      {student && (
        <ArchiveDialog
          key={student.id}
          student={student}
          open={archiveOpen}
          showBalance={canSeeMoney}
          onOpenChange={setArchiveOpen}
          onConfirm={handleArchive}
        />
      )}
    </div>
  );
}
