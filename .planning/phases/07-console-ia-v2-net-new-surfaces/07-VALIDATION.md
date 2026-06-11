---
phase: 7
slug: console-ia-v2-net-new-surfaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Per-task rows below populated by the planner (`/gsd-plan-phase 7`, 2026-06-11) from 07-RESEARCH.md §"Validation Architecture" + the 07-01 Wave-0 plan. The executor flips Status as each test lands and sets `nyquist_compliant: true` when all rows have an automated verify.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit/integration) + `@firebase/rules-unit-testing` (Firestore rules) + Playwright (e2e) |
| **Config file** | `vitest.config.ts` / `firebase.json` (emulator) / `playwright.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx tsc --noEmit && npx vitest run && npm run test:rules` |
| **Estimated runtime** | ~60–120 seconds (vitest); rules matrix is emulator-gated |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` (scoped to touched files where possible)
- **After every plan wave:** Run `npx tsc --noEmit && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite green, including `npm run test:rules` (emulator) for the 2 new collections
- **CI is non-vacuous:** under `CI=true` the emulator MUST be reachable — `scripts/ci-guards.test.ts` guard 6 FAILS if the emulator is absent or the rules suite executed 0 assertions (the read-only-DENY + cross-coach-DENY matrices can never `describe.skip` to a vacuous green)
- **Max feedback latency:** ~120 seconds (unit); rules tests are live-gated on the emulator

---

## Per-Task Verification Map

*Populated by the planner during Wave-0. Each Phase-7 surface's new-collection rules (cohorts, conversationFlags), field additions (cohortId/firstCloseAt), server-side gate denials (read-only DENIED everywhere), the Remote Config publish contract, and the record-close idempotency get a RED stub first.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | COH-01/03, FLAG-01/02/03 | T-07-01/02/03 | cohorts+conversationFlags rules deny read-only + cross-coach + client writes | rules | `npm run test:rules` | ✅ stub (emulator-gated) → ✅ 07-02 | 🔴 RED stub present |
| 07-01-01 | 01 | 0 | COH-02, CLOSE-01 | — | AgentProfileDoc.cohortId?/firstCloseAt? compile; old doc literals still valid | unit/typecheck | `npx tsc --noEmit` | ✅ fields added | ✅ GREEN (compiles; backward-compat) |
| 07-01-02 | 01 | 0 | ASSIGN-01 | T-07-10/27 | coach-assignment atomic dual-write; non-admin + senior-coach → Forbidden (D-07) | unit | `npx vitest run app/[lang]/(admin)/coach-assignment/actions.test.ts` | ✅ stub → ✅ 07-03 | 🔴 RED stub present |
| 07-01-02 | 01 | 0 | AUDIT-01 | T-07-20/21 | audit-log bounded limit(50); admin-only; NO auditDrilldown (no self-audit); hashes not decoded | unit | `npx vitest run app/[lang]/(admin)/audit-log/actions.test.ts` | ✅ stub → ✅ 07-05 | 🔴 RED stub present |
| 07-01-02 | 01 | 0 | MODEL-02 | T-07-17/18/19 | publish reads template, mutates only model.{pillar}.default, publishes WITHOUT force; stale ETag → conflict; non-admin → Forbidden; audit row | unit (mock RC) | `npx vitest run app/[lang]/(admin)/model-config/actions.test.ts` | ✅ stub → ✅ 07-05 | 🔴 RED stub present |
| 07-01-02 | 01 | 0 | CLOSE-01 | T-07-11 | second record-first-close does NOT overwrite firstCloseAt (idempotent); coach own-downline + admin | unit | `npx vitest run app/[lang]/(coach)/agents/actions.test.ts` | ✅ stub → ✅ 07-03 | 🔴 RED stub present |
| 07-01-02 | 01 | 0 | PROF-02, CLOSE-02 | T-07-08/09 | getAgentProfile auditDrilldown-before-read + downline gate; daysToFirstClose = close − createTime; absent → excluded | unit | `npx vitest run src/dashboard/queries.test.ts` | ✅ stub → ✅ 07-03 | 🔴 RED stub present |
| 07-01-02 | 01 | 0 | NAV-01 | T-07-24 | 8 nav items under correct sections per role; read-only sees none | unit | `npx vitest run app/[lang]/_components/app-sidebar-nav.test.ts` | ✅ stub → ✅ 07-06 | 🔴 RED stub present |
| 07-01-03 | 01 | 0 | Gate / PROF-01 | T-07-04/19/28 | no hard-coded model ID; no src/→app/ import; no read-only grant in a new rule; no {force:true} publish; **no journey-edit symbol on the agent-profile route (PROF-01/D-04)**; **anti-vacuous: FAIL under CI when the rules emulator is absent or 0 rule assertions ran** | grep guard + CI-env guard | `CI=1 npx vitest run scripts/ci-guards.test.ts` | ✅ scripts/ci-guards.test.ts | 🟢 Guard 2/6 GREEN; 1/3/4/5 RED-by-design |
| 07-06-02 | 06 | 3 | I18N-07 | T-07-25 | en/ms/zh key sets identical incl. all new keys | unit | `npx vitest run src/i18n/__tests__/i18n-parity.test.ts` | ✅ green-gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Rules-unit-test stubs for `cohorts` + `conversationFlags` (4-role matrix incl. read-only DENY) — extend `src/firebase/__tests__/rules.test.ts`
- [x] Type-level stubs for `AgentProfileDoc.cohortId?` + `AgentProfileDoc.firstCloseAt?` (collections.ts)
- [x] Server-side gate-denial stubs: read-only DENIED on every Phase-7 surface (requireRole allow-lists)
- [x] Remote Config publish contract stub (Surface 6 — getTemplate→mutate→publishTemplate, ETag concurrency)
- [x] "record first close" idempotency stub (Surface 8)
- [x] i18n parity extension (new nav + surface keys across en/ms/zh — `i18n-parity.test.ts`)
- [x] PROF-01/D-04 no-journey-edit ci-guard (agent-profile route exports/contains no journey-state write or editable journey control)
- [x] Nyquist anti-vacuous ci-guard (FAIL under CI when the rules emulator is absent / 0 rule assertions executed — closes the `describe.skip` vacuous-pass surface)

*Existing infrastructure (vitest, rules-unit-testing, playwright, i18n-parity CI) covers the rest — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Remote Config publish reflected in `modelFor()` on next request | MODEL-* (Surface 6) | Requires live Firebase RC backend + App Hosting RC-publish IAM scope (Open Q4) | Publish a `model.coach.default` change via the admin UI; confirm next chat turn resolves the new model ID |
| Firestore composite indexes built | FLAG-*/AUDIT-* | Index build is a deployed-stack operation | `firebase deploy --only firestore:indexes`; confirm `(seniorCoachId,status)` on conversationFlags + `(action,ts)`/`(actorUid,ts)` on auditLogs |
| BM/中文 native sign-off on new surface copy | I18N-* | Translation quality is human judgment | Derek/native reviewer reviews ms/zh strings for the 8 new surfaces |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (2 new collections' rules, field types, gate denials)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
