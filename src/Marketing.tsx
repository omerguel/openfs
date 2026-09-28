import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  campaignTrackingUrl,
  createCampaign,
  deleteCampaign,
  updateCampaign,
  useCampaigns,
  type Campaign,
  type CampaignChannel,
  type CampaignInput,
  type CampaignStatus,
} from "@/hooks/use-campaigns";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents, formatEuro, parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { panelCardClass, panelHeaderClass } from "./components/Panel.tsx";

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                  */
/* ------------------------------------------------------------------ */

const CHANNELS: CampaignChannel[] = [
  "Google Ads",
  "Instagram",
  "Facebook",
  "TikTok",
  "Flyer",
  "Empfehlung",
  "Webseite",
];

const statusLabels: Record<CampaignStatus, string> = {
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  beendet: "Beendet",
};

const statusDot: Record<CampaignStatus, string> = {
  aktiv: "bg-green-500",
  pausiert: "bg-amber-500",
  beendet: "bg-muted-foreground/50",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal",
        status === "beendet" && "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", statusDot[status])} />
      {statusLabels[status]}
    </Badge>
  );
}

/** "2026-03-01" → "01.03.2026" */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function budgetPercent(campaign: Campaign): number {
  if (campaign.budgetCents <= 0) return 0;
  return Math.min(100, Math.round((campaign.spentCents / campaign.budgetCents) * 100));
}

async function copyTrackingLink(campaign: Campaign) {
  try {
    await navigator.clipboard.writeText(campaignTrackingUrl(campaign.trackingCode));
    toast.success("Tracking-Link kopiert.");
  } catch {
    toast.error("Kopieren nicht möglich.");
  }
}

function costPerLeadCents(spentCents: number, leads: number): number | null {
  if (leads <= 0) return null;
  return Math.round(spentCents / leads);
}

/* ------------------------------------------------------------------ */
/* Header stats                                                         */
/* ------------------------------------------------------------------ */

type CampaignTotals = {
  totalBudget: number;
  totalSpent: number;
  totalLeads: number;
  totalSignups: number;
  spentPct: number;
  conversion: number;
  costPerLead: number | null;
};

function getCampaignTotals(campaigns: Campaign[]): CampaignTotals {
  const totalBudget = campaigns.reduce((s, c) => s + c.budgetCents, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.spentCents, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
  const totalSignups = campaigns.reduce((s, c) => s + c.signups, 0);
  const spentPct =
    totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const conversion = totalLeads > 0 ? Math.round((totalSignups / totalLeads) * 100) : 0;
  const costPerLead = costPerLeadCents(totalSpent, totalLeads);

  return {
    totalBudget,
    totalSpent,
    totalLeads,
    totalSignups,
    spentPct,
    conversion,
    costPerLead,
  };
}

function HeaderStats({ totals }: { totals: CampaignTotals }) {
  const stats = [
    {
      label: "Budget",
      value: formatEuro(totals.totalBudget),
      hint: `${formatEuro(totals.totalSpent)} genutzt`,
    },
    {
      label: "Leads",
      value: String(totals.totalLeads),
      hint: "gesamt",
    },
    {
      label: "Anmeldungen",
      value: String(totals.totalSignups),
      hint: `${totals.conversion} % Quote`,
    },
    {
      label: "Kosten pro Lead",
      value: totals.costPerLead === null ? "–" : formatEuro(totals.costPerLead),
      hint: `${totals.spentPct} % Budget`,
    },
  ];

  return (
    <dl className="hidden items-center divide-x divide-border/70 2xl:flex">
      {stats.map(({ label, value, hint }) => (
        <div
          key={label}
          className="flex min-w-0 flex-col gap-1 px-4 first:pl-2 last:pr-2"
        >
          <dt className="text-[11px] font-medium leading-none whitespace-nowrap text-muted-foreground">
            {label}
          </dt>
          <dd className="flex items-baseline gap-1.5 leading-none whitespace-nowrap">
            <span className="text-sm font-semibold tabular-nums">{value}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Chart — leads & signups per channel                                  */
/* ------------------------------------------------------------------ */

const chartConfig = {
  leads: { label: "Leads", color: "var(--chart-1)" },
  signups: { label: "Anmeldungen", color: "var(--chart-2)" },
} satisfies ChartConfig;

type ChannelPerformance = {
  channel: CampaignChannel;
  campaigns: number;
  leads: number;
  signups: number;
  spentCents: number;
  conversion: number;
  costPerLead: number | null;
};

function getChannelPerformance(campaigns: Campaign[]): ChannelPerformance[] {
  return CHANNELS.map((channel) => {
    const inChannel = campaigns.filter((campaign) => campaign.channel === channel);
    const leads = inChannel.reduce((sum, campaign) => sum + campaign.leads, 0);
    const signups = inChannel.reduce((sum, campaign) => sum + campaign.signups, 0);
    const spentCents = inChannel.reduce((sum, campaign) => sum + campaign.spentCents, 0);

    return {
      channel,
      campaigns: inChannel.length,
      leads,
      signups,
      spentCents,
      conversion: leads > 0 ? Math.round((signups / leads) * 100) : 0,
      costPerLead: costPerLeadCents(spentCents, leads),
    };
  }).filter(
    (channel) => channel.leads > 0 || channel.signups > 0 || channel.campaigns > 0,
  );
}

const ChannelChart = memo(function ChannelChart({
  campaigns,
}: {
  campaigns: Campaign[];
}) {
  const chartData = useMemo(() => getChannelPerformance(campaigns), [campaigns]);
  const rankedChannels = useMemo(
    () =>
      chartData
        .toSorted((left, right) =>
          right.leads === left.leads
            ? right.signups - left.signups
            : right.leads - left.leads,
        )
        .slice(0, 3),
    [chartData],
  );
  const totals = getCampaignTotals(campaigns);
  const maxLeads = Math.max(...rankedChannels.map((channel) => channel.leads), 1);

  return (
    <Card className={cn(panelCardClass, "gap-0")}>
      <CardHeader className={cn(panelHeaderClass, "gap-2")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">Kanalperformance</CardTitle>
            <CardDescription>
              <span className="tabular-nums">{totals.totalLeads}</span> Leads ·{" "}
              <span className="tabular-nums">{totals.totalSignups}</span> Anmeldungen
            </CardDescription>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-chart-1" />
              Leads
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-chart-2" />
              Anmeldungen
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {chartData.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-1 text-center">
            <Megaphone className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Noch keine Leads erfasst
            </span>
          </div>
        ) : (
          <div className="grid min-h-[300px] xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 p-4 2xl:p-5">
              <ChartContainer config={chartConfig} className="h-[280px] w-full">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, left: 0, right: 0, bottom: 0 }}
                  barCategoryGap="28%"
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="channel"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="leads"
                    fill="var(--color-leads)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={46}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="signups"
                    fill="var(--color-signups)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={46}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            </div>

            <div className="border-t border-border/70 bg-muted/15 p-4 xl:border-t-0 xl:border-l">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">Stärkste Kanäle</h3>
                <span className="text-[11px] font-medium text-muted-foreground">
                  nach Leads
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {rankedChannels.map((channel) => (
                  <div
                    key={channel.channel}
                    className="rounded-md border border-border/70 bg-background/70 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {channel.channel}
                        </div>
                        <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {channel.signups} Anmeldungen · {channel.conversion} % Quote
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium tabular-nums">
                          {channel.leads}
                        </div>
                        <div className="text-[11px] text-muted-foreground">Leads</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-3">
                      <Progress
                        value={Math.round((channel.leads / maxLeads) * 100)}
                        className="h-1"
                      />
                      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                        {channel.costPerLead === null
                          ? "–"
                          : formatEuro(channel.costPerLead)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

/* ------------------------------------------------------------------ */
/* Create/Edit dialog                                                   */
/* ------------------------------------------------------------------ */

type CampaignDraft = {
  name: string;
  channel: CampaignChannel;
  trackingCode: string;
  budget: string;
  spent: string;
  leads: string;
  signups: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  notes: string;
};

function campaignToDraft(campaign: Campaign | null): CampaignDraft {
  if (!campaign) {
    return {
      name: "",
      channel: "Google Ads",
      trackingCode: "",
      budget: "",
      spent: "",
      leads: "0",
      signups: "0",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      status: "aktiv",
      notes: "",
    };
  }
  return {
    name: campaign.name,
    channel: campaign.channel,
    trackingCode: campaign.trackingCode,
    budget: formatCents(campaign.budgetCents),
    spent: formatCents(campaign.spentCents),
    leads: String(campaign.manualLeads),
    signups: String(campaign.manualSignups),
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    status: campaign.status,
    notes: campaign.notes,
  };
}

/** Parse the draft into an API payload; throws Error with a German
 *  message on invalid money/number inputs. */
function draftToPayload(draft: CampaignDraft): Partial<CampaignInput> {
  const money = (value: string, label: string): number => {
    if (!value.trim()) return 0;
    const cents = parseEuroToCents(value);
    if (cents === null) {
      throw new Error(`${label}: Bitte einen Betrag wie 1.250,00 eingeben.`);
    }
    return cents;
  };
  const count = (value: string, label: string): number => {
    if (!value.trim()) return 0;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${label}: Bitte eine ganze Zahl eingeben.`);
    }
    return n;
  };

  return {
    name: draft.name,
    channel: draft.channel,
    trackingCode: draft.trackingCode.trim(),
    budgetCents: money(draft.budget, "Budget"),
    spentCents: money(draft.spent, "Ausgegeben"),
    manualLeads: count(draft.leads, "Leads"),
    manualSignups: count(draft.signups, "Anmeldungen"),
    startDate: draft.startDate,
    endDate: draft.endDate,
    status: draft.status,
    notes: draft.notes,
  };
}

function CampaignEditDialog({
  campaign,
  open,
  onOpenChange,
  onSave,
  mode,
}: {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Partial<CampaignInput>) => Promise<void>;
  mode: "create" | "edit";
}) {
  const [draft, setDraft] = useState<CampaignDraft | null>(null);

  useEffect(() => {
    setDraft(open ? campaignToDraft(campaign) : null);
  }, [open, campaign?.id]);

  function update<Key extends keyof CampaignDraft>(key: Key, value: CampaignDraft[Key]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setDraft(null);
    }
  }

  if (!draft) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Kampagne erstellen" : "Kampagne bearbeiten"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Neue Marketingkampagne anlegen."
              : "Budget, Laufzeit und Ergebnisse aktualisieren."}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="campaign-name">Name</FieldLabel>
            <Input
              id="campaign-name"
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-channel">Kanal</FieldLabel>
            <Select
              value={draft.channel}
              onValueChange={(value) => update("channel", value as CampaignChannel)}
            >
              <SelectTrigger id="campaign-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-status">Status</FieldLabel>
            <Select
              value={draft.status}
              onValueChange={(value) => update("status", value as CampaignStatus)}
            >
              <SelectTrigger id="campaign-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="aktiv">Aktiv</SelectItem>
                  <SelectItem value="pausiert">Pausiert</SelectItem>
                  <SelectItem value="beendet">Beendet</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="campaign-code">Tracking-Code</FieldLabel>
            <Input
              id="campaign-code"
              className="font-mono"
              placeholder="wird aus dem Namen erzeugt"
              spellCheck={false}
              value={draft.trackingCode}
              onChange={(event) => update("trackingCode", event.target.value)}
            />
            <FieldDescription>
              Anfragen über{" "}
              <span className="font-mono">
                /anfrage?kampagne={draft.trackingCode.trim() || "…"}
              </span>{" "}
              zählen automatisch als Leads dieser Kampagne; wird die Person als
              Fahrschüler/in angelegt, als Anmeldung.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-budget">Budget (EUR)</FieldLabel>
            <Input
              id="campaign-budget"
              inputMode="decimal"
              placeholder="1.250,00"
              value={draft.budget}
              onChange={(event) => update("budget", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-spent">Ausgegeben (EUR, manuell)</FieldLabel>
            <Input
              id="campaign-spent"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.spent}
              onChange={(event) => update("spent", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-leads">Leads offline (manuell)</FieldLabel>
            <Input
              id="campaign-leads"
              inputMode="numeric"
              value={draft.leads}
              onChange={(event) => update("leads", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-signups">
              Anmeldungen offline (manuell)
            </FieldLabel>
            <Input
              id="campaign-signups"
              inputMode="numeric"
              value={draft.signups}
              onChange={(event) => update("signups", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-start">Startdatum</FieldLabel>
            <Input
              id="campaign-start"
              type="date"
              value={draft.startDate}
              onChange={(event) => update("startDate", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-end">Enddatum (leer = laufend)</FieldLabel>
            <Input
              id="campaign-end"
              type="date"
              value={draft.endDate}
              onChange={(event) => update("endDate", event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="campaign-notes">Notizen</FieldLabel>
            <Input
              id="campaign-notes"
              value={draft.notes}
              onChange={(event) => update("notes", event.target.value)}
            />
          </Field>
          <p className="text-xs text-pretty text-muted-foreground sm:col-span-2">
            Offline-Leads (Flyer, Telefon, Empfehlung) werden zu den Anfragen über den
            Tracking-Link addiert. Werbeausgaben bitte von Hand eintragen: Die Google-Ads-
            und Meta-Schnittstellen verlangen einen Entwickler-Token bzw. eine App-Prüfung
            und sind deshalb nicht angebunden.
          </p>
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={async () => {
              try {
                await onSave(draftToPayload(draft));
                handleOpenChange(false);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Kampagne konnte nicht gespeichert werden.",
                );
              }
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Campaign table                                                       */
/* ------------------------------------------------------------------ */

type CampaignSortKey =
  | "name"
  | "channel"
  | "status"
  | "startDate"
  | "budget"
  | "result"
  | "costPerLead";
type SortDirection = "asc" | "desc";

const campaignSortLabels: Record<CampaignSortKey, string> = {
  name: "Kampagne",
  channel: "Kanal",
  status: "Status",
  startDate: "Laufzeit",
  budget: "Budget",
  result: "Ergebnis",
  costPerLead: "Kosten/Lead",
};

const statusSortRank: Record<CampaignStatus, number> = {
  aktiv: 0,
  pausiert: 1,
  beendet: 2,
};

function getCampaignSortValue(campaign: Campaign, sortKey: CampaignSortKey) {
  if (sortKey === "channel") return CHANNELS.indexOf(campaign.channel);
  if (sortKey === "status") return statusSortRank[campaign.status];
  if (sortKey === "startDate") return Date.parse(campaign.startDate);
  if (sortKey === "budget") return campaign.budgetCents;
  if (sortKey === "result") return campaign.leads;
  if (sortKey === "costPerLead") {
    return (
      costPerLeadCents(campaign.spentCents, campaign.leads) ?? Number.POSITIVE_INFINITY
    );
  }

  return campaign.name;
}

function getCampaignTieBreakValue(campaign: Campaign, sortKey: CampaignSortKey) {
  if (sortKey === "budget") return campaign.spentCents;
  if (sortKey === "result") return campaign.signups;
  if (sortKey === "costPerLead") return campaign.leads;
  if (sortKey === "startDate") {
    return campaign.endDate ? Date.parse(campaign.endDate) : Number.POSITIVE_INFINITY;
  }

  return campaign.name;
}

function compareSortValues(left: number | string, right: number | string) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "de", { sensitivity: "base" });
}

function SortableCampaignHead({
  sortKey,
  activeKey,
  direction,
  className,
  align = "left",
  onSort,
}: {
  sortKey: CampaignSortKey;
  activeKey: CampaignSortKey;
  direction: SortDirection;
  className?: string;
  align?: "left" | "right";
  onSort: (key: CampaignSortKey) => void;
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
        className={cn("h-7 px-2 text-xs", align === "left" ? "-ml-2" : "-mr-2")}
        onClick={() => onSort(sortKey)}
      >
        {campaignSortLabels[sortKey]}
        <Icon data-icon="inline-end" />
      </Button>
    </TableHead>
  );
}

function CampaignsTable({
  campaigns,
  loading,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  campaigns: Campaign[];
  loading: boolean;
  onEdit: (campaign: Campaign) => void;
  onToggleStatus: (campaign: Campaign) => void;
  onDelete: (campaign: Campaign) => void;
}) {
  const [sortKey, setSortKey] = useState<CampaignSortKey>("startDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedCampaigns = useMemo(() => {
    return campaigns.toSorted((left, right) => {
      const leftValue = getCampaignSortValue(left, sortKey);
      const rightValue = getCampaignSortValue(right, sortKey);
      const primary = compareSortValues(leftValue, rightValue);
      const tieBreak =
        primary === 0
          ? compareSortValues(
              getCampaignTieBreakValue(left, sortKey),
              getCampaignTieBreakValue(right, sortKey),
            )
          : primary;

      if (tieBreak !== 0) {
        return sortDirection === "asc" ? tieBreak : -tieBreak;
      }

      return left.id - right.id;
    });
  }, [campaigns, sortDirection, sortKey]);

  const handleSort = (key: CampaignSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(
      key === "name" || key === "channel" || key === "status" ? "asc" : "desc",
    );
  };

  return (
    <Card className={cn(panelCardClass, "gap-0")}>
      <CardHeader className={panelHeaderClass}>
        <CardTitle className="text-sm font-medium">Kampagnen</CardTitle>
        <CardDescription>
          <span className="tabular-nums">{campaigns.length}</span>{" "}
          {campaigns.length === 1 ? "Kampagne" : "Kampagnen"}
        </CardDescription>
        <p className="text-xs text-pretty text-muted-foreground">
          Leads = Terminanfragen über den Tracking-Link der Kampagne plus von Hand
          erfasste Offline-Leads (Flyer, Telefon, Empfehlung). Anmeldungen = daraus als
          Fahrschüler angelegte Personen plus von Hand erfasste Anmeldungen. Kampagnen mit
          überschrittenem Enddatum gelten automatisch als beendet.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Lade Kampagnen…</div>
        ) : campaigns.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-1 px-4 py-10 text-center">
            <Megaphone className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Noch keine Kampagnen angelegt
            </span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableCampaignHead
                  sortKey="name"
                  activeKey={sortKey}
                  direction={sortDirection}
                  className="min-w-[320px] pl-4"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="channel"
                  activeKey={sortKey}
                  direction={sortDirection}
                  className="w-32"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="status"
                  activeKey={sortKey}
                  direction={sortDirection}
                  className="w-32"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="startDate"
                  activeKey={sortKey}
                  direction={sortDirection}
                  className="w-40"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="budget"
                  activeKey={sortKey}
                  direction={sortDirection}
                  className="w-44"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="result"
                  activeKey={sortKey}
                  direction={sortDirection}
                  align="right"
                  className="w-40 text-right"
                  onSort={handleSort}
                />
                <SortableCampaignHead
                  sortKey="costPerLead"
                  activeKey={sortKey}
                  direction={sortDirection}
                  align="right"
                  className="w-36 text-right"
                  onSort={handleSort}
                />
                <TableHead className="w-28 pr-4 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCampaigns.map((campaign) => {
                const pct = budgetPercent(campaign);
                const cpl = costPerLeadCents(campaign.spentCents, campaign.leads);
                const period = `${formatDate(campaign.startDate)} – ${
                  campaign.endDate ? formatDate(campaign.endDate) : "laufend"
                }`;

                return (
                  <TableRow key={campaign.id} className="h-[58px]">
                    <TableCell className="pl-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium">{campaign.name}</span>
                        {campaign.notes && (
                          <span className="truncate text-xs text-muted-foreground">
                            {campaign.notes}
                          </span>
                        )}
                        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate font-mono">
                            /anfrage?kampagne={campaign.trackingCode}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Tracking-Link von ${campaign.name} kopieren`}
                            title="Tracking-Link kopieren"
                            onClick={() => void copyTrackingLink(campaign)}
                          >
                            <Copy />
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {campaign.channel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusBadge status={campaign.status} />
                        {campaign.endedByDate && (
                          <span className="text-[11px] text-muted-foreground">
                            Enddatum erreicht
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {period}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-36 flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="tabular-nums text-muted-foreground">
                            {formatEuro(campaign.spentCents)}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatEuro(campaign.budgetCents)}
                          </span>
                        </div>
                        <Progress value={pct} className="h-1" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex flex-col items-end gap-0.5 text-right tabular-nums"
                        title={`Leads: ${campaign.trackedLeads} Terminanfragen über den Tracking-Link + ${campaign.manualLeads} von Hand erfasst. Anmeldungen: ${campaign.trackedSignups} daraus angelegte Fahrschüler + ${campaign.manualSignups} von Hand erfasst.`}
                      >
                        <span className="text-sm">
                          {campaign.leads} {campaign.leads === 1 ? "Lead" : "Leads"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {campaign.signups}{" "}
                          {campaign.signups === 1 ? "Anmeldung" : "Anmeldungen"}
                        </span>
                        {campaign.trackedLeads > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {campaign.trackedLeads} per Link · {campaign.manualLeads}{" "}
                            manuell
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {cpl === null ? "–" : formatEuro(cpl)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1">
                        {campaign.status !== "beendet" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={
                              campaign.status === "aktiv"
                                ? `${campaign.name} pausieren`
                                : `${campaign.name} fortsetzen`
                            }
                            onClick={() => onToggleStatus(campaign)}
                          >
                            {campaign.status === "aktiv" ? <Pause /> : <Play />}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${campaign.name} bearbeiten`}
                          onClick={() => onEdit(campaign)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label={`${campaign.name} löschen`}
                          onClick={() => onDelete(campaign)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export function Marketing() {
  const { campaigns, loading, refresh } = useCampaigns();
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null);
  const totals = useMemo(() => getCampaignTotals(campaigns), [campaigns]);

  const editingMode: "create" | "edit" = isCreateOpen ? "create" : "edit";
  const editingCampaign = isCreateOpen
    ? null
    : (campaigns.find((campaign) => campaign.id === editingCampaignId) ?? null);
  const isDialogOpen = isCreateOpen || editingCampaign !== null;

  async function toggleStatus(campaign: Campaign) {
    const nextStatus: CampaignStatus = campaign.status === "aktiv" ? "pausiert" : "aktiv";
    try {
      await updateCampaign(campaign.id, { status: nextStatus });
      await refresh();
      toast.success(
        nextStatus === "pausiert" ? "Kampagne pausiert." : "Kampagne fortgesetzt.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Status konnte nicht geändert werden.",
      );
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteCampaign(pendingDelete.id);
      await refresh();
      toast.success("Kampagne gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      if (editingCampaignId === pendingDelete.id) {
        setEditingCampaignId(null);
      }
      setPendingDelete(null);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        center={<HeaderStats totals={totals} />}
        end={
          <Button
            type="button"
            size="sm"
            aria-label="Kampagne erstellen"
            onClick={() => {
              setEditingCampaignId(null);
              setIsCreateOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            <span className="hidden sm:inline">Kampagne erstellen</span>
          </Button>
        }
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            Marketing
          </h1>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {campaigns.length} {campaigns.length === 1 ? "Kampagne" : "Kampagnen"}
          </span>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="stagger-in mx-auto flex w-full max-w-[1800px] flex-col gap-4 2xl:gap-5">
          <ChannelChart campaigns={campaigns} />
          <CampaignsTable
            campaigns={campaigns}
            loading={loading}
            onEdit={(campaign) => setEditingCampaignId(campaign.id)}
            onToggleStatus={(campaign) => void toggleStatus(campaign)}
            onDelete={setPendingDelete}
          />
        </div>
      </div>

      <CampaignEditDialog
        campaign={editingCampaign}
        mode={editingMode}
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCampaignId(null);
            setIsCreateOpen(false);
          }
        }}
        onSave={async (payload) => {
          if (editingMode === "create") {
            await createCampaign(payload);
            toast.success("Kampagne erstellt.");
          } else if (editingCampaignId !== null) {
            await updateCampaign(editingCampaignId, payload);
            toast.success("Kampagne aktualisiert.");
          } else {
            return;
          }
          await refresh();
          setEditingCampaignId(null);
          setIsCreateOpen(false);
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kampagne löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `„${pendingDelete.name}“ (${pendingDelete.channel}) wird endgültig gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default Marketing;
