/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Dokumente tab. The Ausbildungsvertrag (print   */
/* via VertragDialog), uploaded files (/api/students/:id/files, bytes  */
/* in the server's FileStore) and the document checklist, persisted    */
/* through the students API like every other student edit.             */
/* ------------------------------------------------------------------ */

import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import {
  deleteStudentFile,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStudentFileMeta,
  hasStudentDocumentNamed,
  STUDENT_FILE_ACCEPT,
  validateStudentFile,
} from "@/lib/student-documents";
import type { StudentEdit } from "./fields";

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

/* Scaled-down first page of a PDF, rendered by the browser's PDF viewer
   from the inline /api/files/:id response (or a local blob URL). */
function PdfThumbnail({ url }: { url: string }) {
  return (
    <DocumentTile>
      <iframe
        src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title="PDF-Vorschau"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        className="pointer-events-none origin-top-left border-0 bg-white"
        style={{ width: 192, height: 192, transform: "scale(0.25)" }}
      />
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
    return <PdfThumbnail url={file.url} />;
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

function FileRow({
  file,
  busy,
  onDelete,
}: {
  file: StudentFile;
  busy: boolean;
  onDelete: () => void;
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
            {getStudentFileMeta(file)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button asChild variant="outline" size="sm">
          <a href={file.url} download={file.name}>
            <Download data-icon="inline-start" />
            Download
          </a>
        </Button>
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
      </div>
    </div>
  );
}

export function DokumenteTab({
  student,
  onSave,
}: {
  student: StudentRecord;
  onSave: (updates: Partial<StudentEdit>) => Promise<void>;
}) {
  const [vertragStudent, setVertragStudent] = useState<StudentRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documentInput, setDocumentInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const {
    files,
    loading: filesLoading,
    refresh: refreshFiles,
  } = useStudentFiles(student.id);

  const saveDocuments = async (documents: string[], successMessage: string) => {
    setSaving(true);
    try {
      await onSave({ documents });
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
    if (hasStudentDocumentNamed(student.documents, nextDocument)) {
      toast.info("Dieser Eintrag ist bereits hinterlegt.");
      return;
    }
    await saveDocuments(
      [...student.documents, nextDocument],
      `„${nextDocument}" hinzugefügt.`,
    );
    setDocumentInput("");
  };

  const removeDocument = (index: number) =>
    saveDocuments(
      student.documents.filter((_, documentIndex) => documentIndex !== index),
      `„${student.documents[index]}" entfernt.`,
    );

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
        await uploadStudentFile(student.id, file);
        uploaded += 1;
      }
      toast.success(
        uploaded === 1
          ? `„${picked[0]!.name}" hochgeladen.`
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

      {/* Uploaded files */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Hochgeladene Dateien
        </h3>
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
              onDelete={() => void removeFile(file)}
            />
          ))
        )}
      </div>

      {/* Checklist — documents the student handed in */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Checkliste</h3>
        {student.documents.length === 0 ? (
          <Empty className="min-h-32 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyTitle>Noch keine Einträge</EmptyTitle>
              <EmptyDescription>
                Halte fest, welche Unterlagen vorliegen – z. B. Sehtest oder Passbild.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          student.documents.map((document, index) => (
            <div
              key={`${document}-${index}`}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{document}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={saving}
                onClick={() => removeDocument(index)}
                aria-label={`${document} entfernen`}
              >
                <X />
              </Button>
            </div>
          ))
        )}

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
            placeholder="z. B. Führungszeugnis"
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
      </div>

      <VertragDialog student={vertragStudent} onClose={() => setVertragStudent(null)} />
    </div>
  );
}
