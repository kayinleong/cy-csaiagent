---
phase: 03-finder-routing
plan: "06"
subsystem: memory
tags: [finder, leadContext, finderSlot, memory, tdd, FIND-05, FIND-06, FIND-08]
dependency_graph:
  requires: [03-02 (ParsedCriteria shape), 01-03 (leadContextRef + LeadContextDoc), 01-05 (writeLeadSlot slot isolation)]
  provides: [FinderSlot type, readFinderSlot, mergeFinderCriteria, mergeDiscussed]
  affects: [03-07 (chat route uses readFinderSlot + mergeFinderCriteria + writeLeadSlot('finderSlot'))]
tech_stack:
  added: []
  patterns:
    - "Agent-scoped slot isolation: writeLeadSlot writes only the named slot (T-03-20 Tampering guard)"
    - "Criteria delta-merge: only explicitly-provided (non-undefined) fields override stored values"
    - "DiscussedProjectIds dedup-union: Set-based accumulation across turns"
    - "epoch-ms for lastRankedAt: framework-free, no Firestore Timestamp dependency in type shape"
key_files:
  created: []
  modified:
    - src/memory/leadContext.ts
    - src/memory/index.ts
    - src/memory/memory.test.ts
decisions:
  - "lastRankedAt stored as epoch milliseconds (Date.now()) — keeps FinderSlot framework-free for tests and pure-logic helpers"
  - "null/undefined guard in mergeFinderCriteria: undefined fields in delta are dropped (no clobber); null is treated as an explicit value and passed through"
  - "readFinderSlot treats an empty object ({}) as absent — Firestore schema default for an unpopulated slot; returns null on first-touch"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-03"
  tasks: 2
  files_modified: 3
---

# Phase 03 Plan 06: finderSlot Memory Primitives Summary

**One-liner:** `FinderSlot` typed shape + `readFinderSlot` + `mergeFinderCriteria` + `mergeDiscussed` wired to `leadContext/{leadId}` for mid-conversation re-rank (FIND-08) and returning-client recall (FIND-06), with slot isolation preserved (T-03-20).

## What Was Built

### FinderSlot type (FIND-05, D-06)

```typescript
export interface FinderSlot {
  criteria: ParsedCriteria
  discussedProjectIds: string[]
  lastRankedAt: number  // epoch ms — framework-free
}
```

Stored in `leadContext/{leadId}.finderSlot`. The Finder agent is the only writer.

### readFinderSlot (FIND-06 — returning-client recall)

`readFinderSlot(leadId): Promise<FinderSlot | null>`

Returns the stored slot for returning-client recall — surface only new launches (`criteria.since` + `discussedProjectIds` exclusion). Returns `null` on first-touch (doc missing or slot is empty `{}`).

### mergeFinderCriteria (FIND-08 — re-rank without re-typing)

`mergeFinderCriteria(stored, delta): ParsedCriteria`

Only fields that are explicitly set (not undefined) in `delta` override `stored`. When a lead says "my budget is now RM700k", the route provides `{priceMax: 700_000}` — all other stored preferences are preserved. Enables SC2.

### mergeDiscussed (FIND-06 — discussed accumulation)

`mergeDiscussed(prev, next): string[]`

Dedup-union of two `discussedProjectIds` arrays. Accumulated across turns so returning-client recall surfaces only NEW launches.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — failing tests | `8d6907f` | 9 tests failing as expected |
| GREEN — implementation | `5296c94` | 27 tests passing; full suite 437 passed |
| REFACTOR | Not needed — implementation is minimal + clean |

RED gate: `readFinderSlot`, `mergeFinderCriteria`, `mergeDiscussed` imported but `TypeError: ... is not a function` for 9 tests. All 16 pre-existing tests still passed during RED.

GREEN gate: All 27 memory tests pass; full suite 437 passed, 0 failures.

## Tests Added (memory.test.ts)

| Test name (describe / it) | Behavior proved |
|---------------------------|-----------------|
| finderSlot-isolation: writeLeadSlot finderSlot updates ONLY finderSlot | T-03-20 Tampering guard re-asserted for finder slot |
| finderSlot-isolation: writing with summary does NOT spill into coachSlot/replySlot | Summary write stays slot-scoped |
| finderSlot-read: readFinderSlot returns stored FinderSlot when it exists | Returning-client recall retrieves typed slot |
| finderSlot-read: readFinderSlot returns null on first-touch (doc missing) | First-touch returns null |
| finderSlot-read: readFinderSlot returns null when finderSlot is empty object | Schema default `{}` → null |
| criteria-merge: budget shift overrides ONLY priceMax | FIND-08 re-rank without re-typing |
| criteria-merge: null/undefined delta field does NOT clobber stored value | No unintended clobber |
| criteria-merge: multiple simultaneous field overrides work correctly | Multi-field delta |
| discussed-accumulation: merging new projectIds appends without duplicates | Dedup union |
| discussed-accumulation: merging empty next returns prev unchanged | No-op merge |
| discussed-accumulation: merging from empty prev works correctly | First-turn accumulation |

## Deviations from Plan

None — plan executed exactly as written. The finderSlot-isolation tests (2 tests) passed during RED because `writeLeadSlot` already enforces slot isolation from Phase 1 — this is intentional: the plan asks to "re-assert the Phase-1 isolation contract for the finder slot specifically". The 9 failing tests were the unimplemented reader + merge functions.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surfaces introduced. The `readFinderSlot` function reads from the same `leadContext/{leadId}` doc that `writeLeadSlot` writes — same trust boundary as Phase 1 (T-01-21, T-03-20 carried).

## Known Stubs

None. All functions fully implemented and tested. The chat route (03-07) will call these primitives to compose the re-rank flow.

## Self-Check: PASSED

Verified:
- `src/memory/leadContext.ts` exists and contains `interface FinderSlot`, `readFinderSlot`, `mergeFinderCriteria`, `mergeDiscussed`
- `src/memory/index.ts` re-exports all four symbols
- Commit `8d6907f` (RED) — `git log --oneline | grep 8d6907f` → found
- Commit `5296c94` (GREEN) — `git log --oneline | grep 5296c94` → found
- `npx vitest run src/memory` → 27 passed, 0 failed
- `npx vitest run` → 437 passed, 0 failed
- `npm run typecheck` → clean (no output = no errors)
