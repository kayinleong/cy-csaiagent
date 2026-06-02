---
phase: 03-finder-routing
plan: "02"
subsystem: inventory/search
tags: [inventory, search, two-stage, vector-rerank, eligibility, affordability, segmentation, tdd]
dependency_graph:
  requires:
    - "03-01 (ProjectDoc with priceValue/priceBand/vpDate/embedding + priceBandFor; CollateralDoc externalUrl)"
    - "01-09 (embedText Gemini 1024-d — reused via @/src/rag/embed)"
    - "01-03/02-01 (projectsRef + adminDb — consumed by search.ts)"
  provides:
    - "ParsedCriteria interface (exported from src/inventory/search.ts — Finder agent 03-04 imports this)"
    - "searchProjects two-stage: deterministic Stage-A filter → in-memory dot-product re-rank"
    - "queryInventory structured VP/priceBand query (no vector, FIND-07)"
    - "affordabilityCeiling(monthlyIncome) + DSR_MULTIPLE constant (FIND-10)"
    - "composeProjectEmbeddingText(project) semantic text composer (status excluded, Pitfall 1/8)"
    - "embedProject(project) 1024-d vector via embedText document embedding (FIND-03)"
    - "src/inventory/index.ts public surface re-export for 03-04/03-03 consumers"
  affects:
    - "03-04 (Finder agent tools.ts searchProjects + queryInventory tool execute())"
    - "03-03 (inventory CRUD re-embed-on-edit uses embedProject)"
    - "03-05 (Finder agent index.ts consumes ParsedCriteria + SearchResult types)"
tech_stack:
  added: []
  patterns:
    - "Two-stage searchProjects: deterministic active/eligibility Firestore filter FIRST, in-memory dot-product re-rank SECOND (Pattern 4, Pitfall 6 avoidance)"
    - "In-memory dot-product scoring instead of findNearest to avoid range-filter limitation (Pitfall 6)"
    - "affordabilityCeiling(income) = income×12×DSR_MULTIPLE; exported constant for Derek/A2 review"
    - "applySegmentWeights: investment boosts vpStatus+priceValue; own_stay boosts bedrooms+locationText"
    - "composeProjectEmbeddingText excludes status (hard filter, not vector content — Pitfall 1/8)"
    - "FIND-06 returning-client since filter applied in-memory before affordability + vector scoring"
key_files:
  created:
    - path: src/inventory/search.ts
      exports: [searchProjects, queryInventory, affordabilityCeiling, DSR_MULTIPLE, ParsedCriteria, ProjectMatch, SearchResult, InventoryFilters]
      min_lines: 80
    - path: src/inventory/embedText.ts
      exports: [composeProjectEmbeddingText, embedProject]
    - path: src/inventory/index.ts
      provides: "public re-export surface for all inventory consumers"
    - path: src/inventory/search.test.ts
      provides: "15 tests covering active-only, eligibility, affordability, rank, segmentation, returning, queryInventory, embedText"
  modified: []
decisions:
  - "In-memory dot-product scoring chosen over findNearest call to avoid Pitfall 6 (range filters cannot be combined with findNearest) — viable for ≤ a few hundred active projects (A5)"
  - "DSR_MULTIPLE = 4.5 exported as a named constant (not hardcoded inline) so Derek/A2 can revise the financing rule without touching gate logic"
  - "since filter uses createdAt field (Phase-3 schema runtime) with vpDate fallback — both extracted safely from unknown Firestore document shape"
  - "Segmentation weights: investment → vpStatus (VP completed = yield-ready) + priceValue; own_stay → bedrooms + locationText length (lifestyle-fit proxy)"
  - "Status field excluded from composeProjectEmbeddingText — status is a hard filter (Stage A), not a semantic signal (Pitfall 1/8)"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-02"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 1
  files_created: 4
---

# Phase 3 Plan 02: Finder Search Engine — Summary

**One-liner:** Two-stage searchProjects with deterministic active/eligibility/affordability Firestore filter (Stage A) before in-memory vector re-rank (Stage B), plus queryInventory structured path, project embedding-text composer, and segment weighting — unit-asserting that sold-out/hidden/ineligible/unaffordable projects are physically unreachable.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED — failing tests | cb01849 | PASSED |
| GREEN — implementation | 49ea234 | PASSED |
| REFACTOR | Not needed — implementation clean on first pass | N/A |

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | RED — failing two-stage searchProjects + queryInventory tests | cb01849 | src/inventory/search.test.ts |
| 2 | GREEN — two-stage searchProjects + queryInventory + affordabilityCeiling + segment weighting | 49ea234 | src/inventory/search.ts |
| 3 | GREEN — project embedding-text composer + embedProject (merged into Task 2 commit) | 49ea234 | src/inventory/embedText.ts, src/inventory/index.ts |

## What Was Built

### src/inventory/search.ts

**ParsedCriteria interface** — exported so 03-04 Finder agent tools.ts imports it. All fields nullable/unknown — the criteria parser emits unknown, never invents missing data (Pitfalls 23/36).

**searchProjects(criteria)** — the load-bearing two-stage function:

- **STAGE A (deterministic — NEVER skipped):**
  - `projectsRef().where('status', '==', 'active')` — unconditional; sold_out and hidden are unreachable (T-03-04, T-03-05)
  - If `nationality === 'foreign'` → `.where('foreignEligible', '==', true)`
  - If `bumiputera === false` → `.where('bumiQuota', '==', false)`
  - Empty snap → `{found: false, reason: 'no_match'}`
- **FIND-06 returning-client since filter** — applied in-memory before affordability; extracts `createdAt` or `vpDate` safely via unknown cast
- **AFFORDABILITY gate (FIND-10, T-03-06):** `affordabilityCeiling = income × 12 × DSR_MULTIPLE (4.5)`; all-unaffordable → `{found: false, reason: 'ineligible', why: 'financing'}` (never a stretch match — Pitfall 3)
- **STAGE B — in-memory dot-product re-rank** within eligible+affordable set; embedText called once here, never in Stage A or queryInventory
- **applySegmentWeights(FIND-09):** investment → vpStatus + priceValue sort; own_stay → bedrooms + locationText length sort; different top-1 for same eligible set (Pitfall 4)

**queryInventory(filters)** — structured Firestore query (status:'active' + vpDate range + priceBand + vpStatus). **embedText never called** — pure inventory-grounded structured query (FIND-07).

**affordabilityCeiling(monthlyIncome)** — exported with `DSR_MULTIPLE` constant for Derek review.

### src/inventory/embedText.ts

**composeProjectEmbeddingText(project)** — joins `[name, priceBand, tenure, bedrooms, locationText, description]` with ` · `. Status is **not** included (status is a hard filter, not vector content). Two projects identical except status produce the same embedding text (Pitfall 1/8 — unit-asserted).

**embedProject(project)** — calls composeProjectEmbeddingText → embedText({inputType:'document'}) → 1024-d normalized vector.

### src/inventory/index.ts

Re-exports all public surface for downstream consumers (03-04, 03-03, admin Server Actions).

### src/inventory/search.test.ts (15 tests, all GREEN)

| Test name | Invariant asserted |
|-----------|-------------------|
| active-only (sold_out) | sold_out projects never appear in results (T-03-04) |
| active-only (hidden) | hidden projects never appear in results |
| eligibility (foreign) | foreignEligible:false excluded for nationality:foreign |
| eligibility (bumi) | bumiQuota:true excluded for bumiputera:false |
| affordability | all-eligible exceed ceiling → ineligible/financing (T-03-06) |
| no_match | empty eligible set → no_match signal |
| rank | closest-in-vector-space project ranks first (Stage B) |
| segmentation | investment vs own_stay produce different top-1 (FIND-09, Pitfall 4) |
| returning | since filter surfaces only post-threshold projects (FIND-06) |
| queryInventory (VP) | VP query returns correct projects |
| queryInventory (no embedText) | embedText NOT called in structured query (FIND-07) |
| queryInventory (priceBand) | priceBand filter applies |
| status-excluded from embedding | same embedding text for active vs sold_out (Pitfall 1/8) |
| semantic fields included | name, priceBand, tenure, location, description in composed text |
| embedProject 1024-d | vector length assertion |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] TypeScript narrow literal type inference for stub vector**
- **Found during:** Task 3 typecheck
- **Issue:** `Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1.0 : 0.0))` was inferred as `(0 | 1)[]` by TypeScript; `mockResolvedValue(neutralVector)` then failed type check
- **Fix:** Added explicit `: number[]` annotation to `STUB_QUERY_VECTOR` and `neutralVector` declarations in test file
- **Files modified:** src/inventory/search.test.ts
- **Commit:** 49ea234

**2. [Rule 1 — Bug] FieldValue → {toDate()} conversion error**
- **Found during:** Task 3 typecheck
- **Issue:** Direct cast of `FieldValue` to `{ toDate: () => Date }` fails TypeScript's overlap check; `ProjectDoc` doesn't have an index signature for `as Record<string, unknown>`
- **Fix:** Double-cast `doc as unknown as Record<string, unknown>` + safe property access with `'toDate' in createdAtRaw` narrowing
- **Files modified:** src/inventory/search.ts
- **Commit:** 49ea234

## Threat Surface Scan

| Invariant | Asserted By | File |
|-----------|-------------|------|
| T-03-04: sold_out/hidden unreachable by construction | Unit test "active-only" | search.test.ts |
| T-03-05: model cannot inject project id — gate is code | Status filter in Stage A (before any LLM interaction) | search.ts:246 |
| T-03-06: affordability refusal; never stretch match | Unit test "affordability" | search.test.ts |

No new network endpoints, auth paths, or trust boundaries beyond what the plan's threat model anticipates.

## Known Stubs

None. The `embedding: number[]` field is consumed as-is from Firestore documents; the mock embeddings are test-only fixtures. Real project embeddings are populated by the inventory CRUD module (03-03/03-04).

`DSR_MULTIPLE = 4.5` is a v1 default pending Derek's confirmation (A2 in 03-RESEARCH.md). The gate logic (all-exceed → ineligible refusal) is correct regardless of the constant value.

## Self-Check

### Created files exist
- [x] src/inventory/search.ts — FOUND
- [x] src/inventory/embedText.ts — FOUND
- [x] src/inventory/index.ts — FOUND
- [x] src/inventory/search.test.ts — FOUND

### Commits exist
- [x] cb01849 — FOUND (test: RED failing tests)
- [x] 49ea234 — FOUND (feat: GREEN implementation)

### Acceptance criteria verified
- `where('status', '==', 'active')` — FOUND at search.ts:246 (searchProjects) + search.ts:389 (queryInventory)
- `dotProduct|score|embedText` — FOUND in searchProjects Stage B (after deterministic filter in source order)
- `embedText` absent in queryInventory body — CONFIRMED
- `composeProjectEmbeddingText|embedProject` — FOUND in embedText.ts:55,83
- `status` absent from composer join — CONFIRMED (only in comments)
- `npx vitest run src/inventory` — 15/15 PASSED
- `npm run typecheck` — PASSED (no output = clean)
- No file deletions in commits — CONFIRMED (git diff --diff-filter=D returns nothing)
- `npx vitest run` (full suite) — 374 passed, 97 skipped (26 test files + 1 skipped) — PASSED

## Self-Check: PASSED
