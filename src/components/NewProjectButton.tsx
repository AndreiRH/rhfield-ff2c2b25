import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toUserMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("TestProject");
  const [lineCount, setLineCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const reset = () => {
    setName("TestProject");
    setLineCount(1);
    setBusy(false);
  };

  const handleClose = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) reset();
  };

  const handleCreate = async () => {
    const projectName = name.trim();
    const lines = Math.max(1, Math.min(50, Math.floor(Number(lineCount) || 1)));
    if (!projectName) {
      toast.error("Enter a project name.");
      return;
    }

    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({ name: projectName, created_by: userData.user?.id ?? null })
        .select("id")
        .single();
      if (projectError) throw projectError;

      const lineRows = Array.from({ length: lines }, (_, index) => ({
        project_id: project.id,
        number: index + 1,
        name: `Line ${index + 1}`,
      }));
      const { error: lineError } = await supabase.from("lines").insert(lineRows);
      if (lineError) throw lineError;

      const { error: noteError } = await supabase
        .from("common_notes")
        .insert({ project_id: project.id, body: "" });
      if (noteError) throw noteError;

      toast.success(`Created "${projectName}"`);
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      reset();
      navigate({ to: "/p/$projectId", params: { projectId: project.id } });
    } catch (e: any) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New empty project</DialogTitle>
          <DialogDescription>
            Create a clean project for testing the setup wizard. Existing projects are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-project-name">Project name</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) handleCreate();
              }}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-project-lines">Production lines</Label>
            <Input
              id="new-project-lines"
              type="number"
              min={1}
              max={50}
              value={lineCount}
              onChange={(e) => setLineCount(Number(e.target.value))}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={busy || !name.trim()}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating
              </>
            ) : (
              "Create project"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
