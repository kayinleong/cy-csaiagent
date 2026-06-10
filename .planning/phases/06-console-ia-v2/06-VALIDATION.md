---
phase: 6
slug: console-ia-v2
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 06-RESEARCH.md §Validation Architecture. The overriding gate: **the full v1 test baseline MUST stay green** — that is the "no v1 regression" proof.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit + rules) + Playwright (e2e) + `tsc` typecheck |
| **Config file** | `package.json` scripts (no explicit vitest config path surfaced) |
| **Quick run command** | `npm run test && npm run typecheck` (offline; Firestore rules suite `describe.skip`s without the emulator) |
| **Full suite command** | `firebase emulators:exec --only firestore "npm run test:rules"` + `npm run test` + `npm run test:e2e` + `npm run typecheck` |
| **Estimated runtime** | ~30–90s unit/typecheck; rules-on-emulator + e2e add minutes |

---

## Sampling Rate

- **After every task commit:** `npm run test && npm run typecheck` (fast; offline rules skip)
- **After every plan wave:** `firebase emulators:exec --only firestore "npm run test:rules"` (the read-only rules matrix only executes here) + `npm run test:e2e`
- **Before `/gsd-verify-work`:** full suite green (unit + rules-on-emulator + e2e + typecheck). The pre-Phase-6 v1 baseline (all existing tests + e2e) must remain green.
- **Max feedback latency:** ~90 seconds (offline path)

> **CI note:** the read-only rules assertions only *run* when the Firestore emulator is up (`RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)`). CI must launch the emulator or the new read-only assertions silently skip — treat a skipped rules suite as a failed gate for RO-01.

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| RO-01 | `read-only` in `Role` union + `VALID_ROLES`; `setUserClaims('read-only')` succeeds, unknown role throws `InvalidRoleError` | unit | `vitest run src/firebase/auth.test.ts` | ✅ extend | ⬜ pending |
| RO-01 | read-only CAN read `usageRollups`, `usageEvents`, `evals` (analytics aggregates) | rules | `vitest run src/firebase/__tests__/rules` (emulator) | ✅ extend | ⬜ pending |
| RO-01 | read-only DENIED write on EVERY collection | rules | same | ✅ extend | ⬜ pending |
| RO-01 | read-only DENIED read on `auditLogs`, `conversations`, `conversations/{cid}/messages`, `leads`, `leadContext`, `erasureRequests`, `rateBudgets`, `knowledgeGaps`, `escalations`, `users`, `agentProfiles` | rules | same | ✅ extend | ⬜ pending |
| RO-01 | read-only hitting a write/admin route → redirected at the layout gate (not nav-hidden) | integration / e2e | new gate test OR Playwright redirect assertion | ❌ W0 | ⬜ pending |
| RO-01 | read-only Server-Action call to `assignRole`/`resolveStall`/`submitCorrection`/KB CRUD → `{ok:false,'Forbidden'}` | unit | `vitest run app/[lang]/(admin)/roles/actions.test.ts` (+ new cases) | ✅ extend | ⬜ pending |
| IA-01 | Each existing deep link still resolves; KB list→detail no longer 404s (broken-link fix) | e2e | `npm run test:e2e` (extend `inventory-admin.spec.ts` + add KB nav spec) | ✅ extend | ⬜ pending |
| IA-01 | Sidebar shows correct sections per role (admin / coach / read-only) | unit (render) | new `app-sidebar.test.tsx` | ❌ W0 | ⬜ pending |
| HOME-01 | Home composes existing aggregations, reads `usageRollups` not raw events; role-aware redirect to Home | integration | new `home/page` test | ❌ W0 | ⬜ pending |
| KM-01 | version-history viewer renders the chain read-only (no edit form for read-only/coach) | unit/e2e | extend KB specs | ❌ W0 | ⬜ pending |
| CKB-01 | senior coach can contribute KB scoped to downline + audited; non-downline denied | unit | extend `src/kb/crud` tests | ✅ extend | ⬜ pending |
| AP-01 | admin per-coach pivot scopes by `seniorCoachId`; non-admin cannot pass a `coachUid` filter | unit | extend `dashboard/actions` tests | ✅ extend | ⬜ pending |
| SC-01 | Integrations shell exposes NO send/auto-send affordance (assert no send button/handler) | unit (render) | new `integrations.test.tsx` | ❌ W0 | ⬜ pending |
| i18n | en/ms/zh key sets identical for all new keys | unit | new `i18n-parity.test.ts` | ❌ W0 | ⬜ pending |
| Guard | No hard-coded model ID introduced; no `src/ → app/` import added; Integrations shell has no send path | lint/grep guard | `grep` assertion in CI or a unit guard | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Read-only role — collection-by-collection rules matrix (RO-01 acceptance grid)

Add `readOnlyCtx()` to `rules-helpers.ts` + a 4th synthetic read-only user in `tests/fixtures/synthetic-users.ts`. Assert per collection in `rules.test.ts`:

| Collection | read-only READ | read-only WRITE |
|------------|---------------|------------------|
| usageRollups | ✅ allow | ❌ deny |
| usageEvents | ✅ allow | ❌ deny |
| evals | ✅ allow | ❌ deny |
| projects / collateral / kbDocs / kbChunks / kbIngestionJobs | ✅ allow (signed-in tenant read) | ❌ deny |
| knowledgeGaps / escalations | ❌ deny (carry agentUid — LOCKED narrowest) | ❌ deny |
| conversations / messages / leads / leadContext | ❌ deny | ❌ deny |
| auditLogs / erasureRequests | ❌ deny | ❌ deny |
| users / agentProfiles | ❌ deny | ❌ deny |
| rateBudgets | ❌ deny (owner-scoped) | ❌ deny |

---

## Wave 0 Requirements

- [ ] `rules-helpers.ts` — add `readOnlyCtx()` + a 4th synthetic read-only user in `tests/fixtures/synthetic-users.ts` (extend `Role`, `allSyntheticUsers`)
- [ ] `src/firebase/__tests__/rules.test.ts` — add the read-only matrix to the deny-by-default loop AND each collection block (RED until RO-01 rules land)
- [ ] `app/[lang]/_components/app-sidebar.test.tsx` — section/role-filter render test (new)
- [ ] read-only gate redirect test (read-only hitting `/usage` write actions / an admin route) — unit on the gate or Playwright
- [ ] `i18n-parity.test.ts` — assert en/ms/zh key parity (new; CONTEXT mandates CI parity, none exists)
- [ ] `integrations` shell render test asserting no send affordance (new)
- [ ] Extend `roles/actions.test.ts` with read-only `Forbidden` cases on `assignRole` (+ other write actions)
- [ ] Ensure CI launches the Firestore emulator so the read-only rules assertions actually execute (not skip)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BM/中文 nav + surface copy reads naturally | i18n | Native-speaker judgment (Derek sign-off, same as prior phases) | Switch locale to ms/zh; review the 6 section labels + new surface strings |
| Deployed `firestore.rules` actually denies read-only PII reads in production | RO-01 | Requires a live rules deploy (`firebase deploy --only firestore:rules`) | Live-gated: deploy + provision a read-only test user + attempt PII reads |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING (❌) references above
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s (offline path)
- [ ] `nyquist_compliant: true` set in frontmatter (planner sets once tasks map cleanly)

**Approval:** pending
