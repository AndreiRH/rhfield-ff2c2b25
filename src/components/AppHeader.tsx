import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { LogOut, Users, Moon, Sun, CloudOff, RefreshCw } from "lucide-react";
import riedhammerLogo from "@/assets/riedhammer-logo.png";
import { useOfflineStatus } from "@/lib/offline";

export function AppHeader() {
  const { user, roles, isAdmin, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const { online, pending, warm } = useOfflineStatus();
  const syncing = online && warm.phase !== "idle" && warm.phase !== "done" && warm.total > 0;
  const phaseLabel = warm.phase === "tables" ? "data" : warm.phase === "routes" ? "pages" : warm.phase === "blobs" ? "files" : "";
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest">
          <img src={riedhammerLogo} alt="Riedhammer" className="h-6 w-auto" />
          Riedhammer Field
        </Link>
        <div className="flex items-center gap-2">
          {!online && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
              title={pending > 0 ? `Offline — ${pending} change(s) waiting to sync` : "Offline — all changes saved locally"}
            >
              <CloudOff className="h-3 w-3" /> Offline{pending > 0 ? ` · ${pending}` : ""}
            </span>
          )}
          {online && pending > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
              title={`${pending} change(s) waiting to sync`}
            >
              <RefreshCw className="h-3 w-3 animate-spin" /> {pending}
            </span>
          )}
          {online && pending === 0 && syncing && (
            <span
              className="inline-flex items-center text-muted-foreground/60"
              title={`Syncing ${phaseLabel} ${warm.done}/${warm.total}`}
              aria-label="Syncing"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            </span>
          )}
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
