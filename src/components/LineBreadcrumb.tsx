import { useEffect, useRef, useState } from "react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  lineNumber: number | string;
  segments?: string[];
  currentTitle?: string;
  className?: string;
};

export function LineBreadcrumb({ projectId, lineNumber, segments = [], currentTitle, className }: Props) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr ?? "" });
  const currentN = Number(lineNumber);
  const isMobile = useIsMobile();

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
    const eqMatch = pathname.match(/\/equipment\/([^/]+)\/([0-9a-f-]{36})/i);
    if (eqMatch) {
      const [, , equipmentId] = eqMatch;
      const { data: cur } = await supabase
        .from("plant_equipment").select("name, kind").eq("id", equipmentId).maybeSingle();
      if (cur?.name) {
        const { data: target } = await supabase
          .from("plant_equipment").select("id")
          .eq("line_id", targetLineId).eq("kind", cur.kind).eq("name", cur.name).maybeSingle();
        if (target?.id) {
          newPath = newPath.replace(/(\/equipment\/[^/]+\/)[0-9a-f-]{36}/i, `$1${target.id}`);
        } else {
          newPath = newPath.replace(/(\/equipment\/[^/]+)\/.*$/, "$1");
        }
      }
    }
    const qs = searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "";
    router.history.push(newPath + qs);
  };

  const visible =
    currentTitle && segments.length > 0 && segments[segments.length - 1] === currentTitle
      ? segments.slice(0, -1)
      : segments;
  const first = visible[0];
  const rest = visible.slice(1);

  const linePill = isMobile ? (
    <MobileLineSwitcher lines={lines ?? []} currentN={currentN} onPick={goToLine} />
  ) : (
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
      <div className="flex items-center gap-1.5">
        {linePill}
        {first != null && (
          <>
            <span aria-hidden>·</span>
            <span>{first}</span>
          </>
        )}
      </div>
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

/**
 * Mobile-only line switcher with touch drag-to-select:
 * - touchstart on the pill opens the panel immediately
 * - touchmove tracks the finger across rows (live highlight)
 * - touchend selects the currently highlighted row; releasing outside cancels
 */
function MobileLineSwitcher({
  lines,
  currentN,
  onPick,
}: {
  lines: { id: string; number: number }[];
  currentN: number;
  onPick: (n: number, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(currentN);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Find the line number under the finger by walking up from elementFromPoint.
  const numberAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const row = (el as HTMLElement).closest?.("[data-line-number]") as HTMLElement | null;
    if (!row) return null;
    const n = Number(row.dataset.lineNumber);
    return Number.isFinite(n) ? n : null;
  };

  useEffect(() => {
    if (!open) return;
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const n = numberAtPoint(t.clientX, t.clientY);
      setHighlight(n);
      if (draggingRef.current) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const n = t ? numberAtPoint(t.clientX, t.clientY) : null;
      draggingRef.current = false;
      setOpen(false);
      if (n != null) {
        const target = lines.find((l) => l.number === n);
        if (target) onPick(target.number, target.id);
      }
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [open, lines, onPick]);

  // Close on outside click for tap-without-drag flows (e.g. accidental tap).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onTouchStart={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          setHighlight(currentN);
          setOpen(true);
        }}
        onClick={(e) => {
          // Click fallback (no touch): toggle.
          if (draggingRef.current) return;
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 leading-none transition hover:bg-current/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
      >
        <span>Line {currentN}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          style={{
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 8px 24px oklch(0.18 0.03 250 / 0.18)",
            minWidth: "180px",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          }}
          className="absolute left-0 top-[calc(100%+6px)] z-50 overflow-hidden p-1 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          {lines.map((l) => {
            const active = l.number === currentN;
            const hovered = highlight === l.number;
            return (
              <div
                key={l.id}
                data-line-number={l.number}
                role="option"
                aria-selected={hovered}
                style={{
                  minHeight: 48,
                  padding: "12px 16px",
                  fontSize: "0.95rem",
                  background: hovered ? "var(--primary)" : "transparent",
                  color: hovered ? "var(--primary-foreground)" : undefined,
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-[calc(var(--radius-md)-4px)]",
                  "normal-case tracking-normal select-none transition-colors duration-75",
                  active && !hovered && "font-medium text-[var(--primary)]",
                )}
                onClick={() => {
                  // Pointer-click fallback (mouse on touch device).
                  setOpen(false);
                  if (!active) onPick(l.number, l.id);
                }}
              >
                <span>Line {l.number}</span>
                {active ? (
                  <Check
                    className="h-4 w-4 shrink-0"
                    style={{ color: hovered ? "var(--primary-foreground)" : "var(--primary)" }}
                    aria-hidden
                  />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
