---
phase: 01-foundations
plan: "07"
subsystem: router-memory-ratelimit
tags: [intent-router, heuristic, dormant-classifier, shared-memory, messages-subcollection, leadContext-slots, journey-stage, ratelimit, rate-budget, tdd, framework-free, offline-tested]

# Dependency graph
requires:
  - "01-02 (test infra, vitest @/* alias, vi.hoisted pattern)"
  - "01-03 (rateBudgetsRef, messagesRef, leadContextRef, agentProfilesRef, typed converters)"
provides:
  - "src/router/heuristic.ts — route() always→coach; manual-override chip seam"
  - "src/router/classifier.ts — dormant LLM classifier seam (activates Phase 3)"
  - "src/router/index.ts — public re-export (route + dormant classifyIntent)"
  - "src/memory/conversation.ts — appendMessage (subcollection) + loadRecent (paginated)"
  - "src/memory/leadContext.ts — writeLeadSlot (slot-scoped, T-01-21)"
  - "src/memory/agentProfile.ts — updateJourneyStage + touchLastActive (D-10 seam)"
  - "src/memory/index.ts — public re-export of all three memory functions"
  - "src/ratelimit/window.ts — window math, caps, isWindowExpired (injectable clock)"
  - "src/ratelimit/index.ts — check (refuses before LLM, T-01-20) + decrement (real write, QUAL-07)"
affects:
  - "01-10 (stall-detect job): reads agentProfiles lastActiveAt via touchLastActive"
  - "01-11 (chat route): imports route, appendMessage, writeLeadSlot, check, decrement"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Heuristic router: pure function, framework-free, always→coach (D-03); override seam present from Phase 1"
    - "Dormant seam pattern: classifier.ts exports classifyIntent() throwing NotActivatedError — import boundary = Phase 3 activation trigger"
    - "Subcollection write: messagesRef(cid).add() — NOT conversationsRef().doc(cid).update({messages: arrayUnion(...)})"
    - "Slot-scoped Firestore update: only the named slot key + rollingSummary + updatedAt in the update object"
    - "Atomic ratelimit decrement: FieldValue.increment(1) and FieldValue.increment(tokens) — no read-modify-write race"
    - "vi.hoisted() pattern for Vitest mock variables (avoids ReferenceError from hoisting)"

key-files:
  created:
    - "src/router/heuristic.ts — route() function; 63 lines; no classifier import"
    - "src/router/classifier.ts — NotActivatedError + classifyIntent() stub; 50 lines"
    - "src/router/index.ts — re-exports route + classifyIntent + types; 18 lines"
    - "src/router/heuristic.test.ts — 5 tests (coach, finder-ish, override-finder, override-reply, no-classifier-call)"
    - "src/memory/conversation.ts — appendMessage + loadRecent; 56 lines"
    - "src/memory/leadContext.ts — writeLeadSlot; 60 lines"
    - "src/memory/agentProfile.ts — updateJourneyStage + touchLastActive; 55 lines"
    - "src/memory/index.ts — public re-exports; 19 lines"
    - "src/memory/memory.test.ts — 8 tests (subcollection, slot isolation, journey-stage)"
    - "src/ratelimit/window.ts — WINDOW_MS/REQUEST_CAP/TOKEN_CAP + isWindowExpired; 54 lines"
    - "src/ratelimit/index.ts — check + decrement + RateLimitError; 120 lines"
    - "src/ratelimit/window.test.ts — 9 tests (check-fresh, check-refuse, decrement-write, window-reset)"
  modified: []

key-decisions:
  - "route() always returns 'coach' in Phase 1 — classifyIntent is NOT imported by heuristic.ts (the import boundary is the Phase 3 activation trigger)"
  - "vi.hoisted() used for mock variables in all test files — prevents Vitest hoisting ReferenceError (same fix as 01-03)"
  - "isWindowExpired accepts both Date and Firestore Timestamp objects (toDate()) to handle real Firestore snapshots correctly"
  - "decrement() checks for window expiry before incrementing; reset path uses update() with explicit fields (not set()) to avoid converter issues with FieldValue.serverTimestamp()"
  - "loadRecent paginates with limitToLast() rather than limit() + reverse sort — returns messages in natural ascending order"

# Metrics
duration: 25min
completed: "2026-05-31"
---

# Phase 01 Plan 07: Router + Memory + Rate-limit Summary

**Heuristic router (always→coach) with dormant LLM-classifier seam + manual-override chip; shared memory layer (messages subcollection + leadContext agent-scoped slots + journey-stage seam); real per-agent rate limiter that refuses runaway conversations before the LLM call via the 01-03 rateBudgetsRef**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-31T11:24:00Z
- **Completed:** 2026-05-31T11:49:00Z
- **Tasks:** 3 (each TDD: RED + GREEN per task)
- **Files created:** 11 source files + 3 test files = 14 total
- **Tests:** 22 tests across 3 test files — all pass (`npx vitest run src/router src/memory src/ratelimit` exits 0)

## Accomplishments

### Task 1: Heuristic Router + Dormant Classifier Seam + Manual-Override

- `src/router/heuristic.ts` — `route(messages, opts?)` is pure, framework-free, and always returns `{ pillar:'coach', reason:'phase-1-single-pillar' }` unless `opts.override` is set (in which case it returns the override with `reason:'manual-override'`).
- `src/router/classifier.ts` — Dormant seam: `classifyIntent()` throws `NotActivatedError('LLM classifier activates in Phase 3...')`. NOT imported by `heuristic.ts`. The import boundary is the Phase-3 activation trigger.
- `src/router/index.ts` — Re-exports both `route` and the dormant `classifyIntent` so downstream consumers can reference the type/error class.
- 5 tests green: coach routing, finder-ish-still-coach, override-finder, override-reply, no-classifier-call.

### Task 2: Shared Memory — Messages Subcollection + LeadContext Slots + Journey-Stage Seam

- `src/memory/conversation.ts` — `appendMessage(cid, msg)` calls `messagesRef(cid).add(msg)` (the **subcollection** ref, never the parent conversation doc). Returns the new `mid`. `loadRecent(cid, n=20)` paginates with `limitToLast(n)` (T-01-22 over-read guard).
- `src/memory/leadContext.ts` — `writeLeadSlot(leadId, slot, value, summary?)` builds a slot-scoped update object containing ONLY the named slot + (optionally) `rollingSummary` + `updatedAt`. `finderSlot`/`replySlot` are never touched by a `coachSlot` write.
- `src/memory/agentProfile.ts` — `updateJourneyStage(uid, stage, checkpoint?)` updates `journeyStage` + `lastActiveAt` (always) + `currentCheckpoint` (when provided). `touchLastActive(uid)` updates only `lastActiveAt` — the signal the stall-detect job (01-10) reads.
- 8 tests green: subcollection write path, no-inline-array, slot isolation (3 slots), journey-stage update, checkpoint optional, touchLastActive single-field.

### Task 3: Per-Agent Rate Limiting — Real Decrement, Refuse Before LLM

- `src/ratelimit/window.ts` — Budget constants (`REQUEST_CAP=100`, `TOKEN_CAP=50_000`, `WINDOW_MS=24h`). `isWindowExpired(windowStart, nowMs?)` is pure and clock-injectable for deterministic tests.
- `src/ratelimit/index.ts` — `check(uid, 'chat')` reads `rateBudgets/{uid}` via `rateBudgetsRef()` (01-03 source of truth), throws `RateLimitError` when `requestCount>=100` OR `tokenCount>=50_000`. Returns cleanly when no doc exists (first request) or window has expired (budget resets). `decrement(uid, tokens)` uses `FieldValue.increment(1)` + `FieldValue.increment(tokens)` for atomic writes (no race condition). Handles window expiry by resetting the doc.
- 9 tests green: check-fresh, check-within-cap, check-refuse-requests, check-refuse-tokens, error-name, decrement-write, decrement-uid-routing, window-reset-allows, window-in-range-refuses.

## Task Commits

Each task committed atomically (RED then GREEN):

| Task | Phase | Commit | Description |
|------|-------|--------|-------------|
| 1 | RED | `a9e580f` | Failing tests for heuristic router |
| 1 | GREEN | `e541e4b` | Heuristic router + classifier seam + override + index |
| 2 | RED | `db1a699` | Failing tests for shared memory |
| 2 | GREEN | `4334ba6` | Conversation subcollection + leadContext slots + journey-stage |
| 3 | RED | `e7986da` | Failing tests for ratelimit |
| 3 | GREEN | `474297c` | Per-agent ratelimit check + decrement + window math |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock() factory referenced outer variable — hoisting error (memory tests)**
- **Found during:** Task 2, first vitest run of memory.test.ts
- **Issue:** `vi.mock()` factory referenced `mockMessagesAdd` (declared as `vi.fn()` at module scope). Vitest hoists `vi.mock()` above variable declarations, causing `ReferenceError: Cannot access 'mockMessagesAdd' before initialization`.
- **Fix:** Wrapped all mock helper variables in `vi.hoisted()` so they are available inside the `vi.mock()` factory. Same pattern documented in 01-03 deviations.
- **Files modified:** `src/memory/memory.test.ts`
- **Commit:** `4334ba6` (included in GREEN commit)

Total deviations: 1 auto-fixed (Rule 1 bug). All other tasks executed exactly as planned.

## TDD Gate Compliance

All three tasks follow the mandatory RED/GREEN sequence:

1. `test(...)` RED commit exists for each task (failing — no implementation).
2. `feat(...)` GREEN commit exists after each RED (all tests pass).
3. No REFACTOR needed — implementations are clean on first pass.

Gate sequence verified in git log above.

## Known Stubs

None. All implementations are functional and complete:

- `route()`: real heuristic logic (always Coach) + real override seam.
- `appendMessage`: real subcollection write path through typed ref.
- `writeLeadSlot`: real slot-scoped Firestore update.
- `updateJourneyStage` / `touchLastActive`: real agentProfiles updates.
- `check` / `decrement`: real reads/writes to rateBudgets/{uid} via 01-03 ref; real `RateLimitError` throws.

The LLM classifier (`classifyIntent`) is intentionally dormant (throws `NotActivatedError`) — this is the designed Phase-3 seam, not a stub.

## Threat Surface Scan

All threat model mitigations from the plan are implemented:

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-01-20 | Mitigated | `check()` throws `RateLimitError` BEFORE `streamText()` is called; 9 tests assert the refusal behavior |
| T-01-21 | Mitigated | `writeLeadSlot` builds a slot-scoped update object — test asserts `finderSlot`/`replySlot` absent from `coachSlot` write |
| T-01-22 | Mitigated | `loadRecent` uses `limitToLast(n)` — never loads full conversation history |

No new security surface introduced beyond the plan's threat model.

---
*Phase: 01-foundations*
*Completed: 2026-05-31*

## Self-Check: PASSED

### Files exist

- [x] `src/router/heuristic.ts` — exists, exports `route`
- [x] `src/router/classifier.ts` — exists, exports `classifyIntent` + `NotActivatedError`
- [x] `src/router/index.ts` — exists, re-exports `route` + `classifyIntent`
- [x] `src/router/heuristic.test.ts` — exists, 5 tests
- [x] `src/memory/conversation.ts` — exists, exports `appendMessage` + `loadRecent`
- [x] `src/memory/leadContext.ts` — exists, exports `writeLeadSlot`
- [x] `src/memory/agentProfile.ts` — exists, exports `updateJourneyStage` + `touchLastActive`
- [x] `src/memory/index.ts` — exists, re-exports all three
- [x] `src/memory/memory.test.ts` — exists, 8 tests
- [x] `src/ratelimit/window.ts` — exists, exports `isWindowExpired`, caps
- [x] `src/ratelimit/index.ts` — exists, exports `check`, `decrement`, `RateLimitError`
- [x] `src/ratelimit/window.test.ts` — exists, 9 tests

### Commits exist

- [x] `a9e580f` — RED router test
- [x] `e541e4b` — GREEN router implementation
- [x] `db1a699` — RED memory test
- [x] `4334ba6` — GREEN memory implementation
- [x] `e7986da` — RED ratelimit test
- [x] `474297c` — GREEN ratelimit implementation

### Acceptance criteria

- [x] `route()` always returns `pillar:'coach'` for non-override input
- [x] `route(messages, { override:'finder' })` returns `pillar:'finder'`
- [x] `classifier.ts` exists; `grep -n "classif" src/router/heuristic.ts` returns only comments (no import/call line)
- [x] `grep -E "from ['\"](next|@/app)" src/router/*.ts` returns nothing
- [x] `npx vitest run src/router/heuristic.test.ts` exits 0 (5 tests green)
- [x] `appendMessage` writes via `messagesRef(cid)` subcollection
- [x] `grep -n "messages.*\[\]\|messages:\s*\[" src/memory/*.ts` returns nothing (no inline array)
- [x] `writeLeadSlot` updates only named slot + rollingSummary + updatedAt (other slots absent)
- [x] `updateJourneyStage` updates journeyStage + currentCheckpoint + lastActiveAt
- [x] `grep -E "from ['\"](next|@/app)" src/memory/*.ts` returns nothing
- [x] `npx vitest run src/memory/memory.test.ts` exits 0 (8 tests green)
- [x] `check()` throws `RateLimitError` when over budget (test asserts)
- [x] `decrement()` uses `FieldValue.increment()` for real atomic write
- [x] `grep -n "rateBudgetsRef" src/ratelimit/*.ts` shows consumer uses 01-03 ref
- [x] No `firestore.collection('rateBudgets')` or converter defined in `src/ratelimit/*.ts`
- [x] Window reset exercised with expired `windowStart` (deterministic)
- [x] `grep -E "from ['\"](next|@/app)" src/ratelimit/*.ts` returns nothing
- [x] `npx vitest run src/ratelimit/window.test.ts` exits 0 (9 tests green)
- [x] `npx vitest run src/router src/memory src/ratelimit` exits 0 (22 tests green)
