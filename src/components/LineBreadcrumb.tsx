import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PillSwitcher } from "@/components/PillSwitcher";
import { cn } from "@/lib/utils";

type Segment = string | ReactNode;

type Props = {
  projectId: string;
  lineNumber: number | string;
  segments?: Segment[];
  currentTitle?: string;
  className?: string;
};

export function LineBreadcrumb({ projectId, lineNumber, segments = [], currentTitle, className }: Props) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr ?? "" });
  const currentN = Number(lineNumber);

  const { data: lines } = useQuery({
    queryKey: ["project-lines-breadcrumb", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("id, number")
        .eq("project_id", projectId)
        .order("number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const goToLine = async (n: number, targetLineId: string) => {
    if (n === currentN) return;
    let newPath = pathname.replace(/(\/lines\/)(\d+)/, `$1${n}`);
    const eqMatch = pathname.match(/\/equipment\/([^/]+)\/([0-9a-f-]{36})/i);
    if (eqMatch) {
      const [, , equipmentId] = eqMatch;
      const { data: cur } = await supabase
        .from("plant_equipment").select("name, kind").eq("id", equipmentId).maybeSingle();
      if (cur?.name) {
        const { data: target } = await supabase
          .from("plant_equipment").select("id")
          .eq("line_id", targetLineId).eq("kind", cur.kind).eq("name", cur.name).maybeSingle();
        if (target?.id) {
          newPath = newPath.replace(/(\/equipment\/[^/]+\/)[0-9a-f-]{36}/i, `$1${target.id}`);
        } else {
          newPath = newPath.replace(/(\/equipment\/[^/]+)\/.*$/, "$1");
        }
      }
    }
    const qs = searchStr ? (searchStr.startsWith("?") ? searchStr : `?${searchStr}`) : "";
    router.history.push(newPath + qs);
  };

  const visible: Segment[] =
    currentTitle && segments.length > 0 && segments[segments.length - 1] === currentTitle
      ? segments.slice(0, -1)
      : segments;
  const first = visible[0];
  const rest = visible.slice(1);

  const linePill = (
    <PillSwitcher
      label={`Line ${currentN}`}
      currentKey={String(currentN)}
      items={(lines ?? []).map((l) => ({ id: l.id, key: String(l.number), label: `Line ${l.number}` }))}
      onPick={(item) => goToLine(Number(item.key), item.id)}
    />
  );

  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        "flex flex-col gap-1 font-mono text-xs uppercase tracking-widest",
        "sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5",
        className ?? "text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-1.5">
        {linePill}
        {first != null && (
          <>
            <span aria-hidden>·</span>
            <span>{first}</span>
          </>
        )}
      </div>
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rest.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={i === 0 ? "hidden sm:inline" : ""}>·</span>
              <span>{s}</span>
            </span>
          ))}
        </div>
      )}
    </nav>
  );
}
