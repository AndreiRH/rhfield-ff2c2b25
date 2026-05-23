import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";

type Role = "admin" | "engineer" | "pm" | "viewer";
const ALL_ROLES: Role[] = ["admin", "engineer", "pm", "viewer"];

const ROLE_LABEL: Record<Role, string> = {
  admin: "adm",
  engineer: "eng",
  pm: "pm",
  viewer: "view",
};

export const Route = createFileRoute("/admin/users")({ component: UsersPage });

function UsersPage() {
  const { session, loading, isAdmin, user: me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
    else if (!loading && session && !isAdmin) navigate({ to: "/" });
  }, [session, loading, isAdmin, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session && isAdmin,
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return data as Array<{
        user_id: string;
        email: string;
        display_name: string | null;
        roles: Role[];
        created_at: string;
      }>;
    },
  });

  const mutate = useMutation({
    mutationFn: async (v: { userId: string; role: Role; grant: boolean }) => {
      const { error } = await supabase.rpc("admin_set_user_role", {
        _user_id: v.userId,
        _role: v.role,
        _grant: v.grant,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (e: any) => toast.error(toUserMessage(e, "Failed to update role")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_delete_user", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User deleted");
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(toUserMessage(e, "Failed to delete user")),
  });

  const [confirmDelete, setConfirmDelete] = useState<{ id: string; email: string } | null>(null);

  if (!session || !isAdmin) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Projects
        </Link>
        <h1 className="text-2xl font-semibold">Users &amp; roles</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Toggle roles to grant or revoke access. You cannot remove your own admin role.
        </p>

        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="hidden sm:grid grid-cols-[1fr_repeat(3,72px)_40px] items-center gap-2 border-b px-4 py-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <div>User</div>
                {ALL_ROLES.map((r) => <div key={r} className="text-center">{r}</div>)}
                <div />
              </div>
              {(data ?? []).map((u) => {
                const isMe = u.user_id === me?.id;
                return (
                  <div
                    key={u.user_id}
                    className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:grid sm:grid-cols-[1fr_repeat(3,72px)_40px] sm:items-center sm:gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words">
                        {u.display_name || u.email.split("@")[0]}
                        {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground break-all">{u.email}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:contents">
                      {ALL_ROLES.map((r) => {
                        const has = u.roles?.includes(r);
                        const disabled = mutate.isPending || (isMe && r === "admin" && has);
                        return (
                          <label
                            key={r}
                            className="flex flex-1 items-center justify-center gap-2 rounded-md border px-2 py-1.5 sm:flex-none sm:border-0 sm:p-0"
                          >
                            <span className="text-xs uppercase tracking-wide text-muted-foreground sm:hidden">{r}</span>
                            <Checkbox
                              checked={!!has}
                              disabled={disabled}
                              onCheckedChange={(v) =>
                                mutate.mutate({ userId: u.user_id, role: r, grant: !!v })
                              }
                            />
                          </label>
                        );
                      })}
                      {!isMe && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmDelete({ id: u.user_id, email: u.email })}
                          aria-label={`Delete ${u.email}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {isMe && <div className="hidden sm:block" />}
                    </div>
                  </div>
                );
              })}
              {(data ?? []).length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No users yet.</div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They can re-register with the same email after deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
