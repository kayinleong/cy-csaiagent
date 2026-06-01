---
phase: 01-foundations
plan: "09"
subsystem: rag
superseded_note: "2026-06-01 — the Voyage embedder described below was REPLACED by Gemini gemini-embedding-001 @1024-d via @ai-sdk/google (Developer API). voyageEmbed→embedText; voyageai removed; 1024-d index unchanged. See PROJECT.md Key Decisions + 01-VERIFICATION.md amendment."
tags: [rag, gemini, firestore-vector, findnearest, dot-product, citations, adapter, pinecone-seam, tdd]

# Dependency graph
requires:
  - "01-03 (firebase): adminDb, kbChunksRef, KbChunkDoc — kbChunks collection + lang field + embedding field"
  - "01-08 (spikes): voyageai@0.2.1 installed; SPIKE-RAG harness committed; SPIKE-RAG decision PENDING"
provides:
  - "src/rag/embed.ts — voyageEmbed(text, opts) -> 1024-d normalized number[] via Voyage voyage-3-large"
  - "src/rag/search.ts — firestoreRetrieve(query, userLang) Firestore findNearest DOT_PRODUCT + lang pre-filter"
  - "src/rag/index.ts — retrieve() adapter facade (Firestore default | Pinecone seam via RAG_ADAPTER env)"
  - "src/rag/citations.ts — buildCitations(results) de-dup+cap + isRetrievalMiss() handoff signal"
  - "src/rag/pinecone.ts — Pinecone fallback adapter seam (throws until SPIKE-RAG activates it)"
  - "src/rag/rag.test.ts — 7 offline unit tests (voyageEmbed dim, DOT_PRODUCT+limit, lang pre-filter, miss path, citation build, miss signal, dedup+cap)"
affects:
  - "01-11 (chat route): retrieve() is the Coach retrieveKnowledge tool backend"
  - "01-12 (Coach agent): imports retrieve/buildCitations/isRetrievalMiss from src/rag/index"

# Tech tracking
tech-stack:
  added:
    - "voyageai@0.2.1 — Voyage AI SDK (installed in 01-08); voyage-3-large 1024-d multilingual embeddings"
  patterns:
    - "Adapter facade: retrieve() dispatches on RAG_ADAPTER env (unset/'firestore' -> Firestore; 'pinecone' -> Pinecone seam)"
    - "DOT_PRODUCT findNearest: adminDb.collection('kbChunks').where('lang','in',[userLang,'en']).findNearest({vectorField:'embedding', queryVector:FieldValue.vector(q), limit:8, distanceMeasure:'DOT_PRODUCT'}).get()"
    - "L2 normalize: vec.map(v => v / norm) applied after Voyage API call as defensive invariant"
    - "Retrieval miss: retrieve() returns []; isRetrievalMiss([]) == true; Coach emits handoff signal"
    - "Citation de-dup+cap: seen Set by chunkId, slice(0, MAX_CITATIONS=5); chunkId always from input (T-01-27)"
    - "TDD: RED commit (39eeb27) test-only; GREEN commit (489a637) implementation; 7 tests GREEN"

key-files:
  created:
    - "src/rag/embed.ts — voyageEmbed: VoyageAIClient.embed -> 1024-d + normalize(); VOYAGE_API_KEY from env only"
    - "src/rag/search.ts — firestoreRetrieve: embed -> where(lang,in) -> findNearest(DOT_PRODUCT,8) -> RetrievalResult[]"
    - "src/rag/index.ts — retrieve() facade; re-exports buildCitations/isRetrievalMiss/voyageEmbed/RetrievalResult"
    - "src/rag/citations.ts — buildCitations(results) -> {citations,missed}; isRetrievalMiss(results) -> bool"
    - "src/rag/pinecone.ts — SEAM: pineconeRetrieve() documented stub (throws); activated by RAG_ADAPTER=pinecone"
    - "src/rag/rag.test.ts — 7 offline tests (Voyage + Firestore mocked; no live credentials needed)"

key-decisions:
  - "Firestore is the DEFAULT adapter (SPIKE-RAG decision PENDING in SPIKES.md); Pinecone seam present in pinecone.ts, activated only by RAG_ADAPTER=pinecone env var"
  - "L2 re-normalization applied after Voyage call as defensive invariant (Voyage voyage-3-large returns normalized vectors when outputDimension is set, but we normalize defensively)"
  - "DOT_PRODUCT lang filter uses [userLang, 'en'] for all three languages; for userLang='en' this becomes ['en','en'] which Firestore dedupes — acceptable per spec"
  - "MAX_CITATIONS=5 cap on buildCitations output to bound the Coach output schema token cost"
  - "Score field populated from data._distance if available; defaults to 1 if Firestore does not expose the distance metric in doc.data()"

# Metrics
duration: ~25min
completed: "2026-05-31"
---

# Phase 01 Plan 09: RAG Scaffold (embed + search + citations + adapter facade) Summary

**Voyage voyage-3-large 1024-d embedding + Firestore findNearest (DOT_PRODUCT, lang pre-filter) behind a retrieve() adapter facade with a Pinecone-Serverless fallback seam; real chunk-ID citations de-duplicated and capped; retrieval-miss returns [] for Coach handoff signal; 7 offline unit tests, all GREEN.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-31T23:35:00Z
- **Completed:** 2026-05-31T23:41:00Z
- **Tasks:** 2 TDD tasks (Task 1: embed+search+index+pinecone seam; Task 2: citations)
- **Files created:** 5 source files + 1 test file

## Accomplishments

### Task 1: Voyage embedding + Firestore findNearest retrieval

- `src/rag/embed.ts`: `voyageEmbed(text, {model:'voyage-3-large', inputType:'query'|'document'})` — calls `VoyageAIClient.embed()` with `outputDimension:1024`, then L2-normalizes the result. `VOYAGE_API_KEY` read from env (Secret Manager binding); never logged.
- `src/rag/search.ts`: `firestoreRetrieve(query, userLang)` — embeds the query, runs `where('lang','in',[userLang,'en']).findNearest({vectorField:'embedding', queryVector:FieldValue.vector(q), limit:8, distanceMeasure:'DOT_PRODUCT'}).get()`, maps `snap.docs` to `RetrievalResult[]` using `d.id` as `chunkId`.
- `src/rag/pinecone.ts`: documented fallback seam with a clear activation guide in comments. Throws if called before SPIKE-RAG activates it (guards against accidental activation).
- `src/rag/index.ts`: `retrieve(query, userLang)` dispatches on `RAG_ADAPTER` env var ('firestore' default | 'pinecone' seam). Re-exports `buildCitations`, `isRetrievalMiss`, `voyageEmbed`, `RetrievalResult`.

### Task 2: Citation assembly

- `src/rag/citations.ts`: `buildCitations(results)` → `{citations: Citation[], missed: boolean}`. De-duplicates by `chunkId` (first/highest-scored occurrence wins), caps at `MAX_CITATIONS=5`, builds a `snippet` (truncated at 200 chars at word boundary). `isRetrievalMiss(results)` returns `true` when `results.length === 0` — the gate the Coach uses before answering.

### TDD compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test-only) | `39eeb27` | 7 tests failing (modules absent) |
| GREEN (implementation) | `489a637` | 7 tests passing |

## Task Commits

| Task | Commit | Files |
|------|--------|-------|
| RED (failing tests) | `39eeb27` | src/rag/rag.test.ts |
| GREEN (implementation) | `489a637` | embed.ts, search.ts, index.ts, citations.ts, pinecone.ts |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

The only minor structural note: the test file uses `vi.doMock + vi.resetModules()` for the per-test mock isolation pattern (rather than top-level `vi.mock`) on Tests 2–4. This was required because `vi.resetModules()` in `beforeEach` forces module re-evaluation, making it possible to inject different Firestore/embed mocks per test. Test 1 (voyageEmbed) uses the top-level hoisted mock. This is correct vitest pattern; not a deviation.

## Threat Mitigations (from Plan Threat Register)

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-01-27 (Fabricated chunk IDs) | `buildCitations` maps only `r.chunkId` from input; test asserts every citation.chunkId came from the input set | Mitigated |
| T-01-28 (Cross-language/cross-tenant chunk leakage) | `where('lang','in',[userLang,'en'])` pre-filter in `firestoreRetrieve`; kbChunks rules tenant-scoped (01-03) | Mitigated |
| T-01-29 (VOYAGE_API_KEY logged or bundled) | Key read from `process.env.VOYAGE_API_KEY` only; no console.log; grep gate passes | Mitigated |

## Known Stubs

**Pinecone fallback adapter:** `src/rag/pinecone.ts` is a documented seam. It throws with a clear message when called before activation. It will be wired to a real Pinecone SDK call only if SPIKE-RAG selects the Pinecone fallback. This is intentional per the plan and D-05.

**Score field from Firestore:** `data._distance` is the Firestore internal distance field. If it is not present in `d.data()` (Firestore may not expose it via the Admin SDK `doc.data()` call), `score` defaults to `1`. The Coach uses position-ordering (results come back in relevance order from findNearest), so the `score` field is informational. This should be verified once the SPIKE-RAG live run executes.

## Threat Flags

No new security surfaces beyond the plan's threat model. All new endpoints are server-only `src/` core modules with no Next.js route handlers or network surface added in this plan.

---

## Self-Check: PASSED

### Files exist
- [x] `src/rag/embed.ts` — exists
- [x] `src/rag/search.ts` — exists (DOT_PRODUCT, findNearest, where lang in)
- [x] `src/rag/index.ts` — exists (retrieve() exported, adapter dispatch)
- [x] `src/rag/citations.ts` — exists (buildCitations, isRetrievalMiss exported)
- [x] `src/rag/pinecone.ts` — exists (fallback seam)
- [x] `src/rag/rag.test.ts` — exists (7 tests)

### Commits exist
- [x] `39eeb27` — test(phase-kayinleong-01): 01-09 — add failing tests (RED gate)
- [x] `489a637` — feat(phase-kayinleong-01): 01-09 — voyageEmbed + firestoreRetrieve + citations + Pinecone seam (GREEN gate)

### Test results
- `npx vitest run src/rag/rag.test.ts` — 7 passed | 0 failed
- `npx vitest run` (full suite) — 92 passed | 81 skipped | 0 failed

### Acceptance criteria grep gates
- `grep -nE "console\.(log|info).*VOYAGE|console.*api.?key" src/rag/embed.ts` — 0 matches (PASS)
- `grep -E "DOT_PRODUCT" src/rag/search.ts` — present (PASS)
- `grep -E "findNearest" src/rag/search.ts` — present (PASS)
- `grep -E "where\('lang','in'" src/rag/search.ts` — present (PASS)
- `grep -E "from ['\"]next|from ['\"].*app/" src/rag/*.ts` — 0 matches (core/shell PASS)
- `retrieve` exported from `src/rag/index.ts` — PASS
- Pinecone seam present in `src/rag/pinecone.ts` — PASS
- `retrieve([])` returns `[]` — test asserts (PASS)

### TDD Gate Compliance
- RED gate commit: `39eeb27` — `test(...)` commit with 7 failing tests before any implementation
- GREEN gate commit: `489a637` — `feat(...)` commit with all 7 tests passing
