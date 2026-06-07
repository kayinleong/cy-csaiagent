---
phase: 5
slug: hardening-scale
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
---

# Phase 5 — Validation Strategy

> Per-phase validation contract. Derived from `05-RESEARCH.md` §Validation Architecture.
> Task IDs are provisional until `05-*-PLAN.md` assign them.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Unit/Integration** | Vitest `4.1.7` — `vitest.config.ts` (node; `src/**`, `tests/**`, `app/**/*.test.ts`) |
| **Rules tests** | `@firebase/rules-unit-testing` `5.0.1` — `src/firebase/__tests__/rules.test.ts`; Firestore emulator (firebase.json: firestore:8080) |
| **E2E** | Playwright `1.60.0` — `playwright.config.ts` (`e2e/`) |
| **Evals** | Promptfoo — `evals/promptfooconfig.yaml` |
| **Quick run** | `npm test` (vitest run; rules tests SKIP cleanly without emulator) |
| **Full suite** | `firebase emulators:exec "npm test && npm run test:rules"` then `npm run test:e2e` + `npm run eval` |

---

## Sampling Rate

- **Per task commit:** `npm test` (fast). Emulator-dependent tasks (erasure/rollup/rules): `firebase emulators:exec "vitest run src/pdpa src/usage"`.
- **Per wave merge:** `firebase emulators:exec "npm test && npm run test:rules"`.
- **Phase gate:** full unit + rules + e2e + eval green; **QUAL-01 model-swap stays green**; live-gated items (load test, PDPA drill, backup/restore, browser click-through) executed during rollout prep with evidence linked in `HARDENING.md`.
- **Max feedback latency:** ~30s offline.

---

## Per-Requirement Verification Map

| Req | Wave | Behavior | Threat Ref | Test Type | Automated Command | Status |
|-----|------|----------|------------|-----------|-------------------|--------|
| QUAL-09 | 0/1 | **Erasure coverage** — every PII collection → 0 docs after erase | T-05-COVERAGE | unit/integration (emulator) | `firebase emulators:exec "vitest run src/pdpa"` | ⬜ |
| QUAL-09 | 0/1 | **Audit exemption** — erase does NOT delete `auditLogs`; writes an `erasure` event | T-05-AUDIT | unit/integration (emulator) | `firebase emulators:exec "vitest run src/pdpa/erasure.test.ts"` | ⬜ |
| QUAL-09 | 1 | Erasure idempotency + chunked sweep finishes partials | — | unit (emulator) | `firebase emulators:exec "vitest run src/pdpa/sweep.test.ts"` | ⬜ |
| QUAL-09 | 1 | Erasure Server Action admin-gate + zod input validation | T-05-ADMINGATE | unit | `vitest run app/[lang]/(admin)/erasure/actions.test.ts` | ⬜ |
| QUAL-09 | 1 | **Deny-by-default** `erasureRequests` (client CUD denied; admin read) | T-05-UNRULED | rules-test (emulator) | `npm run test:rules` | ⬜ extend |
| QUAL-09 | live | PDPA erasure drill (<72h e2e) + Derek `PDPA-SIGNOFF.md` | — | **manual/human-gated** | live stack + sign-off memo | ⬜ artifact |
| QUAL-08 / ADMIN-08 | 1 | Usage capture (`final.totalUsage` → `usageEvents`, no PII) | T-05-PII | unit | `vitest run src/usage/record.test.ts` | ⬜ |
| QUAL-08 / ADMIN-08 | 1 | Rollup aggregation (sum/count, idempotent set-merge) | — | unit (emulator) | `firebase emulators:exec "vitest run src/usage/rollup.test.ts"` | ⬜ |
| QUAL-08 / ADMIN-08 | 1 | **Deny-by-default** `usageEvents`/`usageRollups` (client-write denied; rollups admin-read) | T-05-UNRULED | rules-test (emulator) | `npm run test:rules` | ⬜ extend |
| QUAL-08 | live | Prompt-cache hit-rate measured + `PERF-COST.md` numbers | — | **manual/live measure** | live stack + documented numbers | ⬜ artifact |
| ADMIN-08 | 2 | Admin usage dashboard renders rollups (org scope) | — | e2e | `npm run test:e2e -- usage` | ⬜ |
| CDASH-08 | 2 | Funnel/ramp/knowledge-gap/correction→eval panels render; role scope | — | unit (metrics) + e2e | `vitest run src/dashboard/*.test.ts` · `npm run test:e2e -- dashboard` | ⬜ extend |
| ADMIN-02 | 2 | Conversation viewer admin-only + `auditDrilldown` written; cross-pillar | T-05-ADMINGATE | unit + e2e | `vitest run app/[lang]/(admin)/conversations/actions.test.ts` · `e2e -- conversation-viewer` | ⬜ |
| ADMIN-07 | 2 | Role matrix read + `setUserClaims` assignment admin-gated + audited | T-05-ADMINGATE | unit | `vitest run app/[lang]/(admin)/roles/actions.test.ts` | ⬜ |
| ADMIN-07 | 1 | **Rules sweep proving the matrix** — coach=downline, admin=all, cross-tenant denied (all 19 collections) | T-05-CROSS | rules-test (emulator) | `npm run test:rules` | ⬜ extend (16→19) |
| QUAL-01 | all | Model-swap proof STILL passes (carried-forward gate) | — | integration | existing 01-13 model-swap test | ✅ must stay green |
| SC4 / D-11 | live | ~400-concurrent load test (p95, error, cold-start, contention) | T-05-DOS | **live-gated** | `k6 run scripts/loadtest/chat.js` against deployed stack | ⬜ code-ready, exec deferred |
| SC4 / D-12 | live | Backup/restore drill | — | **manual/human-gated** | `gcloud firestore export` runbook | ⬜ runbook |
| QUAL-10 | n/a | Handover docs exist | — | manual review | `docs/operations/*` present | ⬜ artifact |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements (failing-test stubs before implementation)

- [ ] `src/pdpa/erasure.test.ts` — QUAL-09 cascade + audit exemption (emulator)
- [ ] `src/pdpa/coverage.test.ts` — QUAL-09 coverage manifest (every PII collection → 0 docs)
- [ ] `src/pdpa/sweep.test.ts` — QUAL-09 idempotent chunked sweep
- [ ] `src/usage/record.test.ts` — QUAL-08 usage capture (no-PII, `totalUsage`)
- [ ] `src/usage/rollup.test.ts` — QUAL-08/ADMIN-08 aggregation (emulator)
- [ ] `app/[lang]/(admin)/erasure/actions.test.ts`, `conversations/actions.test.ts`, `roles/actions.test.ts` — admin-gate + audit assertions
- [ ] Extend `src/firebase/__tests__/rules.test.ts` — add `usageEvents`, `usageRollups`, `erasureRequests` (deny-by-default + admin-read); update the "all 16 enumerated" assertion → 19
- [ ] e2e specs: admin erasure click-through, conversation viewer, usage dashboard, dashboard v2 panels
- [ ] `scripts/loadtest/chat.js` (k6) — code-ready; live execution deferred

*(Test infra present — only new test FILES needed, no framework installs.)*

---

## Manual-Only / Live-Gated Verifications

| Behavior | Requirement | Why | Instructions |
|----------|-------------|-----|--------------|
| PDPA erasure drill (<72h e2e) | QUAL-09 | Needs live deployed stack + real subject data | Run `eraseDataSubject` on a seeded subject in a deployed env; confirm 0 residual + audit survives within 72h; Derek signs `PDPA-SIGNOFF.md` |
| Prompt-cache hit-rate + cost numbers | QUAL-08 | Needs live model traffic | Measure on deployed stack; record in `PERF-COST.md` |
| ~400-concurrent load test | SC4/D-11 | Needs deployed App Hosting + load infra | `k6 run scripts/loadtest/chat.js`; record p95/error/cold-start in `LOADTEST.md` |
| Backup/restore drill | SC4/D-12 | Managed Firestore export/import (gcloud) | Operational runbook; confirm restore to a scratch project |
| Browser click-through | CDASH-08/ADMIN-02/07/08/QUAL-09 | No Firebase creds offline | Click each surface on a deployed seeded stack incl. the erasure type-to-confirm gate |

---

## Validation Sign-Off

- [ ] Every task has an `<automated>` verify or a Wave-0 dependency
- [ ] No 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references (esp. erasure-coverage + audit-exemption + the 3 new collections' rules)
- [ ] No watch-mode flags
- [ ] QUAL-01 model-swap stays green throughout
- [ ] `nyquist_compliant: true` set by the planner once tasks map cleanly

**Approval:** pending
