/* ------------------------------------------------------------------ */
/* Buchung erfassen — single dialog for all booking types (incl. the   */
/* one-off Saldovortrag for balances taken over from old software).   */
/* The client only collects intent; Soll/Haben, VAT and numbering      */
/* are derived server-side by the booking engine.                      */
/*                                                                     */
/* Guard rails (soft, confirmable): dates in a past month or in the    */
/* future, and cash bookings that would push the Kasse below zero.     */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { GeldkontoBalance } from "@/lib/accounting-report-types";
import {
  PAYMENT_METHOD_LABELS,
  SALDOVORTRAG_DIRECTION_LABELS,
  TRANSACTION_TYPE_LABELS,
  type Account,
  type CreateTransactionInput,
  type PaymentMethod,
  type SaldovortragDirection,
  type StudentRef,
  type TransactionType,
} from "@/lib/accounting-types";
import {
  TRANSACTION_TYPE_HELP,
  TRANSACTION_TYPE_TITLES,
  accountLabel,
} from "@/lib/account-labels";
import { formatCents, parseEuroToCents, splitVat } from "@/lib/money";
import { useStudents, type StudentRecord } from "@/hooks/use-students";
import { accountingApi, dateWarnings, toIsoDate } from "./api";
import { StudentCombobox } from "./StudentCombobox";
import { FieldError, WarningConfirm } from "./WarningConfirm";

const TYPES: TransactionType[] = [
  "zahlung_guthaben",
  "direktzahlung",
  "guthaben_uebertragung",
  "transfer",
  "ausgabe",
  "saldovortrag",
];

const NEEDS_STUDENT: TransactionType[] = [
  "zahlung_guthaben",
  "direktzahlung",
  "guthaben_uebertragung",
  "saldovortrag",
];

/** Types that never touch a Geldkonto. */
const NO_GELDKONTO: TransactionType[] = ["guthaben_uebertragung", "saldovortrag"];

const NEEDS_PAYMENT_METHOD: TransactionType[] = [
  "zahlung_guthaben",
  "direktzahlung",
  "ausgabe",
];

const NEEDS_DESCRIPTION: TransactionType[] = [
  "direktzahlung",
  "guthaben_uebertragung",
  "ausgabe",
];

const CASH = "1600";
const BANK = "1800";

function studentRef(students: StudentRecord[], customerNo: string): StudentRef | null {
  const student = students.find((s) => s.customerNumber === customerNo);
  if (!student) return null;
  return {
    customerNo: student.customerNumber,
    name: `${student.firstName} ${student.lastName}`,
    address: student.address,
    contractNo: student.contractNumber,
    classes: student.classes,
  };
}

function AccountSelect({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Account[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue placeholder="Konto wählen" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((account) => (
            <SelectItem key={account.number} value={account.number}>
              {accountLabel(account)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

type Errors = Partial<Record<"amount" | "student" | "description" | "konto", string>>;

export function PaymentDialog({
  open,
  onClose,
  accounts,
  onCreated,
  defaultCustomerNo,
  defaultType,
  defaultDate,
  defaultAmountCents,
  defaultDescription,
  defaultHabenKonto,
  onSubmitOverride,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  /** printableId is set when the new transaction can yield a Quittung */
  onCreated: (printableId: number | null) => void;
  /** Preselect this student (e.g. on the Fahrschüler detail page). */
  defaultCustomerNo?: string;
  /** Prefill the transaction type (defaults to zahlung_guthaben). */
  defaultType?: TransactionType;
  /** Prefill the date (ISO YYYY-MM-DD). */
  defaultDate?: string;
  /** Prefill the amount in cents (converted to display string). */
  defaultAmountCents?: number;
  /** Prefill the description / Leistung field. */
  defaultDescription?: string;
  /** Prefill the Leistungskonto (habenKonto). */
  defaultHabenKonto?: string;
  /** When present, replaces the dialog's own API call with this function.
      All validation and field-building still runs; the built
      CreateTransactionInput is passed to this callback instead of POST
      /api/accounting/transactions. Other call-sites that do NOT pass this
      prop are completely unchanged. */
  onSubmitOverride?: (input: CreateTransactionInput) => Promise<void>;
}) {
  const { students } = useStudents();
  const [type, setType] = useState<TransactionType>(defaultType ?? "zahlung_guthaben");
  const [date, setDate] = useState(() => defaultDate ?? toIsoDate(new Date()));
  const [amount, setAmount] = useState(() =>
    defaultAmountCents != null
      ? (defaultAmountCents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  // No preselection unless the caller pins a student (detail page).
  const [customerNo, setCustomerNo] = useState(defaultCustomerNo ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bar");
  // SKR 04 defaults: 1600 Kasse, 4400 Erlöse 19 %, 6530 Kfz-Kosten, 1800 Bank
  const [geldkonto, setGeldkonto] = useState(CASH);
  const [habenKonto, setHabenKonto] = useState(defaultHabenKonto ?? "4400");
  const [aufwandKonto, setAufwandKonto] = useState("6530");
  const [toKonto, setToKonto] = useState(BANK);
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [direction, setDirection] = useState<SaldovortragDirection>("guthaben");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmed, setConfirmed] = useState(false);
  const [balances, setBalances] = useState<GeldkontoBalance[] | null>(null);

  // Re-pin the preselected student and other prefill props whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setCustomerNo(defaultCustomerNo ?? "");
      if (defaultType) setType(defaultType);
      if (defaultDate) setDate(defaultDate);
      if (defaultAmountCents != null)
        setAmount((defaultAmountCents / 100).toFixed(2).replace(".", ","));
      if (defaultDescription != null) setDescription(defaultDescription);
      if (defaultHabenKonto) setHabenKonto(defaultHabenKonto);
      setErrors({});
      setConfirmed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Current Kasse/Bank balances for the negative-cash check.
  useEffect(() => {
    if (!open || onSubmitOverride) return;
    let cancelled = false;
    accountingApi
      .balances()
      .then((list) => {
        if (!cancelled) setBalances(list);
      })
      .catch(() => {
        if (!cancelled) setBalances(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onSubmitOverride]);

  // Only one Saldovortrag per student: check up front instead of letting
  // the server answer 400 (which also shows up as a console error).
  const [existingSaldovortrag, setExistingSaldovortrag] = useState<string | null>(null);
  useEffect(() => {
    setExistingSaldovortrag(null);
    if (!open || type !== "saldovortrag" || !customerNo || onSubmitOverride) return;
    let cancelled = false;
    accountingApi
      .ledger(`?customerNo=${encodeURIComponent(customerNo)}`)
      .then((ledger) => {
        if (cancelled) return;
        const row = ledger.rows.find(
          (r) => r.type === "saldovortrag" && !r.storniert && !r.isStorno,
        );
        setExistingSaldovortrag(
          row
            ? `Für diese/n Fahrschüler/in ist bereits ein Saldovortrag gebucht${
                row.belegNr ? ` (Beleg ${row.belegNr})` : ""
              } — bitte zuerst stornieren.`
            : null,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, type, customerNo, onSubmitOverride]);

  const active = (kinds: Account["kind"][]) =>
    accounts.filter((a) => a.active && kinds.includes(a.kind));
  const geldkonten = active(["geldkonto"]);
  const leistungskonten = active(["erloes", "durchlaufend"]);
  const aufwandkonten = active(["aufwand", "privat"]);

  const amountCents = parseEuroToCents(amount);

  // Account whose VAT setting governs this booking (mirrors the engine).
  const vatAccount = useMemo(() => {
    if (type === "zahlung_guthaben") return accounts.find((a) => a.kind === "anzahlung");
    if (type === "direktzahlung" || type === "guthaben_uebertragung") {
      return accounts.find((a) => a.number === habenKonto);
    }
    if (type === "ausgabe") return accounts.find((a) => a.number === aufwandKonto);
    return undefined;
  }, [type, habenKonto, aufwandKonto, accounts]);

  const vatPreview =
    amountCents != null && vatAccount?.vatRate != null
      ? splitVat(amountCents, vatAccount.vatRate)
      : null;

  /* Cash goes to the Kasse, everything else to the Bank (the engine
     refuses the mismatch anyway). */
  const changePaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method === "bar") setGeldkonto(CASH);
    else if (geldkonto === CASH) setGeldkonto(BANK);
  };
  const changeGeldkonto = (konto: string) => {
    setGeldkonto(konto);
    if (!NEEDS_PAYMENT_METHOD.includes(type)) return;
    if (konto === CASH) setPaymentMethod("bar");
    else if (paymentMethod === "bar") setPaymentMethod("ueberweisung");
  };

  // Money leaving the Kasse: an Ausgabe or a transfer out of 1600.
  const cashOut =
    geldkonto === CASH && (type === "ausgabe" || type === "transfer")
      ? amountCents
      : null;
  const cashBalance = balances?.find((b) => b.number === CASH)?.balanceCents ?? null;
  const warnings = [
    ...dateWarnings(date),
    ...(cashOut != null && cashBalance != null && cashBalance - cashOut < 0
      ? [
          `Die Kasse hat derzeit ${formatCents(cashBalance)} € — nach dieser Buchung stünde sie bei ${formatCents(
            cashBalance - cashOut,
          )} €. Eine Kasse kann nicht negativ sein; bitte Betrag und Konto prüfen (ggf. Bank wählen).`,
        ]
      : []),
  ];

  const reset = () => {
    setAmount("");
    setDescription(defaultDescription ?? "");
    setDate(defaultDate ?? toIsoDate(new Date()));
    setCustomerNo(defaultCustomerNo ?? "");
    setErrors({});
    setConfirmed(false);
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (amount.trim() === "") next.amount = "Bitte einen Betrag eingeben.";
    else if (amountCents == null || amountCents <= 0) {
      next.amount = "Ungültiger Betrag — bitte z. B. 409,83 eingeben.";
    }
    if (NEEDS_STUDENT.includes(type) && !studentRef(students, customerNo)) {
      next.student = "Bitte eine/n Fahrschüler/in auswählen.";
    } else if (type === "saldovortrag" && existingSaldovortrag) {
      next.student = existingSaldovortrag;
    }
    if (NEEDS_DESCRIPTION.includes(type) && !description.trim()) {
      next.description =
        type === "ausgabe"
          ? "Bitte beschreiben, wofür das Geld ausgegeben wurde."
          : "Bitte die Leistung angeben.";
    }
    if (type === "transfer" && geldkonto === toKonto) {
      next.konto = "Von- und Nach-Konto müssen verschieden sein.";
    }
    return next;
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || amountCents == null) return;
    if (warnings.length > 0 && !confirmed) return;
    const student = NEEDS_STUDENT.includes(type)
      ? studentRef(students, customerNo)
      : null;

    let input: CreateTransactionInput;
    switch (type) {
      case "zahlung_guthaben":
        input = { type, date, amountCents, geldkonto, paymentMethod, student: student! };
        break;
      case "direktzahlung":
        input = {
          type,
          date,
          amountCents,
          geldkonto,
          habenKonto,
          paymentMethod,
          student: student!,
          description: description.trim(),
        };
        break;
      case "guthaben_uebertragung":
        input = {
          type,
          date,
          amountCents,
          habenKonto,
          student: student!,
          description: `FS ${student!.name} - ${student!.classes}, ${description.trim()}`,
        };
        break;
      case "transfer":
        input = {
          type,
          date,
          amountCents,
          fromKonto: geldkonto,
          toKonto,
          description: description.trim() || undefined,
        };
        break;
      case "ausgabe":
        input = {
          type,
          date,
          amountCents,
          geldkonto,
          aufwandKonto,
          paymentMethod,
          description: description.trim(),
        };
        break;
      case "saldovortrag":
        input = { type, date, amountCents, direction, student: student! };
        break;
    }

    setSubmitting(true);
    try {
      if (onSubmitOverride) {
        // Caller takes over the submit (e.g. StundenTab's bill endpoint).
        await onSubmitOverride(input);
        toast.success("Buchung erfasst.");
        reset();
        onClose();
        onCreated(null);
      } else {
        const created = await accountingApi.createTransaction(input);
        const printable = type === "zahlung_guthaben" || type === "direktzahlung";
        toast.success(
          created.belegNr ? `Beleg ${created.belegNr} gebucht.` : "Buchung erfasst.",
          printable
            ? {
                action: {
                  label: "Quittung drucken",
                  onClick: () => onCreated(created.id),
                },
              }
            : undefined,
        );
        reset();
        onClose();
        onCreated(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Buchung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = (key: keyof Errors) =>
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{TRANSACTION_TYPE_TITLES[type]}</DialogTitle>
          <DialogDescription className="text-pretty">
            {TRANSACTION_TYPE_HELP[type]}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tx-type">Art der Buchung</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as TransactionType);
                setErrors({});
                if (v === "transfer" && geldkonto === toKonto) {
                  setToKonto(geldkonto === CASH ? BANK : CASH);
                }
              }}
            >
              <SelectTrigger id="tx-type" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRANSACTION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="tx-date">Datum</Label>
            <Input
              id="tx-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setConfirmed(false);
              }}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="tx-amount">Betrag (brutto), EUR</Label>
            <Input
              id="tx-amount"
              inputMode="decimal"
              placeholder="z. B. 409,83"
              value={amount}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? "tx-amount-error" : undefined}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirmed(false);
                clearError("amount");
              }}
            />
            <FieldError id="tx-amount-error" message={errors.amount} />
          </div>

          {NEEDS_STUDENT.includes(type) && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tx-student">Fahrschüler/in</Label>
              <StudentCombobox
                id="tx-student"
                students={students}
                value={customerNo}
                invalid={!!errors.student}
                onChange={(value) => {
                  setCustomerNo(value);
                  clearError("student");
                }}
              />
              <FieldError
                id="tx-student-error"
                message={
                  errors.student ??
                  (type === "saldovortrag" ? existingSaldovortrag : null)
                }
              />
            </div>
          )}

          {type === "saldovortrag" && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label>Saldo aus dem bisherigen Programm</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={direction}
                onValueChange={(v) => v && setDirection(v as SaldovortragDirection)}
                className="flex-wrap justify-start"
              >
                {(
                  Object.keys(SALDOVORTRAG_DIRECTION_LABELS) as SaldovortragDirection[]
                ).map((d) => (
                  <ToggleGroupItem key={d} value={d} className="px-3">
                    {SALDOVORTRAG_DIRECTION_LABELS[d]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-pretty text-muted-foreground">
                {direction === "guthaben"
                  ? "Das Guthaben steht danach auf dem Ausbildungskonto zur Verfügung und wird mit künftigen Leistungen verrechnet."
                  : "Der offene Betrag erscheint unter Offene Posten und kann angemahnt werden; Zahlungen gleichen ihn zuerst aus."}{" "}
                Ohne Umsatzsteuer, nur einmal je Fahrschüler/in (außer nach Storno). Bitte
                mit der Steuerberatung abstimmen.
                <span className="block pt-1 text-[11px]">
                  Buchung:{" "}
                  {direction === "guthaben"
                    ? "9000 Saldenvorträge an 3272 Anzahlungen"
                    : "3272 Anzahlungen an 9000 Saldenvorträge"}
                </span>
              </p>
            </div>
          )}

          {!NO_GELDKONTO.includes(type) && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tx-geldkonto">
                {type === "transfer" ? "Von Konto" : "Geldkonto"}
              </Label>
              <AccountSelect
                id="tx-geldkonto"
                value={geldkonto}
                onChange={(value) => {
                  changeGeldkonto(value);
                  setConfirmed(false);
                  clearError("konto");
                }}
                options={geldkonten}
              />
            </div>
          )}

          {type === "transfer" && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tx-tokonto">Nach Konto</Label>
              <AccountSelect
                id="tx-tokonto"
                value={toKonto}
                onChange={(value) => {
                  setToKonto(value);
                  clearError("konto");
                }}
                options={geldkonten}
              />
              <FieldError id="tx-konto-error" message={errors.konto} />
            </div>
          )}

          {(type === "direktzahlung" || type === "guthaben_uebertragung") && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tx-haben">Art der Leistung</Label>
              <AccountSelect
                id="tx-haben"
                value={habenKonto}
                onChange={setHabenKonto}
                options={leistungskonten}
              />
            </div>
          )}

          {type === "ausgabe" && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tx-aufwand">Kategorie</Label>
              <AccountSelect
                id="tx-aufwand"
                value={aufwandKonto}
                onChange={setAufwandKonto}
                options={aufwandkonten}
              />
            </div>
          )}

          {NEEDS_PAYMENT_METHOD.includes(type) && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label>Zahlungsart</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={paymentMethod}
                onValueChange={(v) => v && changePaymentMethod(v as PaymentMethod)}
                className="flex-wrap justify-start"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <ToggleGroupItem key={m} value={m} className="px-3">
                    {PAYMENT_METHOD_LABELS[m]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {NEEDS_DESCRIPTION.includes(type) && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tx-desc">
                {type === "ausgabe" ? "Beschreibung" : "Leistung"}
              </Label>
              <Input
                id="tx-desc"
                placeholder={
                  type === "ausgabe"
                    ? "z. B. Tankrechnung Fahrschulwagen"
                    : "z. B. Fahrstunde 90 Min."
                }
                value={description}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={errors.description ? "tx-desc-error" : undefined}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError("description");
                }}
              />
              <FieldError id="tx-desc-error" message={errors.description} />
            </div>
          )}

          {type === "transfer" && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tx-desc-transfer">Beschreibung (optional)</Label>
              <Input
                id="tx-desc-transfer"
                placeholder="z. B. Bareinzahlung auf Bankkonto"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}

          {vatPreview && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Netto{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCents(vatPreview.netCents)}
              </span>
              {" · "}USt {vatPreview.rate} %{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCents(vatPreview.vatCents)}
              </span>
              {" · "}Brutto{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCents(vatPreview.grossCents)}
              </span>
            </p>
          )}
          {vatAccount?.kind === "durchlaufend" && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Durchlaufender Posten (§ 10 Abs. 1 UStG) — keine Umsatzsteuer.
            </p>
          )}

          <div className="sm:col-span-2">
            <WarningConfirm
              warnings={warnings}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              label="Hinweise geprüft — trotzdem buchen"
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={submitting || (warnings.length > 0 && !confirmed)}
            >
              Buchen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
