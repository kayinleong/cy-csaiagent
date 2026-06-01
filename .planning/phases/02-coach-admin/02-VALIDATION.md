---
phase: 2
slug: coach-admin
status: draft
nyquist_compliant: false
wave_0_complete: false
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

## Per-Task Verification Map

> Populated after `/gsd-plan-phase 2` produces the PLAN.md task IDs. See `02-RESEARCH.md`
> § Validation Architecture for the per-requirement test-type mapping that seeds this table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | (all 31 Phase-2 IDs) | — | — | per RESEARCH §Validation Architecture | `npm test` / `test:rules` / `test:e2e` / `eval` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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
