---
phase: 03-finder-routing
plan: "08"
subsystem: admin-inventory-ui
tags: [admin, inventory, CRUD, collateral, import, ADMIN-04, FIND-02, FIND-04]
dependency_graph:
  requires:
    - 03-03  # src/inventory/crud.ts + import.ts (consumed, not modified)
    - 02-08  # app/[lang]/(admin)/* admin app pattern (mirrored)
  provides:
    - app/[lang]/(admin)/inventory/* — admin inventory manager UI surface
    - src/inventory/list.ts — admin-gated listProjects()
  affects:
    - 03-09  # Playwright inventory-admin spec
    - any plan that needs a populated projects collection (FIND-* plans)
tech_stack:
  added:
    - src/inventory/list.ts — admin-gated listProjects() (assertAdmin + projectsRef)
  patterns:
    - RSC admin-gated shell + 'use client' island + 'use server' SA (kb/page.tsx mirror)
    - getSessionUser() pattern for Server Action admin re-check (defense-in-depth)
    - Soft-hide (status:'hidden') over hard-delete (mirrors unpublishDoc)
    - Pluggable ProjectSource CSV-default for import (G4 seam intact)
key_files:
  created:
    - app/[lang]/(admin)/inventory/page.tsx
    - app/[lang]/(admin)/inventory/actions.ts
    - app/[lang]/(admin)/inventory/project-form.tsx
    - app/[lang]/(admin)/inventory/project-list.tsx
    - app/[lang]/(admin)/inventory/collateral-form.tsx
    - app/[lang]/(admin)/inventory/import-form.tsx
    - src/inventory/list.ts
  modified:
    - src/i18n/messages/en.json  — added 'inventory' namespace + nav.inventory key
    - src/i18n/messages/ms.json  — added 'inventory' namespace + nav.inventory key
    - src/i18n/messages/zh.json  — added 'inventory' namespace + nav.inventory key
decisions:
  - "listProjects() added to src/inventory/list.ts (not crud.ts) to respect the 'do not modify 03-03 files' constraint"
  - "import-form.tsx extracted as a separate file (not inlined in page.tsx) for clarity and testability"
  - "unhideProjectAction implemented via updateProject({status:'active'}) so priceBand/embedding delta logic is respected"
  - "G4 D2 inventory source format: CSV default ships; Derek must confirm columns before pilot import (see Flagged Decisions)"
metrics:
  duration: ~40 minutes
  completed: "2026-06-03"
  tasks_completed: 2
  files_changed: 10
  checkpoint_g4_flagged: true
---

# Phase 03 Plan 08: Admin Inventory Manager Summary

**One-liner:** RSC admin-gated inventory manager (list/add/edit/hide/collateral/CSV-import) mirroring the kb/page.tsx pattern, with trilingual i18n and the G4 format decision flagged for Derek.

---

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | RSC inventory shell + Server Actions | f8b46ec | page.tsx, actions.ts, list.ts, i18n catalogs |
| 2 | Client form islands (add/edit/hide/collateral/import) | f8b46ec | project-form.tsx, project-list.tsx, collateral-form.tsx, import-form.tsx |

> Tasks 1 and 2 were committed together in one atomic commit because both are tightly coupled (page imports the islands; islands import the actions) and both passed typecheck and vitest before commit.

---

## Flagged Decisions

### G4: D2 Inventory Source Format (checkpoint:decision — recorded, not blocking)

**Status:** CSV default ships. Derek confirmation required before the pilot import.

**What was built:** The `importProjectsAction` uses `csvProjectSource` (the default from 03-03's pluggable `ProjectSource` interface). The seam is ready for a format swap — implementing a new `ProjectSource` takes one file change behind the existing interface.

**Derek needs to confirm before the pilot import:**
1. The D2 inventory export format: does Derek export from a spreadsheet as CSV with the header columns below? Or is the format different?
   ```
   name, status, priceValue, tenure, bedrooms, locationText, description,
   vpStatus, vpDate, bumiQuota, foreignEligible
   ```
2. The affordability DSR multiple constant (RESEARCH A2) — used by `affordabilityCeiling` in 03-02. Currently `DSR_MULTIPLE = 0.33` (standard Malaysian DSR guideline). Confirm or provide the D2-specific value.
3. VP-date semantics (RESEARCH A4) — `vpDate` is stored as a full Date. Confirm "completed VP this year" means `vpDate >= Jan 1 current year` (current implementation in 03-07's `queryInventory` structured path).

**If the format differs:** Derek provides a sample file → a small parser is added behind the existing `ProjectSource` interface (no UI or schema changes needed).

---

## Deviations from Plan

### Auto-applied — Rule 3 (blocking issue averted)

**1. [Rule 3 - Missing export] listProjects() added to src/inventory/list.ts**

- **Found during:** Task 1 — the RSC page needs to fetch all projects; `listProjects` was not in `crud.ts` or the inventory index.
- **Issue:** The plan says "add a small `listProjects(user)` to src/inventory if not present — admin-gated read via projectsRef().get(); if you add it, keep it in src/inventory/crud.ts". However the CRITICAL_TOOLING_OVERRIDE explicitly prohibits modifying `crud.ts` (owned by 03-03).
- **Fix:** Created `src/inventory/list.ts` — a dedicated module for admin reads, following the same `assertAdmin + projectsRef()` pattern as `crud.ts`. The file is exported directly (not yet re-exported through `src/inventory/index.ts` which only exports search/embed functions).
- **Files modified:** `src/inventory/list.ts` (new)

**2. [Rule 2 - Missing feature] unhideProjectAction added**

- **Found during:** Task 2 — the project-list UI offers a "Hide / Unhide" toggle for all project statuses. Without an unhide action the admin can hide but never recover a project.
- **Fix:** Added `unhideProjectAction(projectId)` which calls `updateProject(user, projectId, { status: 'active' })`. This reuses the existing delta-check/embed logic in `updateProject` correctly and does not require a separate `crud.ts` export.
- **Files modified:** `app/[lang]/(admin)/inventory/actions.ts`

**3. [Structural choice] import-form.tsx extracted as a separate file**

- **Context:** The plan lists the import control as "a small CSV/JSON import control on the page". Putting it inline in `page.tsx` (an RSC) would require mixing client-side state into a server component. Extracting to `import-form.tsx` keeps the RSC/client boundary clean.
- **No functional change; no new dependency.**

---

## Acceptance Criteria Verified

```
✅ grep requireUser|role !== 'admin' in page.tsx — RSC admin gate present
✅ grep getSessionUser in actions.ts — Server Action re-check present (13 occurrences)
✅ grep createProject|importProjects|attachCollateral in actions.ts — core functions called
✅ await cookies() is awaited in page.tsx (Next.js 16 async cookies)
✅ 'use client' in project-form.tsx and collateral-form.tsx
✅ No priceBand in project-form.tsx (derived server-side)
✅ No Drive API (drive.google/drive picker/gapi) anywhere in inventory/
✅ useTranslations/getTranslations present in all 5 .tsx files
✅ npx tsc --noEmit — clean (0 errors)
✅ npx vitest run — 452 tests pass, 0 failures
```

---

## Known Stubs

None — all forms wire to real Server Actions; `listProjects` reads Firestore. The inventory manager is fully functional at the admin UI level. Data will be empty until Derek runs the first import or adds projects manually.

---

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already covers:
- T-03-22: RSC admin gate + SA re-check + core assertAdmin (three-layer defense-in-depth) ✅
- T-03-23: Per-row CSV validation before write (importProjects validates, never silently drops) ✅
- T-03-24: No Drive API — collateral is Storage path or external URL only ✅
- T-03-25: Role read from verified session token, never from form body ✅

---

## Self-Check: PASSED

```bash
# Created files exist:
[ -f "app/[lang]/(admin)/inventory/page.tsx" ]         ✅
[ -f "app/[lang]/(admin)/inventory/actions.ts" ]        ✅
[ -f "app/[lang]/(admin)/inventory/project-form.tsx" ]  ✅
[ -f "app/[lang]/(admin)/inventory/project-list.tsx" ]  ✅
[ -f "app/[lang]/(admin)/inventory/collateral-form.tsx" ] ✅
[ -f "app/[lang]/(admin)/inventory/import-form.tsx" ]   ✅
[ -f "src/inventory/list.ts" ]                          ✅

# Commit f8b46ec exists:
git log --oneline | grep f8b46ec                        ✅

# crud.ts and import.ts not modified:
git diff HEAD~1 HEAD -- src/inventory/crud.ts            ✅ (empty — not touched)
git diff HEAD~1 HEAD -- src/inventory/import.ts          ✅ (empty — not touched)

# typecheck clean:
npx tsc --noEmit                                        ✅ (0 errors)

# vitest green:
npx vitest run                                          ✅ (452 passed, 0 failed)
```
