---
phase: 03-finder-routing
plan: "01"
subsystem: firebase/schema
tags: [schema, firestore, indexes, security-rules, finder, affordability, vp-date]
dependency_graph:
  requires:
    - "02-01 (extended collections.ts baseline + deny-by-default rules + emulator gate pattern)"
    - "01-03 (initial firestore.rules + rules-unit-testing infrastructure)"
  provides:
    - "ProjectDoc with priceValue / priceBand / vpDate / description / locationText / bedrooms"
    - "PRICE_BANDS const + PriceBand type + priceBandFor() helper"
    - "CollateralDoc with optional externalUrl field"
    - "Two new projects composite indexes: (status, priceBand, embedding 1024-d) + (status, vpDate)"
    - "Rules tests: extended schema + senior-coach-deny (T-03-01) + admin write (T-03-02)"
  affects:
    - "03-02 (searchProjects two-stage query reads ProjectDoc.priceValue + priceBand + vpDate)"
    - "03-03 (Finder agent schema reads description/locationText/bedrooms for embedding)"
    - "03-04 (inventory CRUD writes all new fields via priceBandFor() + embedded text)"
    - "03-05 (admin UI form binds new fields)"
tech_stack:
  added: []
  patterns:
    - "Discrete equality-filterable priceBand + numeric priceValue for Pitfall-6 findNearest constraint"
    - "vpDate timestamp for FIND-07 date-grain VP queries"
    - "priceBandFor() deterministic helper shared by crud/import/search (no magic strings)"
    - "Optional externalUrl on CollateralDoc (Storage path OR external URL — never Drive API)"
key_files:
  created: []
  modified:
    - path: src/firebase/collections.ts
      change: "Extended ProjectDoc + CollateralDoc; added PRICE_BANDS, PriceBand, priceBandFor()"
    - path: firestore.indexes.json
      change: "Added (status, priceBand, embedding) vector composite + (status, vpDate) composite indexes"
    - path: src/firebase/__tests__/rules.test.ts
      change: "Added §8b: full new-shape seed + new-agent-read + unauthenticated-deny + new-agent-write-deny + senior-coach-write-deny (T-03-01) + admin-write"
decisions:
  - "Pitfall-6 resolution: store discrete priceBand (equality-filterable) for findNearest pre-filter AND numeric priceValue for in-memory affordability ceiling (not a range filter in Firestore)"
  - "priceBandFor() helper exported from collections.ts so all write paths (crud, import, admin) derive the band identically — no magic strings"
  - "vpDate: Date|FieldValue|null added alongside vpStatus boolean (denormalized convenience flag kept) per FIND-07 date-grain requirement"
  - "CollateralDoc.externalUrl is optional (not required) so existing docs without the field remain valid"
  - "T-03-01 senior-coach-write test added as a new focused §8b block rather than extending the §8 loop, to keep the new-shape seed legible and isolated"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-02"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
  files_created: 0
---

# Phase 3 Plan 01: Finder Schema Foundation — Summary

**One-liner:** Extended ProjectDoc (priceValue/vpDate/priceBand/description/locationText/bedrooms), CollateralDoc (externalUrl), two new Firestore composite indexes, and rules-unit-tests proving admin-only-write + senior-coach-deny on the new schema.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend ProjectDoc + CollateralDoc with matching/affordability/VP fields | 6dfa58c | src/firebase/collections.ts |
| 2 | Add projects composite indexes for equality-prefilter findNearest + VP-date query | 6dc5780 | firestore.indexes.json |
| 3 | Extend rules-unit-test for projects/collateral covering new schema + deny-by-default | d9356d8 | src/firebase/__tests__/rules.test.ts |

## What Was Built

### Task 1 — Schema extension (src/firebase/collections.ts)

**ProjectDoc additions:**
- `PRICE_BANDS` const + `PriceBand` type: `'under_500k' | '500k_800k' | '800k_1.2m' | 'above_1.2m'`
- `priceBandFor(priceValue: number): PriceBand` — deterministic banding helper, single source of truth for all write paths
- `priceBand: PriceBand` — re-typed from `string` to the discrete union; enables equality pre-filter for `findNearest`
- `priceValue: number` — numeric RM asking price; used for in-memory affordability ceiling (Pitfall 6 — cannot range-filter with `findNearest`)
- `vpDate: Date | FieldValue | null` — VP completion date; `null` when not yet completed; backs FIND-07 structured VP queries
- `description: string` — semantic project description for embedding-text composer
- `locationText: string` — location string for semantic matching
- `bedrooms: number` — bedroom count for structured + semantic matching

**CollateralDoc additions:**
- `externalUrl?: string` — optional plain share URL (D-09/C2: Storage path OR external URL, NEVER Drive API)

### Task 2 — Indexes (firestore.indexes.json)

Two new entries for the `projects` collection:

1. **`(status ASC, priceBand ASC, embedding 1024-d flat)`** — backs `where('status','==','active').where('priceBand','==',band).findNearest(embedding, DOT_PRODUCT)`. Both pre-filters are equality-only, satisfying Firestore's findNearest constraint (Pitfall 6).

2. **`(status ASC, vpDate DESC)`** — backs `where('status','==','active').where('vpDate','>=',startOfYear).orderBy('vpDate','desc')` for FIND-07 structured VP queries.

Existing indexes preserved: `(status, priceBand)`, `(status, embedding)`.

### Task 3 — Rules tests (src/firebase/__tests__/rules.test.ts)

New `§8b` focused block seeds full new-shape `ProjectDoc` + `CollateralDoc` and asserts:
- new-agent CAN read projects + collateral (signed-in, same tenant)
- unauthenticated CANNOT read (deny-by-default)
- new-agent CANNOT write (not admin)
- **senior-coach CANNOT write projects or collateral (T-03-01 elevation-of-privilege guard)**
- admin CAN write the full new-shape doc (T-03-02 — no new write path opened)

Tests skip cleanly without `FIRESTORE_EMULATOR_HOST` (existing emulator-gate pattern).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes at trust boundaries beyond what the plan's threat model anticipates. The new fields are additive and are covered by the existing `hasRole('admin') && incomingTenant()` write rule. No new threat flags.

## Known Stubs

None — plan 03-01 is schema + indexes + rules only. No data-flow stubs. The embedding fields (`embedding: number[]`) are intentionally empty in test fixtures (seeds use `[]`); actual embeddings are populated by the inventory CRUD module (03-04).

## Self-Check

### Created files exist
- src/firebase/collections.ts — FOUND (modified, not created)
- firestore.indexes.json — FOUND (modified)
- src/firebase/__tests__/rules.test.ts — FOUND (modified)

### Commits exist
- 6dfa58c — FOUND (feat: extend ProjectDoc/CollateralDoc)
- 6dc5780 — FOUND (feat: add projects composite indexes)
- d9356d8 — FOUND (feat: extend rules tests)

### Acceptance criteria verified
- `grep -n "priceValue" src/firebase/collections.ts` — FOUND (line 192)
- `grep -n "vpDate" src/firebase/collections.ts` — FOUND (line 207)
- `grep -n "PRICE_BANDS|priceBandFor" src/firebase/collections.ts` — FOUND (lines 144, 150, 165)
- `grep -n "externalUrl" src/firebase/collections.ts` — FOUND (line 252)
- `npm run typecheck` — PASSED (no output = clean)
- Node index assertion for both projects indexes — PASSED ("OK projects indexes present")
- `grep -n "vpDate" firestore.indexes.json` — FOUND (line 90)
- New vector index `"dimension": "1024"` and `"flat": {}` — CONFIRMED (line 79 + matching block)
- `grep -n "priceValue" src/firebase/__tests__/rules.test.ts` — FOUND (lines 444, 458, 552)
- Senior-coach-write assertion — FOUND (lines 532-542)
- `npx vitest run` — 325 tests PASSED, 97 skipped (10 new skips = new emulator-gated §8b tests)

## Self-Check: PASSED
