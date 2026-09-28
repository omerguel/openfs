import { SearchButton } from "@/components/GlobalSearch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  children?: React.ReactNode;
  center?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
};

export function PageHeader({ children, center, end, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-11 w-full shrink-0 items-center gap-3 rounded-t-lg rounded-b-sm border border-border/70 bg-background px-3 2xl:h-12 2xl:px-4",
        className,
      )}
    >
      <SidebarTrigger className="-ml-1 size-7 shrink-0" />
      <div aria-hidden className="h-4 w-px shrink-0 bg-border/70" />
      {children}
      {center && <div className="absolute left-1/2 -translate-x-1/2">{center}</div>}
      {/* The global search sits in every page header (also Strg/⌘ + K). */}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SearchButton />
        {end}
      </div>
    </header>
  );
}
