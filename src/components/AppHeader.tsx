import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, HardHat } from "lucide-react";

export function AppHeader() {
  const { user, roles, signOut } = useAuth();
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest">
          <HardHat className="h-5 w-5 text-primary" />
          RH Field
        </Link>
        <div className="flex items-center gap-3">
          {user && (
            <>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {user.email} · <span className="font-mono uppercase">{roles.join(",") || "no role"}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="mr-1 h-4 w-4" /> Sign out
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
