---
phase: 02-coach-admin
plan: "07"
subsystem: testing
tags: [promptfoo, vitest, eval, rubric, gold-set, trilingual, hallucination, tone-drift, lazy-cron, qual-06]

# Dependency graph
requires:
  - phase: 02-coach-admin/02-05
    provides: runNightlyEval seam in runDueJobs.ts eval-nightly job + evalsRef/EvalDoc in collections.ts
  - phase: 02-coach-admin/02-04
    provides: grown Coach prompt (journey-aware + playbook tools) that the gold sets exercise
  - phase: 01-foundations/01-13
    provides: P1 judge.ts (four-domain rubric), coach-trilingual.gold.yaml, promptfooconfig.yaml, CALIBRATION.md

provides:
  - Six-domain Opus judge rubric (grounding/scope/language/voice/hallucination/tone-drift) in src/eval/judge.ts
  - Three trilingual gold sets (coach-training/journey/playbooks × EN/BM/ZH) in evals/gold/
  - runNightlyEval() body — Promptfoo shell-out + EvalDoc write to evalsRef() — in src/eval/runNightly.ts
  - CI changed-prompt suite step (offline YAML validation) in .github/workflows/ci.yml
  - Updated evals/CALIBRATION.md (six-domain protocol, lazy-cron pipeline, deferred calibration gate)
  - 32 offline structural tests in src/eval/judge.test.ts

affects:
  - 02-08 (senior-coach dashboard — eval pass rates feed the dashboard regression view)
  - Phase 2 go/no-go memo (live calibration result: >85% judge-human agreement)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline-skip guard: JUDGE_MODEL env unset → warn + return; never crashes the lazy-cron"
    - "EvalDoc per (suite, lang) group — ancillary metadata encoded in failures[] footer line to preserve typed schema"
    - "Gold sets: structural assertions (contains, javascript) run offline; llm-rubric applied via promptfooconfig.yaml defaultTest"
    - "CI: offline YAML validation step (no live calls) for changed-prompt PRs; live eval gated on JUDGE_MODEL"

key-files:
  created:
    - src/eval/judge.test.ts
    - evals/gold/coach-training.yaml
    - evals/gold/coach-journey.yaml
    - evals/gold/coach-playbooks.yaml
  modified:
    - src/eval/judge.ts
    - src/eval/runNightly.ts
    - evals/promptfooconfig.yaml
    - evals/CALIBRATION.md
    - .github/workflows/ci.yml

key-decisions:
  - "EvalDoc schema preserved as-is (no new fields); runId/total/passed encoded in failures[] footer line"
  - "No scheduled-cron GitHub Actions workflow added — nightly eval runs via on-visit lazy-cron (D-09 decision, 02-CONTEXT.md)"
  - "Live calibration run deferred-behind-the-gate (user-approved): Phase-1 gates (SPIKE-DEPLOY) must close first"
  - "hallucination and toneDrift added as separate domains (not merged into voice) to enable per-domain calibration tuning"

patterns-established:
  - "Gold YAML pattern: vars.lang = en/ms/zh; structural assertions offline; llm-rubric via defaultTest; native_review_status on all BM/ZH cases"
  - "Offline-skip guard pattern: check JUDGE_MODEL env before any live model call; log + return (do not throw)"

requirements-completed: [QUAL-06]

# Metrics
duration: 15min
completed: 2026-06-02
---

# Phase 2 Plan 07: Coach Eval Regression Suite Summary

**Six-domain Opus judge rubric (adding hallucination + tone-drift) wired to trilingual Coach gold sets (training/journey/playbooks × EN/BM/ZH), Promptfoo nightly runner body filling the 02-05 seam, and CI offline validation — all gated behind JUDGE_MODEL env for offline safety**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-02T20:19:00Z
- **Completed:** 2026-06-02T20:24:32Z
- **Tasks:** 2 (Task 3 is a checkpoint:human-verify — stopped as required)
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- Expanded the Phase-1 four-domain judge rubric to six domains: grounding, scope, language-match, voice, **hallucination** (no facts asserted beyond cited KB chunks), and **tone-drift** (no AI-persona bleed). `combinedJudgeRubric` updated to score all six; OVERALL is PASS only if all pass.
- Authored three trilingual gold sets (EN/BM/ZH) exercising the full Coach: training Q&A + out-of-scope refusal (`coach-training`), day-one pairing + comprehension gate (`coach-journey`), Meta Ads playbook + first-Meta-ad walkthrough (`coach-playbooks`). All synthetic content, PII-gated, with KB-citation assertions.
- Filled `runNightlyEval()` in `src/eval/runNightly.ts` — the seam 02-05 wired. Offline-skip guard (JUDGE_MODEL unset → warn + skip), Promptfoo shell-out, JSON parse, EvalDoc write per (suite, lang) to `evalsRef()`. Never crashes the lazy-cron.
- Extended `evals/promptfooconfig.yaml` to include all three new gold sets alongside the P1 seed fixture.
- Added offline YAML validation CI step for changed-prompt PRs; updated CALIBRATION.md to v2.0 (six domains, lazy-cron pipeline, deferred calibration gate).
- 32 offline structural tests in `src/eval/judge.test.ts` — all pass without live model calls.

## Task Commits

1. **Task 1: Expand judge rubric + trilingual gold sets** — `5b2bbf7` (feat)
2. **Task 2: Wire suite into CI + eval-nightly runner body** — `6e72ff6` (feat)

(Task 3 is `checkpoint:human-verify` — returned as checkpoint per plan spec.)

## Files Created/Modified

- `/src/eval/judge.ts` — Added `hallucination` + `toneDrift` domains; recomposed `combinedJudgeRubric` (six-domain, OVERALL = all-pass)
- `/src/eval/judge.test.ts` — 32 offline structural tests: rubric domains, gold-set parse, EN/MS/ZH presence, KB-citation assertions, PII gate
- `/src/eval/runNightly.ts` — Implemented `runNightlyEval()`: offline-skip guard, Promptfoo shell-out to `evals/promptfooconfig.yaml`, JSON parse, EvalDoc write per (suite, lang) via `evalsRef()`
- `/evals/gold/coach-training.yaml` — Training Q&A (grounded cited answer + out-of-scope refusal) × EN/BM/ZH
- `/evals/gold/coach-journey.yaml` — Day-one pairing + comprehension gate (no multiple-choice) × EN/BM/ZH
- `/evals/gold/coach-playbooks.yaml` — Meta Ads channel playbook + first-Meta-ad walkthrough × EN/BM/ZH
- `/evals/promptfooconfig.yaml` — Extended to include all three new gold sets + P1 seed; six-domain rubric via env.JUDGE_MODEL
- `/evals/CALIBRATION.md` — Updated to v2.0: six-domain protocol, lazy-cron pipeline (not QStash), Phase-2 gold sets, deferred calibration gate documentation
- `/.github/workflows/ci.yml` — Added "Eval fixtures — offline YAML syntax validation" step for changed-prompt PRs

## Decisions Made

- **EvalDoc schema preserved as-is**: Adding fields (runId, runAt, totalCases) would require a schema change (TypeScript strict). Instead, ancillary metadata is encoded in the `failures[]` array as a footer line (`meta:runId=...`). Future plans can extend the EvalDoc schema cleanly.
- **No scheduled-cron GitHub Actions workflow**: The plan explicitly documents that nightly evals run via the on-visit lazy-cron Server Action (D-09 decision, 02-CONTEXT.md). Adding a scheduled-cron GHA job would contradict this decision and introduce a second scheduler pathway.
- **hallucination and toneDrift as separate domains** (not merged into `voice`): Distinct domains enable per-domain calibration tuning. If calibration reveals the judge is consistently miscalibrated on tone-drift but not voice, the rubric for that specific domain can be revised without affecting the voice check.
- **Live calibration deferred behind Phase-1 gate**: The calibration run with Derek + a coach requires the live stack (SPIKE-DEPLOY). All offline-testable artifacts are committed now; the calibration sign-off follows after the gate closes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed extra fields from EvalDoc write call (TypeScript strict)**
- **Found during:** Task 2 (runNightly.ts implementation)
- **Issue:** The initial `ref.doc(docId).set()` call included extra fields (`runId`, `runAt`, `totalCases`, `passedCases`) not in the `EvalDoc` schema. TypeScript strict mode threw TS2353 (object literal may only specify known properties).
- **Fix:** Removed extra fields from the typed set call. Encoded ancillary metadata (`runId`, `total`, `passed`, `ts`) as a footer entry in the `failures[]` array (always present, clearly prefixed with `meta:`).
- **Files modified:** `src/eval/runNightly.ts`
- **Verification:** `npm run typecheck` clean after fix.
- **Committed in:** `6e72ff6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — type error in EvalDoc write)
**Impact on plan:** Minimal — the metadata is still persisted, just in a different field. No scope change.

## Known Stubs

None — no UI rendering or hardcoded empty values. Gold sets are authored with synthetic content (not placeholder text). `runNightlyEval()` is fully wired; it only no-ops at runtime when JUDGE_MODEL is unset (intentional offline-skip, not a stub).

## Threat Flags

None — no new network endpoints, no new auth paths, no new client-facing surfaces. The `evals/` Firestore collection is write-only via Admin SDK (T-02-34, already in the plan's threat model). Gold sets use synthetic content only (T-02-33). Judge model resolved from env/Remote Config (T-02-35).

## Issues Encountered

TypeScript strict mode rejected extra fields on the typed `EvalDoc` write. Resolved inline (see Deviations above). No other issues.

## User Setup Required

None immediately. Post Phase-1 gate:
1. Derek configures `model.grader.default` in Firebase Remote Config (the `JUDGE_MODEL` env var the runner reads).
2. Run the live calibration: `JUDGE_MODEL=$(firebase remoteconfig:get --key model.grader.default) npx promptfoo eval -c evals/promptfooconfig.yaml`
3. Execute the human-calibration protocol in `evals/CALIBRATION.md` with Derek + a senior coach.
4. Record the agreement % in `evals/CALIBRATION.md §10` and mark the checkpoint as approved.

## Next Phase Readiness

- The eval infrastructure is complete and offline-validated. The live calibration run is explicitly deferred pending the Phase-1 stack gate (user-approved — see CALIBRATION.md §10).
- The `eval-nightly` lazy-cron job (02-05) already delegates to `runNightlyEval()` — no registry changes needed. Once JUDGE_MODEL is set in Remote Config, the nightly run activates automatically on the next authorized visit.
- Task 3 (`checkpoint:human-verify`) is returned to the user: after Phase-1 gates close, run `npm run eval`, execute the human calibration per CALIBRATION.md, confirm >85% agreement, and approve the checkpoint. This result feeds the Phase 2→3 go/no-go memo.

---

*Phase: 02-coach-admin*
*Completed: 2026-06-02*

## Self-Check: PASSED

Verified files exist:
- `src/eval/judge.ts` — FOUND (hallucination + toneDrift domains present)
- `src/eval/judge.test.ts` — FOUND (32 tests, all pass)
- `src/eval/runNightly.ts` — FOUND (runNightlyEval body implemented, offline-skip guard present)
- `evals/gold/coach-training.yaml` — FOUND (EN/MS/ZH cases present)
- `evals/gold/coach-journey.yaml` — FOUND (EN/MS/ZH cases present)
- `evals/gold/coach-playbooks.yaml` — FOUND (EN/MS/ZH cases present)
- `evals/promptfooconfig.yaml` — FOUND (coach-training/journey/playbooks referenced)
- `evals/CALIBRATION.md` — FOUND (v2.0, six-domain rubric, deferred gate documented)
- `.github/workflows/ci.yml` — FOUND (changed-prompt eval step added)

Verified commits exist:
- `5b2bbf7` — feat(phase-kayinleong-02): 02-07 — FOUND
- `6e72ff6` — feat(phase-kayinleong-02): 02-07 — FOUND

Verified constraints:
- `src/jobs/runDueJobs.ts` NOT modified — CONFIRMED (git diff shows zero changes)
- `npx tsc --noEmit` — CLEAN
- `npx vitest run` — GREEN (304 passed, 87 skipped)
- No hard-coded model IDs in judge.ts or promptfooconfig.yaml — CONFIRMED
- No PII in gold sets — CONFIRMED (PII gate assertions in every fixture)
- Live calibration flagged as deferred-behind-the-gate — CONFIRMED (CALIBRATION.md §10)
