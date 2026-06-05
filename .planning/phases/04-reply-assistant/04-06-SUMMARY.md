---
phase: 04-reply-assistant
plan: 06
subsystem: api
tags: [next.js, route-handler, streamText, pdpa, pseudonymize, firestore, reply-pillar, knowledge-gaps, intent-router]

# Dependency graph
requires:
  - phase: 04-02
    provides: pdpa.ts IC/email/RM-financial regexes (knownNames injection completes the coverage)
  - phase: 04-04
    provides: 3-pillar intent router (routeAsync can return 'reply')
  - phase: 04-05
    provides: replyAgent (buildSystemPrompt/makeTools/run) + ReplySlot/readReplySlot
  - phase: 04-03
    provides: KnowledgeGapDoc.pillar discriminator (D-11) + retrieveReplySop pillar filter
  - phase: 03-07
    provides: the Finder dispatch branch + finderSlot onFinish write (the in-file template to mirror)
provides:
  - 3-pillar chat-route dispatch (pillar === 'reply' as the third arm, no /api/reply fork)
  - required-leadId fail-closed (HTTP 400 before streamText for leadless Reply turns)
  - GATE-3 lead-name injection (leads/{leadId}.name → pseudonymize knownNames; closes the empty names:[] hook)
  - replySlot write in onFinish (classification/latestDraft-redacted/sopDocIds/lastDraftedAt)
  - Reply no_sop_match → recordKnowledgeGap({pillar:'reply'}) kb-miss feed (D-11)
  - recordKnowledgeGap extended with an optional pillar discriminator (default coach via omission)
affects: [04-07-reply-edits, 04-08-reply-draft-card, 04-10-reply-quality-dashboard, phase-5-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-pillar dispatch: if (finder) … else if (reply) … else (coach) — one route, no endpoint fork"
    - "Fail-closed server gate for the heaviest-PII pillar (Reply requires a leadId or 400 before any model spend)"
    - "Defensive GATE-3 name injection: read the lead name whenever a leadId is present (covers Finder pastes too) since routeAsync runs after GATE 3"
    - "kb-miss feed reuse: the Reply pillar (no handoff step) writes directly to recordKnowledgeGap from onFinish with a pillar discriminator"

key-files:
  created: []
  modified:
    - app/api/chat/route.ts
    - src/escalation/knowledgeGaps.ts
    - src/memory/index.ts
    - app/api/chat/route.test.ts
    - src/audit/pdpa.test.ts

key-decisions:
  - "GATE-3 name injection runs for ANY pillar with a leadId (not just Reply) because routeAsync (GATE 4) runs after GATE 3 — the pillar is unknown at the pseudonymize call site. This also closes the Finder PII path for free."
  - "kb-miss topic = the ALREADY-REDACTED inbound (GATE-3 pseudonymized), never the raw paste; recordKnowledgeGap further hashes/truncates. PDPA-safe by construction (T-04-GAP-PII)."
  - "The pdpa free-text-name unit test asserts the route-injection CONTRACT (a known name passed in names[] is tokenized), not free-text NER — NER stays deferred to Phase-5 hardening per the Wave-0 test comment."
  - "replyHadNoSopMatch treats a SOP hit anywhere in the turn as 'grounded' (not a gap) — only a miss with no hit records a knowledgeGaps row."

patterns-established:
  - "Pattern 1: Reply dispatch arm mirrors Finder line-for-line (readSlot → buildSystemPrompt → makeTools → stepCountIs(5) → onFinish slot write)."
  - "Pattern 2: Optional discriminator on a shared writer (recordKnowledgeGap pillar?) written only when present (`...(pillar && { pillar })`) so existing callers are byte-for-byte unchanged."

requirements-completed: [REPLY-02, REPLY-03, REPLY-10, ADMIN-06]

# Metrics
duration: ~13min
completed: 2026-06-05
---

# Phase 4 Plan 06: Chat-Route Reply Integration Summary

**Third-pillar (`pillar === 'reply'`) chat-route dispatch with required-leadId fail-closed (400), GATE-3 lead-name injection closing the PDPA free-text gap, replySlot onFinish write, and a `no_sop_match → knowledgeGaps(pillar:'reply')` kb-miss feed — all in one route, no `/api/reply` fork.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-05T12:43:00Z
- **Completed:** 2026-06-05T12:56:25Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Reply is now reachable through the router alongside Coach + Finder: `pillar === 'reply'` builds `replyAgent.buildSystemPrompt` + `replyAgent.makeTools`, resolves `modelFor('reply')`, and streams through the existing `toUIMessageStreamResponse()` pipe with `stopWhen: stepCountIs(5)`.
- The wrong-lead failure mode is closed server-side: a Reply turn with no `leadId` returns HTTP 400 BEFORE `streamText` (no model spend) — the server enforces D-07, not just the UI.
- The last PDPA free-text-name gap is closed at the route: GATE 3 now reads `leads/{leadId}.name` and passes it as `knownNames` so `replaceNames` fires on a pasted WhatsApp inbound (combined with the Wave-1 IC/email/RM-financial regexes, the paste is tokenized before the cross-border model call).
- Per-lead reply context persists: `replySlot` (classification, redacted latestDraft, sopDocIds, lastDraftedAt) is written in `onFinish` only — never inside a tool (Reply tools stay read-only).
- Derek's dashboard gets the SOP-gap feedback loop (ADMIN-06): a Reply `no_sop_match` records a PDPA-safe `knowledgeGaps` row tagged `pillar:'reply'`, reusing the Coach `recordKnowledgeGap` primitive.

## Task Commits

Each task was committed atomically:

1. **Task 1: Override widening + required-leadId fail-closed + GATE-3 lead-name injection** - `128f4d3` (fix)
2. **Task 2: Reply dispatch branch + replySlot onFinish write** - `6dfdfb3` (feat)
3. **Task 3: no_sop_match → knowledgeGaps kb-miss write (D-11)** - `b985949` (feat)

_TDD plan: the Wave-0 RED guards (6 in route.test.ts + 1 in pdpa.test.ts) were already authored failing; each task flipped its slice GREEN (RED → GREEN within the existing test corpus)._

## Files Created/Modified
- `app/api/chat/route.ts` - Override allow-list widened to `['coach','finder','reply']`; required-leadId→400 gate; GATE-3 `knownNames` injection from the lead record; `pillar === 'reply'` dispatch arm; `extractReplySopIds` + `replyHadNoSopMatch` helpers; `stopWhen` 5-step arm includes reply; onFinish `replySlot` write + `no_sop_match → recordKnowledgeGap(pillar:'reply')`.
- `src/escalation/knowledgeGaps.ts` - `RecordKnowledgeGapInput` gains optional `pillar?: 'coach' | 'reply'`, written onto the upsert only when present (existing Coach callers unchanged).
- `src/memory/index.ts` - Re-export `readReplySlot` + `ReplySlot` from the barrel (Rule 3 — needed by the route dispatch; Plan 04-05 added them to `leadContext.ts` but never wired the barrel).
- `app/api/chat/route.test.ts` - Flipped 6 Wave-0 reply RED guards to GREEN (`it.fails` → `it`); added `leadsRef`/`agentProfilesRef` mocks + a streamText-not-called assertion on the 400 path.
- `src/audit/pdpa.test.ts` - Flipped the free-text-name RED guard GREEN, asserting the route-injection contract (a known name passed in `names[]` becomes `<LEAD_ID:…>`).

## Decisions Made
- **Name injection is pillar-agnostic.** `routeAsync` (GATE 4) runs *after* GATE 3, so the pillar is unknown at the `pseudonymize` call site. Rather than re-order the gates (forbidden — gate ordering is load-bearing), the route reads the lead name whenever a `leadId` is present. This satisfies the Reply requirement and incidentally hardens the Finder PII path.
- **kb-miss topic uses the redacted inbound.** The topic handed to `recordKnowledgeGap` is the GATE-3-pseudonymized user content (names/IC/email/financial already tokenized), never the raw paste; `recordKnowledgeGap` then hashes/truncates it to a `topicHash` + short label. PDPA-safe by construction (T-04-GAP-PII).
- **Lead/profile reads are best-effort.** Both the GATE-3 lead read and the onFinish profile read are wrapped so a Firestore failure never blocks the gate or breaks stream completion (count-only, no PII logged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-exported `readReplySlot`/`ReplySlot` from the `@/src/memory` barrel**
- **Found during:** Task 1 (typecheck)
- **Issue:** `route.ts` imports `readReplySlot` + `ReplySlot` from `@/src/memory`, but the barrel (`src/memory/index.ts`) only re-exported `readFinderSlot`/`FinderSlot` — Plan 04-05 added the Reply primitives to `leadContext.ts` but did not wire the barrel (nothing consumed them until this plan). `tsc` errored TS2305 "no exported member 'readReplySlot' / 'ReplySlot'".
- **Fix:** Added `readReplySlot` to the value re-export and `ReplySlot` to the type re-export.
- **Files modified:** `src/memory/index.ts`
- **Verification:** `npx tsc --noEmit` exits 0.
- **Committed in:** `128f4d3` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The barrel re-export was necessary to complete the planned dispatch wiring; no scope creep. All other work matched the plan exactly.

## Issues Encountered
None — the Finder dispatch branch was a faithful template and every supporting primitive (replyAgent, ReplySlot/readReplySlot, modelFor('reply'), the heuristic reply router, KnowledgeGapDoc.pillar) was already in place from Waves 0–2.

## User Setup Required
None - no external service configuration required. (No new Firestore indexes or rules in this plan; the `knowledgeGaps` collection + index already ship from Phase 2 / 04-03.)

## Threat Surface
No new surface introduced beyond the plan's `<threat_model>`. All six registered threats are mitigated:
- **T-04-PDPA-route** — `knownNames` populated from the lead record; route.test.ts asserts a non-empty `names[]`.
- **T-04-BLEED-route** — leadless Reply → 400 before streamText; replySlot keyed by leadId; parallel-lead isolation test passes.
- **T-04-OVERRIDE** — allow-list widened to include `'reply'`; invalid values still coerce to `undefined`.
- **T-04-COST** — Reply tool loop bounded at `stepCountIs(5)`.
- **T-04-TOOLWRITE-route** — replySlot + kb-miss writes in onFinish only (grep guard: no `recordKnowledgeGap(` in `src/agents/reply/`).
- **T-04-GAP-PII** — only redacted/short-label text reaches `recordKnowledgeGap`; hashed/truncated; counts-only logging.

## Verification
- `npm run test` exits 0: **494 passed | 7 expected-fail (later-wave RED guards) | 107 skipped | 0 failed**.
- `npx tsc --noEmit` exits 0; `npx eslint` on the modified files clean.
- Coach/Finder dispatch unregressed: the route + coach suites pass 66/66 (Tests 12–17 Finder dispatch/finderSlot all green; coach path untouched).
- GATE ordering preserved exactly: auth → ratelimit → pseudonymize+assertRedacted → routeAsync → required-leadId → dispatch → streamText → onFinish.
- The 7 remaining `it.fails` in the suite all belong to later waves (04-07 reply-edit-actions/diff, 04-09 kb/rag/gold) — none are Plan 04-06 contracts.

## Next Phase Readiness
- Ready for **04-07** (`replyEdits` collection + `captureReplyEdit` Server Action): the `replySlot.sopDocIds` grounding trail and `latestDraft` are now persisted per-lead for the edit-as-signal analytics.
- Ready for **04-08** (Reply draft card + lead selector + override chip): the route accepts `override:'reply'` and enforces the required leadId, so the UI lead-selector flow has a server contract to satisfy.
- Ready for **04-10** (Reply Quality dashboard): the `knowledgeGaps(pillar:'reply')` rows now flow to the gap feed for the ADMIN-06 panel.

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*

## Self-Check: PASSED

- Files verified present: `04-06-SUMMARY.md`, `app/api/chat/route.ts`, `src/escalation/knowledgeGaps.ts`, `src/memory/index.ts` (+ test files).
- Task commits verified in git log: `128f4d3` (Task 1), `6dfdfb3` (Task 2), `b985949` (Task 3).
- `npm run test` exit 0 (494 pass / 7 expected-fail / 0 fail); `tsc --noEmit` exit 0; tool-write grep guard PASS.
