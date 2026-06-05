---
phase: 04-reply-assistant
plan: 03
subsystem: kb-rag
tags: [kb-chunks, pillar, denormalization, findnearest, vector-index, backfill, reply-assistant, retrieval, category]

# Dependency graph
requires:
  - phase: 04-reply-assistant
    provides: "Plan 01 Wave-0 RED guards — kb.test.ts Test 5b (processBatch writes pillar) + rag.test.ts pillar-filter/in-memory-category it.fails() contracts that this plan turns GREEN"
provides:
  - "KbChunkDoc.pillar (optional, denormalized from parent kbDoc) — the gate for retrieveReplySop's pillar:'reply' filter (REPLY-01, Pitfall B)"
  - "processBatch writes pillar on every newly-ingested kbChunk (destructured from the job doc)"
  - "Parameterized rag facade: retrieve/firestoreRetrieve accept opts { pillar?, category? }; pillar is an index-backed findNearest equality pre-filter, category is narrowed in memory (no second index, 04-RESEARCH §Q7)"
  - "RetrievalResult carries pillar + category so callers can filter/display"
  - "KbDocDoc.category + CreateDocInput/UpdateDocInput.category (D-09) persisted on create/update"
  - "KnowledgeGapDoc.pillar? discriminator (D-11) — absent ⇒ coach; Plan 06 sets 'reply'"
  - "scripts/backfill-kb-chunks-pillar.ts — idempotent one-time backfill (parent pillar, fallback 'coach', Admin-SDK only, counts-only logging)"
  - "firestore.indexes.json: kbChunks (pillar,lang,status,embedding 1024-d) vector index + kbDocs (pillar,category,status) composite — additive"
affects: [04-05-reply-agent, 04-06-route-dispatch, 04-09-reply-sop-admin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Denormalize a parent-doc field (pillar) onto child chunks so findNearest can equality-pre-filter without a JOIN — exactly mirrors the Phase-2 status denormalization (Pitfall 3)"
    - "Equality pre-filter for the index-backed field (pillar) + in-memory narrowing for the high-cardinality field (category) to avoid composite-index sprawl (mirrors the Finder priceBand-pre-filter + priceValue-in-memory pattern)"
    - "Idempotent one-time backfill: filter on `field === undefined`, cache parent-doc lookups, log counts/ids only (never chunk text/PII), --dry-run support — mirrors scripts/backfill-kb-status.ts"

key-files:
  created:
    - "scripts/backfill-kb-chunks-pillar.ts"
  modified:
    - "src/firebase/collections.ts"
    - "src/kb/ingest/pipeline.ts"
    - "src/kb/crud.ts"
    - "src/rag/search.ts"
    - "src/rag/index.ts"
    - "src/rag/pinecone.ts"
    - "firestore.indexes.json"
    - "src/kb/kb.test.ts"
    - "src/rag/rag.test.ts"

key-decisions:
  - "Made KbChunkDoc.pillar OPTIONAL (not required) for backward-compat with pre-Phase-4 chunks — matches how status? was introduced in 02-02. Absent ⇒ treated as 'coach' via the backfill default (D-08). A required field would break the existing converter cast for un-backfilled chunks."
  - "category is filtered IN MEMORY after the pillar-filtered findNearest, NOT as a second equality pre-filter — adding (pillar,category,lang,status,embedding) would be index sprawl (04-RESEARCH §Q7 / A4). Categories are few and top-K is small (8)."
  - "Threaded opts through the pinecone fallback adapter signature too (kept ONE code path) rather than forking a sibling retrieval fn — pinecone is the documented seam; the param is type-compatible and voided until activation."
  - "KnowledgeGapDoc.pillar is OPTIONAL ('coach'|'reply') so the existing recordKnowledgeGap writer (src/escalation/knowledgeGaps.ts) keeps compiling WITHOUT setting it (typecheck confirmed). Plan 06 sets pillar:'reply' on Reply no_sop_match misses; this plan only grows the type (do-not-modify-knowledgeGaps.ts honored)."
  - "category persisted with spread-when-present (`...(input.category !== undefined ? {category} : {})`) so existing callers that omit it write no category field (no undefined-in-Firestore). updateDoc carries the existing doc's category forward on a new version."

patterns-established:
  - "kbChunks.pillar denormalization + in-memory category narrowing — the template for any future per-pillar retrieval isolation"

requirements-completed: [REPLY-01]

# Metrics
duration: ~5min
completed: 2026-06-05
---

# Phase 4 Plan 03: kbChunks.pillar Migration + Pillar-Filtered Reply SOP Retrieval Summary

**Denormalized `pillar` onto `kbChunks` (schema + pipeline write + idempotent backfill + composite vector index) and parameterized the rag facade with an optional `{ pillar, category }` filter — `retrieveReplySop`'s `pillar:'reply'` `findNearest` pre-filter can now isolate Reply SOPs from Coach chunks (REPLY-01), and the Wave-0 RED guards in `kb.test.ts` + `rag.test.ts` are GREEN.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-05T10:43:43Z
- **Completed:** 2026-06-05T10:48:41Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 8

## What Was Built

### Task 1 — schema + pipeline write + category + KnowledgeGapDoc.pillar (commit `aa29ed1`)
- **`src/firebase/collections.ts`** — added `KbChunkDoc.pillar?: 'coach'|'finder'|'reply'` (denormalized from parent kbDoc, mirrors `status?`), `KbDocDoc.category?: string` (D-09), and `KnowledgeGapDoc.pillar?: 'coach'|'reply'` (D-11 discriminator, doc-commented).
- **`src/kb/ingest/pipeline.ts`** — `processBatch` destructures `pillar` from `jobData` and writes it on each `chunksRef.add({...})`. The job doc already carried `pillar` (written in `shardJob`).
- **`src/kb/crud.ts`** — `CreateDocInput`/`UpdateDocInput` gain `category?: string`; `createDoc` and `updateDoc` (both content-new-version and metadata-only paths) persist it spread-when-present; `updateDoc` carries the existing category forward.
- **`src/kb/kb.test.ts`** — flipped Wave-0 RED guard Test 5b (`it.fails` → `it`): `processBatch` now writes `pillar` on each chunk (asserts `'coach'` from the fixture job doc).

### Task 2 — backfill + parameterized retrieval + indexes (commit `a984be8`)
- **`scripts/backfill-kb-chunks-pillar.ts`** (NEW) — idempotent one-time backfill: iterates `kbChunks` where `pillar === undefined`, stamps `pillar` from the parent `kbDocs/{docId}.pillar` (fallback `'coach'`, D-08), caches parent lookups, logs counts/ids only (no chunk text/PII), supports `--dry-run`. Admin-SDK only.
- **`src/rag/search.ts`** — `firestoreRetrieve` accepts `opts?: RetrieveOpts { pillar?, category? }`; guarded `.where('pillar','==',opts.pillar)` pre-filter; `RetrievalResult` now maps `pillar` + `category`; `category` narrowed IN MEMORY after retrieval (no second index).
- **`src/rag/index.ts`** — `retrieve` facade threads `opts` through to both adapters; re-exports `RetrieveOpts`.
- **`src/rag/pinecone.ts`** — fallback adapter signature threads `opts` (one code path; voided until activation).
- **`firestore.indexes.json`** — appended `kbChunks (pillar,lang,status,embedding 1024-d flat)` vector index + `kbDocs (pillar,category,status)` composite. **Additive — existing indexes untouched and unreordered.**
- **`src/rag/rag.test.ts`** — flipped both Wave-0 RED guards (`it.fails` → `it`): pillar equality pre-filter applied + category narrowed in memory.

## Verification

Per the plan's `<verification>` block (sequential executor, run after each task + a final gate):

- `npx vitest run src/rag/rag.test.ts src/kb/kb.test.ts` — **35 passed, 0 expected-fail** (the 3 Wave-0 RED guards this plan owns are now real passing assertions).
- `npm run test` (full offline suite) — **EXIT 0: 464 passed | 30 expected fail | 107 skipped | 0 failed.** Expected-fail count dropped from 33 → 30 (exactly the 3 guards flipped here; the remaining 30 belong to Plans 04-04..04-10).
- `npm run typecheck` (`tsc --noEmit`) — **clean.** Confirms `src/escalation/knowledgeGaps.ts` still compiles WITHOUT setting `KnowledgeGapDoc.pillar` (optional field).
- `firestore.indexes.json` — parses as valid JSON; the `kbChunks` pillar index is present with `vectorConfig.dimension: "1024"`.
- `npx eslint` on touched files — 0 errors (only pre-existing test-file warnings; source files clean).

### Regression surface ruled out
- **Existing Coach retrieval unchanged:** when `opts` is omitted (the Coach `retrieveKnowledge` call path), `firestoreRetrieve` runs the identical `lang + status` query as before — no `pillar` filter is added, so legacy/un-backfilled chunks are still returned. Confirmed by the unchanged 02-02 published-only tests (Test 2–7) all passing.
- **Existing ingest unchanged for Coach docs:** `pillar` flows from the job doc that already carried it; the chunk write gains one field, no removal. Existing kb pipeline tests (write fields, status:'published', supersede cascade, decrement) all still pass.
- **`category` is additive + optional:** spread-when-present means existing `createDoc`/`updateDoc` callers that omit `category` write no field — no `undefined` lands in Firestore, no existing doc shape changes.
- **`KnowledgeGapDoc.pillar` is type-only growth:** no writer modified (`knowledgeGaps.ts` untouched per the plan); typecheck proves the existing writer compiles unchanged.
- **Indexes additive:** the two new index entries were appended; the 11 existing entries are byte-identical and in original order (verified via the diff — `6 files changed, 227 insertions(+), 19 deletions(-)`; the deletions are the multi-line refactor of `firestoreRetrieve` + the flipped `it.fails` lines, not index removals).

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>` and `<acceptance_criteria>` were met without needing any auto-fix (Rules 1–4 not triggered). No authentication gates encountered (all work is offline TypeScript + mocked tests).

## Threat Model Coverage

- **T-04-RETR (Information Disclosure):** the pillar equality pre-filter is enforced alongside the always-on `status:'published'` filter; `rag.test.ts` asserts `where('pillar','==','reply')` is applied so no draft/coach content can leak into reply drafts. Mitigation in place.
- **T-04-RETR-b (Tampering — backfill):** `scripts/backfill-kb-chunks-pillar.ts` is idempotent (`pillar === undefined` filter), Admin-SDK only (cannot run from a client path), logs counts/ids only (no chunk text/PII). Mitigation in place.
- **T-04-RETR-c (DoS — missing index):** the `(pillar,lang,status,embedding)` index is authored now; the mandatory deploy step is flagged below (Pitfall F). Mitigation in place pending deploy.
- **T-04-GAP-PII (Information Disclosure — KnowledgeGapDoc.pillar):** the new field is a non-PII enum discriminator; the PDPA-safe `topicLabel`/`topicHash` contract (T-02-19) is unchanged — `recordKnowledgeGap` still never stores raw queries. Mitigation in place.

No new security surface beyond the plan's `<threat_model>` was introduced.

## DEPLOY REMINDER (Pitfall F — REQUIRED before live Reply queries)

The two new indexes in `firestore.indexes.json` are authored but **not yet deployed**. Before any live `retrieveReplySop` (`pillar:'reply'`) query or `fetchVoiceSamples` (`kbDocs (pillar,category,status)`) lookup runs against the real project, an operator MUST run:

```
firebase deploy --only firestore:indexes
```

Without this, the pillar-filtered `findNearest` throws `FAILED_PRECONDITION: requires an index` at runtime. (This is a manual operator step — sequential executor does not deploy; flagged for the phase deploy gate.)

## BACKFILL REMINDER (one-time, before relying on pillar isolation for pre-Phase-4 content)

Existing `kbChunks` written before this plan carry NO `pillar`. Run the idempotent backfill once (Admin-SDK creds required) so the pillar pre-filter does not silently exclude them:

```
npx tsx scripts/backfill-kb-chunks-pillar.ts --dry-run   # verify counts first
npx tsx scripts/backfill-kb-chunks-pillar.ts             # then apply
```

## Self-Check: PASSED

- **Created file exists:** `scripts/backfill-kb-chunks-pillar.ts` — FOUND.
- **Commits exist:** `aa29ed1` (Task 1) FOUND; `a984be8` (Task 2) FOUND.
- **Tests GREEN:** rag + kb suites 35/35 pass, full suite EXIT 0, typecheck clean, indexes JSON valid with the pillar 1024-d vector index.
