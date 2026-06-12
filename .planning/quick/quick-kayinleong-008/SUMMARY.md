---
quick_id: quick-kayinleong-008
status: complete
date: 2026-06-12
commit: c3d40d9
---

# Summary: quick-kayinleong-008

Fixed the `/api/chat` 500 that fired on a user's **first** message:
`5 NOT_FOUND: No document to update: .../rateBudgets/<uid>`.

## Root cause

`src/ratelimit/index.ts` `decrement()` wrote the per-agent budget with
`rateBudgetsRef().doc(uid).update(...)`. On the first chat the `rateBudgets/{uid}` doc
does not exist yet (`check()` treats a missing doc as "budget fresh" and returns early),
so `update()` threw `NOT_FOUND`. The throw landed in the chat route's `onFinish`
callback after a successful stream, surfacing as `POST /api/chat 500`.

## Fix

`decrement()` now `set()`s a fresh `RateBudgetDoc` whenever the doc is missing **or** the
window has expired (one path, since both write all five fields). The in-window steady
state still uses the atomic `FieldValue.increment()` `update()`.

## Files

- `src/ratelimit/index.ts` — `decrement()`: `needsInit` guard → `ref.set(...)` for
  first-request/reset; `ref.update({increment})` for steady state; cast tightened to
  `RateBudgetDoc` for the `set()` payload.
- `src/ratelimit/window.test.ts` — +2 regression tests (first-request `set()`,
  expired-window `set()` reset).

## Verification

- `npx tsc --noEmit` → 0 errors
- `npx vitest run src/ratelimit/window.test.ts` → 11 passed (9 + 2 new)
- `npx vitest run` (ratelimit + both chat-route suites) → 58 passed
- `npx eslint src/ratelimit/index.ts src/ratelimit/window.test.ts` → 0 errors
- Red→green: the first-request test asserts `set()` (not `update()`) — fails against the
  pre-fix code.

Full regression report in `CLAIM.md`. Code commit: `c3d40d9`.

Remaining human check: live "first chat on a brand-new account → no 500" in the browser.
