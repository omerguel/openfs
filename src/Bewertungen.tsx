import { useMemo, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  Info,
  MessageSquareText,
  Reply,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  deleteReview,
  importGoogleReviews,
  REVIEW_SOURCES,
  updateReview,
  useGoogleReviewSummary,
  useReviews,
  type GoogleReviewSummary,
  type Review,
  type ReviewSource,
  type ReviewStatus,
} from "@/hooks/use-reviews";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type SourceFilter = "alle" | ReviewSource;
type StatusFilter = "alle" | ReviewStatus;

const STATUS_LABELS: Record<ReviewStatus, string> = {
  neu: "Neu",
  beantwortet: "Beantwortet",
  ausgeblendet: "Ausgeblendet",
};

const STATUS_DOTS: Record<ReviewStatus, string> = {
  neu: "bg-amber-500",
  beantwortet: "bg-green-500",
  ausgeblendet: "bg-muted-foreground/50",
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

function formatAverage(value: number): string {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** First + last initial — a quiet identity anchor for the feed's left rail. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function Stars({
  rating,
  compact = false,
  className,
}: {
  rating: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${rating} von 5 Sternen`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden
          className={cn(
            compact ? "size-3.5" : "size-4",
            value <= rating
              ? "fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300"
              : "fill-muted text-muted",
          )}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOTS[status])} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/* Compact average + per-star distribution. Reads from the full set, not the
   filtered slice — the school's standing doesn't change because a filter is on. */
const importedFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});

/* Google's own overall rating (all reviews on Google, not only the five
   the API returns) — shown next to the local average once imported. */
function GoogleRating({ summary }: { summary: GoogleReviewSummary | null }) {
  if (!summary || summary.rating === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">Google gesamt</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums">
          {formatAverage(summary.rating)}
        </span>
        <Star
          aria-hidden
          className="size-3 fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300"
        />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {summary.userRatingCount ?? 0} Bewertungen
          {summary.importedAt
            ? ` · Stand ${importedFormatter.format(new Date(summary.importedAt))}`
            : ""}
        </span>
      </span>
    </div>
  );
}

function SummaryBand({
  reviews,
  google,
}: {
  reviews: Review[];
  google: GoogleReviewSummary | null;
}) {
  const { average, total, distribution, max } = useMemo(() => {
    const counts = [0, 0, 0, 0, 0]; // index 0 = 1 star … index 4 = 5 stars
    let sum = 0;
    for (const review of reviews) {
      sum += review.rating;
      const bucket = Math.min(5, Math.max(1, Math.round(review.rating))) - 1;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return {
      average: reviews.length === 0 ? 0 : sum / reviews.length,
      total: reviews.length,
      distribution: counts,
      max: Math.max(1, ...counts),
    };
  }, [reviews]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b bg-muted/30 px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
          {total === 0 ? "–" : formatAverage(average)}
        </span>
        <div className="flex flex-col gap-1">
          <Stars rating={Math.round(average)} />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {total} {total === 1 ? "Bewertung" : "Bewertungen"}
          </span>
        </div>
      </div>

      <GoogleRating summary={google} />

      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-56">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = distribution[star - 1] ?? 0;
          return (
            <div
              key={star}
              className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground"
            >
              <span className="w-2 text-right">{star}</span>
              <Star
                aria-hidden
                className="size-3 fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300"
              />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-amber-400 dark:bg-amber-300"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="w-5 text-right">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReplyDialog({
  review,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  review: Review;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (reply: string) => void;
}) {
  const [reply, setReply] = useState(review.reply);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Auf Bewertung antworten</DialogTitle>
          <DialogDescription>
            Antwort an {review.author} ({review.source}) verfassen. Die Bewertung wird als
            „Beantwortet“ markiert.
          </DialogDescription>
        </DialogHeader>

        {review.source === "Google" && (
          <p className="flex gap-2 text-xs text-pretty text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Die Antwort wird nur intern gespeichert. Auf Google veröffentlichen lässt sie
            sich nur über die Google Business Profile API (OAuth-Anmeldung und Freigabe
            durch Google) — bitte zusätzlich im Google-Unternehmensprofil antworten.
          </p>
        )}

        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{review.author}</span>
            <Stars rating={review.rating} compact />
          </div>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">{review.text}</p>
        </div>

        <Field>
          <FieldLabel htmlFor="review-reply">Antwort</FieldLabel>
          <Textarea
            id="review-reply"
            rows={5}
            placeholder="Vielen Dank für Ihre Bewertung…"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={saving || !reply.trim()}
            onClick={() => onSave(reply.trim())}
          >
            Antwort speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewActions({
  review,
  saving,
  onReply,
  onToggleHidden,
  onDelete,
}: {
  review: Review;
  saving: boolean;
  onReply: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const hidden = review.status === "ausgeblendet";

  return (
    // Hidden on fine pointers until the row is hovered or an action is focused;
    // always visible on touch. Opacity (not display) so nothing shifts.
    <div
      className={cn(
        "flex items-center gap-0.5",
        "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-150",
        "group-hover/review:opacity-100 group-hover/review:duration-0",
        "has-[:focus-visible]:opacity-100",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        aria-label={`Bewertung von ${review.author} beantworten`}
        onClick={onReply}
      >
        <Reply />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        aria-label={
          hidden
            ? `Bewertung von ${review.author} einblenden`
            : `Bewertung von ${review.author} ausblenden`
        }
        onClick={onToggleHidden}
      >
        {hidden ? <Eye /> : <EyeOff />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Bewertung von ${review.author} löschen`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function ReviewRow({
  review,
  saving,
  onReply,
  onToggleHidden,
  onDelete,
}: {
  review: Review;
  saving: boolean;
  onReply: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const hidden = review.status === "ausgeblendet";

  return (
    <article
      className={cn(
        "group/review flex gap-3.5 px-4 py-4 sm:px-5",
        "transition-colors duration-150 hover:bg-muted/30 hover:duration-0",
        hidden && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      >
        {initials(review.author)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{review.author}</span>
              <StatusBadge status={review.status} />
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {review.source} · {formatDate(review.date)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ReviewActions
              review={review}
              saving={saving}
              onReply={onReply}
              onToggleHidden={onToggleHidden}
              onDelete={onDelete}
            />
            <Stars rating={review.rating} compact />
          </div>
        </div>

        <p className="mt-2 text-sm text-pretty">{review.text}</p>

        {review.reply ? (
          <div className="mt-3 rounded-md border border-border/70 bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Reply className="size-3" aria-hidden />
              Ihre Antwort
            </div>
            <p className="mt-1 text-sm text-pretty text-foreground/90">{review.reply}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function Bewertungen() {
  const { reviews, loading, refresh } = useReviews();
  const { summary: google, refresh: refreshGoogle } = useGoogleReviewSummary();
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("alle");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredReviews = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
    return reviews.filter((review) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [review.author, review.source, review.text, review.reply]
          .join(" ")
          .toLocaleLowerCase("de-DE")
          .includes(normalizedQuery);
      const matchesSource = sourceFilter === "alle" || review.source === sourceFilter;
      const matchesStatus = statusFilter === "alle" || review.status === statusFilter;

      return matchesQuery && matchesSource && matchesStatus;
    });
  }, [query, reviews, sourceFilter, statusFilter]);

  const replyingReview = reviews.find((review) => review.id === replyingId) ?? null;

  const resetFilters = () => {
    setQuery("");
    setSourceFilter("alle");
    setStatusFilter("alle");
  };

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await action();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const importFromGoogle = async () => {
    setImporting(true);
    try {
      const result = await importGoogleReviews();
      await Promise.all([refresh(), refreshGoogle()]);
      toast.success(
        result.imported + result.updated === 0
          ? "Google liefert aktuell keine Bewertungen."
          : `${result.imported} neue, ${result.updated} aktualisierte Google-Bewertungen.`,
        {
          description:
            "Google gibt über die Places API höchstens fünf Bewertungen zurück.",
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    } finally {
      setImporting(false);
    }
  };

  const googleHint = !google?.configured
    ? "GOOGLE_PLACES_API_KEY ist nicht gesetzt."
    : !google.placeId
      ? "Bitte zuerst die Google Place ID im Schulprofil hinterlegen."
      : "Bewertungen und Gesamtbewertung von Google abrufen.";

  const saveReply = async (reply: string) => {
    if (replyingId === null) return;
    const ok = await mutate(
      () => updateReview(replyingId, { reply, status: "beantwortet" }),
      "Antwort gespeichert. Bewertung als „Beantwortet“ markiert.",
    );
    if (ok) setReplyingId(null);
  };

  const toggleHidden = (review: Review) => {
    const nextStatus: ReviewStatus =
      review.status === "ausgeblendet"
        ? review.reply
          ? "beantwortet"
          : "neu"
        : "ausgeblendet";
    void mutate(
      () => updateReview(review.id, { status: nextStatus }),
      nextStatus === "ausgeblendet"
        ? "Bewertung ausgeblendet."
        : "Bewertung wieder eingeblendet.",
    );
  };

  const removeReview = (review: Review) => {
    const confirmed = window.confirm(
      `Bewertung von "${review.author}" (${review.source}) wirklich löschen?`,
    );
    if (!confirmed) return;
    void mutate(() => deleteReview(review.id), "Bewertung gelöscht.");
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suchen…"
              className="hidden w-44 sm:flex lg:w-60"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="hidden w-40 md:flex" aria-label="Status filtern">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="alle">Alle Status</SelectItem>
                  <SelectItem value="neu">Neu</SelectItem>
                  <SelectItem value="beantwortet">Beantwortet</SelectItem>
                  <SelectItem value="ausgeblendet">Ausgeblendet</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={sourceFilter}
              onValueChange={(value) => setSourceFilter(value as SourceFilter)}
            >
              <SelectTrigger className="hidden w-40 md:flex" aria-label="Quelle filtern">
                <SelectValue placeholder="Quelle" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="alle">Alle Quellen</SelectItem>
                  {REVIEW_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="hidden md:inline-flex"
              onClick={resetFilters}
            >
              <RotateCcw />
              Zurücksetzen
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={importing || !google?.configured || !google.placeId}
              title={googleHint}
              aria-label={`Google-Bewertungen importieren. ${googleHint}`}
              onClick={() => void importFromGoogle()}
            >
              <Download data-icon="inline-start" />
              <span className="hidden sm:inline">Google importieren</span>
            </Button>
          </>
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            Bewertungen
          </h1>
          <span className="hidden tabular-nums text-[11px] text-muted-foreground sm:inline">
            {filteredReviews.length} von {reviews.length}
          </span>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="animate-enter mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card">
          {loading ? (
            <div className="divide-y divide-border/70">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex gap-3.5 px-4 py-4 sm:px-5">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3.5 w-20" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <SummaryBand reviews={reviews} google={google} />
              {filteredReviews.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-muted-foreground">
                  <MessageSquareText className="size-5" />
                  <span className="text-sm">
                    Keine Bewertungen für die gewählten Filter gefunden.
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {filteredReviews.map((review) => (
                    <ReviewRow
                      key={review.id}
                      review={review}
                      saving={saving}
                      onReply={() => setReplyingId(review.id)}
                      onToggleHidden={() => toggleHidden(review)}
                      onDelete={() => removeReview(review)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {replyingReview && (
        <ReplyDialog
          key={replyingReview.id}
          review={replyingReview}
          open={replyingId !== null}
          saving={saving}
          onOpenChange={(open) => {
            if (!open) setReplyingId(null);
          }}
          onSave={(reply) => void saveReply(reply)}
        />
      )}
    </div>
  );
}

export default Bewertungen;
