# Claim: quick-kayinleong-008

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-12
- status: done
- summary: Fix RateLimitError NOT_FOUND on a user's first chat — decrement() must create the rateBudgets/{uid} doc with set() when it does not yet exist (it previously fell through to update(), which throws "No document to update").

## What will change

**Symptom (runtime):** Sending the very first chat for a freshly-created user throws:

```
Error: 5 NOT_FOUND: No document to update:
  projects/cy-csaiagent/databases/(default)/documents/rateBudgets/<uid>
    at Module.decrement (src/ratelimit/index.ts:114)
    at async onFinish (app/api/chat/route.ts:614)
POST /api/chat 500
```

**Root cause:** `src/ratelimit/index.ts` `decrement()` reads `rateBudgets/{uid}`.
On a user's first chat the doc does not exist, so `check()` short-circuits ("budget
fresh") and `decrement()` skips its `if (snap.exists)` window-reset branch and falls
straight through to `rateBudgetsRef().doc(uid).update({...increment...})`. Firestore's
`update()` requires an existing document, so it throws `5 NOT_FOUND`. The throw happens
inside `onFinish` after a successful stream, surfacing as a 500 ("failed to pipe response").

**Planned edit:** Collapse the "no doc yet" and "window expired" cases into a single
`set()` path. `set()` (no merge) creates-or-overwrites a full `RateBudgetDoc`, which is
correct for both — first request (create) and window reset (overwrite). The in-window
steady state keeps using the atomic `FieldValue.increment()` `update()`. Add regression
tests locking both `set()` paths.

## What has changed

- `src/ratelimit/index.ts` — `decrement()` rewritten:
  - Hoisted the doc ref to a local `const ref` (read once, write once).
  - New `needsInit = !snap.exists || isWindowExpired(...)` guard. When true, write the
    fresh window doc via `ref.set({ requestCount: 1, tokenCount: tokens, windowStart:
    serverTimestamp(), tenantId, ownerUid })` and return.
  - The previous window-expired branch (which used `update()` on an existing doc) is
    folded into this `set()` path — behaviorally identical for the reset case (all five
    `RateBudgetDoc` fields are written) and now also handles the first-request case.
  - Steady-state path unchanged: `ref.update({ requestCount: increment(1), tokenCount:
    increment(tokens) })`.
  - Cast on the set payload changed from `Partial<RateBudgetDoc> & { windowStart:
    FieldValue }` (an `update()`-shaped cast) to `RateBudgetDoc` (the literal supplies all
    five fields; `set()` requires the full `WithFieldValue<RateBudgetDoc>`).
- `src/ratelimit/window.test.ts` — added `describe('decrement (first request + window
  reset — set() path)')` with two tests:
  1. **first request (no doc)** → asserts `set()` called once with `{requestCount:1,
     tokenCount, tenantId:'d2', ownerUid}` and `windowStart` present, and `update()` NOT
     called. This reproduces the production bug (old code called `update()` here).
  2. **expired window (doc exists)** → asserts the reset goes through `set()` (not
     `update()`) with `{requestCount:1, tokenCount}`.

## Verification

**Self-audit of the diff (regression-prevention):** The change is confined to
`decrement()`. `check()` is untouched. The steady-state increment path (the hot path for
every chat after the first) is byte-identical except for the `rateBudgetsRef().doc(uid)`
→ `ref` local-variable hoist, which is a pure refactor of the same call. The only
behavioral changes are: (a) first request now `set()`s instead of throwing, and (b) the
window-expired reset now uses `set()` instead of `update()` — equivalent because both
write all five `RateBudgetDoc` fields to an existing doc.

**Regression surface (each ruled out):**
- *In-window steady state (the common path)* — still `update({increment})`; the existing
  "Behavior 2" test (existing doc, fresh window) still asserts `update()` with
  `FieldValue.increment(1)` / `increment(tokens)`. Green.
- *Window reset* — previously `update()` on an existing doc; now `set()`. New test +
  existing "Behavior 3" (via `check()`) both green. Result for the doc is identical (full
  5-field overwrite).
- *`check()` / cost-DoS guard (T-01-20)* — not touched; all five `check()` behavior tests
  (1a–1e) still green.
- *Chat route `onFinish` (the 500 site)* — `decrement` is fully mocked in
  `app/api/chat/route.test.ts` and `tests/chat-route.test.ts`; neither asserts
  `set`/`update` internals, so the internal change is invisible to them. Both suites green.
- *Concurrency* — the first-request `set()` carries the same benign TOCTOU as the
  pre-existing reset branch (two simultaneous first requests could each write
  `requestCount:1`, losing one increment). This is unchanged in character from the prior
  reset path and acceptable for a daily budget; not expanded here (minimal-fix scope).

**Automated gates (HEAD c3d40d9):**
- `npx tsc --noEmit` → **0 errors**.
- `npx vitest run src/ratelimit/window.test.ts` → **11 passed** (9 existing + 2 new).
- `npx vitest run src/ratelimit/window.test.ts app/api/chat/route.test.ts
  tests/chat-route.test.ts` → **58 passed** (3 files).
- `npx eslint src/ratelimit/index.ts src/ratelimit/window.test.ts` → **0 errors**.

**Red→green proof:** the new "first request (no doc)" test asserts `set()` is called and
`update()` is NOT. Against the old code (which called `update()` on a missing doc) this
assertion fails — so the test genuinely locks the fix.

**Not verified here:** a live browser "first chat for a brand-new account → no 500" check
(no dev-server run this session). The unit test reproduces the exact failing precondition
(`snap.exists === false` → no `update()`), so the fix is locked at the source layer.
