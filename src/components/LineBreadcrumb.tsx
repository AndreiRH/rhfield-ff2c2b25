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
  const router = useRouter();
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

  const goToLine = async (n: number, targetLineId: string) => {
    if (n === currentN) return;
    let newPath = pathname.replace(/(\/lines\/)(\d+)/, `$1${n}`);

    // If we're on an equipment detail (or sub-page), map the current
    // equipmentId to the same-named equipment on the target line so the
    // user stays on the same equipment, just for a different line.
    const eqMatch = pathname.match(/\/equipment\/([^/]+)\/([0-9a-f-]{36})/i);
    if (eqMatch) {
      const [, , equipmentId] = eqMatch;
      const { data: cur } = await supabase
        .from("plant_equipment")
        .select("name, kind")
        .eq("id", equipmentId)
        .maybeSingle();
      if (cur?.name) {
        const { data: target } = await supabase
          .from("plant_equipment")
          .select("id")
          .eq("line_id", targetLineId)
          .eq("kind", cur.kind)
          .eq("name", cur.name)
          .maybeSingle();
        if (target?.id) {
          newPath = newPath.replace(
            /(\/equipment\/[^/]+\/)[0-9a-f-]{36}/i,
            `$1${target.id}`,
          );
        } else {
          // Equivalent equipment doesn't exist on target line — fall back
          // to that line's equipment list for the same kind.
          newPath = newPath.replace(/(\/equipment\/[^/]+)\/.*$/, "$1");
        }
      }
    }

    const qs = searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "";
    // Soft client-side navigation — no full reload. The line layout
    // uses lineNumber as a React key so the page tree remounts cleanly.
    router.history.push(newPath + qs);
  };

  const visible =
    currentTitle && segments.length > 0 && segments[segments.length - 1] === currentTitle
      ? segments.slice(0, -1)
      : segments;
  const first = visible[0];
  const rest = visible.slice(1);

  const linePill = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 leading-none transition hover:bg-current/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
      >
        <span>Line {currentN}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        style={{
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 4px 12px oklch(0.18 0.03 250 / 0.1)",
          minWidth: "160px",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        }}
        className={cn(
          "overflow-hidden p-1",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1",
          "duration-150",
        )}
      >
        {(lines ?? []).map((l) => {
          const active = l.number === currentN;
          return (
            <DropdownMenuItem
              key={l.id}
              onSelect={() => goToLine(l.number, l.id)}
              style={{ padding: "10px 14px", fontSize: "0.875rem" }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-[calc(var(--radius-md)-4px)]",
                "normal-case tracking-normal outline-none transition-colors",
                "focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]",
                "data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-foreground)]",
                active && "font-medium text-[var(--primary)]",
              )}
            >
              <span>Line {l.number}</span>
              {active ? (
                <Check className="h-4 w-4 shrink-0" style={{ color: "var(--primary)" }} aria-hidden />
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        "flex flex-col gap-1 font-mono text-xs uppercase tracking-widest",
        "sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5",
        className ?? "text-muted-foreground",
      )}
    >
      {/* Line 1: line pill + first context segment */}
      <div className="flex items-center gap-1.5">
        {linePill}
        {first != null && (
          <>
            <span aria-hidden>·</span>
            <span>{first}</span>
          </>
        )}
      </div>

      {/* Line 2 on mobile, inline on desktop: remaining segments (excluding page title). */}
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rest.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={i === 0 ? "hidden sm:inline" : ""}>·</span>
              <span>{s}</span>
            </span>
          ))}
        </div>
      )}
    </nav>
  );
}
