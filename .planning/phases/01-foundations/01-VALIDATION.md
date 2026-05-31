---
phase: 1
slug: foundations
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test infrastructure below is from RESEARCH.md; the Per-Task Verification Map and Wave 0
> list are filled by the planner now that PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` (unit/integration, with `llm/` fake provider) · `@firebase/rules-unit-testing` (rules) · `@playwright/test` (E2E) · `promptfoo` (eval) |
| **Config file** | installed in Wave 0 / plan 01-02 (`vitest.config.ts`, `playwright.config.ts`, `firebase.json` emulator block, `promptfooconfig.yaml`) |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npm run test:rules && npx playwright test && npx promptfoo eval -c evals/promptfooconfig.yaml` |
| **Estimated runtime** | ~quick <30s; full a few minutes (rules emulator + Playwright dominate) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` (quick)
- **After every plan wave:** Run the full suite (`vitest run` + `npm run test:rules`; Playwright + Promptfoo at the Wave-5/6 capstone)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (quick run)

---

## Per-Task Verification Map

> One row per PLAN.md task. Every task has an `<automated>` command OR a Wave-0 dependency that creates it.
> Anchored to RESEARCH.md §Validation Architecture observable signals + the 5 ROADMAP success criteria.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 0 | FND-01, QUAL-04 | T-01-02 | Region confirmed before any resource (G1) | manual (checkpoint) | n/a — human-action gate; `grep asia-southeast1 G1-REGION-SIGNOFF.md` | ✅ created by plan | ⬜ pending |
| 01-01-T2 | 01-01 | 0 | FND-09 | T-01-01 | Secrets via Secret Manager, none in repo | manual + grep | `grep -rIE "(sk-ant\|voyage-\|qstash_)[A-Za-z0-9]{8,}" .planning/` (empty) | ✅ created by plan | ⬜ pending |
| 01-02-T1 | 01-02 | 0 | FND-02, QUAL-03 | T-01-04 | CI PII scan + Next.js-16 anti-pattern lint | config + CI | `npx vitest run src/llm/fake.test.ts; npm run lint` | ✅ created by plan | ⬜ pending |
| 01-02-T2 | 01-02 | 0 | FND-02, QUAL-01 | T-01-05 | llm fake provider; src/ Next-free | unit (TDD) | `npx vitest run src/llm/fake.test.ts` | ✅ created by plan | ⬜ pending |
| 01-03-T1 | 01-03 | 1 | FND-04 | T-01-08 | tenantId stamped; messages subcollection; rateBudgets declared | unit | `npx vitest run src/firebase/collections.test.ts` | ✅ created by plan | ⬜ pending |
| 01-03-T2 | 01-03 | 1 | AUTH-04, QUAL-05 | T-01-06, T-01-07, T-01-09, T-01-10 | Deny-by-default rules; auditLogs immutable; rateBudgets owner-scoped (cross-agent denied); 3 roles | rules-unit-test | `npm run test:rules` | ✅ created by plan | ⬜ pending |
| 01-04-T1 | 01-04 | 2 | AUTH-04 | T-01-10, T-01-11 | requireUser verifies token; claims never from body | unit (TDD) | `npx vitest run src/firebase/auth.test.ts` | ✅ created by plan | ⬜ pending |
| 01-04-T2 | 01-04 | 2 | AUTH-01, AUTH-05 | T-01-12 | Sign-in; httpOnly session cookie; LOCAL persistence | lint + type | `npm run lint && npx tsc --noEmit` | ✅ created by plan | ⬜ pending |
| 01-05-T1 | 01-05 | 2 | QUAL-03 | T-01-14 | Pseudonymize at boundary; pdpa_redacted gate throws | unit (TDD) | `npx vitest run src/audit/pdpa.test.ts` | ✅ created by plan | ⬜ pending |
| 01-05-T2 | 01-05 | 2 | FND-11, QUAL-05 | T-01-15, T-01-16 | Append-only hashes-only audit; TIA on file | unit (TDD) | `npx vitest run src/audit/log.test.ts` | ✅ created by plan | ⬜ pending |
| 01-06-T1 | 01-06 | 1 | AUTH-01 | T-01-18, T-01-19 | proxy.ts (not middleware.ts); trilingual catalogs | lint + type | `npm run lint && npx tsc --noEmit` | ✅ created by plan | ⬜ pending |
| 01-06-T2 | 01-06 | 1 | AUTH-01 | — | Per-message franc-min detect en\|ms\|zh | unit (TDD) | `npx vitest run src/i18n/detect.test.ts` | ✅ created by plan | ⬜ pending |
| 01-07-T1 | 01-07 | 2 | FND-06 | — | Heuristic→Coach; classifier dormant; override seam | unit (TDD) | `npx vitest run src/router/heuristic.test.ts` | ✅ created by plan | ⬜ pending |
| 01-07-T2 | 01-07 | 2 | FND-05 | T-01-21, T-01-22 | Messages subcollection; lead slots; journey seam | unit (TDD) | `npx vitest run src/memory/memory.test.ts` | ✅ created by plan | ⬜ pending |
| 01-07-T3 | 01-07 | 2 | QUAL-07 | T-01-20 | Real decrement (consumes 01-03 rateBudgetsRef); refuse runaway before LLM | unit (TDD) | `npx vitest run src/ratelimit/window.test.ts` | ✅ created by plan | ⬜ pending |
| 01-08-T1 | 01-08 | 2 | FND-03 | T-01-26 | SPIKE-RAG p95/read-cost/recall; SPIKE-INGEST budget | spike harness | `npx vitest run src/rag/spike-rag.test.ts` | ✅ created by plan | ⬜ pending |
| 01-08-T2 | 01-08 | 2 | FND-10, QUAL-04 | T-01-23, T-01-24 | QStash signature verify; ai-sdk pin; apphosting secrets | integration | `npx vitest run src/jobs/signature.test.ts` | ✅ created by plan | ⬜ pending |
| 01-08-T3 | 01-08 | 2 | QUAL-04 | T-01-25 | SSE token-by-token on real 4G; X-Accel-Buffering:no | manual (checkpoint) + header test | n/a — SPIKE-DEPLOY real-4G; `grep X-Accel-Buffering app/api/spike/stream/route.ts` | ✅ created by plan | ⬜ pending |
| 01-09-T1 | 01-09 | 3 | FND-03 | T-01-28, T-01-29 | findNearest DOT_PRODUCT + lang pre-filter; adapter | unit (TDD) | `npx vitest run src/rag/rag.test.ts` | ✅ created by plan | ⬜ pending |
| 01-09-T2 | 01-09 | 3 | FND-03 | T-01-27 | Real chunk-ID citations; retrieval-miss signal | unit (TDD) | `npx vitest run src/rag/rag.test.ts` | ✅ created by plan | ⬜ pending |
| 01-10-T1 | 01-10 | 4 | FND-08 | T-01-31, T-01-32 | Chunked-poll ingestion; idempotent sha256 | unit (TDD) | `npx vitest run src/kb/kb.test.ts` | ✅ created by plan | ⬜ pending |
| 01-10-T2 | 01-10 | 4 | FND-08 | T-01-30 | Admin-gated KB CRUD; seed EN doc retrievable | lint + type + unit | `npm run lint && npx tsc --noEmit && npx vitest run src/kb/kb.test.ts` | ✅ created by plan | ⬜ pending |
| 01-11-T1 | 01-11 | 3 | FND-10 | T-01-35, T-01-36 | Stall detection; deduped handoff signal | unit (TDD) | `npx vitest run src/escalation/escalation.test.ts` | ✅ created by plan | ⬜ pending |
| 01-11-T2 | 01-11 | 3 | FND-10 | T-01-33, T-01-34 | QStash-signed job rejects unsigned; heartbeat | integration (TDD) | `npx vitest run src/jobs/jobs.test.ts` | ✅ created by plan | ⬜ pending |
| 01-12-T1 | 01-12 | 5 | FND-02, FND-06 | T-01-40 | modelFor from Remote Config; grounded Coach via router | unit (TDD) | `npx vitest run src/agents/coach/coach.test.ts` | ✅ created by plan | ⬜ pending |
| 01-12-T2 | 01-12 | 5 | FND-02 | T-01-37, T-01-38, T-01-39, T-01-41, T-01-42 | SSE headers; auth+ratelimit+pdpa gate; audit via after() | unit + lint | `npm run lint && npx tsc --noEmit && npx vitest run app/api/chat` | ✅ created by plan | ⬜ pending |
| 01-12-T3 | 01-12 | 5 | FND-06 | — | Mobile-first chat shell; incremental tokens + citations | lint + type | `npm run lint && npx tsc --noEmit` | ✅ created by plan | ⬜ pending |
| 01-13-T1 | 01-13 | 6 | FND-07 | T-01-43, T-01-46 | Promptfoo trilingual eval; Opus judge from Remote Config | eval | `npx promptfoo eval -c evals/promptfooconfig.yaml` | ✅ created by plan | ⬜ pending |
| 01-13-T2 | 01-13 | 6 | QUAL-05 | T-01-45 | Proof slice E2E: sign-in→stream→persist→audit (EN) | E2E | `npx playwright test e2e/proof-slice.spec.ts e2e/persist.spec.ts` | ✅ created by plan | ⬜ pending |
| 01-13-T3 | 01-13 | 6 | QUAL-01 | T-01-44 | Model swap; no unredacted PII to either provider | integration (TDD) | `npx vitest run src/llm/swap.test.ts` | ✅ created by plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** No run of 3 consecutive tasks lacks an automated verify. The only non-`<automated>` tasks are the two human gates (01-01-T1 region sign-off, 01-08-T3 SPIKE-DEPLOY real-4G) and the secrets-provisioning gate (01-01-T2); each is paired with a grep/header check and is surrounded by automated-verify tasks. No watch-mode flags are used.

---

## Observable Signals (from RESEARCH.md §Validation Architecture — anchor the map above)

- **SC1 (sign-in → stream → token-by-token):** `e2e/proof-slice.spec.ts` (01-13) asserts incremental SSE chunks (not one buffered dump); the 01-12 route header test asserts `X-Accel-Buffering: no` + `text/event-stream`; the real-4G token-by-token check is the 01-08 SPIKE-DEPLOY manual gate.
- **SC2 (persist + audit):** `e2e/persist.spec.ts` (01-13) asserts a `conversations/{cid}/messages/{mid}` doc exists + a create-only hashes-only `auditLogs` row is written; refresh re-renders history.
- **SC3 (one language E2E + recall bar):** Promptfoo trilingual fixture scores EN end-to-end (01-13); SPIKE-RAG (01-08) asserts BM/中文 recall ≥70% of EN on ~500 chunks (gate, not in-suite).
- **SC4 (model swap, no unredacted PII):** `src/llm/swap.test.ts` (01-13) runs the same chat call on a 2nd provider via `llm/`; `src/audit/pdpa.test.ts` (01-05) asserts the `pdpa_redacted:true` gate refuses an unredacted call.
- **SC5 (spikes resolved + TIA):** `SPIKES.md` (01-08) records the pass/fallback decision per spike; `PDPA-TIA.md` (01-05) on file (manual verification).
- **Rules:** `src/firebase/__tests__/rules.test.ts` (01-03) proves deny-by-default for all 3 roles across every collection — cross-agent/cross-tenant reads denied; `auditLogs` mutation denied; `rateBudgets` cross-agent read/write denied (owner-scoped).

---

## Wave 0 Requirements

> Wave 0 = plans 01-01 (provisioning, human-gated) + 01-02 (all test/build infra). These create the frameworks every downstream `<automated>` command depends on. None used `MISSING` — all downstream tasks have a real automated verify because Wave 0 installs the frameworks first.

- [ ] `vitest.config.ts` + first `src/**/*.test.ts` (llm fake provider harness) — 01-02
- [ ] `@firebase/rules-unit-testing` setup + emulator config (`firebase.json`) for rules tests — 01-02 (config) → 01-03 (the rules + tests)
- [ ] `playwright.config.ts` + `test:e2e` script — 01-02 (config) → 01-13 (the specs)
- [ ] `promptfooconfig.yaml` skeleton — 01-02 (skeleton) → 01-13 (the trilingual gold fixture)
- [ ] Test scripts wired in `package.json` (`test`, `test:rules`, `test:e2e`, `eval`) — 01-02
- [ ] CI PII-scan step (MY phone `+?60\d{9,10}` / IC `\d{6}-\d{2}-\d{4}`) + Next.js-16 anti-pattern lint — 01-02
- [ ] `LlmProvider` interface + deterministic fake provider — 01-02 (prerequisite for ALL agent/router/coach unit tests)
- [ ] External infra provisioned (Firebase asia-southeast1, App Hosting, QStash, Secret Manager) — 01-01 (gated on G1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE streams token-by-token on App Hosting over real 4G | QUAL/SC1 (SPIKE-DEPLOY, 01-08 T3) | Needs a real device on a real mobile network in `asia-southeast1` | Deploy the spike stream endpoint; observe token-by-token arrival on a phone off-WiFi; FAIL escalates to Derek |
| Firestore region confirmed (G1) | FND-01 / QUAL-04 (01-01 T1) | Immovable human decision with Derek | `asia-southeast1` confirmed in writing before any Firebase resource is created |
| Secrets bound via Secret Manager | FND-09 (01-01 T2) | Requires dashboard access; cannot be automated from the repo | Five secrets bound; `grep` confirms no secret strings in the repo |
| PDPA Transfer Impact Assessment on file | FND-09 / QUAL-03/04 (SC5, 01-05 T2) | Legal/compliance artifact, not code | `PDPA-TIA.md` drafted + Derek sign-off line; on file before any real PII flows (gates pilot) |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify or a Wave 0 dependency (the 3 human gates are paired with grep/header checks)
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all framework prerequisites (no `MISSING` references remain)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick `npx vitest run`)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planner) — 2026-05-31
