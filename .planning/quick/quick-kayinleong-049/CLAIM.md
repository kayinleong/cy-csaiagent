# Claim: quick-kayinleong-049
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: claimed
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

_(pending)_

## Verification

_(pending)_
