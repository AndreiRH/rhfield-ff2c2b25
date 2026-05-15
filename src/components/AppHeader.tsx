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
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest">
          <img src={riedhammerLogo} alt="Riedhammer" className="h-6 w-auto" />
          Riedhammer Field
        </Link>
        <div className="flex items-center gap-3">
          {(!online || pending > 0 || syncing) && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                online ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"
              }`}
              title={
                !online ? "Offline — changes will sync when you reconnect"
                : syncing ? `Caching for offline use: ${warm.done} / ${warm.total}`
                : `${pending} change(s) waiting to sync`
              }
            >
              {!online ? (
                <><CloudOff className="h-3 w-3" /> Offline{pending > 0 ? ` · ${pending}` : ""}</>
              ) : syncing ? (
                <><RefreshCw className="h-3 w-3 animate-spin" /> Sync {warm.done}/{warm.total}</>
              ) : (
                <><RefreshCw className="h-3 w-3 animate-spin" /> Sync {pending}</>
              )}
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
