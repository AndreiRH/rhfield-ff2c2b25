import { useEffect, useRef, useState } from "react";
import { Cloud, CloudOff } from "lucide-react";
import { useOfflineStatus, retryFailedOutbox, discardFailedOutbox } from "@/lib/offline";

// Single cloud icon in the header that doubles as a sync-status control.
//   online + idle         → plain cloud, muted
//   online + syncing      → plain cloud, slowly pulsing
//   online + pending edits → plain cloud with a tiny dot badge
//   offline               → cut cloud (CloudOff)
// Click (when online) toggles a small, semi-transparent popover with phase
// counts. Click outside closes it.
export function SyncCloud() {
  const { online, pending, warm } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const syncing = online && warm.phase !== "idle" && warm.phase !== "done" && warm.total > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Sync status"
        title={online ? "Sync status" : "Offline — changes saved locally"}
      >
        {online ? <Cloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
        {pending > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-foreground/60" aria-hidden />
        )}
      </button>

      {open && (
        <div
          className="fixed left-1/2 top-16 z-50 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border bg-card/85 p-3 text-xs shadow-md backdrop-blur sm:absolute sm:right-0 sm:left-auto sm:top-auto sm:mt-1 sm:w-56 sm:translate-x-0"
          role="dialog"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono uppercase tracking-wider text-muted-foreground">Sync</span>
            <span className="text-muted-foreground">{online ? (syncing ? "Working…" : "Up to date") : "Offline"}</span>
          </div>

          <Row label="Pending edits" value={pending} />
          {warm.total > 0 ? (
            <Row
              label={phaseLabel(warm.phase)}
              value={`${warm.done}/${warm.total}`}
              dim={warm.phase === "done" || warm.phase === "idle"}
            />
          ) : (
            <Row label="Data" value="—" dim />
          )}

          {warm.error && (
            <p className="mt-2 text-[10px] text-destructive">{warm.error}</p>
          )}
          {warm.lastSync && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Last sync {new Date(warm.lastSync).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function phaseLabel(p: string) {
  if (p === "tables") return "Data";
  if (p === "routes") return "Pages";
  if (p === "blobs") return "Photos & files";
  return "Data";
}

function Row({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${dim ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
