// Maps raw Supabase/PostgREST errors to safe user-facing messages.
// Full details are logged to the console for debugging; the UI receives a
// generic message so internal schema (constraints, table names, RLS policy
// names) is never exposed to end users.

type AnyError = { message?: string; code?: string; details?: string; hint?: string } | null | undefined;

export function toUserMessage(error: AnyError, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  // Always log the full error server/console-side for debugging.
  // eslint-disable-next-line no-console
  console.error("Supabase error:", error);

  const msg = (error.message || "").toLowerCase();
  const code = error.code || "";

  if (code === "23505" || msg.includes("duplicate key")) {
    return "This item already exists.";
  }
  if (code === "23503" || msg.includes("foreign key")) {
    return "This item is referenced elsewhere and cannot be changed.";
  }
  if (code === "23502" || msg.includes("not-null") || msg.includes("null value")) {
    return "Required information is missing.";
  }
  if (code === "23514" || msg.includes("check constraint")) {
    return "The provided value is not allowed.";
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "You don't have permission to perform this action.";
  }
  if (code === "PGRST301" || msg.includes("jwt")) {
    return "Your session has expired. Please sign in again.";
  }
  return fallback;
}
