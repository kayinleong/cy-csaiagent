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
> Per-task rows below are populated by the planner (Wave-0 RED scaffold) — see 07-RESEARCH.md §"Validation Architecture".

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
- **Max feedback latency:** ~120 seconds (unit); rules tests are live-gated on the emulator

---

## Per-Task Verification Map

*Populated by the planner during Wave-0. Each Phase-7 surface's new-collection rules (cohorts, conversationFlags), field additions (cohortId/firstCloseAt), server-side gate denials (read-only DENIED everywhere), the Remote Config publish contract, and the record-close idempotency get a RED stub first.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | (TBD) | T-07-* / — | new-collection rules deny read-only + cross-coach; deny client writes | rules | `npm run test:rules` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Rules-unit-test stubs for `cohorts` + `conversationFlags` (4-role matrix incl. read-only DENY) — extend `src/firebase/__tests__/rules.test.ts`
- [ ] Type-level stubs for `AgentProfileDoc.cohortId?` + `AgentProfileDoc.firstCloseAt?` (collections.ts)
- [ ] Server-side gate-denial stubs: read-only DENIED on every Phase-7 surface (requireRole allow-lists)
- [ ] Remote Config publish contract stub (Surface 6 — getTemplate→mutate→publishTemplate, ETag concurrency)
- [ ] "record first close" idempotency stub (Surface 8)
- [ ] i18n parity extension (new nav + surface keys across en/ms/zh — `i18n-parity.test.ts`)

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
