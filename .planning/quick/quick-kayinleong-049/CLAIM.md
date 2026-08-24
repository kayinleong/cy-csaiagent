# Claim: quick-kayinleong-049
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: done
- summary: Admin can reset a specific user's rate-limit budget. Today a user who hits TOKEN_CAP (50k tokens / 24h) is locked out of chat until the window rolls over on its own, with no way for an admin to clear it.

## Context

`src/ratelimit/check()` throws `RateLimitError` (→ HTTP 429) once
`requestCount >= REQUEST_CAP (100)` or `tokenCount >= TOKEN_CAP (50_000)` inside the
rolling `WINDOW_MS` (24h). The only way the budget clears is `isWindowExpired()` becoming
true — i.e. waiting out the remainder of the day. There is no admin escape hatch, which
matters because:

  - `TOKEN_CAP = 50_000` per 24h against `stepCountIs(5)` + RAG is already flagged as
    too low (carried from quick-046 / RESEARCH-chat-persistence.md RC-4), so a normal
    day of use can 429 an agent for the rest of the day.
  - quick-046's `consumeStream()` fix means previously-free aborted turns now count, so
    budget burns sooner than before.
  - A pilot agent blocked at 11pm is exactly the failure the product exists to prevent.

## What will change

- `src/ratelimit/index.ts`: new `resetBudget(uid)` — writes
  `{requestCount: 0, tokenCount: 0, windowStart: serverTimestamp(), tenantId, ownerUid}`
  via `set()`. Chosen over deleting the doc so the reset is observable and the doc keeps
  its identity fields; `set()` also mirrors what `decrement()` already does on init/expiry,
  and covers the no-doc case without a NOT_FOUND.
- `app/[lang]/(admin)/users/actions.ts`: new `resetUserRateLimit(uid)` Server Action using
  the established three-layer admin gate (group layout → page `requireRole(['admin'])` →
  action re-asserts `role === 'admin'` from the VERIFIED token) plus an `audit.log`
  entry. Same `{ok:true} | {ok:false, error}` union as `createUser`.
- `app/[lang]/(admin)/users/page.tsx`: batch-read the listed users' budgets with a single
  `getAll()` (NOT one read per user — that N+1 is the class of problem quick-046 just
  fixed) so the admin can see who is actually near the cap before resetting.
- `app/[lang]/(admin)/users/user-list.tsx`: per-row usage readout + a confirm-gated
  "Reset limit" action.
- `src/i18n/messages/{en,ms,zh}.json`: `adminUsers` keys at parity (CI-enforced).
- Tests: `resetBudget` behaviour + the action's admin gate.

Chosen surface: `(admin)/users`, not `(admin)/usage`. The usage dashboard is analytics the
`read-only` role can see, and it must not host a mutating control; `(admin)/users` is
already admin-only and already has the Server Action pattern.

No `firestore.rules` change needed: the Server Action writes through the Admin SDK
(`rateBudgetsRef()` from collections.ts), which bypasses rules. The owner-scoped
`rateBudgets` client rules stay as they are — clients still cannot touch another agent's
budget.

## What has changed

One commit (`6b92b6d`).

### Core (`src/ratelimit/index.ts`)
- `resetBudget(uid)` — `{requestCount: 0, tokenCount: 0, windowStart: serverTimestamp(),
  tenantId, ownerUid}` via `set()`. A fresh `windowStart` is the part that actually
  unblocks `check()`; zeroed counters alone would still sit inside the old window.
- `readBudget(uid)` — diagnostics; reports `expired` so a stale window is
  distinguishable from a live one (a stale one needs no reset).

### Server Actions (`app/[lang]/(admin)/users/actions.ts`)
- `resetUserRateLimit(uid)` — three-layer admin gate + `audit.log` `ratelimit-reset`.
  Untrusted uid is trimmed and rejected when empty, >128 chars, or containing `/`.
- `listRateBudgets(uids)` — ONE batched `adminDb.getAll()`. Returns a plain shape;
  `windowStart` never leaves the server.

### UI
- `page.tsx` batch-fetches budgets (non-blocking) and passes them down.
- `user-list.tsx` — "Usage (24h)" column (destructive styling at cap), confirm-gated
  Reset, `useTransition` + sonner, local row clear on success.
- `adminUsers` +12 i18n keys across en/ms/zh.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **900 passed**, 197 skipped (was 872; **+40** new: 8 ratelimit,
  20 action-gate, plus the i18n parity delta)
- `npx eslint app src` → **0 errors** (66 pre-existing warnings)
- `npm run build` → exit 0, 72 static pages

### What the new tests actually pin
- `resetBudget` writes all five `RateBudgetDoc` fields (an unmerged `set()` must be
  complete or the doc loses keys `check()`/`decrement()` read), uses `set()` **not**
  `update()` so a never-seen uid cannot throw NOT_FOUND, and is idempotent.
- End-to-end budget semantics: an agent over `TOKEN_CAP` in a live window is rejected by
  `check()`, and passes after a reset.
- The Layer-3 gate refuses `senior-coach`, `new-agent` and **`read-only`** — the last
  matters because the `(admin)` layout admits read-only into the group, so this action's
  own check is the thing that stops it mutating.
- A failed reset returns `unknown` (never a raw Firestore error) and is **not** audited.
- `listRateBudgets` makes exactly one `getAll()` call for N uids, short-circuits the
  empty list (`getAll()` throws with no refs), filters malformed uids, and returns no
  `toDate` anywhere in its payload.

### Regression surface audited
- **`decrement()` and `check()` untouched.** `resetBudget` writes the same doc shape
  `decrement()` already writes on init/expiry, so the two cannot disagree.
- **No `firestore.rules` change**, so client-side owner scoping on `rateBudgets` is
  unchanged — an agent still cannot read or write another agent's budget. The action
  reaches Firestore through the Admin SDK, which bypasses rules by design (the
  "never admin from a user-facing path" rule targets agent tools, not admin actions).
- **`user-list.tsx` gained two columns**; the existing email/role/coach cells and the
  Paginator are unchanged. `budgets` is an optional prop defaulting to `[]`, so any other
  caller of `UserList` keeps working.
- **No N+1 introduced** — the budget read is one batched round-trip, guarded by a test.
- **PII**: the audit `raw` map carries only the target uid; a test asserts no `@`
  reaches it. The usage readout is counts only.

### Honest gaps — NOT verified
1. **No authenticated click-through.** `/[lang]/users` is admin-gated, so the usage
   column, the confirm dialog, the toast, and the actual Firestore write are unverified
   in a browser. The action logic is unit-tested against mocks, not live Firestore.
2. **BM/中文 copy is machine-assisted** — needs Derek's native sign-off, same as the
   `adminLeads` and `errors.routeError*` namespaces.
3. **`TOKEN_CAP` itself is unchanged.** This claim adds an escape hatch; it does not
   raise the cap. Raising it is still the separate behavioural claim carried from
   quick-046 (RC-4), and this reset makes that less urgent, not moot.

### Pre-existing flake identified (out of scope, filed separately)
While running the gate 3× I finally pinned the intermittent failure that had been
appearing as unnamed "load flake" since quick-046:
`src/agents/reply/reply.test.ts` > "run({ injectedSopResult: <hit> }) returns a draft
with non-empty sopDocIds" — ~1 in 15 full-suite runs, **0 in 12 isolated runs**.

Diagnosed but deliberately not fixed here: that file has **zero `vi.mock` calls** and does
`await import('@/src/agents/reply')` in the test body. `reply/index.ts:34-38` value-imports
`./tools`, `tools.ts:24` imports `@/src/rag`, which reaches `@/src/firebase/admin`, whose
module scope calls `initializeApp(...)`. So a unit test of pure logic initializes the real
Admin SDK, and that races under parallel vitest workers. `run()` with `injectedSopResult`
supplied is pure, so the assertion cannot be wrong. Filed as its own task rather than
fixed blind inside an unrelated claim.
