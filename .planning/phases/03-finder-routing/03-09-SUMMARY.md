---
phase: 03-finder-routing
plan: "09"
subsystem: eval-validation-rollout
tags: [promptfoo, gold-sets, e2e, playwright, pilot-provisioning, FIND-09, FIND-11, FIND-12]
dependency_graph:
  requires: [03-04, 03-05, 03-07, 03-08]
  provides: [finder-grounding-gold-set, finder-segmentation-gold-set, router-precision-gold-set, finder-e2e-scaffolds, finder-pilot-provisioning]
  affects: [evals/promptfooconfig.yaml, e2e/finder-flow.spec.ts, e2e/inventory-admin.spec.ts, scripts/provision-finder-pilot.ts]
tech_stack:
  added: []
  patterns: [promptfoo-gold-set, playwright-scaffold-skip, admin-sdk-dry-run-provisioning]
key_files:
  created:
    - evals/gold/finder-grounding.yaml
    - evals/gold/finder-segmentation.yaml
    - evals/gold/router-precision.yaml
    - e2e/finder-flow.spec.ts
    - e2e/inventory-admin.spec.ts
    - scripts/provision-finder-pilot.ts
  modified:
    - evals/promptfooconfig.yaml
decisions:
  - "e2e specs placed in e2e/ (Playwright testDir) not tests/e2e/ (plan said tests/e2e/ but Playwright config points to ./e2e/)"
  - "Pilot provisioning script uses UID hashes in all log output (never raw UIDs) for T-03-32 PII hygiene"
  - "--apply flag is required to mutate; default dry-run satisfies T-03-31 elevation-of-privilege mitigation"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-03"
  tasks_completed: 3
  tasks_total: 4
  files_created: 6
  files_modified: 1
---

# Phase 03 Plan 09: Finder/Router Eval Suites + e2e Scaffolds + FIND-12 Pilot Provisioning Summary

Promptfoo gold sets for the two highest-trust-risk Finder surfaces (active-only grounding, investment/own-stay segmentation, foreign-eligibility deferral, router precision × EN/BM/ZH), Playwright e2e scaffolds (finder flow + inventory admin), and a dry-run-guarded Admin-SDK pilot provisioning script for 15–20 agents (FIND-12).

## What Was Built

### Task 1: Finder + Router Promptfoo Gold Sets (commit `b5d787d`)

Three gold-set files created and registered in `evals/promptfooconfig.yaml` under the Opus judge (`JUDGE_MODEL` env var from Remote Config). All marked `live_pilot_gated: true`.

**`evals/gold/finder-grounding.yaml`** (9 cases × EN/BM/ZH):
- Case A: sold-out refusal — semantically matching query must yield grounded refusal-with-alternative, never the sold_out project (Pitfall 1, T-03-33)
- Case B: foreign-eligibility deferral — foreign buyer vs foreignEligible=false project must refusal AND defer legal thresholds to D2 sales admin (never invent a % threshold; Pitfall 5, T-03-34)
- Case C: no-match grounding — sub-threshold criteria must yield grounded refusal, no invented project (D-05, SC3)

**`evals/gold/finder-segmentation.yaml`** (6 cases × EN/BM/ZH):
- Parallel investment vs own_stay queries with identical surface criteria (location, price, bedrooms) assert that the Finder produces DIFFERENT ranking rationale per segment (FIND-09, Pitfall 4, D-05)

**`evals/gold/router-precision.yaml`** (11 cases × EN/BM/ZH):
- Clear Coach messages → pillar='coach'
- Clear Finder messages (paste criteria) → pillar='finder'
- Ambiguous messages → safe default 'coach' (D-01/Pitfall 2)
- Manual override chip → wins over heuristic content

### Task 2: Playwright e2e Scaffolds (commit `6d5df74`)

**`e2e/finder-flow.spec.ts`** (5 tests, all `test.skip`):
- FINDER-01: paste criteria → match cards render (data-slot="match-card", rationale, project ID)
- FINDER-02: collateral chips present as plain URLs (no Drive API embed — D-09/C2)
- FINDER-03: Finder override chip forces routing despite Coach-content message
- FINDER-04: budget shift re-ranks matches without re-typing (SC2/FIND-08, leadContext.finderSlot)
- FINDER-05: sub-threshold criteria → grounded refusal state (data-state="refusal")

**`e2e/inventory-admin.spec.ts`** (7 tests, all `test.skip`):
- ADMIN-01: non-admin redirected from /en/inventory (role gate)
- ADMIN-02: admin loads project list
- ADMIN-03: admin adds project → appears in list
- ADMIN-04: admin hides project → status badge updates
- ADMIN-05: admin attaches collateral (plain URL, not Drive API)
- ADMIN-06: CSV import surfaces per-row errors for bad rows
- ADMIN-07: PII gate (no real MY phone numbers on admin page)

### Task 3: FIND-12 Pilot Provisioning Script (commit `999f093`)

**`scripts/provision-finder-pilot.ts`**:
- Admin-SDK script: `adminAuth.setCustomUserClaims(uid, { role:'new-agent', tenantId:'d2' })` per agent
- Seeds `rateBudgets/{uid}` via `rateBudgetsRef()` (mirrors 01-07 pattern)
- Agent list is external input (`--list pilot-agents.json` or `--uids uid1,uid2`) — never hard-coded
- **Dry-run by default** — `--apply` required to mutate (T-03-31 elevation-of-privilege mitigation)
- Safety cap: MAX_PILOT_AGENTS=25 (prevents accidental bulk provisioning)
- All log output uses SHA-256 UID hashes (12 chars) — never raw UIDs (T-03-32 PII hygiene)
- Documents Remote Config pre-flight check (`model.router.default`, `model.finder.default`)
- Uses `dotenv` to load `.env.local` at startup (mirrors `set-claims.ts` pattern)

## OPEN Human-Action Gate (checkpoint:human-action)

**The following live steps are NOT complete — they require operator execution:**

1. **Remote Config confirmation**: Confirm in Firebase Console → Remote Config that `model.router.default` (claude-haiku-4-5) and `model.finder.default` (claude-sonnet-4-6) are seeded. Code fallbacks exist but explicit seeding is required for the pilot.

2. **FIND-12 pilot provisioning**: An operator must:
   - Prepare the pilot agent list (15–20 UIDs) as `pilot-agents.json` (never committed)
   - Run: `npm run provision-pilot -- --list pilot-agents.json` (dry-run preview)
   - Run: `npm run provision-pilot -- --list pilot-agents.json --apply` (apply)
   - Ensure each provisioned user calls `getIdToken(true)` on their client to force-refresh claims

3. **D2 inventory seeding**: Seed real D2 inventory via the admin inventory app (03-08), using the G4-confirmed source format. Include a `sold_out` project matching the Cheras 3-bed RM650k criteria for the grounding eval.

4. **Live Promptfoo eval run** (requires Anthropic key + JUDGE_MODEL from Remote Config + live inventory):
   ```bash
   JUDGE_MODEL=$(firebase remoteconfig:get --key model.grader.default) \
     npx promptfoo eval -c evals/promptfooconfig.yaml --filter-pattern "finder|router"
   ```
   Pass criteria: sold-out refusal, foreign-eligibility deferral, investment/own-stay segmentation difference, router precision (all rubrics pass Opus judge).

5. **Playwright e2e activation** (after pilot stack deployed):
   - Remove `test.skip` from `e2e/finder-flow.spec.ts` and `e2e/inventory-admin.spec.ts`
   - Run: `NEXT_PUBLIC_APP_URL=https://your-app.web.app npx playwright test`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] e2e spec location: `tests/e2e/` → `e2e/`**
- **Found during:** Task 2
- **Issue:** Plan specified `tests/e2e/finder-flow.spec.ts` and `tests/e2e/inventory-admin.spec.ts`, but Playwright's `playwright.config.ts` has `testDir: './e2e'`. Files in `tests/e2e/` would never be discovered by the test runner.
- **Fix:** Created specs in `e2e/` (the actual Playwright testDir). The plan path was a mismatch with the existing project config.
- **Files modified:** `e2e/finder-flow.spec.ts`, `e2e/inventory-admin.spec.ts`
- **Commit:** `6d5df74`

## Known Stubs

None — all artifacts are either complete gold sets (offline-assertable), skip-guarded Playwright scaffolds (documented for pilot), or a functional provisioning script (dry-run safe). No data stubs that prevent the plan goal. The live eval/e2e/provisioning are blocked on the human-action gate, not on implementation stubs.

## Threat Flags

No new threat surface introduced beyond what is in the plan's threat model (T-03-31/T-03-32/T-03-33/T-03-34 all mitigated in implementation). The provisioning script only writes to Firebase Auth claims and rateBudgets — both existing surfaces, both require operator --apply.

## Verification

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` | PASS (clean) |
| `npx vitest run` | PASS (452 passed, 97 skipped — no regressions) |
| Gold sets exist (node existence check) | PASS |
| `finder-grounding.yaml` contains sold_out + foreign cases | PASS |
| `promptfooconfig.yaml` registers finder + router suites | PASS |
| e2e scaffolds exist, skipped, with describe/test blocks | PASS |
| Provisioning script: setCustomUserClaims + rateBudget + --apply guard | PASS |
| No real PII emails in provisioning script | PASS |
| No unexpected file deletions | PASS |

## Self-Check: PASSED

All code artifacts built and committed. Files exist at expected paths. Commits confirmed in git log. `npx tsc --noEmit` clean. `npx vitest run` green (452 passed). No PII hard-coded. No live runs attempted. STATE.md / ROADMAP.md / REQUIREMENTS.md not modified (per executor override instructions).

The OPEN human-action gate (FIND-12 pilot provisioning + live Finder/router Promptfoo eval + Playwright e2e activation) is documented above. Resume signal: "provisioned" once the pilot agents are provisioned and the live eval suites have run with results recorded.
