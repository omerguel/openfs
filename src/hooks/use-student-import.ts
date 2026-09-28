/* ------------------------------------------------------------------ */
/* Datenimport — client calls for /api/import/students/*.              */
/* ------------------------------------------------------------------ */

import { parseOrThrow } from "@/lib/api";
import type {
  ImportCommitResult,
  ImportPreview,
  ImportRequest,
} from "@/lib/student-import";

const post = (path: string, request: ImportRequest, signal?: AbortSignal) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

export async function previewStudentImport(
  request: ImportRequest,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  return parseOrThrow<ImportPreview>(
    await post("/api/import/students/preview", request, signal),
  );
}

export async function commitStudentImport(
  request: ImportRequest,
): Promise<ImportCommitResult> {
  return parseOrThrow<ImportCommitResult>(
    await post("/api/import/students/commit", request),
  );
}
