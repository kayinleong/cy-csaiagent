---
phase: 3
slug: finder-routing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 3 — Validation Strategy

> Per-task rows are filled after planning. Per-requirement test types: see `03-RESEARCH.md § Validation Architecture`.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit/integration), Playwright 1.x (e2e — setup waived per Phase-2 sign-off, scaffold only), Promptfoo (Finder + routing evals), `@firebase/rules-unit-testing` 5.x (rules, emulator-gated) |
| **Quick run** | `npm test` (offline) |
| **Full suite** | `npm run typecheck && npm test && npm run lint` |
| **Rules** | `firebase emulators:exec --only firestore "npm run test:rules"` |
| **Evals** | `npm run eval` (live Anthropic; gated) |

## Sampling Rate
- After every task commit: `npm test` + `npm run typecheck`
- After every wave: full suite; rules tests for any wave touching `firestore.rules`
- Live eval (Finder grounding/active-only + router precision) runs on the deployed pilot stack

## Per-Requirement Validation (seeds the per-task map after planning)
| Req | Validation |
|-----|-----------|
| FIND-01/03/04 | unit (criteria parse, two-stage match, collateral attach) + eval (grounding, active-only) |
| FIND-02 / ADMIN-04 | unit (import adapter, project CRUD) + rules-unit-test (admin-only writes) |
| FIND-05/06/08 | unit (leadContext finderSlot write + re-rank from updated context) |
| FIND-07 | unit (structured inventory query: vpDate/status) |
| FIND-09/10 | unit (eligibility/affordability gate → grounded refusal) + eval (refusal quality) |
| FIND-11 | unit (classifier route decision + override + default-to-coach on low confidence) + eval (route precision) |
| FIND-12 | ops (set-claims pilot provisioning, 15–20 agents) |

## Critical-behavior gates (from RESEARCH risks)
- **Active-only:** a deterministic `status:'active'` + eligibility filter runs BEFORE vector re-rank — unit-asserted (a sold-out/ineligible project can never appear) + eval.
- **Router safety:** low-confidence → default Coach; `route()` async change must keep `heuristic.test.ts` + the stall-detect caller green.

## Wave 0
- Existing test infra (vitest/playwright/promptfoo/rules) — no install.
- New: project-match + classifier + import + inventory-query test files (created within their plans); schema/index additions (`priceValue`/`vpDate`) in the data-model wave.

## Manual / live-gated
| Behavior | Why | When |
|----------|-----|------|
| Finder grounding + active-only quality | needs live Gemini/Firestore + judge | pilot eval |
| Router precision (Coach↔Finder) | needs live classifier + real traffic | pilot + eval |
| Collateral rendering on a phone | needs live deploy | pilot |

**Approval:** pending
