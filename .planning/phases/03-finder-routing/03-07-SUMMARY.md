---
phase: "03"
plan: "07"
subsystem: chat-route / finder-dispatch / ui
tags: [finder, router, finderSlot, match-list, pillar-override, i18n, tdd]
dependency_graph:
  requires:
    - 03-05  # routeAsync (three-tier router)
    - 03-04  # finderAgent (buildSystemPrompt, makeTools)
    - 03-06  # finderSlot primitives (readFinderSlot, mergeFinderCriteria, writeLeadSlot)
    - 01-11  # chat route (base gate ordering, coachAgent dispatch)
  provides:
    - Finder pillar wired into /api/chat with full gate ordering
    - finderSlot read + merge + write in onFinish (re-rank without re-typing)
    - match-list UI renderer (ranked project cards + refusal + clarifying states)
    - pillar-override chip (Auto/Coach/Finder) + leadId in POST body
  affects:
    - app/api/chat/route.ts
    - app/[lang]/chat/chat-header.tsx
    - app/[lang]/chat/chat-input.tsx
    - app/[lang]/chat/chat-shell.tsx
tech_stack:
  added: []
  patterns:
    - routeAsync replaces synchronous route() in chat spine (three-tier routing active)
    - finderSlot write in onFinish (not inside tool execute — T-03-28)
    - stepCountIs(5) bound for Finder multi-step tool loop (T-03-30)
    - extractFinderProjectIds() reads toolResults from final.steps for mergeDiscussed
    - pillarOverride prop-drilled from ChatHeader -> ChatShell -> ChatInput -> POST body
    - PillarOverride type exported from chat-header; consumed by chat-shell
key_files:
  created:
    - app/[lang]/chat/match-list.tsx
  modified:
    - app/api/chat/route.ts
    - app/api/chat/route.test.ts
    - app/[lang]/chat/chat-header.tsx
    - app/[lang]/chat/chat-input.tsx
    - app/[lang]/chat/chat-shell.tsx
    - src/i18n/messages/en.json
    - src/i18n/messages/ms.json
    - src/i18n/messages/zh.json
decisions:
  - routeAsync replaces synchronous route() — the activated classifier is now live in production
  - finderSlot criteria stored as merge of stored + delta (mergeFinderCriteria) for re-rank without re-typing
  - extractFinderProjectIds reads searchProjects toolResults from final.steps (not a tool-level write)
  - pillarOverride threaded via prop-drilling (ChatShell owns state, passed to Header + Input)
  - match-list.tsx is RSC-compatible (render-only, no 'use client') — collateral as plain anchors
  - 'Auto' in pillar chip = undefined override (routeAsync decides); selecting same chip = deselect/Auto
metrics:
  duration: "~3 hours (across 2 sessions)"
  completed: "2026-06-03"
  tasks_completed: 2
  files_changed: 9
  commits: 3
---

# Phase 03 Plan 07: Finder Chat-Spine Wire-Up Summary

Wire the Finder pillar into the chat spine: routeAsync replaces synchronous router, finderAgent dispatched when pillar=finder, PDPA gate preserved, finderSlot read+merge+write in onFinish, match-list card renderer, and manual pillar-override chip (Auto/Coach/Finder) threaded to POST body.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | Failing tests for finder dispatch, routeDecision, PDPA, finderSlot, re-rank | 7846b47 | app/api/chat/route.test.ts |
| 1 GREEN | Finder dispatch in chat route | 4a9eca0 | app/api/chat/route.ts, app/api/chat/route.test.ts |
| 2 | Match-list cards + pillar-override chip + chat-input override/leadId | b29c42a | app/[lang]/chat/match-list.tsx, chat-header.tsx, chat-input.tsx, chat-shell.tsx, i18n/*.json |

## What Was Built

### Task 1 — Finder dispatch in /api/chat (TDD)

**Route changes (app/api/chat/route.ts):**
- `routeAsync` replaces synchronous `route()` — three-tier routing (override → heuristic → LLM) now active
- `routeDecision` stored as `${pillar}:${reason}` on every persisted message (D-02, T-03-27)
- Gate ordering preserved: `requireUser` → `ratelimit.check` → `pseudonymize + assertRedacted` → `routeAsync` → dispatch → stream → onFinish
- Finder dispatch branch: `readFinderSlot(leadId)` → `mergeFinderCriteria(stored, {})` if slot exists → `finderAgent.buildSystemPrompt({leadContext: storedFinderSlot})` → `finderAgent.makeTools(userLang, uid, leadId)` → `modelFor('finder')` → `streamText` with `stepCountIs(5)` bound (T-03-30)
- `onFinish`: both branches get `routeDecision`; when `pillar === 'finder' && leadId`, calls `writeLeadSlot(leadId, 'finderSlot', {criteria, discussedProjectIds, lastRankedAt: Date.now()})` using `mergeFinderCriteria` + `mergeDiscussed` (T-03-28 — NOT inside tool execute)
- New exported helper `extractFinderProjectIds()`: reads `searchProjects` toolResults from `final.steps` to collect discussed project IDs

**Test changes (32/32 tests pass):**
- Extended `vi.mock('@/src/memory', ...)` with all finderSlot functions
- Extended `vi.mock('ai', ...)` with `stepCountIs`
- Added `buildSystemPrompt` to coachAgent mock
- Added 6 new describe blocks testing: routeAsync call, Finder dispatch, PDPA gate, finderSlot write, re-rank merge, no writeLeadSlot when pillar=coach
- `onFinishDone` promise pattern used in tests 13 and 15 for reliable async completion
- `mockReset()` in test 15 test 2 clears leftover Once queue from test 15 test 1 (vitest 4.x `clearAllMocks()` does not clear `onceMockImplementations`)

### Task 2 — Match-list UI + pillar-override chip

**match-list.tsx (created — RSC-compatible):**
- Three render states: ranked project cards (FinderMatch[]), grounded refusal card (no_match/ineligible), clarifying-question plain message
- Each match card: rank badge + projectId mono span + rationale text + matched-criteria outline badges + collateral plain anchor chips
- `hasMatchedCriteria()` guard prevents empty badge rows
- Collateral: `<a target="_blank" rel="noopener noreferrer">` — never a Drive embed (D-09/C2)
- Inline `CollateralIcon` SVG (external-link pattern)

**chat-header.tsx (edited — FIND-11):**
- New `PillarOverride` type exported: `'coach' | 'finder'`
- New props: `onPillarOverride: (p: PillarOverride | undefined) => void`, `pillarOverride?: PillarOverride`
- `handlePillarChange`: deselect or 'auto' → `onPillarOverride(undefined)`; otherwise cast to PillarOverride
- Pillar ToggleGroup (Auto/Coach/Finder) added before lang chip; trilingual labels via `t('chat.pillarOverride.*')`
- `value={pillarOverride ?? 'auto'}` so Auto tab always appears selected when no override is active

**chat-input.tsx (edited):**
- New props: `pillarOverride?: 'coach' | 'finder'`, `leadId?: string`
- `useChatStream` destructures + threads both into `requestBody` as `override` and `leadId` (when truthy)
- `useCallback` dep array extended to include `langOverride, pillarOverride, leadId`

**chat-shell.tsx (edited):**
- Imports `PillarOverride` type from chat-header
- `const [pillarOverride, setPillarOverride] = useState<PillarOverride | undefined>(undefined)`
- Passes `pillarOverride + onPillarOverride={setPillarOverride}` to ChatHeader
- Passes `pillarOverride` to ChatInput

**i18n:**
- All three locales (en/ms/zh) have `chat.pillarOverride.{label,auto,coach,finder}`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the match-list component renders real FinderOutput data from the agent. The pillarOverride and leadId are threaded end-to-end. No hardcoded placeholder values.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes introduced. The `override` and `leadId` fields in the POST body are validated in the existing route gate (T-03-26).

## Self-Check: PASSED

- app/[lang]/chat/match-list.tsx: FOUND
- app/api/chat/route.ts: modified with finder dispatch
- app/[lang]/chat/chat-header.tsx: FOUND (pillarOverride ToggleGroup + exports)
- app/[lang]/chat/chat-input.tsx: FOUND (override + leadId in POST body)
- app/[lang]/chat/chat-shell.tsx: FOUND (pillarOverride state wired)
- src/i18n/messages/en.json: FOUND (pillarOverride keys)
- src/i18n/messages/ms.json: FOUND (pillarOverride keys)
- src/i18n/messages/zh.json: FOUND (pillarOverride keys)
- Commit 7846b47 (RED): FOUND
- Commit 4a9eca0 (GREEN): FOUND
- Commit b29c42a (Task 2): FOUND
- `npm run typecheck`: PASSED (0 errors)
