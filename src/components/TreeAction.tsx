import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type TreeMode = "none" | "delete" | "copy" | "reorder";
export type SelectionKind = "type" | "component" | "item" | "setting";

type SelectionEntry = {
  kind: SelectionKind;
  payload: any; // raw row + (for items) allItems context
};

type Ctx = {
  mode: TreeMode;
  setMode: (m: TreeMode) => void;
  selection: Map<string, SelectionEntry>;
  isSelected: (id: string) => boolean;
  toggle: (id: string, entry: SelectionEntry) => void;
  clear: () => void;
  hasSelection: boolean;
  count: number;
};

const TreeActionCtx = createContext<Ctx | null>(null);

export function TreeActionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<TreeMode>("none");
  const [selection, setSelection] = useState<Map<string, SelectionEntry>>(new Map());

  const clear = useCallback(() => setSelection(new Map()), []);
  const setMode = useCallback((m: TreeMode) => {
    setModeRaw(m);
    setSelection(new Map());
  }, []);
  const toggle = useCallback((id: string, entry: SelectionEntry) => {
    setSelection((prev) => {
      const next = new Map(prev);
      // Restrict to a single kind at a time. If user taps a different kind, reset.
      const firstKind = next.size > 0 ? next.values().next().value!.kind : entry.kind;
      if (firstKind !== entry.kind) {
        next.clear();
      }
      if (next.has(id)) next.delete(id);
      else next.set(id, entry);
      return next;
    });
  }, []);
  const isSelected = useCallback((id: string) => selection.has(id), [selection]);

  const value = useMemo<Ctx>(() => ({
    mode, setMode, selection, isSelected, toggle, clear,
    hasSelection: selection.size > 0,
    count: selection.size,
  }), [mode, selection, setMode, toggle, isSelected, clear]);

  return <TreeActionCtx.Provider value={value}>{children}</TreeActionCtx.Provider>;
}

export function useTreeAction() {
  return useContext(TreeActionCtx);
}
