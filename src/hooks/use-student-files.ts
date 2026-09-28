/* ------------------------------------------------------------------ */
/* Uploaded student documents — /api/students/:id/files and            */
/* /api/files/:id (bytes live in the server's FileStore).              */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type { StudentFile } from "@/lib/student-documents";

export type { StudentFile };

const filesPath = (studentId: number) => `/api/students/${studentId}/files`;

export function useStudentFiles(studentId: number) {
  const query = useQuery({
    queryKey: ["student-files", studentId],
    queryFn: async () =>
      (await parseOrThrow<{ files: StudentFile[] }>(await fetch(filesPath(studentId))))
        .files,
  });
  return {
    files: query.data ?? [],
    loading: query.isPending,
    refresh: query.refetch,
  };
}

export async function uploadStudentFile(
  studentId: number,
  file: File,
  docType = "",
): Promise<StudentFile> {
  const body = new FormData();
  body.append("file", file, file.name);
  if (docType) body.append("docType", docType);
  return parseOrThrow<StudentFile>(
    await fetch(filesPath(studentId), { method: "POST", body }),
  );
}

export async function setStudentFileType(
  id: number,
  docType: string,
): Promise<StudentFile> {
  return parseOrThrow<StudentFile>(
    await fetch(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docType }),
    }),
  );
}

export async function deleteStudentFile(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(await fetch(`/api/files/${id}`, { method: "DELETE" }));
}
