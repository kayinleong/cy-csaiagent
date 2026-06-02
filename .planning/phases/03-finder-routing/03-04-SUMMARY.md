---
phase: 03-finder-routing
plan: "04"
subsystem: agents/finder
tags: [finder-agent, criteria-parser, grounded-refusal, read-only-tools, tdd, zod, property-match]
dependency_graph:
  requires:
    - "03-02 (searchProjects + queryInventory + ParsedCriteria + ProjectMatch — consumed by tools.ts)"
    - "03-01 (ProjectDoc with priceBand/priceValue/vpStatus/bumiQuota/foreignEligible + collateralRef)"
    - "01-03/02-01 (collateralRef — consumed by fetchCollateral tool)"
    - "src/llm/provider.ts modelFor('finder') — Remote Config resolver"
  provides:
    - "finderAgent (buildSystemPrompt + makeTools + outputSchema + run with refusal gate)"
    - "CriteriaSchema (generateObject input — unknown on missing eligibility fields)"
    - "FinderOutputSchema (matches[]/refusal{no_match|ineligible}/clarifyingQuestion)"
    - "makeSearchProjectsTool / makeQueryInventoryTool / makeFetchCollateralTool (read-only)"
  affects:
    - "03-07 (chat route finder dispatch branch — imports finderAgent)"
    - "Router dispatch: pillar=finder → finderAgent.buildSystemPrompt + makeTools"
tech_stack:
  added: []
  patterns:
    - "Finder agent mirrors coachAgent shape 1:1 (buildSystemPrompt/makeTools/outputSchema/run)"
    - "CriteriaSchema with unknown enums — parser NEVER invents missing eligibility data (Pitfalls 23/36)"
    - "Grounded refusal: no_match/ineligible from searchProjects → FinderOutput refusal signal, empty matches"
    - "Per-match rationale cites real project fields (projectId/priceBand/tenure/vpStatus/bedrooms/locationText)"
    - "All tools READ-ONLY: no Firestore writes inside execute() (T-03-14 mirrors T-02-15)"
    - "fetchCollateral returns externalUrl??storagePath — NEVER Drive API (D-09/C2)"
    - "Legal disclaimer: defer foreign-buyer threshold questions to D2 sales admin (Pitfall 5)"
    - "Clarifying question path: nationality/segment/income unknown → ask, don't guess"
key_files:
  created:
    - path: src/agents/finder/schema.ts
      exports: [CriteriaSchema, FinderOutputSchema, ParsedCriteriaInput, FinderOutput, FinderMatch, FinderRefusal, CollateralItem]
      min_lines: 60
    - path: src/agents/finder/tools.ts
      exports: [makeSearchProjectsTool, makeQueryInventoryTool, makeFetchCollateralTool]
      min_lines: 60
    - path: src/agents/finder/prompt.ts
      exports: [buildFinderSystemPrompt, FINDER_SYSTEM_PROMPT]
    - path: src/agents/finder/index.ts
      exports: [finderAgent, FinderRunArgs, FinderRunResult]
      min_lines: 60
    - path: src/agents/finder/finder.test.ts
      provides: "17 tests covering parse, parse-unknown, refusal-no_match, refusal-ineligible, rationale-grounding, read-only"
  modified:
    - path: src/agents/finder/finder.test.ts
      reason: "Rule 1 fix — tool.description TypeScript narrowing (possibly undefined)"
decisions:
  - "financingNote and tenurePref made optional in CriteriaSchema — generateObject may omit them from free text; callers must handle absent fields (Rule 1 fix)"
  - "clarifyingQuestion emitted when nationality OR segment+income are all unknown — agent asks before searching to avoid phantom eligibility filtering"
  - "buildRationale built inline in index.ts (pure function) rather than a separate file — mirrors coach pattern where output logic lives in index.ts"
  - "injectedSearchResult path in run() covers both test scenarios and future SSE onFinish validation; streaming path uses buildSystemPrompt+makeTools only"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-03"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 1
---

# Phase 3 Plan 04: Finder Agent — Summary

**One-liner:** Finder agent mirroring coachAgent (CriteriaSchema with unknown enums, three read-only tools wrapping searchProjects/queryInventory/fetchCollateral, grounded refusal on no-match/ineligible, per-match rationale citing real project fields, legal-disclaimer and ask-not-guess guard in scoped prompt).

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — failing tests | 5a788dd | PASSED |
| GREEN — schema + tools | d1e4d42 | PASSED |
| GREEN — prompt + index | 3f6dd0e | PASSED |
| REFACTOR | Not needed — implementation clean on first pass | N/A |

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | RED — criteria-parse + refusal-gate + rationale-grounding tests | 5a788dd | src/agents/finder/finder.test.ts |
| 2 | GREEN — Finder schema + read-only tools | d1e4d42 | src/agents/finder/schema.ts, tools.ts |
| 3 | GREEN — finderAgent (prompt + index run() with grounded refusal + rationale) | 3f6dd0e | src/agents/finder/prompt.ts, index.ts |

## What Was Built

### src/agents/finder/schema.ts

**CriteriaSchema** — generateObject input schema (Pattern 3):
- `segment: enum(['investment', 'own_stay', 'unknown'])` — drives FIND-09 ranking branch
- `nationality: enum(['malaysian', 'foreign', 'unknown'])` — drives Stage-A foreignEligible filter; 'unknown' = no filter applied
- `monthlyIncome: number | null` — FIND-10 affordability ceiling; null = Infinity (no ceiling)
- `financingNote?: string | null`, `tenurePref?: string | null` — optional (generateObject may omit)
- `bumiputera: boolean | null` — Stage-A bumiQuota filter; null = no filter
- `freeText: string` — always present; feeds Stage-B semantic re-rank vector
- All eligibility-critical fields allow 'unknown'/null — the parser NEVER invents missing data (Pitfalls 23/36)

**FinderOutputSchema** — Zod output with XOR invariant (enforced at app level in index.ts):
- `matches: FinderMatchSchema[]` — empty when refusal/clarifyingQuestion
- `refusal?: { reason: 'no_match'|'ineligible', explanation: string }` — grounded gate result
- `clarifyingQuestion?: string` — emitted when eligibility-critical fields are unknown (ask-not-guess)
- Each `FinderMatchSchema` carries: `projectId`, `rationale`, `matchedCriteria`, `collateral?`

### src/agents/finder/tools.ts

Three READ-ONLY tools — no Firestore writes in any execute():

**makeSearchProjectsTool(userLang)** — wraps `searchProjects` from 03-02:
- Input schema mirrors ParsedCriteria (segment/nationality/income/freeText etc.)
- Returns SearchResult directly — model narrates, never overrides the deterministic gate
- searchProjects ALWAYS enforces status:'active' (done inside the imported function)

**makeQueryInventoryTool(userLang)** — wraps `queryInventory` from 03-02:
- Structured VP date range / priceBand / vpStatus filters
- No vector search — pure Firestore query (FIND-07)
- vpDateFrom/vpDateTo accepted as ISO datetime strings → converted to Date before calling queryInventory

**makeFetchCollateralTool(userLang)** — reads `collateralRef().where('projectId','==',pid)`:
- Returns `{ type, url }` where url = `externalUrl ?? storagePath`
- NEVER calls Google Drive API (D-09/C2 hard constraint verified by grep gate)
- Returns empty array when no collateral documents exist for the projectId

### src/agents/finder/prompt.ts

**buildFinderSystemPrompt({ leadContext? })** — scoped prompt with sections:

- **Grounding (MANDATORY):** "Only recommend projects returned by searchProjects. NEVER invent a project, price, or availability." Cites projectId in every recommendation.
- **Active-only / eligibility:** "Availability and eligibility decided by the tool, not by you. You may EXPLAIN a refusal but never override it."
- **Segmentation branch (FIND-09):** investment → VP+yield emphasis; own_stay → bedrooms+location; unknown → ask before searching.
- **Missing eligibility-critical data (Pitfalls 23/36):** ASK nationality or income when unknown rather than guessing.
- **Legal disclaimer (Pitfall 5):** "Do not state generic foreign-buyer legal price thresholds — defer to D2 sales admin."
- **Anti-AI-tell + language:** EN/BM/中文 response; no filler phrases.
- **Output format:** FinderOutput JSON (matches / refusal / clarifyingQuestion).

### src/agents/finder/index.ts

**finderAgent** mirrors coachAgent exactly:
- `systemPrompt`: base FINDER_SYSTEM_PROMPT
- `buildSystemPrompt(options?)`: injects finderSlot context for re-rank sessions (FIND-05/08)
- `makeTools(userLang, agentUid?, leadId?)`: returns { searchProjects, queryInventory, fetchCollateral }
- `outputSchema`: FinderOutputSchema
- `run(args)` offline/test path:
  - When `injectedSearchResult` provided → buildOutputFromSearchResult → FinderOutputSchema.parse
  - Clarifying question: nationality OR (segment+income) unknown → ask-not-guess path
  - Grounded refusal: no_match → refusal signal; ineligible/financing → refusal with financing explanation
  - Found: builds matches with `buildRationale` citing real project fields + matchedCriteria
  - All output validated by FinderOutputSchema before returning

**buildRationale(match)** — pure function that composes "why this match" text:
  - Always cites projectId, name
  - References priceBand + priceValue (formatted RM), tenure, vpStatus, bedrooms, locationText
  - Eligibility signals: foreignEligible, bumiQuota
  - Matched criteria summary: segment, priceMax, locationPref, bedrooms
  - Semantic match score (from Stage B)

### src/agents/finder/finder.test.ts (17 tests, all GREEN)

| Test name | Invariant asserted |
|-----------|-------------------|
| parse — explicit fields | CriteriaSchema parses segment/nationality/priceMax correctly |
| parse — invalid segment | Zod rejects non-enum segment value |
| parse — invalid nationality | Zod rejects non-enum nationality value |
| parse-unknown — accepts null/unknown | CriteriaSchema accepts nationality:unknown + monthlyIncome:null |
| parse-unknown — clarifying question | finderAgent.run emits clarifyingQuestion (not a match) when eligibility fields unknown |
| refusal-no_match — grounded refusal | found:false/no_match → matches empty + refusal.reason='no_match' + explanation |
| refusal-no_match — no invented project | matches empty, no projectId in empty matches |
| refusal-ineligible — financing | found:false/ineligible/financing → refusal.reason='ineligible' + explanation contains 'financ' |
| refusal-ineligible — no match when ineligible | matches empty on ineligible result |
| rationale-grounding — real fields cited | match.rationale references freehold/650/vpStatus/projectId (real fields) |
| rationale-grounding — matchedCriteria | matchedCriteria.priceMax=700000, segment='own_stay' matches input |
| rationale-grounding — multiple matches | 2 matches, both schema-valid with distinct projectIds |
| read-only — searchProjects tool | execute defined; description has no write/update/delete |
| read-only — queryInventory tool | execute defined |
| read-only — fetchCollateral tool | collateralRef().where() called; no set/add/update called |
| read-only — makeTools with leadId | returns 3 tools |
| read-only — makeTools without leadId | returns 3 tools |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] CriteriaSchema required financingNote + tenurePref**
- **Found during:** Task 2 — first test run
- **Issue:** CriteriaSchema had `financingNote` and `tenurePref` as `z.string().nullable()` (required). Test fixtures omit these fields (generateObject may not produce them from all free-text inputs). Zod threw `invalid_type: expected string, received undefined`.
- **Fix:** Changed to `z.string().nullable().optional()` — these fields are optional annotations from the criteria parser, not required for gate logic.
- **Files modified:** src/agents/finder/schema.ts
- **Commit:** d1e4d42

**2. [Rule 1 — Bug] TypeScript: tool.description possibly undefined**
- **Found during:** Task 3 — `npm run typecheck`
- **Issue:** AI SDK Tool type declares `description?: string` (optional). Test accessed `tool.description.toLowerCase()` directly, causing `TS18048: 'tool.description' is possibly 'undefined'`.
- **Fix:** Added `const desc = tool.description ?? ''` guard in the test assertion.
- **Files modified:** src/agents/finder/finder.test.ts
- **Commit:** 3f6dd0e

## Threat Surface Scan

| Invariant | Asserted By | File |
|-----------|-------------|------|
| T-03-11: model cannot invent/recommend a project not returned by searchProjects | Grounded refusal gate in run(); no_match/ineligible → empty matches (unit-asserted) | finder.test.ts |
| T-03-12: parser emits nationality:unknown — does NOT invent eligibility | CriteriaSchema enum includes 'unknown'; parse-unknown test asserts no invention | finder.test.ts |
| T-03-13: legal-threshold disclaimer defers to D2 sales admin | Prompt contains "defer ... to D2 sales admin" (grep-verified) | prompt.ts |
| T-03-14: tools READ-ONLY — no Firestore writes in execute() | grep gate (no .set/.add/.update in tools.ts); read-only test asserts collateralRef.where not write | finder.test.ts, tools.ts |
| T-03-15: collateral via Storage/URL, not Drive API | grep gate: no drive.google/googleapis/drive.files in src/agents/finder/ | tools.ts |

No new network endpoints, auth paths, or trust boundaries beyond what the plan's threat model anticipates.

## Known Stubs

None. The `run()` method's streaming path (no injectedSearchResult) returns an empty matches output — this is the intended placeholder for the route handler (03-07) which owns the actual `streamText` call. The route handler uses `buildSystemPrompt` + `makeTools`, not `run()`, for production streaming.

## Self-Check

### Created files exist

- [x] src/agents/finder/schema.ts — FOUND
- [x] src/agents/finder/tools.ts — FOUND
- [x] src/agents/finder/prompt.ts — FOUND
- [x] src/agents/finder/index.ts — FOUND
- [x] src/agents/finder/finder.test.ts — FOUND

### Commits exist

- [x] 5a788dd — test: RED failing finder tests
- [x] d1e4d42 — feat: finder schema + read-only tools
- [x] 3f6dd0e — feat: finderAgent prompt + index

### Acceptance criteria verified

- `grep -n "CriteriaSchema\|FinderOutputSchema" src/agents/finder/schema.ts` — FOUND both
- segment + nationality enums include 'unknown' — CONFIRMED
- `grep -n "searchProjects\|queryInventory\|collateralRef" src/agents/finder/tools.ts` — FOUND all three
- No Firestore .set()/.add()/.update() in tools.ts — CONFIRMED (grep gate clean)
- Drive-API grep returns nothing — CONFIRMED
- `npx vitest run src/agents/finder` — 17/17 PASSED
- `npm run typecheck` — PASSED (no output = clean)
- `npx vitest run` (full suite) — 426 passed, 0 failed (28 test files + 1 skipped)
- `grep -n "buildSystemPrompt\|makeTools\|outputSchema\|run" src/agents/finder/index.ts` — all FOUND
- `grep -ni "never invent\|defer.*legal\|sales admin" src/agents/finder/prompt.ts` — all FOUND
- src/inventory/search.ts NOT modified — CONFIRMED (owned by 03-02)
- No STATE.md / ROADMAP.md / REQUIREMENTS.md modifications — CONFIRMED

## Self-Check: PASSED
