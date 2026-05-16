## Goal

Add a migration that ensures `public.replicate_checklist_item` handles checklist items linked via `component_type_id` (not just `component_id`), per the spec.

## Finding from investigation

The current `replicate_checklist_item` function in the database **already contains** a `component_type_id` branch that matches your spec:

- Looks up `template_id` from `component_types` where `id = new.component_type_id`
- Inserts into sibling `component_types` sharing the same `template_id` (excluding the origin)
- Handles `parent_item_id` for nested sub-items by resolving the parent's template within each sibling
- Skips replication when a sibling already has any item with the new item's `template_id` (idempotency guard)

The `ci_replicate` trigger (`AFTER INSERT`) is attached and enabled.

So the reported symptom (wiring / cold-commissioning items not replicating across lines) is **not explained by a missing branch**. Likely real causes to verify with you afterward:

1. The `not exists` idempotency guard. The guard skips replication into a sibling `component_type` if it already contains *any* checklist item with `template_id = new.template_id`. For a fresh row this is fine, but if the front-end ever pre-creates items with a fixed `template_id`, the second insert is silently dropped.
2. The new item is being created on a `component_type` whose `template_id` is NULL (e.g. legacy rows from before `set_template_id_ci` / `set_template_id_ct` existed). With no shared template, there are no "siblings" to replicate into.
3. The `app.replicating = 'on'` session flag is leaking from another transaction (rare but possible if a previous trigger errored mid-run).

## What the migration will do

Re-create `public.replicate_checklist_item` with exactly the behavior described in your message:

- Keep the existing `component_id` branch untouched.
- Re-state the `component_type_id` branch with the same template-lookup → sibling-replicate → parent-resolve logic.
- Preserve `SECURITY DEFINER`, `search_path = public`, and the `app.replicating` re-entrancy guard.
- Preserve the `not exists` idempotency check (so re-running on already-replicated data is safe).

No frontend changes. No trigger changes. No data backfill.

## Suggested follow-up after migration is applied

Pick one wiring or cold-commissioning checklist item that you expected to replicate but didn't, and share:

- the item's `id`
- its `component_type_id` (or `component_id`)
- the line it was created on
- the other line(s) it should have appeared on

With that, we can pinpoint whether it's the idempotency guard, a NULL `template_id`, or something else — and write a one-shot backfill if needed.

## Files

- `supabase/migrations/<timestamp>_replicate_checklist_item_component_type.sql` (new)
