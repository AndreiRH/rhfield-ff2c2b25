import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- Types ----------

const SourceEnum = z.enum([
  "settings",
  "checklist_items",
  "equipment_notes",
  "pa_notes",
  "common_notes",
  "component_files",
  "component_photos",
]);

const PlanSchema = z.object({
  sources: z.array(SourceEnum).min(1),
  keywords: z.array(z.string()).default([]),
  equipmentKinds: z.array(z.enum(["kiln", "shs"])).optional(),
  lineNumbers: z.array(z.number()).optional(),
  equipmentNameLike: z.string().optional(),
  componentTypeLike: z.string().optional(),
  doneFilter: z.enum(["any", "done", "not_done"]).default("any"),
});

export type SearchResult = {
  id: string;
  source: z.infer<typeof SourceEnum>;
  title: string;
  body: string;
  done: boolean | null;
  line_number: number | null;
  plant_kind: string | null;
  equipment_name: string | null;
  component_type: string | null;
  component_name: string | null;
  attachments: { kind: "photo" | "file"; storage_path: string; file_name: string | null }[];
  updated_at: string | null;
};

export type SearchResponse = {
  plan: z.infer<typeof PlanSchema>;
  results: SearchResult[];
  truncated: boolean;
};

const InputSchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(2).max(2000),
  scope: z
    .object({
      lineId: z.string().uuid().optional(),
      equipmentId: z.string().uuid().optional(),
    })
    .default({}),
});

// ---------- Query plan generation ----------

async function buildPlanFromQuery(question: string): Promise<z.infer<typeof PlanSchema>> {
  const normalized = question.toLowerCase();
  const sources = new Set<z.infer<typeof SourceEnum>>();

  if (/\b(setting|settings|parameter|parameters|configuration|config)\b/.test(normalized)) sources.add("settings");
  if (/\b(check|checks|checklist|item|items|task|tasks|status|done|complete|completed|open|pending)\b/.test(normalized)) sources.add("checklist_items");
  if (/\b(note|notes|remark|remarks|comment|comments)\b/.test(normalized)) {
    sources.add("equipment_notes");
    sources.add("common_notes");
  }
  if (/\b(pa|process automation|automation)\b/.test(normalized)) sources.add("pa_notes");
  if (/\b(photo|photos|image|images|picture|pictures)\b/.test(normalized)) sources.add("component_photos");
  if (/\b(file|files|document|documents|attachment|attachments)\b/.test(normalized)) sources.add("component_files");
  if (sources.size === 0) {
    sources.add("settings");
    sources.add("checklist_items");
    sources.add("equipment_notes");
    sources.add("pa_notes");
    sources.add("common_notes");
  }

  const equipmentKinds: Array<"kiln" | "shs"> = [];
  if (/\bkiln|kilns\b/.test(normalized)) equipmentKinds.push("kiln");
  if (/\bshs\b/.test(normalized)) equipmentKinds.push("shs");

  const lineNumbers = Array.from(normalized.matchAll(/\bline\s*(\d+)\b/g))
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  const keywords = Array.from(
    new Set(
      normalized
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .filter((word) => ![
          "all", "and", "are", "done", "every", "from", "line", "not",
          "open", "show", "that", "the", "with",
        ].includes(word))
        .slice(0, 8),
    ),
  );

  let doneFilter: "any" | "done" | "not_done" = "any";
  if (/\b(not done|open|pending|incomplete|needs work)\b/.test(normalized)) doneFilter = "not_done";
  if (/\b(done|completed|complete)\b/.test(normalized) && doneFilter === "any") doneFilter = "done";

  return PlanSchema.parse({
    sources: Array.from(sources),
    keywords,
    equipmentKinds: equipmentKinds.length ? equipmentKinds : undefined,
    lineNumbers: lineNumbers.length ? lineNumbers : undefined,
    doneFilter,
  });
}

// ---------- Helpers ----------

function keywordOrFilter(keywords: string[], fields: string[]): string | null {
  if (!keywords.length) return null;
  const parts: string[] = [];
  for (const kw of keywords) {
    const safe = kw.replace(/[,()*%]/g, " ").trim();
    if (!safe) continue;
    for (const f of fields) parts.push(`${f}.ilike.%${safe}%`);
  }
  return parts.length ? parts.join(",") : null;
}

const MAX_RESULTS = 500;

// ---------- Main server function ----------

export const runAiSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data, context }): Promise<SearchResponse> => {
    const { supabase } = context;
    const { projectId, question, scope } = data;

    const plan = await buildPlanFromQuery(question);

    // Pre-resolve project to lines to equipment scope.
    const { data: linesRows, error: linesErr } = await supabase
      .from("lines")
      .select("id, number, project_id")
      .eq("project_id", projectId);
    if (linesErr) throw new Error(linesErr.message);
    const allLines = (linesRows ?? []).filter((l) => {
      if (scope.lineId && l.id !== scope.lineId) return false;
      if (plan.lineNumbers && plan.lineNumbers.length > 0 && !plan.lineNumbers.includes(l.number)) return false;
      return true;
    });
    const lineIds = allLines.map((l) => l.id);
    const lineNumberById = new Map(allLines.map((l) => [l.id, l.number] as const));

    if (lineIds.length === 0 && !plan.sources.includes("common_notes")) {
      return { plan, results: [], truncated: false };
    }

    // Equipment in scope
    let equipmentQuery = supabase
      .from("plant_equipment")
      .select("id, name, kind, line_id")
      .is("deleted_at", null);
    if (lineIds.length > 0) equipmentQuery = equipmentQuery.in("line_id", lineIds);
    if (scope.equipmentId) equipmentQuery = equipmentQuery.eq("id", scope.equipmentId);
    if (plan.equipmentKinds && plan.equipmentKinds.length > 0)
      equipmentQuery = equipmentQuery.in("kind", plan.equipmentKinds);
    if (plan.equipmentNameLike)
      equipmentQuery = equipmentQuery.ilike("name", `%${plan.equipmentNameLike}%`);

    const { data: equipRows, error: equipErr } = await equipmentQuery;
    if (equipErr) throw new Error(equipErr.message);
    const equipment = equipRows ?? [];
    const equipmentById = new Map(equipment.map((e) => [e.id, e] as const));
    const equipmentIds = equipment.map((e) => e.id);

    const results: SearchResult[] = [];
    let truncated = false;

    // ----- 1. Equipment settings -----
    if (plan.sources.includes("settings") && equipmentIds.length > 0) {
      let q = supabase
        .from("equipment_settings")
        .select(
          "id, title, body, updated_at, plant_equipment_id, setting_photos(storage_path), setting_files(storage_path, file_name)",
        )
        .in("plant_equipment_id", equipmentIds)
        .is("deleted_at", null)
        .limit(MAX_RESULTS);
      const f = keywordOrFilter(plan.keywords, ["title", "body"]);
      if (f) q = q.or(f);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const eq = equipmentById.get(r.plant_equipment_id);
        results.push({
          id: r.id,
          source: "settings",
          title: r.title ?? "",
          body: r.body ?? "",
          done: null,
          line_number: eq ? (lineNumberById.get(eq.line_id) ?? null) : null,
          plant_kind: eq?.kind ?? null,
          equipment_name: eq?.name ?? null,
          component_type: null,
          component_name: null,
          attachments: [
            ...((r.setting_photos as { storage_path: string }[] | null) ?? []).map((p) => ({
              kind: "photo" as const,
              storage_path: p.storage_path,
              file_name: null,
            })),
            ...((r.setting_files as { storage_path: string; file_name: string | null }[] | null) ?? []).map(
              (f) => ({ kind: "file" as const, storage_path: f.storage_path, file_name: f.file_name }),
            ),
          ],
          updated_at: r.updated_at,
        });
      }
    }

    // ----- 2. Checklist items -----
    if (plan.sources.includes("checklist_items") && equipmentIds.length > 0) {
      // Need to navigate equipment groups, component types, components, and checklist items.
      const { data: groups, error: gErr } = await supabase
        .from("equipment_groups")
        .select(
          `id, plant_equipment_id, component_types(id, name, components(id, name)), components(id, name, component_type_id)`,
        )
        .in("plant_equipment_id", equipmentIds)
        .is("deleted_at", null);
      if (gErr) throw new Error(gErr.message);

      // Build maps for component & component_type
      type CompInfo = { name: string; equipmentId: string; componentTypeName: string | null };
      const componentInfo = new Map<string, CompInfo>();
      const typeInfo = new Map<string, { name: string; equipmentId: string }>();
      for (const g of (groups ?? []) as any[]) {
        const eqId = g.plant_equipment_id as string;
        for (const t of g.component_types ?? []) {
          typeInfo.set(t.id, { name: t.name, equipmentId: eqId });
          if (plan.componentTypeLike && !String(t.name).toLowerCase().includes(plan.componentTypeLike.toLowerCase()))
            continue;
          for (const c of t.components ?? []) {
            componentInfo.set(c.id, { name: c.name, equipmentId: eqId, componentTypeName: t.name });
          }
        }
        for (const c of g.components ?? []) {
          const typeName = c.component_type_id
            ? typeInfo.get(c.component_type_id)?.name ?? null
            : null;
          if (
            plan.componentTypeLike &&
            (!typeName || !typeName.toLowerCase().includes(plan.componentTypeLike.toLowerCase()))
          ) {
            continue;
          }
          componentInfo.set(c.id, { name: c.name, equipmentId: eqId, componentTypeName: typeName });
        }
      }

      const componentIds = Array.from(componentInfo.keys());
      const typeIds = Array.from(typeInfo.keys()).filter((id) => {
        if (!plan.componentTypeLike) return true;
        return typeInfo.get(id)?.name.toLowerCase().includes(plan.componentTypeLike.toLowerCase());
      });

      const fetchItems = async (col: "component_id" | "component_type_id", ids: string[]) => {
        if (ids.length === 0) return [];
        let q = supabase
          .from("checklist_items")
          .select("id, label, note, done, updated_at, component_id, component_type_id, item_photos(storage_path), item_files(storage_path, file_name)")
          .in(col, ids)
          .is("deleted_at", null)
          .limit(MAX_RESULTS);
        const f = keywordOrFilter(plan.keywords, ["label", "note"]);
        if (f) q = q.or(f);
        if (plan.doneFilter === "done") q = q.eq("done", true);
        if (plan.doneFilter === "not_done") q = q.eq("done", false);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
      };

      const [byComp, byType] = await Promise.all([
        fetchItems("component_id", componentIds),
        fetchItems("component_type_id", typeIds),
      ]);

      for (const r of [...byComp, ...byType] as any[]) {
        let eqId: string | null = null;
        let compName: string | null = null;
        let typeName: string | null = null;
        if (r.component_id && componentInfo.has(r.component_id)) {
          const c = componentInfo.get(r.component_id)!;
          eqId = c.equipmentId;
          compName = c.name;
          typeName = c.componentTypeName;
        } else if (r.component_type_id && typeInfo.has(r.component_type_id)) {
          const t = typeInfo.get(r.component_type_id)!;
          eqId = t.equipmentId;
          typeName = t.name;
        }
        const eq = eqId ? equipmentById.get(eqId) : undefined;
        results.push({
          id: r.id,
          source: "checklist_items",
          title: r.label ?? "",
          body: r.note ?? "",
          done: r.done,
          line_number: eq ? (lineNumberById.get(eq.line_id) ?? null) : null,
          plant_kind: eq?.kind ?? null,
          equipment_name: eq?.name ?? null,
          component_type: typeName,
          component_name: compName,
          attachments: [
            ...((r.item_photos as { storage_path: string }[] | null) ?? []).map((p) => ({
              kind: "photo" as const,
              storage_path: p.storage_path,
              file_name: null,
            })),
            ...((r.item_files as { storage_path: string; file_name: string | null }[] | null) ?? []).map(
              (f) => ({ kind: "file" as const, storage_path: f.storage_path, file_name: f.file_name }),
            ),
          ],
          updated_at: r.updated_at,
        });
      }
    }

    // ----- 3. Equipment notes -----
    if (plan.sources.includes("equipment_notes") && equipmentIds.length > 0) {
      let q = supabase
        .from("equipment_notes")
        .select("id, title, body, photo_path, file_path, file_name, updated_at, equipment_id")
        .in("equipment_id", equipmentIds)
        .limit(MAX_RESULTS);
      const f = keywordOrFilter(plan.keywords, ["title", "body"]);
      if (f) q = q.or(f);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const eq = equipmentById.get(r.equipment_id);
        const attachments: SearchResult["attachments"] = [];
        if (r.photo_path) attachments.push({ kind: "photo", storage_path: r.photo_path, file_name: null });
        if (r.file_path) attachments.push({ kind: "file", storage_path: r.file_path, file_name: r.file_name });
        results.push({
          id: r.id,
          source: "equipment_notes",
          title: r.title ?? "",
          body: r.body ?? "",
          done: null,
          line_number: eq ? (lineNumberById.get(eq.line_id) ?? null) : null,
          plant_kind: eq?.kind ?? null,
          equipment_name: eq?.name ?? null,
          component_type: null,
          component_name: null,
          attachments,
          updated_at: r.updated_at,
        });
      }
    }

    // ----- 4. PA notes -----
    if (plan.sources.includes("pa_notes") && lineIds.length > 0) {
      let q = supabase
        .from("pa_notes")
        .select("id, title, body, photo_path, file_path, file_name, kind, line_id, updated_at")
        .in("line_id", lineIds)
        .limit(MAX_RESULTS);
      const f = keywordOrFilter(plan.keywords, ["title", "body"]);
      if (f) q = q.or(f);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const attachments: SearchResult["attachments"] = [];
        if (r.photo_path) attachments.push({ kind: "photo", storage_path: r.photo_path, file_name: null });
        if (r.file_path) attachments.push({ kind: "file", storage_path: r.file_path, file_name: r.file_name });
        results.push({
          id: r.id,
          source: "pa_notes",
          title: r.title ?? "",
          body: r.body ?? "",
          done: null,
          line_number: lineNumberById.get(r.line_id) ?? null,
          plant_kind: (r.kind as string) ?? null,
          equipment_name: "PA",
          component_type: null,
          component_name: null,
          attachments,
          updated_at: r.updated_at,
        });
      }
    }

    // ----- 5. Common notes -----
    if (plan.sources.includes("common_notes")) {
      let q = supabase
        .from("common_folder_notes")
        .select("id, title, body, photo_path, file_path, file_name, updated_at, project_id")
        .eq("project_id", projectId)
        .limit(MAX_RESULTS);
      const f = keywordOrFilter(plan.keywords, ["title", "body"]);
      if (f) q = q.or(f);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const attachments: SearchResult["attachments"] = [];
        if (r.photo_path) attachments.push({ kind: "photo", storage_path: r.photo_path, file_name: null });
        if (r.file_path) attachments.push({ kind: "file", storage_path: r.file_path, file_name: r.file_name });
        results.push({
          id: r.id,
          source: "common_notes",
          title: r.title ?? "",
          body: r.body ?? "",
          done: null,
          line_number: null,
          plant_kind: null,
          equipment_name: "Common",
          component_type: null,
          component_name: null,
          attachments,
          updated_at: r.updated_at,
        });
      }
    }

    if (results.length > MAX_RESULTS) {
      truncated = true;
      results.length = MAX_RESULTS;
    }

    return { plan, results, truncated };
  });
