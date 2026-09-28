import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Plus, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  useConversations,
  useMessages,
  createConversation,
  deleteConversation,
  markConversationRead,
  sendChatMessage,
  type ChatMessage,
  type Conversation,
} from "@/hooks/use-chat";
import { useStudents } from "@/hooks/use-students";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* SQLite stores sent_at as UTC "YYYY-MM-DD HH:MM:SS" — parse explicitly
   as UTC so bubbles and previews show local time. */
function parseSentAt(sentAt: string): Date {
  return new Date(`${sentAt.replace(" ", "T")}Z`);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (localDayKey(date) === localDayKey(today)) return "Heute";
  if (localDayKey(date) === localDayKey(yesterday)) return "Gestern";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Compact timestamp for the list — time today, date otherwise. */
function formatListTime(sentAt: string | null): string {
  if (!sentAt) return "";
  const date = parseSentAt(sentAt);
  if (localDayKey(date) === localDayKey(new Date())) return formatTime(date);
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const unread = conversation.unread > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        // Hover fills appear instantly, fade out only (guideline §0.1).
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-muted/60 hover:duration-0 focus-visible:bg-muted/60 focus-visible:outline-none",
        selected && "bg-muted hover:bg-muted",
      )}
    >
      <Avatar size="lg">
        <AvatarFallback>{initials(conversation.studentName)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {conversation.studentName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              unread ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {formatListTime(conversation.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-xs",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {conversation.lastMessage || "Noch keine Nachrichten"}
          </span>
          {unread && (
            <Badge className="h-5 min-w-5 shrink-0 rounded-full px-1.5 tabular-nums">
              {conversation.unread}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const fromSchool = message.sender === "schule";
  return (
    <div className={cn("flex", fromSchool ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-0.5 rounded-xl px-3.5 py-2",
          fromSchool
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted",
        )}
      >
        <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>
        <span
          className={cn(
            "self-end text-[10px] tabular-nums",
            fromSchool ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {formatTime(parseSentAt(message.sentAt))}
        </span>
      </div>
    </div>
  );
}

/* Quiet centered day marker — a muted pill, no hairline-through-text. */
function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
        {label}
      </span>
    </div>
  );
}

function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversation: Conversation) => void;
}) {
  const { students } = useStudents();
  const [studentId, setStudentId] = useState<string>("");

  useEffect(() => {
    if (!open) setStudentId("");
  }, [open]);

  async function handleCreate() {
    const student = students.find((item) => String(item.id) === studentId);
    if (!student) return;
    try {
      const conversation = await createConversation({
        student_id: student.id,
        student_name: `${student.firstName} ${student.lastName}`.trim(),
      });
      onOpenChange(false);
      onCreated(conversation);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unterhaltung konnte nicht erstellt werden.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Neue Unterhaltung</DialogTitle>
          <DialogDescription>
            Wählen Sie eine Fahrschülerin oder einen Fahrschüler aus. Gibt es schon eine
            Unterhaltung, wird sie geöffnet.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="chat-student">Fahrschüler/in</FieldLabel>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger id="chat-student" className="w-full">
                <SelectValue placeholder="Fahrschüler/in wählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={String(student.id)}>
                      {student.firstName} {student.lastName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Abbrechen
            </Button>
          </DialogClose>
          <Button type="button" disabled={!studentId} onClick={() => void handleCreate()}>
            Unterhaltung starten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const POLL_INTERVAL_MS = 10_000;

export function Plaudern() {
  const { conversations, loading, refresh, clearUnread } = useConversations();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { messages, refresh: refreshMessages } = useMessages(selectedId);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ?? null;

  const totalUnread = conversations.reduce(
    (sum, conversation) => sum + conversation.unread,
    0,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.studentName.toLowerCase().includes(needle) ||
        conversation.lastMessage.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  // Mark the thread read when it is opened (or new messages arrive while open).
  useEffect(() => {
    if (!selected || selected.unread === 0) return;
    void markConversationRead(selected.id)
      .then(() => clearUnread(selected.id))
      .catch((error) =>
        console.error("Unterhaltung konnte nicht als gelesen markiert werden:", error),
      );
  }, [selected, clearUnread]);

  // No WebSockets — a slow poll keeps list and thread reasonably fresh.
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
      void refreshMessages();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh, refreshMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedId]);

  /* Group the thread into [date label, messages] sections for separators. */
  const sections = useMemo(() => {
    const groups: { key: string; label: string; messages: ChatMessage[] }[] = [];
    for (const message of messages) {
      const date = parseSentAt(message.sentAt);
      const key = localDayKey(date);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.messages.push(message);
      } else {
        groups.push({ key, label: formatDayLabel(date), messages: [message] });
      }
    }
    return groups;
  }, [messages]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedId === null || !draft.trim()) return;
    try {
      await sendChatMessage(selectedId, draft.trim());
      setDraft("");
      await Promise.all([refreshMessages(), refresh()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Senden fehlgeschlagen.");
    }
  }

  async function handleDelete(conversation: Conversation) {
    try {
      await deleteConversation(conversation.id);
      if (selectedId === conversation.id) setSelectedId(null);
      await refresh();
      toast.success("Unterhaltung gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button type="button" size="sm" onClick={() => setIsNewOpen(true)}>
            <Plus data-icon="inline-start" />
            <span className="hidden sm:inline">Neue Unterhaltung</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">Chat</h1>
          <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
            <span className="tabular-nums">
              {conversations.length}{" "}
              {conversations.length === 1 ? "Unterhaltung" : "Unterhaltungen"}
            </span>
            {totalUnread > 0 && (
              <>
                <span aria-hidden className="h-4 w-px bg-border" />
                <span className="tabular-nums text-foreground">
                  {totalUnread} ungelesen
                </span>
              </>
            )}
          </div>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background">
        {/* Left pane — conversation list. Below md only one pane is shown:
            the list, or the open conversation (with a back button). */}
        <aside
          className={cn(
            "min-w-0 flex-1 flex-col md:flex md:w-80 md:flex-none md:shrink-0 md:border-r md:border-border/70",
            selected ? "hidden" : "flex",
          )}
        >
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Unterhaltungen durchsuchen"
                className="pl-8"
                aria-label="Unterhaltungen durchsuchen"
              />
            </div>
          </div>
          <Separator />
          {/* Native scroll (not ScrollArea): the radix viewport's table-wrapper
              grows to the previews' intrinsic width, which breaks truncation and
              clips the timestamps/unread badges. */}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="flex flex-col gap-0.5 p-1.5">
              {loading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3 px-2.5 py-2">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                ))
              ) : filtered.length === 0 ? (
                <p className="px-2.5 py-8 text-center text-sm text-muted-foreground">
                  {query ? "Keine Treffer." : "Noch keine Unterhaltungen."}
                </p>
              ) : (
                filtered.map((conversation) => (
                  <ConversationListItem
                    key={conversation.id}
                    conversation={conversation}
                    selected={conversation.id === selectedId}
                    onSelect={() => setSelectedId(conversation.id)}
                  />
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Right pane — message thread */}
        <section
          className={cn("min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}
        >
          {selected ? (
            <>
              <div className="group/thread flex shrink-0 items-center gap-2 border-b border-border/70 px-2 py-2.5 md:gap-3 md:px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 md:hidden"
                  aria-label="Zurück zur Übersicht"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft />
                </Button>
                <Avatar className="shrink-0">
                  <AvatarFallback>{initials(selected.studentName)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {selected.studentName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {selected.studentId !== null ? "Fahrschüler/in" : "Kontakt ohne Akte"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "ml-auto shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive",
                    // Quiet until the thread header is hovered or the button is focused.
                    "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-150",
                    "group-hover/thread:opacity-100 group-hover/thread:duration-0",
                    "focus-visible:opacity-100",
                  )}
                  aria-label={`Unterhaltung mit ${selected.studentName} löschen`}
                  onClick={() => setDeleting(selected)}
                >
                  <Trash2 />
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-2 p-4">
                  {sections.map((section) => (
                    <div key={section.key} className="flex flex-col gap-2">
                      <DateSeparator label={section.label} />
                      {section.messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                      ))}
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Noch keine Nachrichten. Schreiben Sie die erste Nachricht.
                    </p>
                  )}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              <form
                onSubmit={(event) => void handleSend(event)}
                className="sticky bottom-0 flex shrink-0 items-center gap-2 border-t border-border/70 bg-background p-3"
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Nachricht schreiben…"
                  aria-label="Nachricht schreiben"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim()}
                  aria-label="Nachricht senden"
                >
                  <Send />
                </Button>
              </form>
            </>
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircle />
                </EmptyMedia>
                <EmptyTitle>Keine Unterhaltung ausgewählt</EmptyTitle>
                <EmptyDescription>
                  Wählen Sie links eine Unterhaltung aus oder beginnen Sie eine neue, um
                  Ihren Fahrschülern zu schreiben.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unterhaltung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Unterhaltung mit {deleting?.studentName} und alle Nachrichten werden
              endgültig entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void handleDelete(deleting);
                setDeleting(null);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewConversationDialog
        open={isNewOpen}
        onOpenChange={setIsNewOpen}
        onCreated={async (conversation) => {
          await refresh();
          setSelectedId(conversation.id);
        }}
      />
    </div>
  );
}

export default Plaudern;
