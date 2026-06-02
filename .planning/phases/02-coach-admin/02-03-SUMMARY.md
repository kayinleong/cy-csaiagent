---
phase: "02-coach-admin"
plan: "03"
subsystem: "chat-surface"
tags: ["chat", "persistence", "disclosure", "handoff", "lang-override", "conversation-lifecycle", "CHAT-01", "CHAT-02", "CHAT-04", "CHAT-05", "CHAT-06", "CHAT-07", "CHAT-08"]

dependency_graph:
  requires:
    - "02-01 (collections + indexes)"
    - "02-02 (published-only retrieval)"
    - "01-12 (P1 chat spine)"
    - "01-11 (escalation seam)"
  provides:
    - "real conversation lifecycle (persistent primary thread per agent)"
    - "user + assistant message persistence with KB citations"
    - "conversation list + client-side substring search"
    - "first-run AI disclosure modal + persistent AI badge"
    - "context-bundled 'Talk to my coach' handoff action"
    - "per-message language auto-detect + EN/BM/中文 manual override chip"
  affects:
    - "app/api/chat/route.ts (stable cid, persistence, citations, langOverride)"
    - "app/[lang]/chat/* (new components wired into shell)"
    - "src/memory/conversation.ts (new functions)"

tech_stack:
  added: []
  patterns:
    - "get-then-set(merge:true) idempotent conversation doc create"
    - "extractCitationChunkIds(steps[*].toolResults) — AI SDK v5 onFinish payload"
    - "localStorage + Server Action defence-in-depth for disclosure ack"
    - "client Firestore query for conversation list (owner-only rules gate)"
    - "pure searchConversations helper — client-side substring over summary"

key_files:
  created:
    - "src/memory/conversation.ts (extended)"
    - "app/_actions/chat.ts"
    - "app/[lang]/chat/disclosure-modal.tsx"
    - "app/[lang]/chat/chat-header.tsx"
    - "app/[lang]/chat/conversation-list.tsx"
    - "e2e/disclosure.spec.ts"
  modified:
    - "src/memory/index.ts"
    - "src/memory/memory.test.ts"
    - "app/api/chat/route.ts"
    - "app/api/chat/route.test.ts"
    - "app/[lang]/chat/chat-shell.tsx"
    - "app/[lang]/chat/chat-input.tsx"
    - "src/i18n/messages/en.json"
    - "src/i18n/messages/ms.json"
    - "src/i18n/messages/zh.json"
    - "tests/chat-route.test.ts"

decisions:
  - "extractCitationChunkIds reads final.steps[*].toolResults for toolName='retrieveKnowledge' — the correct AI SDK v5 v5.0.193 onFinish payload access pattern"
  - "disclosureAckAt written via adminDb.collection('users') directly (no typed converter) since UserDoc schema does not declare this runtime-only audit field"
  - "conversation-list.tsx uses client Firestore SDK (getDocs) for the history drawer — owner-only rules enforce access without needing a server route"
  - "ensurePrimaryThread is idempotent: get-then-set(merge:true) only on absent doc — preserves existing summary field"

metrics:
  duration: "13 minutes"
  completed_date: "2026-06-02"
  tasks_completed: 3
  files_changed: 15
---

# Phase 02 Plan 03: Chat Surface — Conversation Lifecycle, Disclosure, Handoff, Language Override Summary

**One-liner:** Real conversation persistence (user+assistant+citations, stable cid, reload across refresh), first-run AI disclosure modal + persistent badge, context-bundled 'Talk to my coach' handoff, and EN/BM/中文 manual override chip wired into the unchanged P1 streaming spine.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 (TDD) | Conversation lifecycle in src/memory | `1e00432` | conversation.ts, index.ts, memory.test.ts |
| 2 | Fix chat route (stable cid, user+assistant persist, citations, langOverride) | `36460f8` | route.ts, route.test.ts |
| 3 | Chat surface UI (disclosure, badge, handoff, lang chip, history) | `0ac2d4a` | 10 files |
| Wave-0 | Playwright disclosure.spec.ts scaffold | `823bb17` | e2e/disclosure.spec.ts |

## What Was Built

### Task 1: src/memory/conversation.ts — conversation lifecycle
- `ensurePrimaryThread(uid, lang)`: deterministic cid `coach-${uid}`, idempotent get-then-set(merge:true) — creates the `conversations/{cid}` doc ONLY when absent, preserving `summary` on subsequent calls (D-01)
- `listConversations(uid, n=50)`: Firestore query `ownerUid == uid, orderBy createdAt DESC, limit n` (uses the composite index from 02-01)
- `searchConversations(threads, term)`: pure case-insensitive substring filter over `summary` — the accepted MVP approach (no Algolia/Typesense for the pilot)
- All three re-exported from `src/memory/index.ts`
- TDD: 5 RED tests → 16 GREEN tests (all pass)

### Task 2: app/api/chat/route.ts — full conversation lifecycle
- Replaced throwaway `conv-${uid}-${Date.now()}` cid with `ensurePrimaryThread(uid, userLang)` when no cid in body (Pitfall 2 fix)
- `langOverride` honored from body (validated against `['en','ms','zh']`); falls back to `detectLang()` when absent (CHAT-08)
- User message persisted in `onFinish` BEFORE the assistant message (role:'user', citations:[], tokens:0)
- `extractCitationChunkIds(final)` helper: reads `final.steps[*].toolResults` for `toolName='retrieveKnowledge'`, maps `RetrieveHit.citations[].chunkId` → string array (Pitfall 6 fix)
- Assistant message now persisted with real citation chunk IDs (not hardcoded `[]`)
- Gate ordering (requireUser→ratelimit→pseudonymize→route→streamText), SSE headers, `toUIMessageStreamResponse()` all unchanged

### Task 3: Chat surface UI
- `app/_actions/chat.ts`: `ackDisclosure()` (disclosureAckAt → adminDb, idempotent); `requestHandoff(cid)` (reads agentProfile.seniorCoachId + journeyStage + conversation.summary → emitHandoffSignal with contextBundle containing NO raw PII per T-02-11)
- `disclosure-modal.tsx`: first-run Dialog, blocks chat input until ack, localStorage primary gate + SA defence-in-depth (T-02-13), `showCloseButton={false}`, interaction-outside + Escape prevention
- `chat-header.tsx`: sticky header with persistent "AI" Badge (CHAT-05), "Talk to my coach" button with toast feedback (CHAT-06), EN/BM/中文 ToggleGroup (CHAT-08)
- `conversation-list.tsx`: Sheet drawer, client Firestore `getDocs` query, substring search input, owner-only Firestore rules enforce access
- `chat-shell.tsx`: rewired to gate on `disclosureAcked`, own `activeCid` + `langOverride` state, wire all four new components
- `chat-input.tsx`: accepts `langOverride` prop, passes to POST body; `cidRef` updates when `conversationId` prop changes (history navigation)
- i18n: `chat.disclosure`, `chat.aiBadge`, `chat.talkToCoach`, `chat.langOverride`, `chat.history`, `chat.searchPlaceholder` added to en/ms/zh.json in translated (not English) strings

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tests/chat-route.test.ts missing ensurePrimaryThread mock**
- **Found during:** Task 2 (pre-existing capstone test file)
- **Issue:** `tests/chat-route.test.ts` mocked `@/src/memory` with only `appendMessage`. After Task 2 added `ensurePrimaryThread` call to route.ts, the pre-existing test failed with "No ensurePrimaryThread export defined on mock".
- **Fix:** Added `ensurePrimaryThread: vi.fn(async () => 'coach-uid-001')` to the `@/src/memory` mock in `tests/chat-route.test.ts`.
- **Files modified:** `tests/chat-route.test.ts`
- **Commit:** `0ac2d4a`

**2. [Rule 2 - Missing] disclosureAckAt not in UserDoc schema**
- **Found during:** Task 3 TypeScript check
- **Issue:** `disclosureAckAt` is a runtime audit field not declared in the typed `UserDoc` interface. Writing it via `usersRef().doc(uid)` would fail TypeScript.
- **Fix:** Used `adminDb.collection('users').doc(uid)` directly (untyped) for the disclosure ack write — documented in code comments. The typed converter is not needed for this merge write.
- **Files modified:** `app/_actions/chat.ts`
- **Commit:** `0ac2d4a`

**3. [Rule 1 - Bug] Memory test mock for vi.mock('@/src/firebase/collections') — duplicate mock blocks**
- **Found during:** Task 1 TDD RED setup
- **Issue:** The original test had a simple `vi.mock('@/src/firebase/collections')` block. Adding tests for `ensurePrimaryThread`/`listConversations` required a `conversationsRef` mock — but two `vi.mock()` calls for the same module cause issues. Replaced the original simple mock with a comprehensive one using `importOriginal`.
- **Fix:** Replaced the P1 simple mock block with the new comprehensive mock (preserves all existing mocks + adds `conversationsRef`). Removed duplicate block.

## Known Stubs

None. All new functions have real implementations or meaningful fallbacks:
- `conversation-list.tsx` loads real data from Firestore via `getDocs` (not mock data)
- `requestHandoff` calls `emitHandoffSignal` (real escalation write)
- `ackDisclosure` calls `adminDb.collection('users')` (real Firestore write)

**Note on browser-unverifiable behaviors:** The following require a live deploy to verify visually (SPIKE-DEPLOY gate):
- Disclosure modal rendering and ack flow (Playwright `e2e/disclosure.spec.ts` scaffolded, skipped until `TEST_BASE_URL` is set)
- "Talk to my coach" toast confirmation
- Language override chip visual state
- Conversation history drawer loading

## Threat Flags

No new unmitigated surfaces beyond those in the plan's threat model (T-02-10 through T-02-14 addressed as specified).

| Flag | File | Description |
|------|------|-------------|
| T-02-11 (mitigated) | app/_actions/chat.ts | requestHandoff contextBundle contains conversationId + journeyStage + summary (no raw PII) |
| T-02-13 (mitigated) | app/_actions/chat.ts | disclosureAckAt written to users/{uid} for audit trace |

## Self-Check: PASSED

All files confirmed present. All commit hashes verified. `npx vitest run` GREEN (221 passed, 87 skipped, 0 failed). `npx tsc --noEmit` clean.

### Files found (13/13):
- src/memory/conversation.ts
- src/memory/index.ts
- app/api/chat/route.ts
- app/_actions/chat.ts
- app/[lang]/chat/disclosure-modal.tsx
- app/[lang]/chat/chat-header.tsx
- app/[lang]/chat/conversation-list.tsx
- app/[lang]/chat/chat-shell.tsx
- app/[lang]/chat/chat-input.tsx
- e2e/disclosure.spec.ts
- src/i18n/messages/en.json (+ ms.json, zh.json)

### Commits verified (4/4):
- `1e00432` feat: conversation lifecycle in src/memory
- `36460f8` feat: fix chat route lifecycle
- `0ac2d4a` feat: chat surface UI
- `823bb17` test: Playwright disclosure.spec.ts scaffold
