/* ------------------------------------------------------------------ */
/* Students — single client-side source of truth                       */
/*                                                                     */
/* Every page that shows students (/fahrschueler, /theorie, the        */
/* dashboard, payment dialog) reads the same DB-backed list from       */
/* /api/students via this hook. Edits go through updateStudent /       */
/* createStudent so they persist across reloads.                       */
/* ------------------------------------------------------------------ */

import type { Student } from "@/lib/student-data";
import { parseOrThrow, useFetchList } from "@/lib/api";

/* instructorId/vehicleId are the real links; the display names in
   `instructor`/`vehicle` are derived by the server. */
export type StudentRecord = Student & {
  id: number;
  instructorId?: number | null;
  vehicleId?: number | null;
};

export async function fetchStudents(): Promise<StudentRecord[]> {
  const data = await parseOrThrow<{ students: StudentRecord[] }>(
    await fetch("/api/students"),
  );
  return data.students;
}

export async function createStudent(input: Partial<Student>): Promise<StudentRecord> {
  return parseOrThrow<StudentRecord>(
    await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateStudent(
  id: number,
  input: Partial<Student>,
): Promise<StudentRecord> {
  return parseOrThrow<StudentRecord>(
    await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

/** Archives the student (restorable from /archiv); `reason` is one of
 *  abgeschlossen | abgebrochen | wechsel | sonstiges. */
export async function deleteStudent(id: number, reason?: string): Promise<void> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/students/${id}${query}`, { method: "DELETE" }),
  );
}

export function useStudents() {
  const {
    items: students,
    loading,
    refresh,
  } = useFetchList(
    ["students"],
    fetchStudents,
    "Fahrschüler konnten nicht geladen werden",
  );
  return { students, loading, refresh };
}
