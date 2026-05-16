# Fix: PWA Sync badge counts stale failed outbox items as pending

## Root cause

`outboxCount()` in `public/sw.js` counts every row in the outbox, including rows already marked `failed: true` from a prior 4xx (likely a one-time 401 JWT-expired on the installed PWA where the token didn't refresh before the SW replayed the queue). The UI receives that single number and shows "5 pending edits" forever, even though no real edit is waiting. On the browser the same queue is empty, so it shows 0.

## Changes (smallest possible)

### 1. `public/sw.js`

- Split outbox stats into `{ pending, failed }`:
  - New helper `outboxStats()` iterates `outboxAll()` once and counts `failed === true` vs not.
  - `broadcastQueueCount()` now posts `{ type: "rhfield-queue", count: pending, failed }` (keep `count` = pending only so existing UI keeps working; add new `failed` field).
- 401 JWT refresh-and-retry-once:
  - In `flushQueue()`, when a response is 401 (or body contains `JWT expired` / `PGRST301`), do **not** mark failed. Instead:
    - Broadcast `{ type: "rhfield-auth-expired" }` and `break` out of the loop (stalled).
    - The client (see step 2) refreshes the Supabase session, which causes any next request to flow through `rememberAuth`, updating `latestAuthHeader`. The client then calls `triggerFlush()` again.
  - On retry, before `fetch(item.url, ...)`, if `latestAuthHeader` exists and differs from `item.headers.authorization`, overwrite `item.headers.authorization` with `latestAuthHeader`. Track `item.authRetries` (default 0); only allow this swap once per item. If a second 401 occurs, fall through to the existing failed-marking path.
- New message handlers:
  - `rhfield-outbox-retry-failed`: clear `failed`/`lastStatus`/`lastError` on all failed rows, then `flushQueue()`.
  - `rhfield-outbox-discard-failed`: delete every row where `failed === true`, then `broadcastQueueCount()` + `broadcastDataChanged()`.
- `rhfield-flush-complete` payload: include `failedCount` alongside `remaining` so the UI updates immediately after a flush.

### 2. `src/lib/offline.ts`

- `useOfflineStatus()` adds `failed: number` to its return value.
- Update `onMsg` handler:
  - On `rhfield-queue`: `setPending(d.count); setFailed(d.failed ?? 0)`.
  - On `rhfield-flush-complete`: also `setFailed(d.failedCount ?? 0)`.
  - On `rhfield-auth-expired`: call `supabase.auth.refreshSession()` (dynamic import to avoid SSR), then `triggerFlush()` once.
- Export two helpers used by the UI:
  - `retryFailedOutbox()` → `send("rhfield-outbox-retry-failed")`
  - `discardFailedOutbox()` → `send("rhfield-outbox-discard-failed")`

### 3. `src/components/SyncCloud.tsx`

- Read `failed` from `useOfflineStatus()`.
- In the popover, when `failed > 0`, render one extra row below "Pending edits":
  - Label: `Failed (N)` in destructive color.
  - Two tiny text buttons: `Retry` → `retryFailedOutbox()`, `Discard` → `discardFailedOutbox()` (with a `confirm()` since the project memory requires a deletion warning).
- The header cloud icon dot badge stays driven by `pending` only (not failed), so a real "up to date" state shows no dot even when failed items linger.

## Files touched

- `public/sw.js` — outbox stats split, 401 refresh hook, retry/discard message handlers.
- `src/lib/offline.ts` — surface `failed`, handle `auth-expired`, expose retry/discard.
- `src/components/SyncCloud.tsx` — show Failed row with Retry/Discard.

No other files change. No refactor. No schema or route changes. Existing pending/sync behavior is preserved; only the counting and the new Failed control are added.

## Activation note

The SW version bumps from `v8` → `v9` so installed PWAs pick up the new logic on next load. The user will need to open the app once with connectivity for the new SW to activate; the stale 5 failed rows will then appear under "Failed" with a Discard button.
