import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { importProjectFromZip, rollbackImport, type ImportProgress, type ImportSummary } from "@/lib/importProject";
import { useQueryClient } from "@tanstack/react-query";

export function ImportProjectButton() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const reset = () => {
    setFile(null); setName(""); setProgress(null); setError(null); setSummary(null); setBusy(false);
  };

  const handleClose = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) reset();
  };

  const handleImport = async () => {
    if (!file || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await importProjectFromZip({
        zipFile: file,
        newProjectName: name.trim(),
        onProgress: setProgress,
      });
      setSummary(res);
      qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!summary) return;
    setBusy(true);
    try {
      await rollbackImport(summary.newProjectId);
      qc.invalidateQueries({ queryKey: ["projects"] });
      handleClose(false);
    } catch (e: any) {
      setError(`Rollback failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const pct = progress?.total ? Math.round(((progress.current ?? 0) / progress.total) * 100) : (progress ? 25 : 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" /> Import from ZIP
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import project from ZIP</DialogTitle>
          <DialogDescription>
            Restore an exported ZIP as a brand-new project. The original project (if it still exists) is not touched.
          </DialogDescription>
        </DialogHeader>

        {!summary && !busy && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="zip">ZIP file</Label>
              <Input id="zip" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Label htmlFor="name">New project name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Plant – restored" />
            </div>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Import is not transactional. If something fails halfway, use the Rollback button shown after the import.
              </AlertDescription>
            </Alert>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
        )}

        {busy && progress && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> {progress.message}
            </div>
            <Progress value={pct} />
            {progress.total !== undefined && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {progress.current ?? 0} / {progress.total}
              </div>
            )}
          </div>
        )}

        {summary && (
          <div className="space-y-3">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">Import complete.</div>
                <div className="mt-2 text-xs space-y-0.5 tabular-nums">
                  <div>{summary.counts.lines ?? 0} production lines</div>
                  <div>{summary.counts.plant_equipment ?? 0} equipment</div>
                  <div>{summary.counts.checklist_items ?? 0} checklist items</div>
                  <div>{summary.counts.equipment_notes ?? 0} equipment notes</div>
                  <div>{summary.counts.pa_folders ?? 0} provisional acceptance folders</div>
                  <div>{summary.counts.milestones ?? 0} milestones</div>
                  <div className="pt-1">{summary.mediaUploaded} media files uploaded{summary.mediaMissing > 0 ? `, ${summary.mediaMissing} missing` : ""}</div>
                </div>
              </AlertDescription>
            </Alert>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
        )}

        <DialogFooter>
          {!summary && !busy && (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleImport} disabled={!file || !name.trim()}>Start import</Button>
            </>
          )}
          {summary && (
            <>
              <Button variant="destructive" onClick={handleRollback} disabled={busy}>Rollback</Button>
              <Button onClick={() => { handleClose(false); navigate({ to: "/p/$projectId", params: { projectId: summary.newProjectId } }); }}>
                Open project
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
