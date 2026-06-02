---
phase: 02-coach-admin
plan: "08"
subsystem: admin-kb-ui
tags: [admin, kb, crud, versioning, i18n, publish-unpublish]
dependency_graph:
  requires: [02-01, 02-02, 02-03]
  provides: [admin-kb-manager-ui, publish-unpublish-actions, version-history-view]
  affects: [app/[lang]/(admin)/kb, src/kb/crud, src/i18n/messages, app/api/kb/ingest/upload]
tech_stack:
  added: []
  patterns:
    - "RSC admin gate (cookie → requireUser → redirect if role !== admin) reused on detail page"
    - "Client island list with optimistic toggle (PublishToggle) wired to Server Actions"
    - "Version lineage chain built from listDocs result — no extra Firestore round trips"
    - "updateDocFromFile: new CRUD function for file-based versioned updates"
    - "Upload route accepts optional supersedesId to route create vs. update"
key_files:
  created:
    - app/[lang]/(admin)/kb/kb-doc-list.tsx
    - app/[lang]/(admin)/kb/publish-toggle.tsx
    - app/[lang]/(admin)/kb/[docId]/page.tsx
  modified:
    - app/[lang]/(admin)/kb/actions.ts
    - app/[lang]/(admin)/kb/kb-doc-form.tsx
    - app/[lang]/(admin)/kb/page.tsx
    - app/api/kb/ingest/upload/route.ts
    - src/kb/crud.ts
    - src/i18n/messages/en.json
    - src/i18n/messages/ms.json
    - src/i18n/messages/zh.json
decisions:
  - "Version lineage chain built in-memory from listDocs result (no extra Firestore reads); acceptable for pilot scale"
  - "updateDocFromFile added to crud.ts to support file-based versioned updates (parallel to text updateDoc)"
  - "Upload route extended with optional supersedesId field — backward compatible (no field = create mode)"
  - "File upload made available in edit mode (not just create); passes supersedesId so old doc is superseded on ingest completion"
  - "Page uses inline count string (existingDocuments key + count in parens) for simplicity over ICU plural"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-02T12:34:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 6
---

# Phase 02 Plan 08: Admin KB Manager UI Summary

**One-liner:** Full plain-language admin KB manager with status badges, publish/unpublish toggle, per-doc version history, and file/text edit → re-ingest — all admin-gated end to end.

## Tasks Completed

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Multi-doc KB list + publish/unpublish Server Actions | 7820be9 | kb-doc-list.tsx, publish-toggle.tsx, actions.ts, page.tsx |
| 2 | Per-doc version history + plain-language edit → re-ingest + trilingual keys | c7a645b | [docId]/page.tsx, kb-doc-form.tsx, upload/route.ts, crud.ts, en/ms/zh.json |

## What Was Built

### Task 1 — Multi-doc list + publish/unpublish

**`kb-doc-list.tsx`** (`use client`): Table of all KB docs showing title, lang (EN/BM/中文), pillar, version, status Badge (published/unpublished/superseded). Superseded docs hidden by default; toggle reveals them. Each row links to `/${lang}/admin/kb/${id}`. Delete action with `window.confirm` guard calls `deleteKbDocAction` and reloads.

**`publish-toggle.tsx`** (`use client`): Switch wired to `publishKbDocAction` / `unpublishKbDocAction`; optimistic UI (flips immediately, reverts on error); sonner toast on success/failure; disabled for superseded docs (T-02-25).

**`actions.ts`** extended: `publishKbDocAction(docId)` and `unpublishKbDocAction(docId)` follow the existing `getSessionUser` + try/catch `ActionResult` pattern, calling `publishDoc`/`unpublishDoc` from crud (assertAdmin is the gate — T-02-24 double gate preserved).

**`page.tsx`** updated: renders `<KbDocList docs={kbDocs} lang={lang} />` instead of the old inline list; RSC admin gate unchanged.

### Task 2 — Version history + edit → re-ingest + trilingual keys

**`[docId]/page.tsx`** (RSC, admin-gated): loads all docs, builds version lineage chain in-memory (walks `supersedesId` backwards + `supersededBy` forwards), renders version history list (current doc highlighted), renders `<KbDocForm>` pre-filled with title/lang/pillar for edit. Shows a supersededNotice banner when viewing a superseded doc.

**`kb-doc-form.tsx`** extended:
- File upload now available in **both** create and edit modes (previously create-only).
- In edit mode, the upload form sets `supersedesId` field → upload route creates a new versioned doc.
- Edit-success toast says "New version published; old version superseded." vs. "Document processed and indexed." for creates.
- Re-ingest poll against `/api/kb/ingest/process` is the same code path for both modes.

**`src/kb/crud.ts`** extended: added `updateDocFromFile(user, docId, input)` — creates a new kbDocs doc at version+1 with `supersedesId` pointing to the old doc, then calls `shardJob`. The `markSuperseded` cascade fires on ingest completion (existing pipeline path — SPIKE-INGEST gate).

**`app/api/kb/ingest/upload/route.ts`** extended: reads optional `supersedesId` from the multipart form; if present, routes to `updateDocFromFile` (edit mode) instead of `createDocFromFile` (create mode). Backward compatible — no `supersedesId` = create.

**i18n catalogs** (`en`/`ms`/`zh`): added `versionHistory`, `publish`, `unpublish`, `editDocument`, `supersededNotice`, `existingDocuments` keys under the existing `kb` namespace. `chat` namespace keys (including `talkToCoach`) preserved.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `publishKbDocAction\|unpublishKbDocAction` in actions.ts | PASS |
| `status` badge in kb-doc-list.tsx | PASS |
| `KbDocList` in page.tsx + RSC admin gate retained | PASS |
| `[docId]/page.tsx` exists with admin gate + version lineage | PASS |
| `ingest/process` poll visible in kb-doc-form.tsx (edit mode) | PASS |
| `versionHistory` key in all three locale files | PASS |
| `talkToCoach` (chat namespace) preserved in en.json | PASS |
| `npm run typecheck` clean | PASS |
| `npx vitest run src/i18n` green | PASS |
| `npx vitest run` (all 23 suites) green | PASS |

## Deviations from Plan

### Auto-added Missing Functionality

**1. [Rule 2 - Missing] Added `updateDocFromFile` to `src/kb/crud.ts`**
- **Found during:** Task 2 — file upload in edit mode had no server-side handler for versioned file updates
- **Issue:** The upload route only called `createDocFromFile`; editing with a file would create an unlinked doc instead of a superseding version
- **Fix:** Added `updateDocFromFile(user, docId, input)` that reads existing doc, creates new versioned doc at version+1 with `supersedesId`, calls `shardJob`
- **Files modified:** `src/kb/crud.ts`, `app/api/kb/ingest/upload/route.ts`
- **Commit:** c7a645b

**2. [Rule 2 - Missing] Extended upload route with `supersedesId` routing**
- **Found during:** Task 2 — upload route needed to know whether to create or update
- **Fix:** Upload route reads optional `supersedesId` from FormData; routes to `updateDocFromFile` when present (edit mode), `createDocFromFile` otherwise. Backward compatible.
- **Files modified:** `app/api/kb/ingest/upload/route.ts`
- **Commit:** c7a645b

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-02-24 Elevation — KB CRUD admin gate | Mitigated: double gate on both page RSC (redirect if role !== admin) and Server Action (assertAdmin in crud). Pattern reused from P1. |
| T-02-25 Tampering — publish/unpublish affecting retrieval | Mitigated: toggle wired to publishDoc/unpublishDoc which bulk-update kbChunks.status; superseded docs cannot be toggled (UI disabled). |
| T-02-26 Info-disclosure — version history | Accepted: admin-only view, tenant-scoped, no PII. |
| T-02-27 DoS — runaway re-ingest | Mitigated: chunked client-driven poll (POLL_LIMIT=5), same path as create. |

## Known Stubs

None — all data flows are wired. The `markSuperseded` cascade on ingest completion is implemented in the backend (pipeline.ts processBatch) but the SPIKE-INGEST gate must be passed before the live supersede fires on the real Firestore environment. The UI and Server Actions are complete.

## Threat Flags

None — no new trust-boundary surface beyond what the plan's threat model covers.

## Self-Check: PASSED

**Files exist:**
- `app/[lang]/(admin)/kb/kb-doc-list.tsx` — EXISTS
- `app/[lang]/(admin)/kb/publish-toggle.tsx` — EXISTS
- `app/[lang]/(admin)/kb/[docId]/page.tsx` — EXISTS
- `app/[lang]/(admin)/kb/actions.ts` — EXISTS (extended)
- `src/kb/crud.ts` — EXISTS (extended with updateDocFromFile)

**Commits exist:**
- `7820be9` — feat(phase-kayinleong-02): 02-08 — multi-doc KB list + publish/unpublish Server Actions
- `c7a645b` — feat(phase-kayinleong-02): 02-08 — per-doc version history + edit→re-ingest + trilingual keys

**Verification:**
- `npm run typecheck` — CLEAN (no errors)
- `npx vitest run` — 23 passed / 1 skipped, 304 tests
- `npx vitest run src/i18n` — 4 passed (trilingual keys verified, chat keys preserved)
