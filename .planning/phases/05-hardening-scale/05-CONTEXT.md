# Phase 5: Hardening + Scale-Up - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning
**Mode:** auto (gray areas auto-resolved to recommended defaults — review the logged choices)

<domain>
## Phase Boundary

The FINAL phase of the v1 milestone. Make the three-pillar platform **provably ready for a ~400-agent rollout** and hand it over to D2's own team. No new pillars, no new agent capabilities — this phase hardens what exists.

1. **PDPA data erasure** (QUAL-09, SC1) — an admin-triggered data-subject erasure that removes a subject's PII across all PII-bearing collections within the **<72h** target, with the audit log (hashes-only) surviving as the compliance record. Plus a PDPA audit + Derek sign-off.
2. **Cost + performance pass** (QUAL-08, SC2/SC4) — token-spend + read/write breakdown per agent and per pillar; a p95-latency budget held under load; a documented optimization pass (prompt-cache hit rate, Firestore read cost, index audit).
3. **Coach dashboard v2** (CDASH-08, SC3) — full funnel metrics tied to the 60→7–10-day compression target + knowledge-gap signals + the inline-correction→eval feedback loop.
4. **Admin surfaces** (ADMIN-02/07/08) — a conversation-log viewer (compliance review), finalized role/permission controls, and usage analytics (active agents, message volume, resolution time, escalation rate).
5. **Load test + hardening checklist** (SC4) — a ~400-concurrent-agent load test, plus SLOs, runbooks, backup/restore, security audit, and cost projection.
6. **Handover documentation** (QUAL-10, SC5) — internal operator docs so D2's team can run the platform.

**Stack, architecture, data model, exec model, security are locked in TSD.md + PROJECT.md Key Decisions (incl. the 2026-06-01 Gemini + lazy-cron overrides). NOT re-litigated** — this captures Phase-5 implementation depth.

**⛔ Hard-constraint reminders (especially load-bearing for a hardening phase):**
- **No GCP beyond the Firebase SDK surface.** Usage/cost analytics are **Firestore rollups, NOT BigQuery**. Periodic rollups run on the **on-visit lazy-cron** `usage-rollup` job (already named in CLAUDE.md) — no Cloud Scheduler, no external scheduler. The load-test *harness* is a dev/CI tool (e.g. k6) hitting the deployed endpoint — that's test tooling, not app infra, so it doesn't violate the constraint.
- **PDPA erasure is destructive** — it deletes real PII. It must be admin-gated, audited (the erasure event itself is logged, hashes-only), idempotent, and chunked (lazy-cron-completable) so it never becomes one mega-request (Cloud Run timeout). The **audit log is EXEMPT from erasure** — it holds only hashes (no PII) and is the legal record that erasure occurred.
- **Model IDs from Remote Config; PII never logged; tenantId on every doc; deny-by-default rules + CI rules tests** — all still apply to every new collection/surface here.
</domain>

<decisions>
## Implementation Decisions

> `--auto`: each gray area resolved to its recommended default (logged). Reverse any in this file before `/gsd-plan-phase 5`.

### PDPA data erasure (QUAL-09, SC1)
- **D-01 — Admin-triggered cascade erasure Server Action.** An `eraseDataSubject({ subjectType: 'lead'|'agent', id })` admin-only Server Action enumerates every PII-bearing doc keyed by that subject and hard-deletes it: `conversations/{cid}` + the `messages` subcollection, `leadContext/{leadId}` (all slots), `replyEdits`, `escalations`, `knowledgeGaps`, `agentProfiles/{uid}` (for agent erasure), `users/{uid}`, and any Storage objects. The **audit log is NOT erased** (hashes-only, the compliance record); instead an `erasure` audit event is written. *Auto-selected: cascade hard-delete of PII-bearing docs + audit-exempt + erasure event logged.*
- **D-02 — Chunked + lazy-cron-completable, <72h target.** Erasure runs as an idempotent job: the Server Action marks an `erasureRequests/{reqId}` doc `pending` and deletes what it can synchronously; the on-visit lazy-cron `erasure-sweep` job finishes any remaining batches (mirrors the chunked ingestion pattern). A UI shows request status + completion timestamp; the <72h SLA is tracked on the request doc. *Auto-selected: request doc + chunked sweep (never one mega-delete).*
- **D-03 — PDPA audit + sign-off.** Update the Phase-1 TIA with the live data-flow, run an erasure-coverage audit (prove every PII collection is reached), and produce a `PDPA-SIGNOFF.md` memo for Derek. *Auto-selected: TIA update + coverage audit + Derek sign-off memo (documented gate).*

### Cost + performance pass (QUAL-08, SC2/SC4)
- **D-04 — Token + read/write capture at the boundaries.** The `llm/` provider wrapper records token usage (input/output, cache-hit) per call; the chat route tags each with `pillar` + `uid`. Firestore read/write counts are derived from the same instrumented call sites. Written to a lightweight `usageEvents` append-only collection (tenantId, no PII). *Auto-selected: instrument the existing llm wrapper + route, not a new tracing system.*
- **D-05 — `usage-rollup` lazy-cron job → `usageRollups`.** A DUE-gated `usage-rollup` job aggregates `usageEvents` into per-day, per-agent, per-pillar `usageRollups` docs (token spend, read/write, message volume, resolution time, escalation rate). Read-time dashboards query the rollups, not raw events. *Auto-selected: lazy-cron rollup (no BigQuery, no external scheduler).*
- **D-06 — Performance pass = measure + document, tune the cheap wins.** Verify Anthropic prompt-cache hit rate (cache_control already in place), audit Firestore composite-index/read cost, set a p95 latency budget, and apply low-risk tuning (cache TTL, index pruning, payload trimming). Output a `PERF-COST.md` with measured numbers + the budget. Exact SLO numbers are Derek's call. *Auto-selected: measure-first documented pass; tune only low-risk wins in v1.*

### Coach dashboard v2 (CDASH-08, SC3)
- **D-07 — Grow the existing senior-coach dashboard, do NOT fork.** Add: full funnel (training→lead→close) tied to the 60→7–10-day ramp metric, a knowledge-gap aggregation panel (over the `knowledgeGaps` collection from P2/P4, now pillar-tagged), and the inline-correction→eval feedback view (corrections that re-ingested + their eval impact). Reuse `recharts` + the role-conditional scope (coach=downline, admin=org). *Auto-selected: extend the existing dashboard; one more set of panels.*

### Admin surfaces (ADMIN-02/07/08)
- **D-08 — Conversation-log viewer (ADMIN-02).** An admin-only, PDPA-gated, `auditDrilldown`-logged read surface in the admin app to review a conversation thread for compliance. Reuses the `getAgentChatHistory` drilldown pattern (quick-002), widened to admin scope across pillars. Read-only; no editing. *Auto-selected: admin compliance viewer reusing the existing drilldown + audit pattern.*
- **D-09 — Role/permission controls (ADMIN-07) — finalize + surface.** The enforcement already exists (custom claims + deny-by-default rules: coach=downline, admin=all). Phase 5 adds an admin-visible role/permission matrix view + a `set-claims`-backed assignment UI, and a rules-test sweep proving the matrix. No new auth model. *Auto-selected: surface + verify the existing model; no rebuild.*
- **D-10 — Usage analytics (ADMIN-08).** An admin dashboard reading `usageRollups` (D-05): active agents, message volume, resolution time, escalation rate, + the cost view from D-04/D-05. Role-conditional (admin org-wide). *Auto-selected: admin usage dashboard over the rollups (single source with the cost pass).*

### Load test + hardening checklist (SC4)
- **D-11 — Scripted ~400-concurrent load test against the deployed stack.** A `scripts/loadtest/` harness (default k6) simulating ~400 concurrent agents on the SSE chat endpoint + key reads; measures p95 latency, error rate, cold-start, and Firestore contention; emits a `LOADTEST.md` report. Live-gated (runs against a deployed App Hosting stack) — code-ready in this phase, executed during rollout prep. *Auto-selected: k6-style harness + report; live-gated execution.*
- **D-12 — `HARDENING.md` checklist artifact.** A single checklist covering SLOs, runbooks, backup/restore (Firestore export/import), security audit (rules + auth + secrets + PDPA), and cost projection at 400 agents — each item linked to its evidence. *Auto-selected: one consolidated hardening checklist with evidence links.*

### Handover documentation (QUAL-10, SC5)
- **D-13 — Operator handover docs.** A `docs/operations/` set: architecture overview, deploy + secrets runbook, the lazy-cron job catalog + watchdog, backup/restore, incident runbooks, the PDPA erasure runbook, and the cost/SLO dashboard guide — written so D2's 2-person team can operate without the build team. *Auto-selected: operator-focused runbook set in `docs/operations/`.*

### Claude's Discretion (research/planning defaults)
- Exact SLO/p95 numbers, cost thresholds, and the 400-agent load profile shape — researcher/planner propose; final numbers are Derek's call.
- Load-test tool (k6 vs artillery) — default k6; planner may switch if it fits the harness better.
- Whether `usageEvents` needs a TTL/retention policy — propose during planning (cost vs audit retention tradeoff).
- Backup/restore mechanism specifics (Firestore managed export schedule vs on-demand) — within the no-external-scheduler constraint, default to documented on-demand export + a lazy-cron reminder.

</decisions>

<carried_forward>
## Carried Forward (locked — do NOT re-ask)
- **Stack overrides (2026-06-01):** Gemini `gemini-embedding-001` @1024-d; on-visit lazy-cron (the `usage-rollup` + new `erasure-sweep` jobs are job definitions added to `runDueJobs`); AI SDK v5 `toUIMessageStreamResponse`. **No QStash / Cloud Scheduler / Cloud Functions / BigQuery / Vertex.**
- **Security/PDPA:** deny-by-default rules + CI rules tests on every collection (`usageEvents`, `usageRollups`, `erasureRequests` join the list); PII pseudonymized at the boundary + `pdpa_redacted` gate; audit append-only, hashes-only, **exempt from erasure**; `tenantId` on every doc.
- **Model-agnostic:** model IDs from Remote Config; QUAL-01 model-swap test must still pass.
- **All three pillars (Coach + Finder + Reply) are live in one chat surface** (Phase 4); Phase 5 hardens the shared platform, not any single pillar.
- **Grow, don't fork:** dashboard v2 grows the existing senior-coach dashboard; usage analytics + cost share one rollup source; the conversation viewer reuses the existing audited drilldown; role controls surface the existing claims+rules model.
- **No WhatsApp Business API / no auto-send** — WABA stays gated by the Phase-4 `WABA-GATE.md` (post-v1).

</carried_forward>

<canonical_refs>
## Canonical References
**Downstream agents MUST read these. TSD = source of truth for HOW; PROJECT.md Key Decisions is authoritative for the 2026-06-01 overrides.**
- `.planning/TSD.md` — §3 architecture (exec model §3.4 — chunked/lazy-cron), §4 data model (all 14+ collections — Phase 5 adds `usageEvents`/`usageRollups`/`erasureRequests`), §5 security (§5.3 PDPA — erasure + audit exemption), §9 observability/ratelimit (token/usage capture), §10 deployment (App Hosting `asia-southeast1`, minInstances), §11 Phase→Spec mapping (Phase 5 row).
- `.planning/PROJECT.md` — Key Decisions (Gemini + lazy-cron overrides; PDPA posture).
- `.planning/ROADMAP.md` — Phase 5 goal + 5 success criteria + the 7 req IDs.
- `.planning/REQUIREMENTS.md` — CDASH-08, ADMIN-02/07/08, QUAL-08/09/10.
- **Phase 1–4 outputs (the seams Phase 5 hardens):**
  - `01-foundations/PDPA-TIA.md` + `01-05` audit/PDPA (the TIA to update; the audit writer erasure must respect)
  - `01-11` / `src/jobs/runDueJobs.ts` (the lazy-cron — add `usage-rollup` + `erasure-sweep`)
  - `02-coach-admin` dashboard + `(coach)/dashboard/*` (the dashboard v2 grows) + `(admin)/*` (conversation viewer, role controls)
  - quick-kayinleong-002 `getAgentChatHistory` drilldown (the conversation-viewer analog)
  - `src/llm/*` provider wrapper (instrument token/usage) + `src/audit/*` (hashes-only, erasure-exempt) + `src/escalation/knowledgeGaps.ts` (dashboard-v2 knowledge-gap source)
- `CLAUDE.md` + `AGENTS.md` — hard constraints + Next.js 16 gotchas (read `node_modules/next/dist/docs/`).
- `.planning/research/{ARCHITECTURE,PITFALLS,SUMMARY}.md` — scale/cost/PDPA risk context.

</canonical_refs>

<code_context>
## Existing Code Insights (Phase 5 hardens; extends, does NOT rebuild)
- **`src/jobs/runDueJobs.ts`** — the on-visit lazy-cron; add `usage-rollup` + `erasure-sweep` DUE-gated job definitions alongside stall-detect/escalate/eval-nightly.
- **`src/llm/provider.ts`** — the model-agnostic wrapper; instrument token/cache-hit capture here (single choke point) → `usageEvents`.
- **`app/api/chat/route.ts`** — tags each call with `pillar`+`uid`; the usage-capture hook rides the existing `after()`/onFinish side-effect path.
- **`src/audit/*`** — append-only, hashes-only; the erasure logic must SKIP audit and write an erasure event; PDPA boundary already in place.
- **`app/[lang]/(coach)/dashboard/*`** + `_components/*` — the dashboard to grow (v2 funnel + knowledge-gap + correction→eval panels); existing recharts + role-conditional scope.
- **`app/[lang]/(admin)/*`** — admin route group; add the conversation-log viewer + role/permission matrix + usage analytics surfaces (admin-gated, reuse `assertAdmin`).
- **`src/firebase/collections.ts`** + `firestore.rules` + `firestore.indexes.json` — add `usageEvents`/`usageRollups`/`erasureRequests` typed refs + deny-by-default rules + additive indexes (note: indexes now deploy cleanly after quick-004 fixed the vectorConfig dimension type + removed the invalid agentProfiles single-field composite).
- **Vendored:** shadcn + recharts + sonner — everything the new dashboards need is on disk; no new deps (load-test harness is dev-only tooling).

</code_context>

<specifics>
## Specific Ideas
- This phase CLOSES the v1 milestone — the exit bar is "provably ready for ~400 agents + handed over," not "more features." Resist scope creep into v2 (public recommender, WABA, auto-assignment).
- The single most sensitive piece is **PDPA erasure** — destructive, must be coverage-audited (prove every PII collection is reached) and the audit log must survive. Get the erasure-coverage audit right before shipping.
- The cost/usage story has ONE source: instrument the llm wrapper → `usageEvents` → lazy-cron `usage-rollup` → `usageRollups` → both the admin usage dashboard (ADMIN-08) and the cost pass (QUAL-08) read it. Don't build two pipelines.
- Load test + hardening checklist + handover docs are largely **artifacts** (scripts + markdown), code-light but completion-defining for the milestone.

</specifics>

<deferred>
## Deferred Ideas (NOT Phase 5 / v1)
- **WhatsApp Business API / auto-send** — post-v1, gated by the Phase-4 `WABA-GATE.md`.
- **Public-facing property recommender + auto-assignment of self-served prospects** — v2 (PUB-01/02 out-of-scope).
- **Native mobile apps, voice/audio input, real-time multi-user collaboration** — out of scope (PROJECT.md).
- **Multi-tenant / white-label** — the `tenantId` seam exists but multi-tenant activation is post-v1.
- **Automated wall-clock scheduling** (replacing lazy-cron) — only if the pilot proves on-visit insufficient; stays the documented escape hatch, not Phase-5 work.
- **BigQuery / external analytics warehouse** — excluded by the no-GCP-beyond-Firebase constraint; usage analytics stay Firestore rollups.

</deferred>

---
*Phase: 05-hardening-scale*
*Context gathered: 2026-06-07 (--auto)*
