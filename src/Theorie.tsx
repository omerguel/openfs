import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  Phone,
} from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import { useStudents, type StudentRecord } from "@/hooks/use-students";
import type { TheoryStatus } from "@/lib/student-data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* Progress, status and the last Theoriestunde are derived server-side
   from the theory-group attendance (student-facts.ts). Pre-exams stay
   manual: the learning app is not integrated (the official question
   catalogue needs a licence), so there is no "last login" to show. */
const toLearner = (student: StudentRecord) => ({
  id: student.id,
  name: `${student.firstName} ${student.lastName}`,
  phone: student.phone,
  className: student.classes,
  lastSession: student.theory.lastSession,
  lastSessionDate: student.theory.lastSessionDate,
  attendedUnits: student.theory.attendedUnits,
  requiredUnits: student.theory.requiredUnits,
  createdAt: student.registrationDate,
  progress: student.theory.progress,
  preExams: student.theory.preExams,
  exam: student.theory.exam,
  status: student.theory.status,
});

const statusDot: Record<TheoryStatus, string> = {
  Aktiv: "bg-primary",
  "In Prüfung": "bg-amber-500",
  Bereit: "bg-green-500",
  Pausiert: "bg-muted-foreground/50",
};

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "Aktiv", label: "Aktiv" },
  { value: "Bereit", label: "Bereit" },
  { value: "In Prüfung", label: "In Prüfung" },
  { value: "Pausiert", label: "Pausiert" },
];

type Learner = ReturnType<typeof toLearner>;
type StatusFilter = "all" | TheoryStatus;
type SortOption = "name" | "progress-desc" | "progress-asc" | "exam" | "activity";

function openStudent(id: number) {
  window.history.pushState({}, "", `/fahrschueler/${id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const parseDate = (value: string) => {
  if (value === "Nicht geplant" || value === "—") return Number.POSITIVE_INFINITY;

  const [day, month, year] = value.split(".").map(Number);
  if (!day || !month || !year) return 0;

  return new Date(year, month - 1, day).getTime();
};

function compareLearners(left: Learner, right: Learner, sort: SortOption) {
  if (sort === "progress-desc") return right.progress - left.progress;
  if (sort === "progress-asc") return left.progress - right.progress;
  if (sort === "exam") return parseDate(left.exam) - parseDate(right.exam);
  if (sort === "activity")
    return (right.lastSessionDate ?? "").localeCompare(left.lastSessionDate ?? "");
  return left.name.localeCompare(right.name, "de");
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StatusBadge({ status }: { status: TheoryStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", statusDot[status])} />
      {status}
    </Badge>
  );
}

function StatusNavigation({
  learners,
  value,
  onChange,
  horizontal = false,
}: {
  learners: Learner[];
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
  horizontal?: boolean;
}) {
  return (
    <nav
      aria-label="Theorie-Status"
      className={cn(horizontal ? "flex gap-1" : "space-y-1")}
    >
      {statusOptions.map((option) => {
        const count =
          option.value === "all"
            ? learners.length
            : learners.filter((learner) => learner.status === option.value).length;
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:bg-accent",
              horizontal ? "shrink-0" : "w-full",
              selected
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/70",
            )}
          >
            <span className="whitespace-nowrap">{option.label}</span>
            <span className="ml-auto tabular-nums text-xs text-muted-foreground">
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function LearnerListItem({
  learner,
  selected,
  onSelect,
}: {
  learner: Learner;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative w-full px-4 py-3.5 text-left outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent",
        selected ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-muted/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-primary transition-opacity",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-foreground/5"
        >
          {initials(learner.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{learner.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Klasse {learner.className}
              </p>
            </div>
            <StatusBadge status={learner.status} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Progress value={learner.progress} className="h-1.5" />
            <span className="w-12 text-right text-xs font-medium tabular-nums">
              {learner.attendedUnits}/{learner.requiredUnits}
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5 truncate tabular-nums">
              <CalendarDays className="size-3.5 shrink-0" />
              {learner.exam}
            </span>
            <span
              className="flex min-w-0 items-center gap-1.5 truncate tabular-nums"
              title="Letzte Theoriestunde"
            >
              <Clock3 className="size-3.5 shrink-0" />
              {learner.lastSession}
            </span>
          </div>
        </div>

        <ChevronRight
          aria-hidden
          className="mt-2 size-4 shrink-0 text-muted-foreground/50 md:hidden"
        />
      </div>
    </button>
  );
}

function DetailReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-13 items-center justify-between gap-6 px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function LearnerDetail({ learner, onBack }: { learner: Learner; onBack: () => void }) {
  return (
    <section
      aria-label={`Details für ${learner.name}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-14 items-center gap-2 border-b px-4 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Zurück zur Liste"
        >
          <ArrowLeft />
        </Button>
        <span className="text-sm font-medium">Schüler</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-5 sm:p-7 lg:p-9">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground ring-1 ring-foreground/5"
            >
              {initials(learner.name)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-balance text-xl font-semibold tracking-[-0.02em]">
                {learner.name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Klasse {learner.className}</span>
                <span aria-hidden>·</span>
                <StatusBadge status={learner.status} />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label="Zum Schülerprofil"
              onClick={() => openStudent(learner.id)}
            >
              <span className="hidden sm:inline">Zum Schülerprofil</span>
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>

          <div className="mt-6 rounded-xl bg-muted/45 p-4 ring-1 ring-foreground/5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Theorie-Fortschritt</p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {learner.attendedUnits} von {learner.requiredUnits} Doppelstunden
                  besucht (laut Anwesenheit der Theoriegruppen)
                </p>
              </div>
              <p className="text-2xl font-semibold tracking-[-0.03em] tabular-nums">
                {learner.progress}%
              </p>
            </div>
            <Progress value={learner.progress} className="mt-4 h-1.5" />
          </div>

          <section className="mt-7" aria-labelledby="learning-status-heading">
            <div className="flex items-center gap-2">
              <BookOpenCheck className="size-4 text-muted-foreground" />
              <h2 id="learning-status-heading" className="text-sm font-semibold">
                Lernstand
              </h2>
            </div>
            <dl className="mt-3 overflow-hidden rounded-xl bg-muted/25 ring-1 ring-foreground/10 divide-y">
              <DetailReadout label="Letzte Theoriestunde" value={learner.lastSession} />
              <DetailReadout label="Theorieprüfung" value={learner.exam} />
              <DetailReadout
                label="Vorprüfungen (manuell, Lern-App nicht angebunden)"
                value={learner.preExams}
              />
              <DetailReadout label="Angemeldet am" value={learner.createdAt} />
            </dl>
          </section>

          <section className="mt-7" aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-sm font-semibold">
              Kontakt
            </h2>
            <div className="mt-3 flex min-h-16 items-center gap-3 rounded-xl px-4 ring-1 ring-foreground/10">
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Telefon</p>
                <p className="mt-0.5 truncate text-sm font-medium tabular-nums">
                  {learner.phone}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${learner.phone.replace(/\s/g, "")}`}>Anrufen</a>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export function Theorie() {
  const { students } = useStudents();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("name");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const learners = useMemo(() => students.map(toLearner), [students]);
  const classes = useMemo(
    () =>
      [...new Set(learners.map((learner) => learner.className))].toSorted((a, b) =>
        a.localeCompare(b, "de"),
      ),
    [learners],
  );

  const matchingLearners = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return learners.filter((learner) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [learner.name, learner.phone, learner.className]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesClass = classFilter === "all" || learner.className === classFilter;
      return matchesQuery && matchesClass;
    });
  }, [classFilter, learners, query]);

  const filteredLearners = useMemo(
    () =>
      matchingLearners
        .filter((learner) => statusFilter === "all" || learner.status === statusFilter)
        .toSorted((left, right) => compareLearners(left, right, sort)),
    [matchingLearners, sort, statusFilter],
  );

  const selectedLearner =
    filteredLearners.find((learner) => learner.id === selectedId) ??
    filteredLearners[0] ??
    null;

  const resetFilters = () => {
    setQuery("");
    setClassFilter("all");
    setStatusFilter("all");
  };

  const selectLearner = (id: number) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Schüler suchen…"
              aria-label="Schüler suchen"
              className="hidden w-48 sm:flex lg:w-64"
            />
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="hidden w-36 md:flex">
                <SelectValue placeholder="Klasse" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Alle Klassen</SelectItem>
                  {classes.map((className) => (
                    <SelectItem key={className} value={className}>
                      Klasse {className}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="hidden lg:inline-flex"
              onClick={resetFilters}
            >
              Zurücksetzen
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background p-2 sm:p-3 2xl:p-4">
        <div className="animate-enter flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div
            className={cn(
              "shrink-0 items-center gap-1 overflow-x-auto border-b p-2 lg:hidden",
              mobileDetailOpen ? "hidden md:flex" : "flex",
            )}
          >
            <StatusNavigation
              learners={matchingLearners}
              value={statusFilter}
              onChange={setStatusFilter}
              horizontal
            />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)] lg:grid-cols-[10.5rem_minmax(20rem,0.85fr)_minmax(26rem,1.4fr)]">
            <aside className="hidden min-h-0 flex-col border-r p-2 lg:flex">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
                Status
              </p>
              <StatusNavigation
                learners={matchingLearners}
                value={statusFilter}
                onChange={setStatusFilter}
              />
            </aside>

            <section
              aria-label="Schülerliste"
              className={cn(
                "min-h-0 flex-col border-r md:flex",
                mobileDetailOpen ? "hidden" : "flex",
              )}
            >
              <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
                <div>
                  <p className="text-sm font-semibold">
                    {statusFilter === "all" ? "Alle Schüler" : statusFilter}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {filteredLearners.length} Einträge
                  </p>
                </div>
                <Select
                  value={sort}
                  onValueChange={(value) => setSort(value as SortOption)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Sortieren" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="progress-desc">Fortschritt ↓</SelectItem>
                      <SelectItem value="progress-asc">Fortschritt ↑</SelectItem>
                      <SelectItem value="exam">Prüfung</SelectItem>
                      <SelectItem value="activity">Letzte Stunde</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="border-b p-2 sm:hidden">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Schüler suchen…"
                  aria-label="Schüler suchen"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto divide-y">
                {filteredLearners.length > 0 ? (
                  filteredLearners.map((learner) => (
                    <LearnerListItem
                      key={learner.id}
                      learner={learner}
                      selected={selectedLearner?.id === learner.id}
                      onSelect={() => selectLearner(learner.id)}
                    />
                  ))
                ) : (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
                    <BookOpenCheck className="size-5 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">Keine Schüler gefunden</p>
                    <p className="mt-1 text-pretty text-xs text-muted-foreground">
                      Ändern Sie die Suche oder setzen Sie die Filter zurück.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4"
                      onClick={resetFilters}
                    >
                      Filter zurücksetzen
                    </Button>
                  </div>
                )}
              </div>
            </section>

            <div className={cn("min-h-0", mobileDetailOpen ? "flex" : "hidden md:flex")}>
              {selectedLearner ? (
                <LearnerDetail
                  learner={selectedLearner}
                  onBack={() => setMobileDetailOpen(false)}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                  Wählen Sie einen Schüler aus.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
