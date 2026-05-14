import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

type Role = "admin" | "engineer" | "pm";
const ALL_ROLES: Role[] = ["admin", "engineer", "pm"];

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
    onError: (e: any) => toast.error(e.message ?? "Failed to update role"),
  });

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
              <div className="grid grid-cols-[1fr_repeat(3,90px)] items-center gap-2 border-b px-4 py-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <div>User</div>
                {ALL_ROLES.map((r) => <div key={r} className="text-center">{r}</div>)}
              </div>
              {(data ?? []).map((u) => {
                const isMe = u.user_id === me?.id;
                return (
                  <div key={u.user_id} className="grid grid-cols-[1fr_repeat(3,90px)] items-center gap-2 border-b px-4 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {u.display_name || u.email.split("@")[0]}
                        {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    {ALL_ROLES.map((r) => {
                      const has = u.roles?.includes(r);
                      const disabled = mutate.isPending || (isMe && r === "admin" && has);
                      return (
                        <div key={r} className="flex justify-center">
                          <Checkbox
                            checked={!!has}
                            disabled={disabled}
                            onCheckedChange={(v) =>
                              mutate.mutate({ userId: u.user_id, role: r, grant: !!v })
                            }
                          />
                        </div>
                      );
                    })}
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
    </div>
  );
}
