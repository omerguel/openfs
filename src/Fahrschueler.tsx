import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Printer,
  Search,
  UserPlus,
  Users,
} from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import { VertragDialog } from "./components/VertragDialog.tsx";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStudents, type StudentRecord } from "@/hooks/use-students";
import type { Student } from "@/lib/student-data";
import { matchesStudentQuery } from "@/lib/student-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type SortKey = Extract<
  keyof Student,
  | "firstName"
  | "lastName"
  | "classes"
  | "balance"
  | "phone"
  | "lastLesson"
  | "nextLesson"
  | "drivingSchool"
  | "registrationDate"
  | "contractNumber"
>;
type SortDirection = "asc" | "desc";
type StatusFilter = "aktiv" | "inaktiv";

const sortLabels: Record<SortKey, string> = {
  firstName: "Vorname",
  lastName: "Nachname",
  classes: "Klassen",
  balance: "Bilanz",
  phone: "Telefon",
  lastLesson: "Letzte Stunde",
  nextLesson: "Nächste Stunde",
  drivingSchool: "Fahrschule",
  registrationDate: "Anmeldedatum",
  contractNumber: "Vertragsnummer",
};

const parseDate = (value: string) => {
  if (value === "Nicht geplant") return Number.POSITIVE_INFINITY;

  const [datePart, timePart = "00:00"] = value.split(", ");
  const [day, month, year] = (datePart ?? "").split(".").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if (!day || !month || !year) return 0;

  return new Date(year, month - 1, day, hour || 0, minute || 0).getTime();
};

const parseBalance = (value: string) =>
  Number(value.replace(" EUR", "").replace(".", "").replace(",", "."));

function getSortValue(student: Student, sortKey: SortKey) {
  if (
    sortKey === "registrationDate" ||
    sortKey === "lastLesson" ||
    sortKey === "nextLesson"
  ) {
    return parseDate(student[sortKey]);
  }

  if (sortKey === "balance") {
    return student.balanceCents ?? parseBalance(student.balance);
  }

  return student[sortKey];
}

function SortableHead({
  sortKey,
  activeKey,
  direction,
  className,
  onSort,
}: {
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  className?: string;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-1 h-7 px-1 text-xs"
        onClick={() => onSort(sortKey)}
      >
        {sortLabels[sortKey]}
        <Icon data-icon="inline-end" />
      </Button>
    </TableHead>
  );
}

export function Fahrschueler() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // DB-backed: the roster comes from /api/students, edits go back via PATCH.
  const { students: studentRows } = useStudents();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("aktiv");
  const [sortKey, setSortKey] = useState<SortKey>("lastName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [vertragStudent, setVertragStudent] = useState<StudentRecord | null>(null);

  const queryMatches = useMemo(
    () => studentRows.filter((student) => matchesStudentQuery(student, query)),
    [query, studentRows],
  );
  const otherStatus: StatusFilter = statusFilter === "aktiv" ? "inaktiv" : "aktiv";
  const otherStatusMatches = queryMatches.filter(
    (student) => student.status === otherStatus,
  ).length;

  const filteredStudents = useMemo(() => {
    return queryMatches
      .filter((student) => student.status === statusFilter)
      .toSorted((left, right) => {
        const leftValue = getSortValue(left, sortKey);
        const rightValue = getSortValue(right, sortKey);
        const result =
          typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), "de");

        if (result !== 0) {
          return sortDirection === "asc" ? result : -result;
        }

        return left.lastName.localeCompare(right.lastName, "de");
      });
  }, [queryMatches, sortDirection, sortKey, statusFilter]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  };

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("aktiv");
  };

  const openStudent = (student: StudentRecord) =>
    void navigate({
      to: "/fahrschueler/$studentId",
      params: { studentId: String(student.id) },
    });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button
            type="button"
            size="sm"
            onClick={() => void navigate({ to: "/neue-schueler" })}
          >
            <UserPlus data-icon="inline-start" />
            <span className="hidden sm:inline">Schüler anmelden</span>
            <span className="sr-only sm:hidden">Schüler anmelden</span>
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={isMobile ? "Suchen" : "Name, Telefon, E-Mail oder Nr."}
              aria-label="Fahrschüler suchen nach Name, Telefon, E-Mail, Kunden- oder Vertragsnummer"
              title="Name, Telefon, E-Mail, Klasse, Kunden- oder Vertragsnummer"
              className="h-8 w-36 pl-8 sm:w-64 lg:w-72"
            />
          </div>
          <ToggleGroup
            type="single"
            value={statusFilter}
            onValueChange={(value) => {
              if (value === "aktiv" || value === "inaktiv") {
                setStatusFilter(value);
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Status der Fahrschüler"
            className="shrink-0"
          >
            <ToggleGroupItem value="aktiv" aria-label="Aktive Fahrschüler">
              Aktiv
            </ToggleGroupItem>
            <ToggleGroupItem value="inaktiv" aria-label="Inaktive Fahrschüler">
              Inaktiv
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden md:inline-flex"
            onClick={resetFilters}
          >
            Zurücksetzen
          </Button>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {filteredStudents.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {query.trim() ? <Search /> : <Users />}
              </EmptyMedia>
              <EmptyTitle>
                {query.trim()
                  ? statusFilter === "aktiv"
                    ? "Keine aktiven Treffer"
                    : "Keine inaktiven Treffer"
                  : statusFilter === "aktiv"
                    ? "Noch keine aktiven Fahrschüler"
                    : "Keine inaktiven Fahrschüler"}
              </EmptyTitle>
              <EmptyDescription>
                {query.trim()
                  ? `Für „${query.trim()}“ wurde ${
                      statusFilter === "aktiv" ? "unter Aktiv" : "unter Inaktiv"
                    } niemand gefunden.`
                  : statusFilter === "aktiv"
                    ? "Legen Sie den ersten Fahrschüler über „Schüler Anmeldung“ an."
                    : "Fahrschüler, die Sie auf inaktiv setzen, erscheinen hier."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row flex-wrap justify-center">
              {otherStatusMatches > 0 && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStatusFilter(otherStatus)}
                >
                  {otherStatusMatches} Treffer unter{" "}
                  {otherStatus === "aktiv" ? "Aktiv" : "Inaktiv"} anzeigen
                </Button>
              )}
              {query.trim() ? (
                <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
                  Suche zurücksetzen
                </Button>
              ) : (
                statusFilter === "aktiv" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void navigate({ to: "/neue-schueler" })}
                  >
                    <UserPlus data-icon="inline-start" />
                    Schüler Anmeldung
                  </Button>
                )
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <div className="animate-enter flex flex-col gap-4 rounded-xl border bg-card p-4 2xl:p-5">
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <SortableHead
                      sortKey="firstName"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="pl-4 pr-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="lastName"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="classes"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="balance"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="phone"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="lastLesson"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="nextLesson"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="drivingSchool"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="registrationDate"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <SortableHead
                      sortKey="contractNumber"
                      activeKey={sortKey}
                      direction={sortDirection}
                      className="px-1"
                      onSort={handleSort}
                    />
                    <TableHead className="pl-1 pr-4 text-right">
                      Vertrag drucken
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.map((student) => {
                    const hasDebt = student.balance.startsWith("-");

                    return (
                      <TableRow
                        key={student.id}
                        tabIndex={0}
                        className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                        onClick={() => openStudent(student)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openStudent(student);
                          }
                        }}
                      >
                        <TableCell className="pl-4 pr-1 font-medium">
                          {student.firstName}
                        </TableCell>
                        <TableCell className="px-1 font-medium">
                          {student.lastName}
                        </TableCell>
                        <TableCell className="px-1">{student.classes}</TableCell>
                        <TableCell className="pl-1 pr-4">
                          <Badge
                            variant="outline"
                            className={
                              hasDebt
                                ? "bg-red-50 text-red-700 ring-red-600/20"
                                : "bg-green-50 text-green-700 ring-green-600/20"
                            }
                          >
                            {student.balance}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-1 text-muted-foreground">
                          {student.phone}
                        </TableCell>
                        <TableCell className="px-1">{student.lastLesson}</TableCell>
                        <TableCell className="px-1">{student.nextLesson}</TableCell>
                        <TableCell className="px-1">{student.drivingSchool}</TableCell>
                        <TableCell className="px-1">{student.registrationDate}</TableCell>
                        <TableCell className="px-1">{student.contractNumber}</TableCell>
                        <TableCell className="px-1">
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${student.contractNumber} drucken`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setVertragStudent(student);
                              }}
                            >
                              <Printer data-icon="inline-start" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
      <VertragDialog student={vertragStudent} onClose={() => setVertragStudent(null)} />
    </div>
  );
}
