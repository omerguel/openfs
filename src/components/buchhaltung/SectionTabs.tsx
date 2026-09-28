/* ------------------------------------------------------------------ */
/* Page section switcher (Buchhaltung, Rechnungen). In the top bar on  */
/* wide screens; on phones it moves into the page body as a            */
/* horizontally scrollable strip so no label gets cut off.             */
/* ------------------------------------------------------------------ */

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function SectionTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-full overflow-x-auto [scrollbar-width:none]", className)}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => next && onChange(next as T)}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={label}
        className="w-max"
      >
        {items.map((item) => (
          <ToggleGroupItem key={item.value} value={item.value} className="shrink-0">
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
