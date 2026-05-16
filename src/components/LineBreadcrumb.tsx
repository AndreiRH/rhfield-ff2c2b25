import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
 * all lines in the project. Selecting a different line keeps the rest of the
 * URL path identical. Middle segments collapse to "…" on mobile.
 */
export function LineBreadcrumb({ projectId, lineNumber, segments = [], className }: Props) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
    const newPath = pathname.replace(/(\/lines\/)(\d+)/, `$1${n}`);
    navigate({ to: newPath });
  };

  const middle = segments.slice(0, -1);
  const last = segments[segments.length - 1];

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
        <DropdownMenuContent align="start" className="min-w-[12rem]">
          {(lines ?? []).map((l) => (
            <DropdownMenuItem
              key={l.id}
              onSelect={() => goToLine(l.number)}
              className="flex items-center justify-between gap-3"
            >
              <span>Production line {String(l.number).padStart(2, "0")}</span>
              {l.number === currentN && <Check className="h-3.5 w-3.5" aria-hidden />}
            </DropdownMenuItem>
          ))}
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
