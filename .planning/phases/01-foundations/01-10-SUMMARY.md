---
phase: 01-foundations
plan: "10"
subsystem: kb
tags: [kb-ingestion, chunker, pdf-extraction, idempotent, sha256, chunked-poll, admin-crud, seed-kb, shadcn, server-action, zod, tdd]

# Dependency graph
requires:
  - "01-03 (firebase): kbDocsRef, kbChunksRef, kbIngestionJobsRef from collections.ts"
  - "01-04 (auth): requireUser — admin gate for CRUD + process route"
  - "01-09 (rag): voyageEmbed(text, {inputType:'document'}) — embeds each chunk"
provides:
  - "src/kb/ingest/chunker.ts — gpt-tokenizer token-aware chunker with overlap"
  - "src/kb/ingest/pdf.ts — pdfjs-dist (legacy Node path) + mammoth DOCX text extraction"
  - "src/kb/ingest/pipeline.ts — shardJob (sha256 idempotency + kbIngestionJobs) + processBatch (embed+write kbChunks, decrement remaining)"
  - "app/api/kb/ingest/process/route.ts — Node-runtime poll worker (admin-gated, returns remaining, no after())"
  - "src/kb/crud.ts — createDoc/updateDoc/listDocs/deleteDoc (admin-only, multi-doc, versioned supersedesId)"
  - "src/kb/index.ts — public KB module re-exports"
  - "app/[lang]/(admin)/kb/page.tsx — RSC admin page (requireUser admin gate + doc list)"
  - "app/[lang]/(admin)/kb/kb-doc-form.tsx — 'use client' island (shadcn Field/Zod/Server Action + ingest poll loop)"
  - "app/[lang]/(admin)/kb/actions.ts — Server Actions: createKbDocAction/updateKbDocAction/deleteKbDocAction"
  - "scripts/seed-kb-en.ts — seeds one EN doc from fixture, runs full ingestion, prints docId"
affects:
  - "01-12 (proof slice): retrieves against the seeded EN doc"
  - "01-13 (Coach grounding): kbChunks created by seed are the rag.retrieve() targets"

# Tech tracking
tech-stack:
  added:
    - "gpt-tokenizer@3.4.0 — already installed (01-08); token-aware chunk sizing via countTokens()"
    - "pdfjs-dist@6.0.227 — already installed (01-08); PDF text extraction via legacy/build/pdf.mjs (Node-compatible)"
    - "mammoth@1.12.0 — already installed (01-08); DOCX text extraction"
  patterns:
    - "Chunked client-driven ingestion: shardJob() → kbIngestionJobs → browser polls /api/kb/ingest/process?jobId=&limit=N until remaining:0"
    - "sha256 idempotency: kbIngestionJobsRef().where('fileHash','==',hash).limit(1).get() returns existing job if found"
    - "processBatch: reads chunkTexts from kbIngestionJobs, voyageEmbed each with inputType:document, writes to kbChunks, decrements remaining"
    - "Server Action for mutations: createKbDocAction/updateKbDocAction read __session cookie → requireUser → admin gate"
    - "Route Handler for poll: GET/POST /api/kb/ingest/process — Node runtime, requireUser admin, no after()"
    - "Zod^4 schema in 'use client' island: safeParse → FieldError renders Zod issues"
    - "pdfjs-dist legacy Node path: import('pdfjs-dist/legacy/build/pdf.mjs') — avoids DOMMatrix ReferenceError"

key-files:
  created:
    - "src/kb/ingest/chunker.ts — token-aware chunker, gpt-tokenizer countTokens, overlap support"
    - "src/kb/ingest/pdf.ts — extractText(buffer, mimeType): PDF (pdfjs-dist legacy), DOCX (mammoth), plain text"
    - "src/kb/ingest/pipeline.ts — shardJob + processBatch; sha256 idempotency; no after() embedding"
    - "src/kb/crud.ts — multi-doc CRUD (createDoc/updateDoc/listDocs/deleteDoc), versioning (supersedesId/version)"
    - "src/kb/index.ts — re-exports all public KB types and functions"
    - "src/kb/kb.test.ts — 13 unit tests (4 behaviors: chunker + shardJob + idempotency + processBatch)"
    - "app/api/kb/ingest/process/route.ts — Node-runtime poll worker, admin-gated, returns remaining"
    - "app/[lang]/(admin)/kb/page.tsx — RSC admin shell, requireUser admin gate, lists kbDocs"
    - "app/[lang]/(admin)/kb/kb-doc-form.tsx — 'use client' island: shadcn Field/FieldGroup/FieldLabel/FieldError, Zod, Server Action, ingest poll"
    - "app/[lang]/(admin)/kb/actions.ts — Server Actions: createKbDocAction/updateKbDocAction/deleteKbDocAction"
    - "scripts/seed-kb-en.ts — seeds one EN doc from tests/fixtures/seed-kb-en.ts, runs ingestion, prints docId"
  modified:
    - "src/firebase/collections.ts — extend KbIngestionJobDoc with chunkTexts/docId/lang/pillar/createdAt; add chunkIndex to KbChunkDoc"
    - "src/kb/ingest/chunker.ts — prefer-const lint fix"

key-decisions:
  - "pdfjs-dist legacy build: standard build/pdf.mjs fails in Node.js with 'DOMMatrix is not defined'; legacy/build/pdf.mjs is the correct Node path"
  - "chunkTexts stored in kbIngestionJobs: the process worker reads chunkTexts from the job doc rather than re-parsing the file on each poll (simpler, avoids re-upload)"
  - "KbIngestionJobDoc extended with chunkTexts/docId/lang/pillar/createdAt: these are pipeline runtime fields needed by processBatch"
  - "KbChunkDoc extended with chunkIndex: preserves document order for diagnostics and future range-based retrieval"
  - "Server Action reads __session cookie to build a synthetic Request for requireUser() — Server Actions have no Request object"

# Metrics
duration: ~25min
completed: "2026-06-01"
---

# Phase 01 Plan 10: KB Layer (Chunked Ingestion + Admin CRUD Form + Seed) Summary

**Token-aware chunker (gpt-tokenizer) + PDF/DOCX extraction (pdfjs-dist/mammoth) + idempotent chunked-poll ingestion (sha256, kbIngestionJobs) + minimal authenticated KB CRUD form (shadcn field.tsx, Zod^4, Server Action) + one seeded English KB doc; 13 unit tests GREEN.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-01T00:00:00Z
- **Completed:** 2026-06-01T00:10:00Z
- **Tasks:** 2 (Task 1: TDD — chunker + pdf + pipeline + process route; Task 2: admin CRUD form + seed script)
- **Files created:** 11 | **Files modified:** 2

## Accomplishments

### Task 1: Chunker + PDF/DOCX extraction + idempotent chunked-poll ingestion pipeline

- `src/kb/ingest/chunker.ts`: `chunk(text, opts)` splits text into token-bounded, overlapping chunks using `gpt-tokenizer` `countTokens()`. Max 400 tokens/chunk, 50-token overlap. Deterministic for a given input.
- `src/kb/ingest/pdf.ts`: `extractText(buffer, mimeType)` dispatches to pdfjs-dist (PDF via `legacy/build/pdf.mjs` — the Node-compatible build), mammoth (DOCX), or UTF-8 decode (plain text).
- `src/kb/ingest/pipeline.ts`:
  - `shardJob(file)`: computes `sha256(buffer)` → queries `kbIngestionJobsRef().where('fileHash','==',hash).limit(1)` → returns existing job (idempotent) OR creates new job doc with `total`, `remaining=total`, `status:'pending'`, `chunkTexts[]`.
  - `processBatch(jobId, limit)`: reads job doc → embeds `limit` chunk texts via `voyageEmbed(text,{inputType:'document'})` → writes to `kbChunksRef()` (tenantId stamped) → decrements `remaining` → marks `status:'complete'` + updates `kbDocsRef().publishedAt` when `remaining === 0` → returns `{ remaining }`.
- `app/api/kb/ingest/process/route.ts`: Node-runtime GET+POST handler; `requireUser` admin gate (T-01-30); calls `processBatch`; returns `{ remaining }`; no `after()` in executable code (T-01-31).
- `src/kb/crud.ts`: `createDoc/updateDoc/listDocs/deleteDoc` — all admin-gated; `updateDoc` creates a new versioned doc with `supersedesId` pointing to the old doc.
- `src/kb/index.ts`: re-exports all public KB types and functions.
- TDD: RED commit (`871e7a7`) with 13 failing tests → GREEN commit (`f6ab51b`) with all 13 passing.

### Task 2: Minimal authenticated KB CRUD form + seed one English doc

- `app/[lang]/(admin)/kb/page.tsx`: RSC shell; `await cookies()` → builds synthetic Request → `requireUser()` → redirects non-admin to sign-in or chat; fetches `listDocs()` for the doc list; renders `<KbDocForm />`.
- `app/[lang]/(admin)/kb/kb-doc-form.tsx`: `'use client'` island; imports `Field/FieldGroup/FieldLabel/FieldError/FieldDescription` from `@/components/ui/field`; Zod^4 schema validates title/content/lang/pillar; submits via `createKbDocAction` / `updateKbDocAction` Server Actions (NOT a Route Handler); polls `/api/kb/ingest/process` until `remaining === 0`, surfacing progress via `sonner` toasts.
- `app/[lang]/(admin)/kb/actions.ts`: `'use server'` — reads `__session` cookie → calls `requireUser` → calls `createDoc`/`updateDoc`/`deleteDoc`.
- `scripts/seed-kb-en.ts`: creates kbDocs doc from `seedKbDocEn` fixture title; runs `shardJob` on assembled chunk texts from `seedKbChunksEn`; loops `processBatch` until `remaining === 0`; verifies chunk count in kbChunks; prints `DOC_ID`; no real PII.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test-only) | `871e7a7` | 13 tests failing (modules absent) |
| GREEN (implementation) | `f6ab51b` | 13 tests passing |
| Task 2 (no TDD tag) | `7730f08` | lint + tsc + full vitest GREEN |

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| RED (Task 1) | `871e7a7` | test: 13 failing KB tests |
| GREEN (Task 1) | `f6ab51b` | feat: chunker + pdf + pipeline + process route |
| Task 2 | `7730f08` | feat: admin CRUD form + seed-kb-en.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pdfjs-dist standard build fails in Node.js with DOMMatrix**
- **Found during:** Task 1, testing pdfjs-dist integration
- **Issue:** The standard `pdfjs-dist/build/pdf.mjs` throws `ReferenceError: DOMMatrix is not defined` in Node.js 24. The library itself warns: "Please use the `legacy` build in Node.js environments."
- **Fix:** Import from `pdfjs-dist/legacy/build/pdf.mjs` instead. Both builds export `getDocument` and `GlobalWorkerOptions`.
- **Files modified:** `src/kb/ingest/pdf.ts`

**2. [Rule 2 - Missing critical fields] KbIngestionJobDoc missing pipeline runtime fields**
- **Found during:** Task 1, TypeScript check
- **Issue:** `KbIngestionJobDoc` in `collections.ts` only had `fileHash/total/remaining/status`. The pipeline needs `chunkTexts/docId/lang/pillar/createdAt` to store chunk texts for the process worker without re-parsing the file.
- **Fix:** Extended `KbIngestionJobDoc` with `chunkTexts: string[]`, `docId: string`, `lang`, `pillar`, `createdAt`. Also added `chunkIndex: number` to `KbChunkDoc`.
- **Files modified:** `src/firebase/collections.ts`

**3. [Rule 1 - Bug] prefer-const lint error in chunker.ts**
- **Found during:** Task 2, `npm run lint`
- **Issue:** `let tail: string[]` should be `const tail: string[]` (array is mutated via `.unshift()`, not reassigned).
- **Fix:** Changed to `const`.
- **Files modified:** `src/kb/ingest/chunker.ts`

**Total deviations:** 3 auto-fixed (1 Rule 1, 1 Rule 2, 1 Rule 1). All necessary for correctness.

## Known Stubs

None. All implementations are complete:
- Chunker: real gpt-tokenizer tokenization with overlap
- PDF extraction: real pdfjs-dist legacy Node path
- DOCX extraction: real mammoth integration
- Pipeline: real sha256 idempotency, real kbIngestionJobs writes, real processBatch
- Admin CRUD form: real Server Actions, real Zod validation, real ingest poll loop
- Seed script: real ingestion pipeline (requires live Firebase + Voyage API keys)

## Threat Flags

No new security surfaces beyond the plan's threat model. All mitigations implemented:

| Threat ID | Status | Verification |
|-----------|--------|--------------|
| T-01-30 (Non-admin creating KB docs) | Mitigated | requireUser admin gate on page.tsx + Server Actions + /api/kb/ingest/process route |
| T-01-31 (Mega-PDF DoS) | Mitigated | Chunked poll loop; processBatch bounded by limit (max 20); no after() in code |
| T-01-32 (Duplicate chunks) | Mitigated | sha256 idempotency: re-sharding same file returns existing job without creating new chunks |

---
*Phase: 01-foundations | Plan: 10*
*Completed: 2026-06-01*

## Self-Check: PASSED

### Files exist
- [x] `src/kb/ingest/chunker.ts` — exists (token-aware chunker, gpt-tokenizer)
- [x] `src/kb/ingest/pdf.ts` — exists (pdfjs-dist legacy + mammoth)
- [x] `src/kb/ingest/pipeline.ts` — exists (sha256, shardJob, processBatch)
- [x] `src/kb/crud.ts` — exists (createDoc/updateDoc/listDocs/deleteDoc)
- [x] `src/kb/index.ts` — exists (re-exports)
- [x] `src/kb/kb.test.ts` — exists (13 tests)
- [x] `app/api/kb/ingest/process/route.ts` — exists (Node-runtime poll worker)
- [x] `app/[lang]/(admin)/kb/page.tsx` — exists (RSC admin shell)
- [x] `app/[lang]/(admin)/kb/kb-doc-form.tsx` — exists ('use client', shadcn field.tsx)
- [x] `app/[lang]/(admin)/kb/actions.ts` — exists (Server Actions)
- [x] `scripts/seed-kb-en.ts` — exists (seeds EN doc, no PII)

### Commits exist
- [x] `871e7a7` — test(phase-kayinleong-01): 01-10 — RED gate
- [x] `f6ab51b` — feat(phase-kayinleong-01): 01-10 — GREEN gate
- [x] `7730f08` — feat(phase-kayinleong-01): 01-10 — admin CRUD form + seed

### Acceptance criteria
- [x] `pipeline.ts` contains `sha256` — grep confirmed
- [x] `pipeline.ts` writes `kbIngestionJobs` with `total`/`remaining` — verified
- [x] Re-ingest of same hash does not duplicate (test 3 asserts) — 13 tests green
- [x] `process/route.ts` returns `remaining` — grep confirmed
- [x] `process/route.ts` guarded by `requireUser` (admin) — grep confirmed
- [x] `process/route.ts` does NOT call `after()` in executable code — python3 grep confirmed
- [x] `chunker.ts` uses `gpt-tokenizer` — grep confirmed (countTokens import)
- [x] `pdf.ts` uses `pdfjs-dist` — grep confirmed
- [x] `grep -E "from ['\"](next|@/app)" src/kb/**/*.ts` returns nothing — grep PASS
- [x] `npx vitest run src/kb/kb.test.ts` exits 0 (13 GREEN) — confirmed
- [x] `kb-doc-form.tsx` begins with `'use client'` — head -1 confirmed
- [x] `kb-doc-form.tsx` imports `@/components/ui/field` — grep confirmed
- [x] `kb-doc-form.tsx` submits via Server Action (not a Route Handler fetch for mutation) — actions.ts is 'use server'
- [x] `page.tsx` gates on `role === 'admin'` via `requireUser` — line 64 confirmed
- [x] `crud.ts` writes via `kbDocsRef()` — grep confirmed
- [x] `crud.ts` supports multi-doc (list/create/update/delete) with versioning — all functions present
- [x] `scripts/seed-kb-en.ts` contains no real PII — grep confirmed
- [x] `npm run lint` — 0 errors (14 pre-existing warnings)
- [x] `npx tsc --noEmit` — 0 errors in new files (9 pre-existing errors in calendar.tsx/detect.ts/embed.ts/rag.test.ts)
- [x] `npx vitest run src/kb/kb.test.ts` — 13 passed (GREEN)
- [x] `npx vitest run` — 116 passed | 81 skipped | 0 failed (default suite GREEN)
