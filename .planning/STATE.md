---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: phase-5-executing
stopped_at: Phase 5 Plan 07 (org usage/cost dashboard + coach dashboard v2) COMPLETE — 2 code tasks + 1 auto-approved checkpoint, 5 files created, 2 modified, 2 commits. Next: 05-08-PLAN.md.
last_updated: "2026-06-07T09:30:00Z"
last_activity: 2026-06-07 — 05-07-PLAN.md executed. Admin usage+cost dashboard (reads usageRollups only, ADMIN-08+QUAL-08, HR-7) + coach dashboard v2 (3 panels appended — funnel+ramp, gap-agg, correction-eval; CDASH-08). 541 tests PASS. tsc clean. NOT pushed (user hold).
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 30
  completed_plans: 30
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Compress new-agent ramp-up from 60 days to 7–10 days via a D2-grounded multi-pillar AI chat surface (the 11pm-on-a-phone answer).
**Current focus:** Phase 5 — Hardening + Scale-Up (planned + verified, next: /gsd-execute-phase 5)

## Current Position

Phase: 5 of 5 executing (Hardening + Scale-Up)
Plan: Phase 5 Plan 07/08 COMPLETE (org usage/cost dashboard + coach dashboard v2). 1 plan remaining. Next: 05-08-PLAN.md.
Status: Phase 5 executing. Plans 01-07 done. FINAL v1 phase.
Last activity: 2026-06-07 — 05-07-PLAN.md: admin usage+cost dashboard (usageRollups only, ADMIN-08+QUAL-08) + coach dashboard v2 (3 panels: funnel+ramp KPI, knowledge-gap agg by pillar, correction→eval feedback; CDASH-08). 2 commits (b7785e4, fe41d3f). NOT pushed (user hold).

Progress: [█████████░] 88% (4 of 5 phases code-complete + verified; Phase 5 Plan 07/08 complete)

### Phase 4 open human-action gate (live-gated — does NOT block Phase 5 planning)
1. `firebase deploy --only firestore:indexes,firestore:rules` — additive `kbChunks` pillar vector index + `replyEdits` indexes/rules.
2. One-time `npx tsx scripts/backfill-kb-chunks-pillar.ts` — backfill `pillar` onto pre-Phase-4 chunks.
3. Emulator-gated `replyEdits` rules tests (`npm run test:rules`).
4. Live Promptfoo trilingual Reply evals (Anthropic/Gemini + Opus judge from Remote Config + seeded SOPs); ≥90% EN tone PASS.
5. Browser click-through: copy-only draft flow, lead-selector gating, parallel-lead isolation, Reply Quality dashboard, admin Reply-SOP create. BM/中文 voice strings await Derek's native sign-off.

### Phase 3 open human-action gate (live-gated — carried)
1. Live Promptfoo finder/router evals — need live Anthropic/Gemini/Firestore + Opus judge (model from Remote Config).
2. Playwright `e2e/finder-flow.spec.ts` + `e2e/inventory-admin.spec.ts` — skip-guarded scaffolds; remove `test.skip`, run against a deployed seeded stack.
3. FIND-12 pilot provisioning — `scripts/provision-finder-pilot.ts --apply` to 15–20 real finder-pilot agents (dry-run by default).

### Earlier open gates (carried — Phase 1/2 live-stack proofs, run during pilot rollout)
- 01-01 region/residency sign-off + live Firebase/App Hosting/Secret Manager provisioning (`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`); SPIKE-RAG/DEPLOY/INGEST live runs; Phase-1/2 Playwright + Promptfoo trilingual eval. (SPIKE-CRON retired — lazy-cron, no external scheduler.)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 5-phase structure adopted from research Build Order (Foundations → Coach+Admin → Finder+Routing → Reply → Hardening); risk gradient Coach→Finder→Reply drives pillar order.
- [Roadmap]: Multilingual + audit logging baked into Phase 1 (retrofitting forces index rebuild / PDPA-vulnerable backfill).
- [Phase 1]: Three required spikes (SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON) gate all downstream work — must resolve before Phase 2.
- [05-02]: ErasureRequestDoc stores subjectIdHash only (never raw id) — PDPA T-05-PII mitigation enforced by schema.
- [05-02]: UsageEventDoc is counts-only by interface — no content fields; mirrors auditLogs no-PII posture.
- [05-02]: resolvedAt? added to EscalationDoc; resolveStall (dashboard/actions.ts:84) must also set it (regression surface flagged).
- [05-02]: Rules + CI tests shipped in same plan as collections — Pitfall 6 (unruled-collection leak) mitigated in CI.
- [05-02]: Deploy is live-gated: firebase deploy --only firestore:rules,firestore:indexes (consistent with quick-004).
- [05-03]: rawSubjectId stored as server-side field on ErasureRequestDoc (not in TypeScript interface) — sweep re-queries Firestore using this field for idempotent resumability.
- [05-03]: collectionsHit includes all manifest collections (even empty ones) to satisfy coverage test contract (coverage proof = executor visited every collection).
- [05-03]: STORAGE manifest entry is a no-op code path (A1 — voice samples are Firestore strings today); must be wired before sign-off if voice moves to Storage.
- [05-04]: final.totalUsage used in usageEvents capture only; rate-limit/messages.tokens left at final.usage.totalTokens (pre-Phase-5 undercount documented in PERF-COST.md as separate claim).
- [05-04]: resolvedAt written via FieldValue.serverTimestamp() in resolveStall — minimal field add for D-05 resolution-time analytics.
- [05-04]: Resolution-time in rollup is per-uid (not per-pillar) — EscalationDoc has no pillar field.
- [05-05]: eraseDataSubjectAction is the exported name the test imports; eraseDataSubject is re-exported as an alias for callers.
- [05-05]: Wave-0 test stub was incomplete (missing @/src/firebase/collections mock); Rule 1 fix applied — added 3 missing mocks so happy-path test can pass without an emulator.
- [05-05]: getBlastRadius returns org-wide collection counts (not subject-filtered) — AggregateField.count per manifest collection; subject-specific counts deferred (acceptable tradeoff for blast-radius preview).
- [05-06]: conversations/actions.test.ts test imports getConversationForReview (the Wave-0 stub named it that); actions.ts exports under the same name — no alias needed.
- [05-06]: searchConversations uses orderBy __name__ + startAt/endAt for prefix search — bounded at 50; listUsersWithRoles bounded at 200 (pilot org ≤ 200 agents).
- [05-06]: roles/actions.test.ts TypeScript fix — added type cast (result as AssignRoleError) on InvalidRoleError assertion; vitest expect() does not narrow union discriminants for TypeScript.
- [05-07]: usageRollups read with where('day','>=',windowStart).orderBy('day','asc'); window from searchParams (7 or 30 days, default 7). No AggregateField sum needed — rollups are already aggregated docs.
- [05-07]: stale watchdog threshold 25h (1h buffer on daily window) to avoid spurious staleness alerts.
- [05-07]: getKnowledgeGapAggregation uses select() projection + JS bucket aggregation (same pattern as getReplyQualityMetrics :402-407) — acceptable at pilot scale.
- [05-07]: getCorrectionEvalFeedback orders evals by score DESC (EvalDoc has no runAt timestamp); chronological trend deferred to when EvalDoc gets a runAt field.
- [05-07]: Task 3 checkpoint:human-verify auto-approved per auto_advance=true — building dashboards is not an auth gate.

### Pending Todos

None yet.

### Blockers/Concerns

Carried from research — must be held during Phase 1 planning:

- Firestore region final pick (`asia-southeast1` vs `asia-southeast2`) is immovable once set — resolve with Derek before project creation.
- Anthropic has no Asian residency (May 2026); TIA + pseudonymization is the v1 path, Bedrock-Singapore the fallback — decide in Phase 1.
- Voyage BM/Mandarin embedding quality unverified — gated by SPIKE-RAG.
- Standardize embedding dimension on 1024-d in Phase 1; pin one model per collection.

## Deferred Items

Items acknowledged and carried forward (v2 / post-pilot):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| WhatsApp | WABA-01/02 (direct API, volume monitoring) | Deferred to v2 | Roadmap |
| Public surface | PUB-01/02 (public recommender, auto-assignment) | Deferred to v2 | Roadmap |
| Advanced coaching | COACH2-01/02 (voice input, playlist sequencing) | Deferred to v2 | Roadmap |
| Scale | SCALE-01/02 (multi-tenant white-label, native apps) | Deferred to v2 | Roadmap |

## Session Continuity

Last session: 2026-06-07
Stopped at: Phase 5 Plan 07 (org usage/cost dashboard + coach dashboard v2) COMPLETE — 2 code tasks + 1 auto-approved checkpoint, 5 files created, 2 modified, 2 commits (b7785e4, fe41d3f). Next: 05-08-PLAN.md.
Resume file: .planning/phases/05-hardening-scale/05-08-PLAN.md
Phase 3: code-complete + verified; live finder/router Promptfoo evals + Playwright e2e (skip-guarded scaffolds) + FIND-12 pilot provisioning (`scripts/provision-finder-pilot.ts --apply`, dry-run by default) are the live-gated human step — run during pilot rollout, do NOT block Phase 4 planning.
Phase 4 (Reply Assistant + Reply Analytics): NOT yet started. Reqs REPLY-01..12, ADMIN-05/06, QUAL-02. Paste-and-draft WhatsApp replies in D2's voice (never auto-sent), per-lead isolation, edit-as-signal analytics, reachable via the activated intent router alongside Coach + Finder.
Next step: /gsd-discuss-phase 4 (then plan → execute). User standing instruction: do NOT push to any remote without explicit confirmation.
