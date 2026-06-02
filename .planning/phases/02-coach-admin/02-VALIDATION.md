---
phase: 2
slug: coach-admin
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-02
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Per-task rows are filled after planning (task IDs come from the PLAN.md files).
> Per-requirement test types are mapped in `02-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit/integration), Playwright 1.x (e2e), Promptfoo (evals), `@firebase/rules-unit-testing` 5.x (security rules, emulator-gated) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `evals/promptfooconfig.yaml`, `firebase.json` |
| **Quick run command** | `npm test` (vitest, offline) |
| **Full suite command** | `npm run typecheck && npm test && npm run lint` |
| **Rules tests** | `firebase emulators:exec --only firestore "npm run test:rules"` (needs Java + emulator; env-gated, skips cleanly otherwise) |
| **E2E** | `npm run test:e2e` (needs live stack + credentials) |
| **Evals** | `npm run eval` (needs live Anthropic + `JUDGE_MODEL` from Remote Config) |
| **Estimated runtime** | ~2s quick (vitest); e2e/eval/rules require the live stack/emulator |

---

## Sampling Rate

- **After every task commit:** `npm test` (offline unit/integration) + `npm run typecheck`
- **After every plan wave:** full suite (`typecheck && test && lint`); rules tests under the emulator for any wave touching `firestore.rules`
- **Before `/gsd-verify-work`:** full suite green; e2e + eval pass against the live stack once Phase-1 gates close
- **Max feedback latency:** ~5 seconds (offline tier)

---

## Per-Plan Verification Map

> Per-plan granularity (one row per PLAN.md). Every executable task in each plan carries its own
> `<verify><automated>` block (confirmed by the plan-checker — no 3-consecutive-task gap), so the
> Nyquist sampling-continuity bar is met. `gsd-nyquist-auditor` expands this to per-individual-task
> rows at execution. Per-requirement test types: see `02-RESEARCH.md § Validation Architecture`.

| Plan | Wave | Requirements | Primary Test Type | Automated Command | Live-gated? | Status |
|------|------|--------------|-------------------|-------------------|-------------|--------|
| 02-01 | 1 | AUTH-02, AUTH-03, AUTH-06 | rules-unit-test + unit | `npm run test:rules` (emulator) + `npm test` | rules need emulator | ⬜ pending |
| 02-02 | 2 | ADMIN-03, CDASH-04 | unit (retrieval filter, supersede) | `npm test src/rag src/kb` | live findNearest gated | ⬜ pending |
| 02-03 | 2 | CHAT-01..08 | unit + e2e | `npm test src/memory` + `npm run test:e2e` | e2e needs live stack | ⬜ pending |
| 02-04 | 2 | COACH-01,02,03,06,07,08,09 | unit (TDD: journey/comprehension) | `npm test src/coach src/agents/coach` | comprehension grading live-gated | ⬜ pending |
| 02-05 | 2 | COACH-04, COACH-05, CDASH-03, CDASH-06 | unit (injectable clock) | `npm test src/jobs src/escalation` | — (offline) | ⬜ pending |
| 02-06 | 4 | AUTH-06, CDASH-01,02,03,04,05,07, COACH-10 | unit + rules-unit-test | `npm test src/dashboard` + `npm run test:rules` | downline reads need emulator | ⬜ pending |
| 02-07 | 3 | QUAL-06 | promptfoo eval + unit | `npm test src/eval` + `npm run eval` | eval needs live Anthropic | ⬜ pending |
| 02-08 | 3 | ADMIN-01, ADMIN-03 | unit + e2e | `npm test src/kb` + `npm run test:e2e` | e2e needs live stack | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Offline tiers (vitest + emulator rules) run now; e2e/eval tiers run after the Phase-1 gate closes.*

---

## Wave 0 Requirements

- [ ] Test infrastructure already exists (vitest/playwright/promptfoo/rules-unit-testing from Phase 1) — no install needed.
- [ ] New rules-test coverage for downline-scoped reads + correction writes (AUTH-06, CDASH-04) — added in the wave that touches `firestore.rules`.
- [ ] Expanded Promptfoo gold set + judge rubrics for the Coach (QUAL-06) — added in the eval wave.

*Existing infrastructure covers the base; Phase 2 extends rules + eval coverage.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Token-by-token streaming on a real 4G phone | CHAT-04 | Needs physical device + deployed stack | Tied to Phase-1 SPIKE-DEPLOY; re-verify on the pilot deploy |
| Proactive overnight nudge actually fires | COACH-04 / D-09 | Lazy-cron is visit-triggered (not wall-clock) | Pilot observation; decision point on the GitHub Actions escape hatch |
| Trilingual answer quality (BM/中文) | CHAT-08 / QUAL-06 | Needs native-speaker judgment | Human calibration with Derek + a coach (>85% judge-human agreement) |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (offline tier)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
