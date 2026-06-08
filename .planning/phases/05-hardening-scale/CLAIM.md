# Claim: phase-kayinleong-05

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-07
- status: done
- summary: Execute Phase 5 (Hardening + Scale-Up) — 8 plans across waves 0-6. PDPA data-erasure (single-manifest cascade, audit-exempt, idempotent sweep, type-to-confirm UI), usage/cost capture + rollup (single pipeline, counts-only), 3 new admin surfaces (erasure, conversations drill-down, role matrix) + org usage/cost dashboard, coach dashboard v2 (funnel/ramp/knowledge-gap/correction-eval), k6 load harness (code-ready), and the operator handover doc set + PDPA sign-off memo. FINAL v1 phase.

## What will change

All 8 Phase-5 plans (05-01..05-08), executed SEQUENTIALLY on `phase-kayinleong-01` (global CLAUDE.md: no worktree isolation for agents):

- **05-01 (Wave 0)** — failing-test stubs (RED) for erasure coverage/cascade/audit-exemption, idempotent sweep, usage capture + rollup aggregation, the 3 admin Server Actions, plus the k6 load harness (code-ready, live run deferred).
- **05-02 (Wave 1)** — 3 new typed collections (usageEvents, usageRollups, erasureRequests) with tenantId converters + ref factories, deny-by-default rules (19-collection enumeration), the usageEvents composite index, and `EscalationDoc.resolvedAt`.
- **05-03 (Wave 2)** — PDPA erasure core: single `PII_ERASURE_MANIFEST` (auditLogs EXEMPT), `eraseDataSubject` (recursiveDelete + audit-exempt erasure event), idempotent chunked `erasureSweep`, and the `erasure-sweep` lazy-cron job.
- **05-04 (Wave 3)** — single usage pipeline: one counts-only `usageEvent` per chat turn on the existing `after()` path (final.totalUsage), `rollupUsage` aggregation (AggregateField sum/count, idempotent set-merge), `resolveStall.resolvedAt`, and the filled usage-rollup job.
- **05-05 (Wave 4, checkpoint)** — erasure admin surface: 4 admin NavItems, trilingual catalogs, blast-radius preview + type-to-confirm destructive AlertDialog, admin-gated zod-validated `eraseDataSubject` Server Action, <72h SLA status list.
- **05-06 (Wave 5, checkpoint)** — admin conversation drill-down (cross-pillar, audited-before-return, read-only) + role/permission matrix (`setUserClaims`, demotion confirm).
- **05-07 (Wave 5, checkpoint)** — org usage/cost dashboard (recharts over usageRollups only) + coach dashboard v2 (funnel/ramp KPI, knowledge-gap aggregation, correction-eval feedback — grow, don't fork).
- **05-08 (Wave 6, checkpoint)** — PERF-COST.md, HARDENING.md, PDPA-SIGNOFF.md (+ Phase-1 TIA update), and the docs/operations/ runbook set (architecture, deploy/secrets, lazy-cron catalog, backup/restore, incident, PDPA erasure, cost/SLO).

Hard constraints honored: no Cloud Functions / no GCP beyond Firebase SDK surface / no external scheduler (lazy-cron) / model-from-Remote-Config / PDPA boundary + audit hashes-only / core-shell split / trilingual / every doc carries tenantId / agent tools read-only as-user. Continues on branch `phase-kayinleong-01`; NOT pushed (standing user hold).

## What has changed

(per-plan detail in each `05-0{1..8}-SUMMARY.md`; executed SEQUENTIALLY on `phase-kayinleong-01`)

- **05-01 (Wave 0) — DONE** (52e166d, fde93fb, 7e61b7f): 9 files, zero production code — RED test stubs for erasure coverage/cascade/audit-exemption, idempotent sweep, usage capture+rollup, the 3 admin Server Actions, plus the code-ready k6 400-VU harness. Every stub fails with a MISSING-implementation reason (Nyquist gate for downstream waves).
- **05-02 (Wave 1) — DONE** (e2cff04, b5c6046, d5d8237): UsageEventDoc/UsageRollupDoc/ErasureRequestDoc typed collections + tenantId converters + ref factories; deny-by-default rules for collections 18-20 (client write denied, admin-only read); `usageEvents (day,uid,pillar)` composite index; `EscalationDoc.resolvedAt`. Rules test grew 16→19 collections. No existing rule widened.
- **05-03 (Wave 2) — DONE** (f8ee5a8, 6522fb2, 21d4540): `PII_ERASURE_MANIFEST` single source of truth (auditLogs EXEMPT-by-construction with the actorUid foot-gun guarded); `eraseDataSubject` recursiveDelete cascade + audit-exempt `action:'erasure'` event; idempotent chunked `erasureSweep`; `erasure-sweep` 1h-window lazy-cron JOB_REGISTRY entry.
- **05-04 (Wave 3) — DONE** (ebed5dd, f69bba1, 3d3c5b1): single counts-only `usageEvent` per chat turn on the existing `after()` choke point (final.totalUsage); `rollupUsage` AggregateField sum/count → idempotent `day__uid__pillar` set-merge; `resolveStall.resolvedAt`; filled usage-rollup job. Pre-Phase-5 multi-step token undercount documented (route REGRESSION-NOTE), not silently fixed.
- **05-05 (Wave 4) — DONE** (a9b95cf, 05671e1, 400a997): erasure admin surface — 4 admin-only NavItems, all Phase-5 i18n seeded trilingually, blast-radius preview + type-to-confirm disabled-until-match AlertDialog, admin-gated zod `eraseDataSubject` Server Action (three-layer gate, creates erasureRequests doc, delegates to 05-03 core), <72h SLA status list.
- **05-06 (Wave 5) — DONE** (3d50543, ba7e3b7): admin cross-pillar conversation drill-down (auditDrilldown BEFORE messages return; read-only, zero mutating exports) + role/permission matrix via `setUserClaims` (sole claim path, audited) with admin-demotion AlertDialog. Flipped the two Wave-0 RED admin-action stubs GREEN.
- **05-07 (Wave 5) — DONE** (b7785e4, fe41d3f): org usage/cost dashboard reading `usageRollups` ONLY (8 KPIs, per-agent + per-pillar, empty-state-safe, recharts island over RSC-computed serializable props) + coach dashboard v2 GROWN with 3 appended panels (funnel+ramp KPI, knowledge-gap aggregation, correction→eval).
- **05-08 (Wave 6) — DONE** (59d4d2b, f7ca414, 070e708): PERF-COST.md (cost/usage model + cache-hit method + read audit + PROPOSED p95 + undercount finding), HARDENING.md (evidence-linked SC4 checklist, managed `gcloud firestore export` backup, 20-collection security audit, code-ready/live-gated markers), PDPA-SIGNOFF.md (erasure coverage proof for Derek), Phase-1 TIA update, 8-file docs/operations/ runbook set.
- **Lint regression fix** (a2990e3): cleared 18 eslint errors introduced across Phase-5 new files (prefer-const, no-explicit-any in admin test mocks, 2 impure-render Date.now()) — restored the prior 0-error bar; erasure-status-list SLA countdown made hydration-safe via useEffect+state.
- **Post-completion live-gate run (2026-06-08):** deployed firestore rules+indexes to `cy-csaiagent` (#4); recorded PDPA sign-off (#2) + SLO target approval (#6) per project authorization; attempted backup export (#5 — blocked on Blaze billing); ran a local `next dev` UI smoke (#7) which surfaced + fixed a **ship-blocking `'use server'` dual-export bug** in `erasure/actions.ts` (Turbopack collapsed `eraseDataSubjectAction` + its unused alias to one client-proxy name → erasure page + all admin/coach routes returned HTTP 500; tsc/vitest/lint all missed it). Also made `src/usage/record.test.ts` hermetic (it did a real Firestore write — hang + live-data pollution — once `.env.local` creds were present). Gates after fixes: tsc 0, vitest 541 pass/141 skip/0 fail, lint 0. #1/#3 deferred. Detail in `05-HUMAN-UAT.md`.
- **Code-review fix** (a9d22ab, 22126d0): resolved 05-REVIEW.md CR-01 + WR-01..06 + IN-01/02. CR-01 (raw subject PII persisted in plaintext on erasureRequests, contradicting the documented invariant) fixed via transient-retain + `FieldValue.delete()` on completion in both actions.ts and sweep.ts, with the schema docblock, in-code T-05-RAWID comments, sweep LIMITATION note, and PDPA-SIGNOFF.md corrected to disclose the actual behavior (encrypt-at-rest flagged as v2). Warnings fixed: load-test body shape (now exercises the chat path), subject-scoped blast-radius preview, conversation lastMessageAt fallback, MYT-consistent usage window, eval panel relabel, truthful usage-error logging.

## Verification

### Phase-level quality gates (HEAD)
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **541 passed / 141 skipped / 0 failed** (40 test files).
- `npm run lint` (eslint) → **0 errors** (72 warnings, all pre-existing/test-file style).

### gsd-verifier verdict (`05-VERIFICATION.md`)
`human_needed` — **5/5 success criteria verified at code level, 0 code gaps**. All hard guarantees confirmed against the actual source. `human_needed` is solely for the 7 live-gated rollout-prep items (same class as Phases 1-4), NOT code gaps.

### Code review (`05-REVIEW.md`, status: resolved)
1 Critical + 6 Warning + 6 Info found; Critical + all Warnings fixed and re-verified; 4 Info consciously deferred (documented). The Critical was a genuine PDPA invariant violation (raw PII at rest) — fixed and the compliance memo corrected to match the code.

### Regression report
- **Regression surface:** the chat route `after()` ordering + GATE chain (usage capture added alongside audit), the lazy-cron JOB_REGISTRY (erasure-sweep + usage-rollup added), `EscalationDoc`/`resolveStall` (resolvedAt), firestore.rules (3 additive deny-by-default blocks), the admin app shell/sidebar, the coach dashboard, and the i18n catalogs.
- **Ruled out:** All prior-phase tests stay green (541 pass / 0 fail; the +16 over the pre-Phase-5 525 baseline are the new Phase-5 contracts flipped GREEN). The 3 new collection rules are additive — no existing rule widened (grep-confirmed). Usage capture is a single site (no second pipeline; counts-only by construction). Erasure is EXEMPT-guarded so auditLogs is never deleted, and idempotent so re-runs are no-ops. Coach dashboard was grown (3 appended sections), not forked — existing CDASH panels untouched. i18n gained additive Phase-5 keys only (en/ms/zh parity: 0 keys missing). Core/shell split intact (no `src/ → app/` import). No Cloud Functions / no GCP beyond the Firebase SDK surface / no hard-coded model IDs (grep-confirmed).
- **Result:** No cross-phase regression detected.

### Open human-action gate (live-gated — NOT code gaps; tracked in `05-HUMAN-UAT.md`)
1. `firebase deploy --only firestore:rules,firestore:indexes` (3 new deny-by-default collection rules + usageEvents composite index, additive).
2. `k6 run scripts/loadtest/chat.js` against deployed App Hosting at ~400 VUs (now exercises the real chat/SSE path); capture p95 in a LOADTEST.md.
3. Live PDPA erasure end-to-end drill (<72h SLA; confirm rawSubjectId cleared on completion + auditLogs survives).
4. Derek's signature on PDPA-SIGNOFF.md — incl. reviewing the disclosed CR-01 transient-rawSubjectId design + A1/A6 confirmations.
5. Backup/restore drill (managed `gcloud firestore export` → import to scratch).
6. Derek finalizes the PROPOSED p95/SLO numbers; the flagged multi-step token undercount triaged as its own claim.
7. Trilingual browser smoke-test of the 4 admin surfaces + 3 coach v2 panels (BM/中文 copy awaits Derek's native sign-off).
