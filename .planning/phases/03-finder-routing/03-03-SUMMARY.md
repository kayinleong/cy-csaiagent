---
phase: 03-finder-routing
plan: "03"
subsystem: inventory
tags: [crud, import, admin-gate, embed-on-write, tdd, find-02, find-04, admin-04]
dependency_graph:
  requires:
    - 03-01 (projectsRef/collateralRef/priceBandFor/PRICE_BANDS from collections.ts)
    - 03-02 (embedProject/composeProjectEmbeddingText from embedText.ts)
  provides:
    - src/inventory/crud.ts (assertAdmin/createProject/updateProject/hideProject/attachCollateral)
    - src/inventory/import.ts (ProjectSource interface/csvProjectSource/importProjects)
    - src/inventory/crud.test.ts (35 tests covering admin-gate/embed/re-embed/hide/collateral/import)
  affects:
    - 03-08 (admin Server Actions consume createProject/updateProject/hideProject/attachCollateral)
tech_stack:
  added: []
  patterns:
    - Admin-gated CRUD (assertAdmin export) mirroring src/kb/crud.ts pattern
    - Embed-on-create + Pitfall 8 delta check (EMBEDDING_RELEVANT_FIELDS set)
    - Soft-hide (status:'hidden', no delete) mirroring unpublishDoc
    - Collateral via Storage path / external URL — NEVER Drive API (D-09/C2)
    - ProjectSource pluggable parser interface with CSV default (A1 swap seam)
    - Per-row validation before write (T-03-08 / ASVS V5)
key_files:
  created:
    - src/inventory/crud.ts
    - src/inventory/import.ts
    - src/inventory/crud.test.ts
  modified: []
decisions:
  - assertAdmin is exported from crud.ts (not private) so import.ts and Server Actions share the same gate without duplication
  - EMBEDDING_RELEVANT_FIELDS is a ReadonlySet<keyof ProjectDoc> — delta check avoids unnecessary Gemini calls on non-semantic edits (status, vpStatus, vpDate, eligibility flags)
  - csvProjectSource uses pure String.split() — no new dependencies added (research constraint confirmed)
  - importProjects accumulates per-row errors (not fail-fast) so a single bad row does not block valid rows
  - attachCollateral validates that exactly one of storagePath/externalUrl is provided at the function boundary (defense-in-depth before write)
  - embedding field is NOT in CreateProjectInput type — createProject derives it internally via embedProject, preventing callers from ever writing a stale or fake vector
metrics:
  duration: "~5 minutes"
  completed: "2026-06-02"
  tasks: 3
  files: 3
---

# Phase 03 Plan 03: Inventory CRUD + Import Adapter Summary

Admin-gated project CRUD (embed-on-write, priceBand sync, soft-hide, collateral via Storage/URL) and a pluggable CSV import adapter behind a `ProjectSource` interface — the data-management spine behind ADMIN-04 and FIND-02.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED — admin-gate + embed + re-embed + collateral + import tests | 01ad866 | src/inventory/crud.test.ts |
| 2 | GREEN — inventory CRUD (admin-gated, embed-on-write, soft-hide, collateral) | d1f7d72 | src/inventory/crud.ts |
| 3 | GREEN — pluggable import adapter (ProjectSource + CSV default + validation) | a52f4be | src/inventory/import.ts |

## TDD Gate Compliance

- RED gate: `test(phase-kayinleong-03): 03-03 — add failing inventory crud + import + admin-gate tests` (01ad866) — suite ran and FAILED (Cannot find package '@/src/inventory/crud') before any implementation
- GREEN gate: `feat(phase-kayinleong-03): 03-03 — inventory CRUD` (d1f7d72) + `feat(phase-kayinleong-03): 03-03 — pluggable CSV/JSON import adapter` (a52f4be) — 50 tests PASSED
- Both gates present in git log in correct order.

## Acceptance Criteria Verification

- `grep -n "assertAdmin" src/inventory/crud.ts` — assertAdmin called at top of createProject, updateProject, hideProject, attachCollateral (4 call sites confirmed)
- Drive-API grep gate: `grep -rniE "drive\.google|googleapis.*drive|drive\.files|drive_v" src/inventory/` returns NOTHING (D-09/C2 enforced)
- `grep -n "status: *'hidden'" src/inventory/crud.ts` — hideProject writes `{ status: 'hidden' }` via doc.update(), no `.delete()` call on project docs
- `grep -n "interface ProjectSource|csvProjectSource|importProjects" src/inventory/import.ts` — all three present
- `grep -n "G4 FORMAT TBD" src/inventory/import.ts` — seam comment present at 3 locations (line 26, 53, 151)
- `npx vitest run src/inventory` — 50 tests PASS (crud.test.ts 35 + search.test.ts 15)
- `npm run typecheck` — clean (no errors)
- search.ts and embedText.ts NOT modified (git log confirms)

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-03-07 | assertAdmin at top of all 5 mutation functions; non-admin rejection unit-tested (5 tests) |
| T-03-08 | importProjects validates each row against REQUIRED_FIELDS before write; invalid rows accumulate to errors[], never written (3 tests) |
| T-03-09 | attachCollateral stores storagePath/externalUrl string only; grep gate returns nothing; no Drive-API import |
| T-03-10 | updateProject uses EMBEDDING_RELEVANT_FIELDS delta check; re-embeds only when semantic fields change; 8 tests verify relevant vs non-relevant field behavior |

## Deviations from Plan

None — plan executed exactly as written.

The only auto-fix applied was a TypeScript error (Rule 1):
- `embedding: []` was erroneously included in the `CreateProjectInput` object literal inside `importProjects` (line 248 of import.ts). Since `CreateProjectInput` is `Omit<ProjectDoc, 'tenantId' | 'priceBand' | 'embedding'>`, embedding is excluded by type. The spurious field was removed. This was a first-draft bug caught immediately by `npm run typecheck`. No behavior change — createProject always derives the embedding internally.

## Known Stubs

None. Both `crud.ts` and `import.ts` are fully wired:
- createProject writes real embeddings via embedProject (mocked in tests, real Gemini in production)
- importProjects calls createProject per valid row (full create+embed cycle)
- collateral writes to the real `collateralRef()` typed collection

The G4 format seam (`csvProjectSource` as the parser) is intentional and documented — the swap point for Derek's confirmed D2 export format (A1, 03-08 checkpoint).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond the plan's threat model.

## Self-Check: PASSED

Files created:
- [x] src/inventory/crud.ts — FOUND
- [x] src/inventory/import.ts — FOUND
- [x] src/inventory/crud.test.ts — FOUND

Commits verified:
- [x] 01ad866 — FOUND (RED test commit)
- [x] d1f7d72 — FOUND (GREEN crud.ts commit)
- [x] a52f4be — FOUND (GREEN import.ts commit)

Verifications:
- [x] `npx vitest run src/inventory` — 50 tests PASSED
- [x] `npm run typecheck` — clean
- [x] Drive-API grep gate — CLEAN (no symbols)
- [x] search.ts / embedText.ts unmodified
- [x] `npx vitest run` (full suite) — 27 passed, 1 skipped (no regressions)
