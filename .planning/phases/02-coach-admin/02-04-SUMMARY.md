---
phase: 02-coach-admin
plan: "04"
subsystem: coach-journey
tags: [coach, journey, tdd, comprehension, grounding, tools]
dependency_graph:
  requires: [01-12, 02-01, 02-02]
  provides: [journey-state-machine, comprehension-gate, coach-depth]
  affects: [02-05, 02-06, 02-09]
tech_stack:
  added: []
  patterns:
    - Config-driven linear journey state machine (JourneyConfig → ordered stages/checkpoints)
    - Injectable grading backend (GradeFn interface for comprehension gate)
    - Journey-context-aware system prompt injection (buildCoachSystemPrompt)
    - Read-only AI SDK tools for journey state (getCurrentCheckpoint, getCheckpointContent)
key_files:
  created:
    - src/coach/journey/config.ts
    - src/coach/journey/transition.ts
    - src/coach/journey/comprehension.ts
    - src/coach/journey/transition.test.ts
    - src/coach/journey/comprehension.test.ts
    - src/coach/journey/index.ts
  modified:
    - src/agents/coach/prompt.ts
    - src/agents/coach/tools.ts
    - src/agents/coach/index.ts
    - src/agents/coach/coach.test.ts
    - src/memory/agentProfile.ts
    - src/memory/index.ts
decisions:
  - "A5 (checkpoint taxonomy): Proposed D2 PowerBoost journey with 3 stages (onboarding/training/qualified) and 9 checkpoints; Derek must confirm and ensure KB docs match the referenced IDs"
  - "A2 (comprehension threshold): Default 0.78 for embedding cosine similarity; must be validated with Derek + a coach before the pilot"
  - "Journey tools are read-only; advance writes are Server Action responsibility gated by gradeParaphrase pass (T-02-15)"
  - "getAgentProfile() added to agentProfile.ts so journey tools can read Firestore state without Admin SDK writes"
metrics:
  duration: "11 minutes"
  completed: "2026-06-02"
  tasks: 3
  files_created: 6
  files_modified: 6
---

# Phase 02 Plan 04: Coach Journey State Machine + Comprehension Gate Summary

Journey state machine + comprehension gate + grown Coach prompt/tools: config-driven linear D2 onboarding with free-text paraphrase grading and KB-grounded playbook delivery via read-only journey tools.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED→GREEN: Journey config + pure transition logic | ec0ecf8 | config.ts, transition.ts, transition.test.ts, index.ts |
| 2 | RED→GREEN: Comprehension gate — free-text paraphrase grading | ee273bc | comprehension.ts, comprehension.test.ts |
| 3 | Grow Coach prompt + journey tools | 9876508 | prompt.ts, tools.ts, index.ts, coach.test.ts, agentProfile.ts, memory/index.ts |

## What Was Built

### Journey State Machine (`src/coach/journey/`)

**`config.ts`** — `JourneyConfig` and `D2_JOURNEY` constant.

The proposed D2 PowerBoost onboarding journey:

| Stage | Checkpoints | Comprehension Gates |
|-------|-------------|---------------------|
| `onboarding` | day-one-pairing → product-foundations → channel-playbooks → first-meta-ad → onboarding-complete | 4 gates (no gate on completion) |
| `training` | advanced-negotiation → compliance-and-pdpa → training-complete | 2 gates |
| `qualified` | qualified-agent | 0 gates (terminal) |

Each checkpoint references KB doc IDs (placeholder IDs named `kb-coach-{topic}-en`). Derek creates KB documents in the admin app using these IDs as references — no code change required to update content (D-06).

**`transition.ts`** — Pure functions:
- `nextCheckpoint(config, stage, checkpoint)` — returns the next `Step | null`; the `'start'` sentinel maps to `day-one-pairing` for the `'onboarding'` stage
- `advance(config, current)` — returns `{stage, checkpoint} | null` (pure, no I/O)
- `commitAdvance(uid, next)` — the ONLY I/O function; calls `updateJourneyStage()`; must be called from a Server Action gated by a passing comprehension grade (T-02-15)

**`comprehension.ts`** — `gradeParaphrase(answer, canonicalText, opts)`:
- Injectable `grade?: GradeFn` backend (tests inject a deterministic fake; live path = Gemini embedding cosine similarity)
- Default threshold: `0.78` (A2 — verify with Derek + a D2 coach before the pilot)
- Empty/blank answer short-circuits with `{pass: false, score: 0}` without calling the grade fn
- Raw answer text is NEVER logged (T-02-17)
- No MCQ — free-text paraphrase only

### Grown Coach Agent (`src/agents/coach/`)

**`prompt.ts`** — `buildCoachSystemPrompt(journeyContext?)`:
- Base grounding mandate retained verbatim: cite `[KB:chunk-id]`; on miss → handoff, never invent
- Journey section injected when `journeyContext` is provided (stage + checkpoint + tool instructions)
- Comprehension gate guidance: free-text paraphrase only, no multiple-choice
- Channel playbook + Meta-ad walkthrough grounding instructions
- `COACH_SYSTEM_PROMPT` preserved as a backwards-compatible export (calls `buildCoachSystemPrompt()`)

**`tools.ts`** — Three read-only tools:
1. `makeRetrieveKnowledgeTool(userLang)` — unchanged grounding tool
2. `makeGetCurrentCheckpointTool(agentUid)` — reads `agentProfiles` via `getAgentProfile()`
3. `makeGetCheckpointContentTool(userLang)` — retrieves KB content via `rag.retrieve()` for a named checkpoint

None of the tools write to Firestore (T-02-15 compliance).

**`index.ts`** — `coachAgent.makeTools(userLang, agentUid?)` now returns journey tools when `agentUid` is provided. `buildSystemPrompt(journeyContext?)` exposed for route-handler use.

**`agentProfile.ts`** — Added `getAgentProfile(uid)` read function.

## A5: Proposed Checkpoint Taxonomy (Derek to Confirm)

The journey sequence is proposed based on D2 PowerBoost structure from the research notes (A5):

```
onboarding:
  start (sentinel, set by setUserClaims)
  → day-one-pairing           [kb-coach-day-one-intro-en, kb-coach-powerboost-overview-en, kb-coach-senior-coach-intro-en]
  → product-foundations       [kb-coach-d2-product-range-en, kb-coach-project-status-guide-en, kb-coach-bumiputera-rules-en]
  → channel-playbooks         [kb-coach-meta-ads-playbook-en, kb-coach-whatsapp-playbook-en, kb-coach-iproperty-playbook-en, kb-coach-content-playbook-en]
  → first-meta-ad             [kb-coach-first-meta-ad-walkthrough-en, kb-coach-meta-ad-compliance-en]
  → onboarding-complete       [kb-coach-onboarding-completion-en]

training:
  → advanced-negotiation      [kb-coach-negotiation-sop-en, kb-coach-objection-handling-en]
  → compliance-and-pdpa       [kb-coach-pdpa-obligations-en, kb-coach-d2-code-of-conduct-en]
  → training-complete         [kb-coach-training-completion-en]

qualified:
  → qualified-agent           [kb-coach-qualified-agent-guide-en]  (terminal)
```

**Derek action required:** Confirm the above sequence. Create KB documents in the admin app using the above KB doc IDs as the document titles/references. These IDs can be adjusted without code changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Entry sentinel validation in `nextCheckpoint`**
- **Found during:** Task 1 GREEN phase testing
- **Issue:** `nextCheckpoint(config, 'does-not-exist', 'start')` returned `day-one-pairing` instead of `null` because the sentinel path returned the first checkpoint unconditionally without validating the stage.
- **Fix:** Added stage validation in the sentinel path — the stage must exist in the config before returning the first checkpoint.
- **Files modified:** `src/coach/journey/transition.ts`
- **Commit:** ec0ecf8

**2. [Rule 1 - Bug] String literal with apostrophe caused parse error in config.ts**
- **Found during:** Task 1 GREEN phase run
- **Issue:** `'lead's eligibility'` (unescaped apostrophe in a single-quoted string) caused a vite/oxc parse error.
- **Fix:** Escaped the apostrophe: `'lead\'s eligibility'`.
- **Files modified:** `src/coach/journey/config.ts`
- **Commit:** ec0ecf8

**3. [Rule 2 - Missing functionality] Test MCQ assertion corrected**
- **Found during:** Task 3 test writing
- **Issue:** Initial test asserted `not.toContain('multiple-choice')` but the prompt intentionally says "Do NOT use multiple-choice questions" as a prohibition — the word appears in the prohibition, not in an MCQ pattern. The test was wrong.
- **Fix:** Updated test to assert that the prompt contains `'free-text paraphrase'` and that any mention of "multiple-choice" is paired with "do not".
- **Files modified:** `src/agents/coach/coach.test.ts`
- **Commit:** 9876508

**4. [Rule 1 - Bug] TypeScript AsyncIterable type widening for AI SDK tool.execute**
- **Found during:** Task 3 TypeScript check
- **Issue:** AI SDK's `tool.execute` return type is `TOutput | AsyncIterable<TOutput>`, causing TypeScript errors when accessing properties of `TOutput` directly.
- **Fix:** Added explicit type assertions in tests to narrow from `AsyncIterable<T> | T` to `T`.
- **Files modified:** `src/agents/coach/coach.test.ts`
- **Commit:** 9876508

## Known Stubs

None that block the plan's goal. The journey KB doc IDs (e.g., `kb-coach-day-one-intro-en`) are placeholder references — they need real KB documents in the admin app before the Coach can retrieve content for those checkpoints. This is an operational step (Derek + admin app), not a code stub.

## Security Review (T-02-15, T-02-16, T-02-17, T-02-18)

| Threat ID | Status |
|-----------|--------|
| T-02-15 (journey advance tampering) | Mitigated — `commitAdvance` is a plain async function, not a tool execute; the AI SDK tools are read-only; a model cannot self-advance without the server-gated comprehension check |
| T-02-16 (hallucinated grounding) | Mitigated — grounding mandate retained verbatim in prompt; coach.test.ts asserts no-invent-on-miss; KB-miss → emitHandoffSignal preserved |
| T-02-17 (comprehension answer logging) | Mitigated — `gradeParaphrase` never logs `answer` or `canonicalText`; only `score` is returned |
| T-02-18 (KB-doc-referenced content) | Accepted — journey references KB docIds; content governed by admin publish/version (02-02/02-08) |

## Threat Flags

None — no new network endpoints, auth paths, or Firestore collections introduced in this plan.

## Self-Check: PASSED

### Created files exist:
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/config.ts` — FOUND
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/transition.ts` — FOUND
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/comprehension.ts` — FOUND
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/transition.test.ts` — FOUND
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/comprehension.test.ts` — FOUND
- `/Users/ka.yin.leong/Documents/cy-csaiagent/src/coach/journey/index.ts` — FOUND

### Commits exist:
- `ec0ecf8` — Task 1 RED→GREEN journey config + transition — FOUND
- `ee273bc` — Task 2 RED→GREEN comprehension gate — FOUND
- `9876508` — Task 3 grow Coach prompt + journey tools — FOUND

### Tests:
- `npx vitest run src/coach/journey src/agents/coach` → 54 tests PASSED (3 files)
- `npx vitest run` → 258 tests PASSED (22 files), 0 failures

### TypeScript:
- `npx tsc --noEmit` → CLEAN (no errors)
