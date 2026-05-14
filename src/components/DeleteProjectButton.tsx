import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    const { error } = await supabase.rpc("delete_project_cascade", { p_project_id: projectId });
    setBusy(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success(`Deleted "${projectName}"`);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
          aria-label={`Delete ${projectName}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project "{projectName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the project and ALL its lines, equipment, components,
            checklist items, notes, photos and files. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…</> : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
