# Claim: phase-kayinleong-05

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-07
- status: in-progress
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

(per-plan detail in each `05-0{1..8}-SUMMARY.md`)

- _pending execution_

## Verification

- _pending — phase-level regression report + gsd-verifier verdict to be recorded on completion_
