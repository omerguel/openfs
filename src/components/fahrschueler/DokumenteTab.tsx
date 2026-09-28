/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Dokumente tab. The Ausbildungsvertrag (print   */
/* via VertragDialog), uploaded files (/api/students/:id/files, bytes  */
/* in the server's FileStore) and the document checklist, persisted    */
/* through the students API like every other student edit.             */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import {
  deleteStudentFile,
  setStudentFileType,
  uploadStudentFile,
  useStudentFiles,
  type StudentFile,
} from "@/hooks/use-student-files";
import { VertragDialog } from "@/components/VertragDialog.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildChecklist,
  getStudentFileMeta,
  hasStudentDocumentNamed,
  STUDENT_DOCUMENT_TYPES,
  STUDENT_FILE_ACCEPT,
  toggleChecklistEntry,
  validateStudentFile,
} from "@/lib/student-documents";
import type { Student } from "@/lib/student-data";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/* Uniform thumbnail tile; falls back to an icon or extension badge. */
function DocumentTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {children}
    </div>
  );
}

/* Types the browser can render as a thumbnail (HEIC usually cannot). */
const PREVIEW_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/* PDFs get a document tile — an embedded viewer renders blank or with
   toolbar chrome at thumbnail size in several browsers. */
function PdfThumbnail() {
  return (
    <DocumentTile>
      <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
        <FileText className="size-4" />
        <span className="text-[9px] font-semibold">PDF</span>
      </span>
    </DocumentTile>
  );
}

/** Thumbnail for an uploaded (or picked, not yet uploaded) file. */
export function StudentFilePreview({
  file,
}: {
  file: { name: string; mimeType: string; url: string };
}) {
  if (PREVIEW_IMAGE_TYPES.has(file.mimeType)) {
    return (
      <img
        src={file.url}
        alt=""
        loading="lazy"
        className="size-12 shrink-0 rounded-md border object-cover"
      />
    );
  }
  if (file.mimeType === "application/pdf") {
    return <PdfThumbnail />;
  }
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.slice(0, 4)
    : null;
  return (
    <DocumentTile>
      {extension ? (
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          {extension}
        </span>
      ) : (
        <FileText className="size-5 text-muted-foreground" />
      )}
    </DocumentTile>
  );
}

const UNTYPED = "";

function DocTypeSelect({
  value,
  disabled,
  onChange,
  id,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (docType: string) => void;
  id?: string;
  ariaLabel: string;
}) {
  const known = (STUDENT_DOCUMENT_TYPES as readonly string[]).includes(value);
  return (
    <NativeSelect
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="w-full sm:w-52"
    >
      <NativeSelectOption value={UNTYPED}>Sonstiges Dokument</NativeSelectOption>
      {!known && value !== UNTYPED && (
        <NativeSelectOption value={value}>{value}</NativeSelectOption>
      )}
      {STUDENT_DOCUMENT_TYPES.map((type) => (
        <NativeSelectOption key={type} value={type}>
          {type}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function FileRow({
  file,
  busy,
  readOnly,
  onDelete,
  onTypeChange,
}: {
  file: StudentFile;
  busy: boolean;
  readOnly: boolean;
  onDelete: () => void;
  onTypeChange: (docType: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <StudentFilePreview file={file} />
        <div className="flex min-w-0 flex-col">
          <a
            href={file.url}
            target="_blank"
            rel="noopener"
            className="truncate text-sm font-medium hover:underline"
          >
            {file.name}
          </a>
          <span className="text-xs text-muted-foreground tabular-nums">
            {readOnly && file.docType ? `${file.docType} · ` : ""}
            {getStudentFileMeta(file)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {!readOnly && (
          <DocTypeSelect
            value={file.docType}
            disabled={busy}
            onChange={onTypeChange}
            ariaLabel={`Dokumentart von ${file.name}`}
          />
        )}
        <Button asChild variant="outline" size="sm">
          <a href={file.url} download={file.name}>
            <Download data-icon="inline-start" />
            <span className="max-sm:sr-only">Download</span>
          </a>
        </Button>
        {!readOnly && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`${file.name} löschen`}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Datei löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  „{file.name}" wird unwiderruflich gelöscht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

export function DokumenteTab({
  student,
  onSave,
  readOnly = false,
  showContract = true,
  openContractSignal = 0,
}: {
  student: StudentRecord;
  onSave: (updates: Partial<Student>) => Promise<void>;
  /** Fahrlehrer/innen may look, not change. */
  readOnly?: boolean;
  /** The contract carries prices — hidden for Fahrlehrer/innen. */
  showContract?: boolean;
  /** Incremented from outside to open the contract dialog. */
  openContractSignal?: number;
}) {
  const [vertragStudent, setVertragStudent] = useState<StudentRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documentInput, setDocumentInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState(UNTYPED);

  useEffect(() => {
    if (openContractSignal > 0 && showContract) setVertragStudent(student);
    // Only a new signal opens the dialog — not every student refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openContractSignal]);
  const openDocuments = student.openDocuments ?? [];
  const checklist = buildChecklist(student.documents, openDocuments);
  const {
    files,
    loading: filesLoading,
    refresh: refreshFiles,
  } = useStudentFiles(student.id);

  const saveDocuments = async (
    documents: string[],
    successMessage: string,
    nextOpen: string[] = openDocuments,
  ) => {
    setSaving(true);
    try {
      await onSave({ documents, openDocuments: nextOpen });
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const addDocument = async () => {
    const nextDocument = documentInput.trim();
    if (!nextDocument) return;
    if (checklist.some((entry) => hasStudentDocumentNamed([entry.name], nextDocument))) {
      toast.info("Dieser Eintrag steht bereits auf der Checkliste.");
      return;
    }
    // New entries start open — tick them once the document is there.
    await saveDocuments(student.documents, `„${nextDocument}" hinzugefügt.`, [
      ...openDocuments,
      nextDocument,
    ]);
    setDocumentInput("");
  };

  const toggleDocument = (name: string, done: boolean) => {
    const next = toggleChecklistEntry(student.documents, openDocuments, name, done);
    return saveDocuments(
      next.documents,
      done ? `„${name}" liegt vor.` : `„${name}" als fehlend markiert.`,
      next.openDocuments,
    );
  };

  const removeDocument = (name: string) =>
    saveDocuments(
      student.documents.filter((entry) => !hasStudentDocumentNamed([entry], name)),
      `„${name}" entfernt.`,
      openDocuments.filter((entry) => !hasStudentDocumentNamed([entry], name)),
    );

  const changeFileType = async (file: StudentFile, docType: string) => {
    setUploading(true);
    try {
      await setStudentFileType(file.id, docType);
      await markHandedIn(docType);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setUploading(false);
      await refreshFiles();
    }
  };

  /* A typed upload ticks the matching checklist entry. */
  const markHandedIn = async (docType: string) => {
    if (!docType || hasStudentDocumentNamed(student.documents, docType)) return;
    if (!checklist.some((entry) => hasStudentDocumentNamed([entry.name], docType)))
      return;
    const next = toggleChecklistEntry(student.documents, openDocuments, docType, true);
    await onSave({ documents: next.documents, openDocuments: next.openDocuments });
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (picked.length === 0) return;

    const invalid = picked.map(validateStudentFile).find(Boolean);
    if (invalid) {
      toast.error(invalid);
      return;
    }

    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of picked) {
        await uploadStudentFile(student.id, file, uploadType);
        uploaded += 1;
      }
      await markHandedIn(uploadType);
      toast.success(
        uploaded === 1
          ? `„${picked[0]!.name}" hochgeladen${uploadType ? ` (${uploadType})` : ""}.`
          : `${uploaded} Dateien hochgeladen.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      await refreshFiles();
    }
  };

  const removeFile = async (file: StudentFile) => {
    setUploading(true);
    try {
      await deleteStudentFile(file.id);
      toast.success(`„${file.name}" gelöscht.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setUploading(false);
      await refreshFiles();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* Contract — generated document, printable */}
      {showContract && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Vertragsdokumente</h3>
          <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <DocumentTile>
              <FileText className="size-5 text-muted-foreground" />
            </DocumentTile>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                Ausbildungsvertrag · {student.contractNumber}
              </span>
              <span className="text-xs text-muted-foreground">
                Anmeldedatum {student.registrationDate} · Klasse {student.classes}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVertragStudent(student)}
            >
              <Printer data-icon="inline-start" />
              Drucken
            </Button>
          </div>
        </div>
      )}

      {/* Uploaded files */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Hochgeladene Dateien
        </h3>
        {!readOnly && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Upload className="text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Datei hochladen</span>
                <span className="text-xs text-muted-foreground">
                  PDF oder Bild (PNG, JPEG, WebP, HEIC) bis 12 MB
                </span>
              </div>
            </div>
            <Input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept={STUDENT_FILE_ACCEPT}
              disabled={uploading}
              onChange={uploadFiles}
              tabIndex={-1}
              aria-hidden="true"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <DocTypeSelect
                id="upload-doc-type"
                value={uploadType}
                disabled={uploading}
                onChange={setUploadType}
                ariaLabel="Dokumentart für den Upload"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload data-icon="inline-start" />
                {uploading ? "Wird hochgeladen …" : "Hochladen"}
              </Button>
            </div>
          </div>
        )}

        {filesLoading ? (
          <Skeleton className="h-[74px] rounded-lg" />
        ) : files.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            Noch keine Dateien hochgeladen.
          </p>
        ) : (
          files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              busy={uploading}
              readOnly={readOnly}
              onDelete={() => void removeFile(file)}
              onTypeChange={(docType) => void changeFileType(file, docType)}
            />
          ))
        )}
      </div>

      {/* Checklist — documents the student handed in */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Checkliste</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {checklist.filter((entry) => entry.done).length} von {checklist.length}{" "}
            vorhanden
          </span>
        </div>
        <div className="flex flex-col divide-y rounded-lg border bg-card">
          {checklist.map((entry) => (
            <div key={entry.name} className="flex items-center gap-3 px-3 py-1.5">
              <Checkbox
                id={`doc-${entry.name}`}
                checked={entry.done}
                disabled={saving || readOnly}
                onCheckedChange={(value) =>
                  void toggleDocument(entry.name, value === true)
                }
              />
              <Label
                htmlFor={`doc-${entry.name}`}
                className={cn(
                  "min-w-0 flex-1 truncate py-1 text-sm font-normal",
                  !entry.done && "text-muted-foreground",
                )}
              >
                {entry.name}
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {entry.done ? "liegt vor" : "fehlt"}
              </span>
              {entry.custom && !readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={saving}
                  onClick={() => void removeDocument(entry.name)}
                  aria-label={`${entry.name} von der Checkliste entfernen`}
                >
                  <X />
                </Button>
              ) : (
                <span className="w-6" aria-hidden />
              )}
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Input
              value={documentInput}
              onChange={(event) => setDocumentInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addDocument();
                }
              }}
              placeholder="Weiteren Eintrag hinzufügen, z. B. Führungszeugnis"
            />
            <Button
              type="button"
              variant="outline"
              className="sm:w-auto"
              disabled={saving || !documentInput.trim()}
              onClick={addDocument}
            >
              <Plus data-icon="inline-start" />
              Hinzufügen
            </Button>
          </div>
        )}
      </div>

      <VertragDialog student={vertragStudent} onClose={() => setVertragStudent(null)} />
    </div>
  );
}
