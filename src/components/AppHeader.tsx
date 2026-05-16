import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { LogOut, Users, Moon, Sun } from "lucide-react";
import riedhammerLogo from "@/assets/riedhammer-logo.png";
import { SyncCloud } from "@/components/SyncCloud";

export function AppHeader() {
  const { user, roles, isAdmin, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest">
          <img src={riedhammerLogo} alt="Riedhammer" className="h-6 w-auto" />
          Riedhammer Field
        </Link>
        <div className="flex items-center gap-2">
          <SyncCloud />
          {user && (
            <>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {user.email} · <span className="font-mono uppercase">{roles.join(",") || "no role"}</span>
              </span>
              {isAdmin && (
                <Button variant="ghost" size="sm" asChild aria-label="Users">
                  <Link to="/admin/users"><Users className="h-4 w-4" /></Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
