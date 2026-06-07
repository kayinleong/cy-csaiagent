---
phase: "05-hardening-scale"
plan: "08"
subsystem: "documentation-handover"
tags: ["perf-cost", "hardening", "pdpa-signoff", "tia-update", "ops-runbooks", "qual-08", "qual-09", "qual-10", "sc4", "wave-6", "final-v1-plan"]
dependency_graph:
  requires:
    - "05-01 (k6 load-test harness code-ready)"
    - "05-02 (usageEvents/usageRollups/erasureRequests collections + rules)"
    - "05-03 (PII_ERASURE_MANIFEST + eraseDataSubject + erasureSweep)"
    - "05-04 (recordUsageEvent + rollupUsage + usage-rollup job)"
    - "05-05 (erasure admin surface + all Phase-5 i18n)"
    - "05-06 (conversations + roles admin surfaces)"
    - "05-07 (admin usage dashboard + coach dashboard v2)"
  provides:
    - "PERF-COST.md — QUAL-08/D-06 cost/perf pass output"
    - "HARDENING.md — SC4 hardening checklist with evidence links (D-12)"
    - "PDPA-SIGNOFF.md — QUAL-09 Derek sign-off memo (D-03)"
    - "PDPA-TIA.md Phase-5 update — live data flow + erasure + lazy-cron"
    - "docs/operations/ — 8-file operator handover set (QUAL-10/D-13)"
  affects:
    - "QUAL-08 requirement complete"
    - "QUAL-09 code-ready; live drill + Derek signature live-gated"
    - "QUAL-10 requirement complete"
    - "SC4 hardening checklist complete; live-gated items documented"
tech_stack:
  added: []
  patterns:
    - "Honest code-ready vs live-gated separation throughout (no inflated claims)"
    - "PROPOSED markers for all Derek-decision numbers (SLOs, p95, cost projection, TTL)"
    - "Single chain of evidence: SUMMARY → HARDENING.md → PERF-COST.md → runbooks → source commits"
    - "PII_ERASURE_MANIFEST single-source-of-truth linkage (coverage.ts → erasure.ts → sweep.ts → coverage.test.ts → PDPA-SIGNOFF.md)"
    - "signoff-ready auto-selected: coverage test GREEN + manifest complete; live drill + signature live-gated"
key_files:
  created:
    - ".planning/phases/05-hardening-scale/PERF-COST.md"
    - ".planning/phases/05-hardening-scale/HARDENING.md"
    - ".planning/phases/05-hardening-scale/PDPA-SIGNOFF.md"
    - "docs/operations/README.md"
    - "docs/operations/architecture-overview.md"
    - "docs/operations/deploy-secrets-runbook.md"
    - "docs/operations/lazy-cron-catalog.md"
    - "docs/operations/backup-restore-runbook.md"
    - "docs/operations/pdpa-erasure-runbook.md"
    - "docs/operations/incident-runbooks.md"
    - "docs/operations/cost-slo-dashboard-guide.md"
  modified:
    - ".planning/phases/01-foundations/PDPA-TIA.md"
decisions:
  - "signoff-ready auto-selected for Task 3 checkpoint:decision (auto_advance=true): coverage test GREEN on emulator + manifest covers all PII collections + audit exemption proven; only live drill + A1/A6 confirmations + Derek signature remain (LIVE-GATED)"
  - "PERF-COST.md documents the pre-Phase-5 multi-step token undercount at route.ts:607/:522/:620 as a flagged finding (separate claim required) — not silently fixed"
  - "Backup posture: managed gcloud firestore export on-demand + lazy-cron reminder (NOT automated; confirm-with-Derek A6 note preserved)"
  - "Storage A1 confirmation: voice samples are Firestore strings today; STORAGE manifest entry is a near-no-op; confirm-with-Derek before sign-off if voice moves to Storage"
  - "docs/operations/ uses placeholders only (<PROJECT_ID>, <API_KEY>, <BUCKET_NAME>) — no real secret values committed"
metrics:
  duration: "12 minutes"
  completed: "2026-06-07T09:47:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 12
  files_modified: 1
---

# Phase 05 Plan 08: Hardening Checklist + Cost/Perf Pass + PDPA Sign-Off + Operator Handover Summary

**One-liner:** Three milestone-closing docs (PERF-COST.md with single-pipeline docs + undercount flag + PROPOSED p95, HARDENING.md with evidence-linked SC4 checklist, PDPA-SIGNOFF.md with coverage proof + signoff-ready determination) plus 8 operator runbooks and a Phase-1 TIA update — v1 Phase 5 documentation complete.

## What Was Built

### Task 1: PERF-COST.md + HARDENING.md (commit: 59d4d2b)

**`.planning/phases/05-hardening-scale/PERF-COST.md`** (QUAL-08 / D-06):

- **Single usage pipeline**: documented end-to-end with commit + file references (ebed5dd route capture → f69bba1 rollup → b7785e4 dashboard). One pipeline, no BigQuery, no second capture point.
- **Cache-hit measurement method**: `cachedInputTokens / (inputTokens + cachedInputTokens)` from `usageRollups`; `cacheCreationInputTokens` for write cost; actual numbers LIVE-GATED.
- **Firestore index/read audit**: `(day, uid, pillar)` composite index (b5c6046); `AggregateField.sum/count` discipline (1 read-unit per aggregation); dashboards-read-rollups-not-raw rule (HR-7 confirmed in b7785e4).
- **PROPOSED p95 budget**: SSE first-token < 3,000ms p95 / < 1,500ms p50; error rate < 1% — all marked PROPOSED, Derek's call (A4).
- **FLAGGED FINDING (Open Question 1)**: pre-Phase-5 `route.ts:607` rate-limit decrement + `:522` messages.tokens + `:620` audit tokenCount all use `final.usage.totalTokens` (last step only) for Finder/Reply (stepCountIs(5)) — documented undercount; requires separate claim + Derek sign-off to fix (behavioral change to TOKEN_CAP consumption).
- **PROPOSED 90-day TTL** for usageEvents (rollups are durable); Derek to confirm (A5).
- Low-risk tuning applied vs deferred (measure-first, no prompt/agent tuning in hardening phase — Pitfall 8/34).

**`.planning/phases/05-hardening-scale/HARDENING.md`** (SC4 / D-12):

- **SLOs**: PROPOSED table with evidence links to `scripts/loadtest/chat.js` thresholds.
- **Runbooks**: all 8 docs/operations/ files linked.
- **Backup**: managed `gcloud firestore export` on-demand + lazy-cron reminder; NOT app code, NOT external scheduler; confirm-with-Derek A6 note; Pitfall 7 compliant.
- **Security audit**: 20-collection rules (19 enumerated in CI test, d5d8237); three-layer admin gate (05-05/06/07); secrets via Secret Manager; PDPA boundary + coverage proof.
- **Load test**: k6 code-ready (7e61b7f) / LIVE-GATED execution.
- **Cost projection**: PERF-COST.md §5 linked; PROPOSED numbers pending live measurement.
- **Live-gated completion criteria table** with 6 gates (load test, backup drill, PDPA drill, Derek sign-off, rules deploy, SLO finalization).

### Task 2: docs/operations/ runbook set + PDPA-TIA.md update (commit: f7ca414)

**8-file operator handover set** (QUAL-10 / D-13), all placeholders-only, no real secrets:

1. **`README.md`**: runbook index, on-call basics, health check, security posture, reference links.
2. **`architecture-overview.md`**: single Next.js 16 monolith on App Hosting; 3 pillars; chat data flow with gates; cross-pillar `leadContext` memory; 20-collection data model table (PII? Yes/No); security architecture; hard constraints.
3. **`deploy-secrets-runbook.md`**: App Hosting git-push deploy; `firebase deploy --only firestore:rules,firestore:indexes`; Secret Manager rotation (placeholders); Remote Config model-ID swap (QUAL-01 model-agnostic); post-deploy checklist.
4. **`lazy-cron-catalog.md`**: all 5 jobs (stall-detect 24h, escalate 24h, eval-nightly 24h, usage-rollup 24h, erasure-sweep 1h) with window + purpose + heartbeat key + troubleshooting note; stale watchdog; backup reminder advisory; how to add a new job.
5. **`backup-restore-runbook.md`**: managed `gcloud firestore export/import` (on-demand default; confirm-with-Derek A6 note); create/restore/verify commands with `<BUCKET_NAME>` placeholder; backup verification drill; backup schedule; what is NOT backed up.
6. **`pdpa-erasure-runbook.md`**: 6-step procedure (request, backup, type-to-confirm trigger, monitor, verify, communicate); <72h SLA; type-to-confirm requirement documented; auditLogs exemption explained; coverage table (agent/lead); cross-border Anthropic note; Storage A1 note; engineering coverage test command.
7. **`incident-runbooks.md`**: 6 incidents (stale lazy-cron, rate-limit exhaustion with undercount note, model provider outage via Remote Config swap, Firestore index errors, erasure stuck/failed, auth failures); escalation path table.
8. **`cost-slo-dashboard-guide.md`**: KPI tiles definitions; cache hit rate formula; 7/30-day window; stale watchdog; cost estimation formula with note on pre-Phase-5 undercount for historical data; SLO monitoring; trade-off notes.

**`.planning/phases/01-foundations/PDPA-TIA.md`** Phase-5 update (D-03):
- Added §P5-1 (20-collection PII inventory with erasure mechanism per collection)
- §P5-2 (erasure implementation status table with commit references)
- §P5-3 (lazy-cron periodic work — PDPA relevance of erasure-sweep 1h window)
- §P5-4 (Anthropic cross-border retention unchanged posture — pseudonymized)
- §P5-5 (Storage A1 note — confirm-with-Derek)
- §P5-6 (sign-off status table)
- Existing TIA content intact (no prior content modified)

### Task 3: PDPA-SIGNOFF.md (commit: 070e708) — Auto-selected: signoff-ready

**`.planning/phases/05-hardening-scale/PDPA-SIGNOFF.md`** (QUAL-09 / D-03):

- **PII Erasure Manifest** (§2): full tabular presentation of agent + lead manifest entries with `coverage.ts:line` references; EXEMPT table with rationale.
- **Coverage proof** (§3): states coverage.test.ts GREEN on emulator (commits 52e166d/f8ee5a8); lists all assertions (0 docs per collection + auditLogs survives + erasure event appended).
- **Open confirmations for Derek** (§4): A1 (voice samples in Storage?) + A6 (gcloud export acceptable?).
- **Cross-border Anthropic note** (§5): pseudonymized; out of erasure scope; TIA-documented.
- **Live end-to-end drill** (§6): LIVE-GATED table for rollout prep.
- **Sign-off table** (§7): Derek signature LIVE-GATED.

**Decision: signoff-ready** — auto-selected per `auto_advance=true` directive. The coverage test is GREEN; the manifest covers every PII collection; the audit exemption is proven. Only the live drill + A1/A6 confirmations + Derek's signature remain. These are correctly live-gated (not code gaps).

## Test State After This Plan

| Metric | State |
|--------|-------|
| `npx tsc --noEmit` | CLEAN (no changes to source code in this plan) |
| Vitest suite | 541 passed / 141 skipped (no regressions — no source code changed) |
| `src/pdpa/coverage.test.ts` | GREEN on emulator (05-03) |
| `scripts/loadtest/chat.js` | Code-ready (05-01); live execution LIVE-GATED |

## Deviations from Plan

### Auto-approved Checkpoint

**Task 3: checkpoint:decision** — auto-selected `signoff-ready` per `auto_advance=true` directive (per `auto_checkpoint_mode` instructions: writing documents is not an unavoidable gate). The evidence supports `signoff-ready`:
- coverage.test.ts GREEN on emulator as of 05-03
- PII_ERASURE_MANIFEST covers all 9 agent + 4 lead collections (verified against collections.ts field references)
- auditLogs EXEMPT guard: proven by manifest construction + test assertion
- Remaining items (live drill, A1/A6 Derek confirmations, signature) are correctly live-gated — they require a deployed stack and Derek's decision, not code changes.

### None — plan executed exactly as written.

No code changes were made in this plan (docs-only plan). No Rule 1/2/3 deviations triggered.

## Known Stubs

None that affect plan goals.

**Carried from prior plans (documented, not blocking sign-off):**
- STORAGE manifest entry is a near-no-op (A1 — voice samples are Firestore strings today). Documented in PDPA-SIGNOFF.md §4 and pdpa-erasure-runbook.md.
- Pre-Phase-5 token undercount (route.ts:607/:522/:620) is a flagged finding in PERF-COST.md §6 — separate claim required, Derek sign-off needed.
- 90d usageEvents TTL: proposed in PERF-COST.md §7; Derek confirmation needed before enforcing.

## Threat Mitigations Verified

| Threat ID | Status |
|-----------|--------|
| T-05-DOCSECRET | MITIGATED — all docs/operations/ use placeholders only (`<PROJECT_ID>`, `<API_KEY>`, `<BUCKET_NAME>`); secret scan clean |
| T-05-FALSESIGNOFF | MITIGATED — PDPA-SIGNOFF.md presents the coverage proof (test link + manifest table + assertion list); checkpoint blocks until Derek signs on live drill (D-03); auto-selected signoff-ready based on evidence |
| T-05-BACKUPDRIFT | MITIGATED — backup documented as managed gcloud export on-demand + lazy-cron reminder; no automated-scheduler language; no BigQuery; confirm-with-Derek A6 note preserved |

## Threat Flags

No new threat surface introduced. This plan creates documentation artifacts only — no new network endpoints, auth paths, schema changes, or data writes.

## Self-Check: PASSED

Files created/exist on disk:
- `.planning/phases/05-hardening-scale/PERF-COST.md` — FOUND
- `.planning/phases/05-hardening-scale/HARDENING.md` — FOUND
- `.planning/phases/05-hardening-scale/PDPA-SIGNOFF.md` — FOUND
- `docs/operations/README.md` — FOUND
- `docs/operations/architecture-overview.md` — FOUND
- `docs/operations/deploy-secrets-runbook.md` — FOUND
- `docs/operations/lazy-cron-catalog.md` — FOUND
- `docs/operations/backup-restore-runbook.md` — FOUND
- `docs/operations/pdpa-erasure-runbook.md` — FOUND
- `docs/operations/incident-runbooks.md` — FOUND
- `docs/operations/cost-slo-dashboard-guide.md` — FOUND
- `.planning/phases/01-foundations/PDPA-TIA.md` — FOUND (Phase-5 update section appended)

Commits verified in git log:
- `59d4d2b` — Task 1: PERF-COST.md + HARDENING.md
- `f7ca414` — Task 2: ops runbook set + PDPA-TIA update
- `070e708` — Task 3: PDPA-SIGNOFF.md

Must-haves verified:
- [x] PERF-COST.md contains "undercount" (flagged finding), "PROPOSED" (p95/load profile), "90d"/"TTL" (retention proposal), cache-hit measurement method
- [x] PERF-COST.md does NOT claim measured numbers as final — marked LIVE-GATED
- [x] HARDENING.md covers SLOs, runbooks, backup/restore ("firestore export"), security audit, cost projection — each with evidence link and code-ready/live-gated marker
- [x] HARDENING.md backup = managed gcloud export (NOT custom JSON dump, NOT automated scheduler)
- [x] All 8 docs/operations/ files exist
- [x] lazy-cron-catalog.md lists all 5 jobs including usage-rollup + erasure-sweep + watchdog
- [x] backup-restore-runbook.md describes managed gcloud firestore export; no automated-scheduler language; no BigQuery
- [x] pdpa-erasure-runbook.md mentions <72h SLA, audit exemption, type-to-confirm
- [x] PDPA-TIA.md has Phase-5 update section (existing content intact)
- [x] No real secret values in docs/ (placeholder scan clean)
