/* ------------------------------------------------------------------ */
/* Erlöskonto picker — human label in the trigger, the SKR 04 account  */
/* number as muted secondary text in the list.                         */
/* ------------------------------------------------------------------ */

import { REVENUE_ACCOUNT_OPTIONS, revenueAccountOption } from "@/lib/revenue-accounts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function AccountSelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** Account number; "" / null = default Erlöskonto 4400. */
  value: string | null;
  onChange: (account: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const current = revenueAccountOption(value);
  const account = current?.account ?? value ?? "4400";
  return (
    <Select value={account} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={cn("w-full min-w-0", className)}>
        <SelectValue>
          <span className="truncate">{current?.short ?? `Konto ${account}`}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {REVENUE_ACCOUNT_OPTIONS.map((option) => (
            <SelectItem key={option.account} value={option.account}>
              <span className="flex flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  Konto {option.account} · {option.hint}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
