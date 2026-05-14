import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const qc = useQueryClient();

  const reset = () => { setPassword(""); setBusy(false); };

  const handleDelete = async () => {
    if (!password) { toast.error("Enter your password to confirm."); return; }
    setBusy(true);

    // Re-authenticate the current admin with their password
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) { setBusy(false); toast.error("Not signed in."); return; }

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setBusy(false);
      toast.error("Incorrect password.");
      return;
    }

    const { error } = await supabase.rpc("delete_project_cascade", { p_project_id: projectId });
    setBusy(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success(`Deleted "${projectName}"`);
    setOpen(false);
    reset();
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        aria-label={`Delete ${projectName}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete project "{projectName}"?</DialogTitle>
            <DialogDescription>
              This permanently removes the project and ALL its lines, equipment, components,
              checklist items, notes, photos and files. This cannot be undone.
              Re-enter your admin password to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="del-pw">Admin password</Label>
            <Input
              id="del-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) handleDelete(); }}
              disabled={busy}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              onClick={handleDelete}
              disabled={busy || !password}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…</> : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
