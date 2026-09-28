import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, Printer, UserPlus } from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import { VertragDialog } from "./components/VertragDialog.tsx";
import { useStudents, type StudentRecord } from "@/hooks/use-students";
import type { Student } from "@/lib/student-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  // DB-backed: the roster comes from /api/students, edits go back via PATCH.
  const { students: studentRows } = useStudents();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("aktiv");
  const [sortKey, setSortKey] = useState<SortKey>("lastName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [vertragStudent, setVertragStudent] = useState<StudentRecord | null>(null);

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return studentRows
      .filter((student) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [
            student.firstName,
            student.lastName,
            student.classes,
            student.phone,
            student.contractNumber,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        const matchesStatus = student.status === statusFilter;

        return matchesQuery && matchesStatus;
      })
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
  }, [query, sortDirection, sortKey, statusFilter, studentRows]);

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
            Schüler anmelden
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, Telefon, Klasse oder Vertrag suchen"
            className="h-8 w-44 sm:w-64 lg:w-72"
          />
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
            aria-label="Fahrschueler Status"
            className="hidden sm:flex"
          >
            <ToggleGroupItem value="aktiv" aria-label="Aktive Fahrschueler">
              Aktiv
            </ToggleGroupItem>
            <ToggleGroupItem value="inaktiv" aria-label="Inaktive Fahrschueler">
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
                  <TableHead className="pl-1 pr-4 text-right">Vertrag drucken</TableHead>
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
      </div>
      <VertragDialog student={vertragStudent} onClose={() => setVertragStudent(null)} />
    </div>
  );
}
