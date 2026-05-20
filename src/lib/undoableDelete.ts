import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";

interface UndoableDeleteOptions {
  /** Toast label shown while undo is available. */
  label?: string;
  /** Milliseconds to wait before committing. Default 3000. */
  duration?: number;
  /** Synchronously update local UI (e.g. filter item out of state). */
  optimistic?: () => void;
  /** Restore UI when user clicks Undo or commit fails. Usually a reload. */
  restore?: () => void;
  /** Actual destructive operation. Runs after the delay if not undone. */
  commit: () => Promise<void>;
  /** Called after a successful commit. Usually reload. */
  afterCommit?: () => void;
}

/**
 * Optimistic delete with a 3-second undo toast.
 *
 * Pattern:
 *  1. `optimistic()` runs immediately so the item disappears.
 *  2. Toast shows with an Undo action.
 *  3. If user clicks Undo within `duration` ms → `restore()` runs, commit is skipped.
 *  4. Otherwise after `duration` ms → `commit()` runs, then `afterCommit()`.
 */
export function undoableDelete({
  label = "Deleted",
  duration = 3000,
  optimistic,
  restore,
  commit,
  afterCommit,
}: UndoableDeleteOptions) {
  try {
    optimistic?.();
  } catch {
    // ignore optimistic errors
  }
  let undone = false;

  toast(label, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        try { restore?.(); } catch { /* noop */ }
      },
    },
  });

  setTimeout(async () => {
    if (undone) return;
    try {
      await commit();
      afterCommit?.();
    } catch (e) {
      toast.error(toUserMessage(e as any));
      try { restore?.(); } catch { /* noop */ }
    }
  }, duration);
}
