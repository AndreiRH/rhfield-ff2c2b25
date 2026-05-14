## Problem

Two issues are stopping the dashboard from showing anything:

1. **403 on every query**: `permission denied for function has_any_role`. The RLS policies use `has_role` / `has_any_role`, but the `authenticated` Postgres role was never granted EXECUTE on those functions, so every SELECT against `projects`, `lines`, etc. is rejected.
2. **No BlueW1 row exists**: the previous migration created the schema but didn't actually insert the `BlueW1` project + 10 lines + equipment scaffold. So even once RLS is fixed, the list will still be empty.

## Fix (one migration)

```sql
-- 1. Allow signed-in users to execute the role-check helpers
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_any_role(uuid, public.app_role[]) to authenticated;

-- 2. Seed BlueW1 if it doesn't exist
insert into public.projects (name) values ('BlueW1')
on conflict do nothing;

-- 3. Seed lines 1..10 for BlueW1
-- 4. Seed Kiln + SHS equipment groups per chapter (Assembly, Wiring, Cold Comm, Hot Comm)
-- 5. Seed placeholder components + a few starter checklist items
-- (engineers can edit/extend in the UI)
```

The seed steps will be idempotent (guarded by `not exists` / `on conflict`) so re-running is safe.

## After the migration

- Reload the dashboard — you'll see BlueW1 with 10 lines at 0% progress.
- You can start ticking checklist items, uploading photos, adding milestones.

## Out of scope for this fix

- Promoting your account to `admin` (you're currently `engineer`, which can read/write everything except create new projects). Tell me when you want admin and I'll add a one-line grant for your user id.
- Offline sync, project-creation UI — still planned for later as discussed.

Approve and I'll apply the migration.