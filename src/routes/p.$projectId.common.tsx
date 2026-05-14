import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Upload, FileText, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/p/$projectId/common")({ component: CommonPage });

function CommonPage() {
  const { projectId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["common", projectId],
    queryFn: async () => {
      const [{ data: project }, { data: note }, { data: files }] = await Promise.all([
        supabase.from("projects").select("name").eq("id", projectId).single(),
        supabase.from("common_notes").select("*").eq("project_id", projectId).maybeSingle(),
        supabase.from("common_files").select("*").eq("project_id", projectId).order("uploaded_at", { ascending: false }),
      ]);
      return { project, note, files: files ?? [] };
    },
  });

  const [body, setBody] = useState("");
  useEffect(() => { if (data?.note) setBody(data.note.body ?? ""); }, [data?.note]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["common", projectId] });

  const saveNote = async () => {
    const existing = data?.note;
    if (existing) {
      const { error } = await supabase.from("common_notes").update({ body, updated_by: user?.id, updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) toast.error(error.message); else toast.success("Notes saved");
    } else {
      const { error } = await supabase.from("common_notes").insert({ project_id: projectId, body, updated_by: user?.id });
      if (error) toast.error(error.message); else { toast.success("Notes saved"); invalidate(); }
    }
  };

  const uploadFile = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) { toast.error("Max 100 MB per file"); return; }
    const path = `${projectId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("files").upload(path, file);
    if (upErr) { toast.error(upErr.message); return; }
    const { error } = await supabase.from("common_files").insert({
      project_id: projectId, name: file.name, storage_path: path,
      size_bytes: file.size, mime_type: file.type, uploaded_by: user?.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("Uploaded"); invalidate(); }
  };

  const deleteFile = async (id: string, path: string) => {
    await supabase.storage.from("files").remove([path]);
    const { error } = await supabase.from("common_files").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); invalidate(); }
  };

  const downloadFile = async (path: string) => {
    const { data: signed } = await supabase.storage.from("files").createSignedUrl(path, 60);
    if (signed?.signedUrl) window.open(signed.signedUrl, "_blank");
  };

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Link to="/p/$projectId" params={{ projectId }} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Project dashboard
        </Link>
        <h1 className="mb-1 text-2xl font-semibold">Common — {data?.project?.name ?? ""}</h1>
        <p className="mb-6 text-sm text-muted-foreground">Plant-wide notes and shared files (not tied to a specific line).</p>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Notes</h2>
                {canEdit && <Button size="sm" onClick={saveNote}><Save className="mr-1 h-4 w-4" /> Save</Button>}
              </div>
              {isLoading
                ? <Skeleton className="h-64" />
                : <Textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} className="min-h-[300px]" placeholder="Plant-wide notes…" />
              }
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Files</h2>
                {canEdit && (
                  <label>
                    <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                    <span className="inline-flex cursor-pointer items-center rounded-md border bg-card px-3 py-1.5 text-sm hover:border-primary/40">
                      <Upload className="mr-1 h-4 w-4" /> Upload
                    </span>
                  </label>
                )}
              </div>
              {isLoading ? <Skeleton className="h-32" /> : (
                <ul className="space-y-1">
                  {(data?.files ?? []).length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
                  {(data?.files ?? []).map((f: any) => (
                    <li key={f.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                      <button onClick={() => downloadFile(f.storage_path)} className="flex flex-1 items-center gap-2 text-left">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{f.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{prettySize(f.size_bytes)}</div>
                        </div>
                      </button>
                      {canEdit && (
                        <Button size="sm" variant="ghost" onClick={() => deleteFile(f.id, f.storage_path)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function prettySize(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
