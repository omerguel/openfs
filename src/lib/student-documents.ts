/* ------------------------------------------------------------------ */
/* Student documents: the checklist strings in students.documents and */
/* the uploaded files served by /api/students/:id/files.               */
/* ------------------------------------------------------------------ */

export const MAX_STUDENT_DOCUMENT_BYTES = 12 * 1024 * 1024;

/** Accepted by the upload endpoint (the server re-checks the bytes). */
export const STUDENT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.heic,application/pdf,image/png,image/jpeg,image/webp,image/heic";

const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "heic"];

/** Mirrors the server's StudentFile (src/server/student-files.ts). */
export type StudentFile = {
  id: number;
  studentId: number;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  url: string;
  /** Dokumentart ("Sehtest", …); "" = not classified. */
  docType: string;
};

/** Unterlagen a Fahrschule collects for the Führerscheinantrag — offered
 *  as Dokumentart for uploads and as the default checklist. */
export const STUDENT_DOCUMENT_TYPES = [
  "Personalausweis",
  "Passbild",
  "Sehtest",
  "Erste-Hilfe-Nachweis",
  "Führerscheinantrag",
  "Ausbildungsvertrag",
  "Einverständniserklärung (BF17)",
] as const;

/** Checklist shown for every student (entries can be ticked off). */
export const DEFAULT_CHECKLIST = [
  "Personalausweis",
  "Passbild",
  "Sehtest",
  "Erste-Hilfe-Nachweis",
  "Führerscheinantrag",
];

export type ChecklistEntry = { name: string; done: boolean; custom: boolean };

/** The checklist to display: default entries plus custom ones, each
 *  done when it is in `documents` (handed in). */
export function buildChecklist(
  documents: string[],
  openDocuments: string[] = [],
): ChecklistEntry[] {
  const has = (list: string[], name: string) => hasStudentDocumentNamed(list, name);
  const entries: ChecklistEntry[] = DEFAULT_CHECKLIST.map((name) => ({
    name,
    done: has(documents, name),
    custom: false,
  }));
  for (const name of [...documents, ...openDocuments]) {
    if (entries.some((entry) => has([entry.name], name))) continue;
    entries.push({ name, done: has(documents, name), custom: true });
  }
  return entries;
}

/** Tick or untick `name`: moves it between handed-in and open. */
export function toggleChecklistEntry(
  documents: string[],
  openDocuments: string[],
  name: string,
  done: boolean,
): { documents: string[]; openDocuments: string[] } {
  const without = (list: string[]) =>
    list.filter((entry) => !hasStudentDocumentNamed([entry], name));
  const isDefault = hasStudentDocumentNamed(DEFAULT_CHECKLIST, name);
  return done
    ? { documents: [...without(documents), name], openDocuments: without(openDocuments) }
    : {
        documents: without(documents),
        // Default entries are open implicitly; custom ones stay listed.
        openDocuments: isDefault
          ? without(openDocuments)
          : [...without(openDocuments), name],
      };
}

const byteFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
});

const uploadedAtFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatStudentDocumentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${byteFormatter.format(Math.ceil(bytes / 1024))} KB`;
  }
  return `${byteFormatter.format(bytes / (1024 * 1024))} MB`;
}

export function formatStudentDocumentUploadedAt(uploadedAt: string): string {
  const date = new Date(uploadedAt);
  if (Number.isNaN(date.getTime())) return "Uploadzeit unbekannt";
  return uploadedAtFormatter.format(date);
}

export function getStudentFileMeta(file: Pick<StudentFile, "size" | "uploadedAt">) {
  return `${formatStudentDocumentSize(file.size)} · ${formatStudentDocumentUploadedAt(file.uploadedAt)}`;
}

export function hasStudentDocumentNamed(names: string[], name: string): boolean {
  const normalizedName = name.trim().toLocaleLowerCase("de-DE");
  return names.some(
    (existing) => existing.trim().toLocaleLowerCase("de-DE") === normalizedName,
  );
}

/** German error message for a file the upload endpoint would reject,
 *  or null if it looks acceptable. */
export function validateStudentFile(file: { name: string; size: number }): string | null {
  if (file.size > MAX_STUDENT_DOCUMENT_BYTES) {
    return `„${file.name}" ist größer als 12 MB.`;
  }
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `„${file.name}": nur PDF, PNG, JPEG, WebP oder HEIC erlaubt.`;
  }
  return null;
}
