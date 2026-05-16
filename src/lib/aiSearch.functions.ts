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

// ---------- AI plan generation ----------

async function buildPlanFromAI(question: string): Promise<z.infer<typeof PlanSchema>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    // Fallback to a naive plan: search everything for the question text
    return PlanSchema.parse({
      sources: [
        "settings",
        "checklist_items",
        "equipment_notes",
        "pa_notes",
        "common_notes",
      ],
      keywords: question.split(/\s+/).filter((w) => w.length > 2).slice(0, 6),
    });
  }

  const system = `You translate plant-commissioning search questions into a JSON query plan.
Return ONLY a JSON object matching this schema (no prose):
{
  "sources": string[],   // any of: settings, checklist_items, equipment_notes, pa_notes, common_notes, component_files, component_photos
  "keywords": string[],  // case-insensitive substrings to match in title/body/label/name (include synonyms)
  "equipmentKinds": ("kiln"|"shs")[] | null,
  "lineNumbers": number[] | null,
  "equipmentNameLike": string | null,    // single substring for equipment name
  "componentTypeLike": string | null,    // single substring for component type
  "doneFilter": "any"|"done"|"not_done"  // only relevant for checklist_items
}
Pick the smallest set of sources that answers the question.
If the user asks about "settings" pick "settings".
If they ask about "checks", "status", "sensors", "items", "tasks" → "checklist_items".
If they ask about "notes" → equipment_notes (and pa_notes when PA mentioned).
If they ask about "files" or "photos" → include component_files / component_photos.
Always include 1-5 keywords (lowercase, no punctuation). If the question is in another language, also add English equivalents.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI rate limit exceeded. Please retry in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const merged = {
    sources: ["settings", "checklist_items", "equipment_notes"],
    keywords: [],
    doneFilter: "any",
    ...(parsed as object),
  } as Record<string, unknown>;

  // Strip nulls so zod defaults apply
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];

  return PlanSchema.parse(merged);
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

    const plan = await buildPlanFromAI(question);

    // Pre-resolve project → lines → equipment scope
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
      // Need to navigate: equipment_groups → component_types & components → checklist_items
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
