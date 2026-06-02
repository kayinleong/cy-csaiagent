---
phase: 02-coach-admin
plan: "02"
subsystem: rag + kb-crud + ingestion-pipeline
tags: [published-filter, pitfall-3, supersede-cascade, publish-unpublish, correction-attribution, cdash-04, admin-03]
dependency_graph:
  requires: [02-01-status-fields, 02-01-composite-index, 01-09-rag-adapter, 01-10-kb-crud]
  provides: [published-only-retrieval, version-supersede-cascade, publish-unpublish-backend, correction-attribution, orphan-chunk-cleanup, backfill-script]
  affects: [02-06-correction-loop, 02-08-kb-admin-ui, Coach-grounding]
tech_stack:
  added: []
  patterns: [published-filter-on-retrieval, denormalized-status-sync, assertAdminOrCoach-pattern, idempotent-backfill]
key_files:
  created:
    - scripts/backfill-kb-status.ts
  modified:
    - src/rag/search.ts
    - src/rag/pinecone.ts
    - src/kb/ingest/pipeline.ts
    - src/kb/crud.ts
    - src/firebase/collections.ts
    - src/rag/rag.test.ts
    - src/kb/kb.test.ts
decisions:
  - "markSuperseded trigger = ingest-completion (/api/kb/ingest/process when remaining===0): old version stays retrievable until new version is fully embedded and ready"
  - "deleteDoc now hard-deletes kbChunks (fixes Phase-1 orphan-chunk note) — not soft-supersede"
  - "correctKbDoc inlines the updateDoc logic (no assertAdmin bypass) rather than calling updateDoc directly, preserving the admin-only guard on updateDoc"
  - "KbDocDoc.correctedBy? added to collections.ts to carry attribution through versioning chain"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-02"
  tasks_completed: 2
  files_modified: 7
requirements: [ADMIN-03, CDASH-04]
---

# Phase 02 Plan 02: Published-Only Retrieval + Correction Backend (Wave 2) Summary

**One-liner:** Published-only kbChunks retrieval filter (Pitfall 3 fix), version supersede cascade with chunk bulk-update, publish/unpublish toggle, CDASH-04 correction attribution with senior-coach entrypoint, orphan-chunk cleanup on deleteDoc, and idempotent backfill script for legacy docs.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| RED-1 | Failing tests: published-only retrieval filter | `664a7da` | `src/rag/rag.test.ts` |
| GREEN-1 | Published-only retrieval filter + status chunk writes | `4e526c6` | `src/rag/search.ts`, `src/rag/pinecone.ts`, `src/kb/ingest/pipeline.ts`, `src/rag/rag.test.ts`, `src/kb/kb.test.ts` |
| RED-2 | Failing tests: supersede cascade + publish/unpublish + correction | `2c36098` | `src/kb/kb.test.ts` |
| GREEN-2 | Version supersede cascade + publish/unpublish + correction attribution | `ea7503a` | `src/kb/crud.ts`, `src/firebase/collections.ts`, `src/kb/kb.test.ts`, `scripts/backfill-kb-status.ts` |

## What Was Built

### Task 1 — Published-Only Retrieval Filter (Pitfall 3 Fix)

**`src/rag/search.ts`**
- Added `where('status', '==', 'published')` to the kbChunks query chain before `findNearest`.
- This uses the `lang+status+embedding` composite index added in 02-01 Task 2.
- Legacy chunks without a `status` field (Phase-1 writers) are handled by the backfill script.

**`src/rag/pinecone.ts`**
- Added `status: { $eq: 'published' }` to the Pinecone query metadata filter in the seam comment.
- Ensures a future Pinecone fallback activation preserves the same contract as Firestore.

**`src/kb/ingest/pipeline.ts`**
- `processBatch` now writes `status: 'published' as const` on every kbChunk it creates.
- New ingests are immediately retrievable once embedded.

**`src/rag/rag.test.ts`**
- Updated Tests 2, 3, 4: `.where()` mock is now self-referential to support chained `.where().where()`.
- Added Test 2 assertion: `status='published'` filter is verified on the query chain.
- Added Tests 5, 6, 7 (02-02): status filter in chain, superseded-excluded scenario, all-unpublished-miss scenario.

**`src/kb/kb.test.ts`**
- Added Test 5: verifies `status:'published'` on every kbChunk written by `processBatch`.

### Task 2 — Version Supersede Cascade + Publish/Unpublish + Correction Attribution

**`src/kb/crud.ts`** — full rewrite adding:

- `createDoc` / `createDocFromFile`: write `status: 'published'` on the kbDocs document.
- `updateDoc`: new version gets `status: 'published'`; `correctedBy?` stamped if provided.
- `deleteDoc`: now hard-deletes all associated kbChunks via `kbChunksRef().where('docId','==',docId).get()` + `chunk.ref.delete()`. Closes the Phase-1 orphan-chunk note.
- `publishDoc(user, docId)`: admin-only; sets kbDoc + kbChunks → `status:'published'`.
- `unpublishDoc(user, docId)`: admin-only; sets kbDoc + kbChunks → `status:'unpublished'`.
- `markSuperseded(oldDocId, newDocId)`: no auth guard (called from Route Handler server-side); sets old kbDoc → `{status:'superseded', supersededBy:newDocId}` + bulk-updates old kbChunks → `status:'superseded'`.
- `correctKbDoc(user, docId, content, opts?)`: allows `admin|senior-coach` (CDASH-04); creates new versioned kbDoc with `correctedBy: user.uid`; triggers re-ingest via `shardJobForContent`.
- `assertAdminOrCoach`: new internal guard for correctKbDoc.
- `setDocAndChunksStatus`: shared helper for publishDoc/unpublishDoc bulk sync.

**`src/firebase/collections.ts`**
- Added `correctedBy?: string` to `KbDocDoc` — carries attribution through the version chain.

**`scripts/backfill-kb-status.ts`** (new file)
- Idempotent one-time script: stamps `status:'published'` on all existing kbDocs and kbChunks that have no `status` field.
- Skip-if-already-set: only patches documents where `data.status === undefined`.
- `--dry-run` flag for safe preview.
- Prerequisite: `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT` env var.

**`src/kb/kb.test.ts`**
- Added 8 new tests (02-02): markSuperseded cascade, unpublishDoc/publishDoc bulk-sync, correctKbDoc attribution + senior-coach allowed, correctKbDoc rejects new-agent, deleteDoc hard-deletes chunks, publishDoc/unpublishDoc reject non-admin, correctKbDoc allows admin.

## Design Decisions

### markSuperseded Trigger (from plan action item)

**Chosen: ingest-completion trigger** — `/api/kb/ingest/process` calls `markSuperseded(oldDocId, newDocId)` when `remaining === 0`.

**Why:** This ensures the old version stays retrievable during the embedding window (could be minutes for large docs). The Coach continues to answer from the old content until the new version is fully ready. This avoids a "dead window" where neither old nor new content is available.

**Alternative considered:** Immediate supersede in `updateDoc` (before ingest). Rejected because the new chunks don't exist yet when `updateDoc` is called — the Coach would have a retrieval miss for the topic during the entire ingest window.

**Implication for 02-06/02-08:** The Route Handler (`/api/kb/ingest/process`) needs to store `supersedesId` in the job doc and call `markSuperseded` on completion. The job doc already carries `docId` (the new version); the old doc's ID is `kbDocs[newDocId].supersedesId`. This wiring is the 02-06/02-08 responsibility.

### deleteDoc — Hard Delete vs. Soft Supersede

Hard delete was chosen for `deleteDoc` because:
1. The admin is explicitly requesting removal, not versioning.
2. Soft-supersede (`status:'superseded'`) is for versioned replacements, not intentional deletions.
3. Hard delete ensures no storage leak and removes ambiguity about whether the content is "gone" or "replaced".

### correctKbDoc — Inline Logic vs. assertAdmin Bypass

`correctKbDoc` inlines the `updateDoc` logic (read existing doc → create new versioned doc → shardJob) rather than calling `updateDoc` directly. This is because `updateDoc` uses `assertAdmin` internally. The alternatives were:
1. Pass an "internal" flag to skip auth check — leaks the pattern and allows future misuse.
2. Extract a private `_updateDocInternal` — adds indirection with no benefit.
3. Inline the relevant logic — cleanest, most readable, clear that this is a different auth path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing rag.test.ts mock did not support chained .where().where()**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Tests 2, 3, 4 in the `retrieve (Firestore adapter)` suite used a mock where `.where()` returned `{ findNearest }` — no `.where` method on the returned object. Adding the second `.where('status','==','published')` call caused `TypeError: adminDb.collection(...).where(...).where is not a function`.
- **Fix:** Made `mockWhereFn` self-referential: `vi.fn(() => ({ where: mockWhereFn, findNearest: ... }))` so chained calls work. Also added assertion to Test 2 verifying `status='published'` filter is in the chain.
- **Files modified:** `src/rag/rag.test.ts` (Tests 2, 3, 4)
- **Commit:** `4e526c6`

**2. [Rule 2 - Missing functionality] deleteDoc orphan-chunk cleanup**
- **Found during:** Task 2 plan action item 5 — the Phase-1 `deleteDoc` had a TODO comment: "associated kbChunks are NOT automatically deleted in v1 (Phase 2 cleanup job)". Plan 02-02 explicitly requires this fix.
- **Fix:** `deleteDoc` now fetches chunks via `kbChunksRef().where('docId','==',docId).get()` and hard-deletes each one. Test 9 added.
- **Files modified:** `src/kb/crud.ts`
- **Commit:** `ea7503a`

## Known Stubs

None. No placeholder data flows to UI rendering. The `markSuperseded` function is wired but the Route Handler trigger (`/api/kb/ingest/process`) does not yet call it — that wiring is the responsibility of 02-06 (correction loop) and 02-08 (KB admin). This is intentional: the backend function is ready; the call site is in-scope for the dependent plans.

## Threat Surface Scan

All surfaces align with the plan's `<threat_model>`:

| Flag | File | Status |
|------|------|--------|
| T-02-06: coach correction → KB | `src/kb/crud.ts correctKbDoc` | Mitigated — same chunker pipeline, attributed via `correctedBy`, admin oversight via supersedesId. |
| T-02-07: stale/superseded chunk retrieval | `src/rag/search.ts` | Mitigated — `status:'published'` filter applied before findNearest. |
| T-02-08: publish/unpublish/delete elevation | `src/kb/crud.ts` | Mitigated — `assertAdmin` on all toggles; `assertAdminOrCoach` on correction only. |

No new unplanned security surface introduced.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | CLEAN |
| `npx vitest run src/rag/rag.test.ts` | 13 pass |
| `npx vitest run src/kb/kb.test.ts` | 22 pass |
| `npx vitest run` (full suite) | 205 pass, 87 skip (expected) |
| `grep "status.*published" src/rag/search.ts` | FOUND (findNearest query chain, line 100) |
| `grep "status" src/rag/pinecone.ts` | FOUND (metadata filter comment) |
| `grep "status.*published" src/kb/ingest/pipeline.ts` | FOUND (processBatch chunk write, line 214) |
| `grep "publishDoc\|unpublishDoc\|correctKbDoc\|correctedBy\|markSuperseded" src/kb/crud.ts` | ALL FOUND |
| `grep "superseded" src/kb/crud.ts` | FOUND (markSuperseded status cascade) |

## Self-Check

### Files exist:

- [x] `src/rag/search.ts` — modified, committed in `4e526c6`
- [x] `src/rag/pinecone.ts` — modified, committed in `4e526c6`
- [x] `src/kb/ingest/pipeline.ts` — modified, committed in `4e526c6`
- [x] `src/rag/rag.test.ts` — modified, committed in `4e526c6`
- [x] `src/kb/kb.test.ts` — modified (both commits) `4e526c6`, `ea7503a`
- [x] `src/kb/crud.ts` — modified, committed in `ea7503a`
- [x] `src/firebase/collections.ts` — modified, committed in `ea7503a`
- [x] `scripts/backfill-kb-status.ts` — created, committed in `ea7503a`

### Commits exist:

- [x] `664a7da` — test(phase-kayinleong-02): 02-02 — RED: published-only retrieval filter tests (Pitfall 3)
- [x] `4e526c6` — feat(phase-kayinleong-02): 02-02 — published-only retrieval filter + status chunk writes (Pitfall 3)
- [x] `2c36098` — test(phase-kayinleong-02): 02-02 — RED: version supersede cascade + publish/unpublish + correction tests
- [x] `ea7503a` — feat(phase-kayinleong-02): 02-02 — version supersede cascade + publish/unpublish + correction attribution

### Success criteria:

- [x] Published-only retrieval: `where('status','==','published')` in search.ts + pinecone.ts fallback parity
- [x] Version supersede cascade: `markSuperseded` bulk-updates old doc + chunks to `superseded`
- [x] Publish/unpublish: `publishDoc`/`unpublishDoc` bulk-sync kbChunks.status
- [x] Correction attribution: `correctKbDoc` stamps `correctedBy:user.uid`, allows `senior-coach`
- [x] orphan-chunk cleanup: `deleteDoc` hard-deletes associated kbChunks
- [x] Backfill: `scripts/backfill-kb-status.ts` idempotent, skip-if-status-exists
- [x] `npx tsc --noEmit` CLEAN
- [x] `npx vitest run src/rag src/kb` GREEN (35 pass)
- [x] All plan `<acceptance_criteria>` PASS

## Self-Check: PASSED
