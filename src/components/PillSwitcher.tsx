import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type PillItem = {
  id: string;
  /** Stable key used by the touch-drag highlight (string). */
  key: string;
  label: string;
};

type Props = {
  label: string;
  items: PillItem[];
  currentKey: string;
  onPick: (item: PillItem) => void;
};

/**
 * Generic pill switcher used in the breadcrumb.
 * - Mobile: touchstart opens, finger-follow highlight, touchend selects, release outside cancels.
 * - Desktop: click opens a dropdown.
 */
export function PillSwitcher({ label, items, currentKey, onPick }: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileSwitcher label={label} items={items} currentKey={currentKey} onPick={onPick} />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="breadcrumb-pill focus:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
      >
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
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
          minWidth: "180px",
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
        {items.map((item) => {
          const active = item.key === currentKey;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onPick(item)}
              style={{ padding: "10px 14px", fontSize: "0.875rem" }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-[calc(var(--radius-md)-4px)]",
                "normal-case tracking-normal outline-none transition-colors",
                "focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)]",
                "data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-foreground)]",
                active && "font-medium text-[var(--primary)]",
              )}
            >
              <span>{item.label}</span>
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
}

function MobileSwitcher({ label, items, currentKey, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(currentKey);
  const [dropAlign, setDropAlign] = useState<"left" | "right">("left");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const draggingRef = useRef(false);

  const keyAtPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const row = (el as HTMLElement).closest?.("[data-switcher-key]") as HTMLElement | null;
    if (!row) return null;
    return row.dataset.switcherKey ?? null;
  };

  useEffect(() => {
    if (!open) return;
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      setHighlight(keyAtPoint(t.clientX, t.clientY));
      if (draggingRef.current) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const k = t ? keyAtPoint(t.clientX, t.clientY) : null;
      draggingRef.current = false;
      setOpen(false);
      if (k != null) {
        const target = items.find((i) => i.key === k);
        if (target) onPick(target);
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
  }, [open, items, onPick]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      setDropAlign(spaceRight < 220 ? "right" : "left");
    }
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onTouchStart={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          setHighlight(currentKey);
          setOpen(true);
        }}
        onClick={(e) => {
          if (draggingRef.current) return;
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="breadcrumb-pill focus:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
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
            minWidth: "200px",
            maxWidth: "80vw",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          }}
          className="absolute left-0 top-[calc(100%+6px)] z-50 overflow-hidden p-1 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          {items.map((item) => {
            const active = item.key === currentKey;
            const hovered = highlight === item.key;
            return (
              <div
                key={item.id}
                data-switcher-key={item.key}
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
                  setOpen(false);
                  if (!active) onPick(item);
                }}
              >
                <span className="truncate">{item.label}</span>
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
