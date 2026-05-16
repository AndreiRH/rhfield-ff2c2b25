import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  lineNumber: number | string;
  /** Trailing segments rendered after the Line pill (e.g. ["Kiln", "Switchboards"]). */
  segments?: string[];
  /** Current page heading. If the last segment equals this, it is omitted to avoid duplication. */
  currentTitle?: string;
  /** Optional override for the wrapper text color (defaults to text-muted-foreground). */
  className?: string;
};

/**
 * Breadcrumb where the Line segment is an interactive pill with a dropdown of
 * all lines in the project. Selecting a different line performs a hard
 * navigation to the same URL with the new line id, guaranteeing a full
 * remount with fresh data. Middle segments collapse to "…" on mobile.
 */
export function LineBreadcrumb({ projectId, lineNumber, segments = [], currentTitle, className }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr ?? "" });
  const currentN = Number(lineNumber);

  const { data: lines } = useQuery({
    queryKey: ["project-lines-breadcrumb", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("id, number")
        .eq("project_id", projectId)
        .order("number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const goToLine = (n: number) => {
    if (n === currentN) return;
    // Rebuild the URL with the new line number. Equipment IDs in the path are
    // line-specific, so strip anything past /equipment/<kind> to land on a
    // page that's valid for any line.
    let newPath = pathname.replace(/(\/lines\/)(\d+)/, `$1${n}`);
    newPath = newPath.replace(/(\/equipment\/[^/]+)\/.*$/, "$1");
    // Hard navigation forces a full remount and fresh data fetch.
    const qs = searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "";
    window.location.href = newPath + qs;
  };

  const visible =
    currentTitle && segments.length > 0 && segments[segments.length - 1] === currentTitle
      ? segments.slice(0, -1)
      : segments;
  const middle = visible.slice(0, -1);
  const last = visible[visible.length - 1];

  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        "flex flex-wrap items-center gap-1.5 font-mono text-xs uppercase tracking-widest",
        className ?? "text-muted-foreground",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 leading-none transition hover:bg-current/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
        >
          <span>Line {currentN}</span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className={cn(
            "min-w-[11rem] overflow-hidden rounded-xl border border-border/60",
            "bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80">
            Switch line
          </div>
          {(lines ?? []).map((l) => {
            const active = l.number === currentN;
            return (
              <DropdownMenuItem
                key={l.id}
                onSelect={() => goToLine(l.number)}
                className={cn(
                  "group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2",
                  "font-sans text-sm normal-case tracking-normal",
                  "transition-colors focus:bg-primary focus:text-primary-foreground",
                  "data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground",
                  active && "bg-primary/10 font-medium text-primary",
                )}
              >
                <span>Line {l.number}</span>
                {active ? (
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {middle.length > 0 && (
        <span className="inline-flex items-center gap-1.5 sm:hidden" aria-hidden>
          <span>·</span>
          <span>…</span>
        </span>
      )}
      {middle.map((s, i) => (
        <span key={i} className="hidden items-center gap-1.5 sm:inline-flex">
          <span aria-hidden>·</span>
          <span>{s}</span>
        </span>
      ))}
      {last != null && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>·</span>
          <span>{last}</span>
        </span>
      )}
    </nav>
  );
}
