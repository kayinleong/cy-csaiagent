---
phase: 4
slug: reply-assistant
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-05
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` §Validation Architecture. Task IDs are provisional
> until `04-*-PLAN.md` files assign them; the planner aligns task IDs to this map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (unit/integration)** | Vitest `^3` — config `vitest.config.ts` (node env; `src/**/*.test.ts`, `tests/**/*.test.ts`, `app/**/*.test.ts`) |
| **Rules tests** | `@firebase/rules-unit-testing` `^5` — `src/firebase/__tests__/rules/rules.test.ts`; Firestore emulator required |
| **E2E** | Playwright `^1.60` — `playwright.config.ts` |
| **Evals** | Promptfoo (Opus-4.7 judge via `JUDGE_MODEL` from Remote Config) — `evals/promptfooconfig.yaml` |
| **Quick run command** | `npm run test` (= `vitest run`) — offline, mocked AI SDK + Admin SDK |
| **Full suite command** | `npm run test && npm run test:rules && npm run typecheck && npm run lint` |
| **Estimated runtime** | offline `vitest run` ~seconds–low-tens-of-seconds; rules tests need the emulator |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file>` + `npm run typecheck`
- **After every plan wave:** Run `npm run test && npm run test:rules && npm run lint`
- **Before `/gsd-verify-work`:** Full offline suite green + PDPA coverage suite green + (live-gated) a Promptfoo Reply gold-set run ≥90% tone PASS (EN)
- **Max feedback latency:** ~30 seconds (offline suite)

---

## Per-Requirement Verification Map

| Req | Wave | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File | Status |
|-----|------|----------|------------|-----------------|-----------|-------------------|------|--------|
| (PDPA) | 0 | Free-text paste PII pseudonymized before model call | T-04-PDPA | name/IC/email/RM-financial redacted; `pdpa_redacted` reflects real coverage | unit | `npx vitest run src/audit/pdpa.test.ts` | extend `pdpa.test.ts` | ⬜ |
| REPLY-10 | 1 | 3-pillar routing (reply detected; precedence over finder keywords) | — | override allow-list preserved | unit | `npx vitest run src/router/heuristic.test.ts src/router/classifier.test.ts` | extend (fix `classifier.test.ts:95`) | ⬜ |
| REPLY-01 | 1 | Reply SOP retrievable, pillar-filtered | — | only `status:'published'` + `pillar:'reply'` | integration | `npx vitest run src/rag/rag.test.ts src/kb/kb.test.ts` | extend (+ `kbChunks.pillar`) | ⬜ |
| REPLY-02 | 2 | Paste → grounded draft, cites SOP IDs | T-04-INVENT | `no_sop_match` not hallucination | unit | `npx vitest run src/agents/reply/reply.test.ts` | new (mirror `finder.test.ts`) | ⬜ |
| REPLY-03 | 2 | Per-lead isolation (no cross-lead bleed) | T-04-BLEED | slot-scoped `leadContext` writes | unit + integration | `npx vitest run src/memory/memory.test.ts app/api/chat/route.test.ts` | extend | ⬜ |
| REPLY-09 | 3 | Edit captured → `replyEdits` row + editRatio | T-04-FORGE | server-only Admin SDK write | unit + integration | `npx vitest run src/reply/diff.test.ts app/api/chat/route.test.ts` | new + extend | ⬜ |
| (sec) | 3 | `replyEdits` deny-by-default + downline read scope | T-04-DOWNLINE | `seniorCoachId == auth.uid`; client writes denied | rules-test | `npm run test:rules` | extend `rules.test.ts` | ⬜ |
| REPLY-04 | 2 | Draft + copy-only; never auto-sent | T-04-SEND | no send/share affordance exists | e2e | `npx playwright test tests/e2e/reply-draft.spec.ts` | new | ⬜ |
| QUAL-02 | 2 | Copy-only / disclosure (no auto-send) | T-04-SEND | assert NO send/share on draft card | e2e | `npx playwright test tests/e2e/reply-draft.spec.ts` | new | ⬜ |
| REPLY-05 | 4 | Cold-prospect → qualifying questions, not pitch | — | grounded in SOP | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` (live-gated) | new gold set | ⬜ |
| REPLY-06 | 4 | Objection-handling draft | — | grounded in SOP | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` | new gold set | ⬜ |
| REPLY-07 | 4 | Financing draft from D2 financing SOP | — | grounded in SOP | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` | new gold set | ⬜ |
| REPLY-08 | 4 | Tone calibration vs curated voice doc | — | voiceMatch + no-AI-tell | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` | judge rubric + gold set | ⬜ |
| ADMIN-05 | 4 | Reply SOP management (pillar filter) | — | admin-gated | unit + e2e | `npx vitest run src/kb/kb.test.ts` + `playwright test tests/e2e/kb-admin.spec.ts` | extend | ⬜ |
| REPLY-11 | 5 | Reply analytics dashboard (edit-rate per SOP) | — | downline-scoped read | unit + e2e | `npx vitest run` dashboard queries + `playwright test` | new | ⬜ |
| ADMIN-06 | 5 | Feedback-loop visibility (aggregation) | — | downline/org scope by role | integration | `npx vitest run` dashboard aggregation test | new | ⬜ |
| REPLY-12 | 5 | WABA gate documented (criteria only) | — | no WABA code | manual-only | review `WABA-GATE.md` | doc | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (failing-test stubs created before implementation)

- [ ] Extend `src/audit/pdpa.test.ts` — IC, email, RM-financial, known-name injection coverage (security-critical; closes the false-positive PDPA gate, RESEARCH Pitfall A)
- [ ] `src/agents/reply/reply.test.ts` — REPLY-02/05/06/07/11 (mirror `finder.test.ts`)
- [ ] `src/reply/diff.test.ts` — REPLY-09 edit-diff + editRatio
- [ ] Extend `src/router/heuristic.test.ts` + `src/router/classifier.test.ts` — REPLY-10 (fix the `classifier.test.ts:95` reply-rejection assertion)
- [ ] Extend `src/firebase/__tests__/rules/rules.test.ts` — `replyEdits` deny-by-default + agent/coach/admin read scoping
- [ ] Extend `src/rag/rag.test.ts` + `src/kb/kb.test.ts` — pillar filter + `kbChunks.pillar` write/backfill
- [ ] Extend `app/api/chat/route.test.ts` — reply dispatch + replySlot onFinish + required-leadId-fail-closed + parallel-lead isolation
- [ ] `evals/gold/reply-*.yaml` — Reply gold sets (EN; BM/ZH later) registered in `promptfooconfig.yaml`
- [ ] `tests/e2e/reply-draft.spec.ts` — copy-only / no-auto-send / lead-selector (D-07)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Promptfoo Reply evals | REPLY-05/06/07/08 | Needs `ANTHROPIC_API_KEY` + `JUDGE_MODEL` (Remote Config) + seeded live SOPs | Run `npm run eval -- --filter-pattern "reply"` against a deployed seeded stack; ≥90% tone PASS (EN) |
| Real-device copy-to-clipboard | REPLY-04 / QUAL-02 | Real-phone clipboard + WhatsApp paste can't be automated | Manual smoke on a phone (the 11pm scenario): tap Copy, paste into WhatsApp |
| BM/中文 voice nuance | REPLY-08 | Human-calibration judgment until Derek provides BM/ZH samples (D-14) | Native-reviewer calibration per `evals/CALIBRATION.md` |
| WABA gate review | REPLY-12 | A document; Derek's product/legal call | Review `WABA-GATE.md` thresholds |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (esp. the PDPA coverage gap)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (set by the planner once tasks map cleanly)

**Approval:** pending
