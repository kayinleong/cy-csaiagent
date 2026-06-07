# Phase 5: Hardening + Scale-Up - Discussion Log

> **Audit trail only.** Not consumed by downstream agents. Decisions live in `05-CONTEXT.md`.

**Date:** 2026-06-07
**Phase:** 05-hardening-scale (FINAL phase of v1 milestone)
**Mode:** `--auto` (Claude auto-selected the recommended option for every gray area; alternatives listed)
**Areas:** PDPA erasure · cost/perf pass · coach dashboard v2 · admin surfaces (conversation viewer / roles / usage) · load test + hardening checklist · handover docs

---

## PDPA data erasure (D-01, D-02, D-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Admin cascade hard-delete + audit-exempt + erasure event logged | Delete PII-bearing docs across all subject-keyed collections; keep hashes-only audit as the compliance record. | ✓ |
| Soft-delete / tombstone everything | Mark deleted, purge later. | |
| Erase audit too | Delete the audit rows for the subject as well. | |

**Selected:** Cascade hard-delete, audit exempt.
**Notes:** The audit log holds only hashes (no PII) and is the legal proof that erasure happened — erasing it would destroy the compliance record. Soft-delete leaves PII at rest, weakening the <72h erasure guarantee.

| Option | Description | Selected |
|--------|-------------|----------|
| Request doc + chunked lazy-cron `erasure-sweep` | Mark `erasureRequests/{id}` pending; delete synchronously what fits; sweep the rest on-visit; track <72h SLA. | ✓ |
| One synchronous mega-delete | Delete everything in the request handler. | |

**Selected:** Chunked request + sweep.
**Notes:** A subject can span many docs (conversations + messages subcollections) — one mega-request hits the Cloud Run timeout. Mirrors the proven chunked-ingestion pattern.

| Option | Description | Selected |
|--------|-------------|----------|
| TIA update + erasure-coverage audit + Derek `PDPA-SIGNOFF.md` | Prove every PII collection is reached; documented sign-off gate. | ✓ |
| Skip formal sign-off | Ship erasure without a coverage audit. | |

**Selected:** Coverage audit + sign-off.
**Notes:** QUAL-09 is a production-rollout gate; a coverage audit is the only way to prove erasure is complete.

---

## Cost + performance pass (D-04, D-05, D-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Instrument the existing `llm/` wrapper + route (token/cache/read-write) → `usageEvents` | Single choke point; tag pillar+uid. | ✓ |
| New distributed tracing system | Full APM/tracing stack. | |
| No instrumentation; estimate from logs | Approximate after the fact. | |

**Selected:** Instrument the existing wrapper.
**Notes:** The llm provider wrapper is the one place every model call passes through — cheapest accurate capture. A tracing stack would pull in non-Firebase infra (constraint).

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy-cron `usage-rollup` → `usageRollups`; dashboards read rollups | DUE-gated aggregation per day/agent/pillar. | ✓ |
| BigQuery export + scheduled query | Warehouse analytics. | |
| Read-time aggregation over raw events | No rollup. | |

**Selected:** Lazy-cron rollup.
**Notes:** BigQuery violates no-GCP-beyond-Firebase. Raw read-time aggregation gets expensive at 400 agents — rollups bound the read cost.

| Option | Description | Selected |
|--------|-------------|----------|
| Measure-first documented pass; tune low-risk wins; `PERF-COST.md` | Verify cache hit-rate, index/read cost, p95 budget; tune cache TTL/index/payload. | ✓ |
| Aggressive re-architecture for performance | Rewrite hot paths. | |

**Selected:** Measure-first.
**Notes:** v1 hardening should bound and document, not re-architect. Exact SLO numbers are Derek's call.

---

## Coach dashboard v2 (D-07)

| Option | Description | Selected |
|--------|-------------|----------|
| Grow the existing senior-coach dashboard (funnel + knowledge-gap + correction→eval) | Reuse recharts + role-conditional scope. | ✓ |
| New analytics app/route group | Separate v2 surface. | |

**Selected:** Grow existing.
**Notes:** Consistent with the Phase 2–4 "grow, don't fork" discipline; the dashboard already has the scope-gating and chart stack.

---

## Admin surfaces (D-08, D-09, D-10)

| Option | Description | Selected |
|--------|-------------|----------|
| Conversation viewer reusing the audited `getAgentChatHistory` drilldown, widened to admin | PDPA-gated, `auditDrilldown`-logged, read-only. | ✓ |
| New unaudited admin log reader | Raw read access. | |

**Selected:** Reuse the audited drilldown.
**Notes:** ADMIN-02 is a compliance surface — it MUST be audited and PDPA-gated; quick-002 already built the pattern.

| Option | Description | Selected |
|--------|-------------|----------|
| Surface + verify the existing claims+rules model (matrix view + assignment UI + rules-test sweep) | No new auth model. | ✓ |
| Rebuild permissions as a new RBAC system | Fresh model. | |

**Selected:** Surface + verify.
**Notes:** ADMIN-07's enforcement already ships (coach=downline, admin=all). Phase 5 makes it visible/manageable and proves it.

| Option | Description | Selected |
|--------|-------------|----------|
| Admin usage dashboard over `usageRollups` (shared with the cost pass) | One rollup source feeds ADMIN-08 + QUAL-08. | ✓ |
| Separate usage pipeline | Independent of the cost pass. | |

**Selected:** Shared rollup source.
**Notes:** Two pipelines for the same numbers is waste + drift risk.

---

## Load test + hardening checklist (D-11, D-12)

| Option | Description | Selected |
|--------|-------------|----------|
| `scripts/loadtest/` k6 harness (~400 concurrent) + `LOADTEST.md`; live-gated | Hits deployed SSE endpoint + key reads; measures p95/error/cold-start/contention. | ✓ |
| Skip load test; reason about capacity | No empirical test. | |
| Cloud-based load service | External infra. | |

**Selected:** Scripted k6 harness, live-gated.
**Notes:** SC4 requires demonstrating ~400 concurrent. A dev/CI harness is test tooling (not app infra), so it respects the constraint; execution is live-gated like prior live steps.

| Option | Description | Selected |
|--------|-------------|----------|
| One `HARDENING.md` checklist (SLOs/runbooks/backup-restore/security audit/cost projection) with evidence links | Consolidated completion gate. | ✓ |
| Scatter items across multiple docs | No single gate. | |

**Selected:** One checklist.
**Notes:** A single evidence-linked checklist is the milestone exit bar.

---

## Handover documentation (D-13)

| Option | Description | Selected |
|--------|-------------|----------|
| `docs/operations/` operator runbook set | Architecture, deploy/secrets, lazy-cron catalog, backup/restore, incident + erasure runbooks, cost/SLO guide. | ✓ |
| Auto-generated API docs only | No operator narrative. | |

**Selected:** Operator runbook set.
**Notes:** QUAL-10 is about D2's 2-person team operating the platform — operator narrative beats reference dumps.

---

## Claude's Discretion
- Exact SLO/p95 numbers, cost thresholds, 400-agent load profile shape (Derek's call on finals)
- k6 vs artillery (default k6)
- `usageEvents` retention/TTL policy
- Backup/restore specifics within the no-external-scheduler constraint

## Deferred Ideas
WhatsApp Business API/auto-send (gated by Phase-4 WABA-GATE.md) · public recommender + auto-assignment (v2) · native apps / voice / real-time collab · multi-tenant activation · wall-clock scheduler · BigQuery/external warehouse — all logged in `05-CONTEXT.md` `<deferred>`.

---
*Auto-mode: every option above was considered; the ✓ option was selected per the "grow, don't fork" + no-GCP-beyond-Firebase discipline. Reverse any decision in `05-CONTEXT.md` before `/gsd-plan-phase 5`.*
