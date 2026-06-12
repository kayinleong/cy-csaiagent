---
quick_id: quick-kayinleong-008
status: complete
date: 2026-06-12
---

# Quick Task quick-kayinleong-008: Fix RateLimitError NOT_FOUND on first chat

## Problem

`/api/chat` returns 500 on a user's first message:

```
5 NOT_FOUND: No document to update: .../rateBudgets/<uid>
  at Module.decrement (src/ratelimit/index.ts:114)
  at async onFinish (app/api/chat/route.ts:614)
```

`decrement()` calls `rateBudgetsRef().doc(uid).update(...)`, but on the first chat the
`rateBudgets/{uid}` doc has never been created (`check()` returns early for a missing
doc), so `update()` throws.

## Task

**File:** `src/ratelimit/index.ts` (`decrement`)

- **action:** Collapse the "no doc yet" and "window expired" branches into one `set()`
  path that writes a fresh full `RateBudgetDoc` (`requestCount:1`, `tokenCount:tokens`,
  `windowStart: serverTimestamp()`, `tenantId`, `ownerUid`). Keep the atomic
  `FieldValue.increment()` `update()` for the in-window steady state.
- **verify:** `npx tsc --noEmit`; `npx vitest run src/ratelimit/window.test.ts`.
- **done:** First chat creates the budget doc instead of throwing; steady-state and
  window-reset behavior preserved.

**File:** `src/ratelimit/window.test.ts` (regression tests)

- **action:** Add a `decrement` describe block asserting (1) first request with no doc →
  `set()` called, `update()` not; (2) expired window → `set()` reset, `update()` not.
- **verify:** tests green; the first-request test fails against the pre-fix code.
- **done:** Both `set()` paths locked.

## Out of scope

- Concurrency hardening of the first-request `set()` (pre-existing benign TOCTOU on the
  reset path; not expanded — minimal-fix scope).
