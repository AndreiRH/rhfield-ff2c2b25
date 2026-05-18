import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { exportProject, type ExportProgress } from "@/lib/exportProject";
import { toUserMessage } from "@/lib/errors";

export function ExportProjectButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    setRunning(true);
    setProgress({ phase: "tables", message: "Starting…" });
    abortRef.current = new AbortController();
    try {
      await exportProject(projectId, {
        includeMedia,
        signal: abortRef.current.signal,
        onProgress: setProgress,
      });
      toast.success("Export downloaded");
      setOpen(false);
    } catch (e: any) {
      toast.error(toUserMessage(e, "Export failed"));
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const pct =
    progress?.total && progress.current !== undefined
      ? Math.round((progress.current / Math.max(progress.total, 1)) * 100)
      : null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Download className="h-4 w-4" /> Export project
      </Button>

      <Dialog open={open} onOpenChange={(o) => !running && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export project data</DialogTitle>
            <DialogDescription>
              Downloads a single ZIP with every checklist, note, progress sheet,
              photo and file. Open the CSVs in Excel.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeMedia}
              disabled={running}
              onChange={(e) => setIncludeMedia(e.target.checked)}
            />
            Include photos & files (slower, larger ZIP)
          </label>

          {running && progress && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{progress.message}</span>
              </div>
              {pct !== null && (
                <>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-right font-mono text-xs text-muted-foreground">
                    {progress.current} / {progress.total}
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {running ? (
              <Button variant="ghost" onClick={cancel}>Cancel</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={start} className="gap-2">
                  <Download className="h-4 w-4" /> Start export
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
