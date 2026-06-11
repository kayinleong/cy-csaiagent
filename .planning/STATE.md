---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Phase 7 UI-SPEC approved
last_updated: "2026-06-11T04:44:17.087Z"
last_activity: "2026-06-11 — Executed Phase 6 end-to-end via /gsd-plan-phase 6 --auto → gsd-execute-phase (sequential, no-worktree). 8 plans + a code-review fix (CR-01 read-only reachability + WR-01/WR-02). Plan 06-08 finished inline after the executor socket dropped twice. Live-gated: firestore.rules deploy, emulator rules matrix (151/151 local), read-only browser click-through, BM/中文 native sign-off. NOT pushed."
progress:
  total_phases: 8
  completed_phases: 6
  total_plans: 56
  completed_plans: 56
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Compress new-agent ramp-up from 60 days to 7–10 days via a D2-grounded multi-pillar AI chat surface (the 11pm-on-a-phone answer).
**Current focus:** Phase 6 — Console IA v2 (Restructure + Read-only Role) — CODE-COMPLETE + VERIFIED (8/8 plans). Next: Phase 7 (net-new surfaces) — /gsd-discuss-phase 7 or /gsd-plan-phase 7.

## Current Position

Phase: 6 of (now) 8 — CODE-COMPLETE + VERIFIED (v1 Phases 1-5 COMPLETE; claim phase-kayinleong-06 DONE)
Plan: Phase 6 = 8 plans across 5 waves, ALL DONE (W0 RED scaffold → W1 role union + requireRole() helper → W2 Firestore analytics rules → W3 gate widening + role-assignment UI → W4: IA sidebar+links+i18n / Home / KB viewer+Integrations shell / per-coach pivot+KB-contribution). plan-checker PASSED (12/12); gsd-verifier human_needed (13/13 must-haves, 0 code gaps); code review CR-01+WR-01/02 RESOLVED.
Status: Phase 6 code-complete + verified. Read-only stakeholder role (server-side + Firestore-rules gated, least-privilege), 6-section IA over unchanged routes, Home, KB version viewer, Integrations no-send shell, per-coach pivot, audited senior-coach KB contribution. tsc 0 / vitest 605 passed / 0 failed (+51 over baseline, 0 regression). Scope split (2026-06-10): Phase 7 (new) = net-new surfaces; Phase 8 (new) = WhatsApp Business API (graduation-gated). NOT pushed (user hold).
Last activity: 2026-06-11 — Executed Phase 6 end-to-end via /gsd-plan-phase 6 --auto → gsd-execute-phase (sequential, no-worktree). 8 plans + a code-review fix (CR-01 read-only reachability + WR-01/WR-02). Plan 06-08 finished inline after the executor socket dropped twice. Live-gated: firestore.rules deploy, emulator rules matrix (151/151 local), read-only browser click-through, BM/中文 native sign-off. NOT pushed.

Progress: [██████████] v1 100% (5/5 phases). Post-v1: Phase 6 CODE-COMPLETE (8/8 plans). Next: Phase 7.

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

### Roadmap Evolution

- Phase 6 added (2026-06-10): **Console IA v2** — restructure the admin/coach console into the business-requested 6-section IA (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), add a read-only stakeholder role, and close the post-v1 gap-audit surfaces. Source: Derek stakeholder feedback + full codebase gap audit. Scope detail: `.planning/phases/06-console-ia-v2/SCOPE.md`.
- Phase 6 SPLIT (2026-06-10, during /gsd-plan-phase 6 --auto): the milestone-sized scope was split per stakeholder decision into **Phase 6** (IA restructure + read-only role + consolidation + version-history viewer + senior-coach KB-contribution + per-coach pivot + Integrations *shell*), **Phase 7** (net-new surfaces: cohorts +data model, agent profiles, coach-assignment, flagged queue, audit-log viewer, model-config UI, PDPA-settings read-only display, days-to-first-close), and **Phase 8** (WhatsApp Business API — consciously overrides the v1 "no WABA / no auto-send" constraints, graduation-gated). v1 "no WABA / no auto-send" stays in force for Phases 6/7. Phase 6 now PLANNED + VERIFIED (8 plans). See `.planning/phases/06-console-ia-v2/06-CONTEXT.md`.

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
- [05-08]: signoff-ready auto-selected for Task 3 checkpoint:decision (auto_advance=true) — coverage test GREEN + manifest complete; live drill + A1/A6 + Derek signature are LIVE-GATED.
- [05-08]: pre-Phase-5 token undercount (route.ts:607/:522/:620) documented in PERF-COST.md as a separate claim + Derek sign-off required (behavioral change to TOKEN_CAP).
- [05-08]: backup posture = managed gcloud firestore export on-demand + lazy-cron reminder (NOT automated; confirm-with-Derek A6 note in HARDENING.md + backup-restore-runbook.md).
- [05-08]: v1 milestone code-complete — all 5 phases, 8 Phase-5 plans done; live-gated items execute during rollout prep.

### Pending Todos

None yet.

### Blockers/Concerns

Carried from research — must be held during Phase 1 planning:

- Firestore region final pick (`asia-southeast1` vs `asia-southeast2`) is immovable once set — resolve with Derek before project creation.
- Anthropic has no Asian residency (May 2026); TIA + pseudonymization is the v1 path, Bedrock-Singapore the fallback — decide in Phase 1.
- Voyage BM/Mandarin embedding quality unverified — gated by SPIKE-RAG.
- Standardize embedding dimension on 1024-d in Phase 1; pin one model per collection.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| quick-kayinleong-006 | Create an architecture diagram explaining how the project works | 2026-06-09 | 2f43bc8 | [quick-kayinleong-006](./quick/quick-kayinleong-006/) |

## Deferred Items

Items acknowledged and carried forward (v2 / post-pilot):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| WhatsApp | WABA-01/02 (direct API, volume monitoring) | Deferred to v2 | Roadmap |
| Public surface | PUB-01/02 (public recommender, auto-assignment) | Deferred to v2 | Roadmap |
| Advanced coaching | COACH2-01/02 (voice input, playlist sequencing) | Deferred to v2 | Roadmap |
| Scale | SCALE-01/02 (multi-tenant white-label, native apps) | Deferred to v2 | Roadmap |

## Session Continuity

Last session: 2026-06-11T04:06:18.264Z
Stopped at: Phase 7 UI-SPEC approved
Resume file: .planning/phases/07-console-ia-v2-net-new-surfaces/07-UI-SPEC.md
v1 milestone status: CODE-COMPLETE. Live-gated items to execute during rollout prep:

  1. firebase deploy --only firestore:rules,firestore:indexes (Phase 4/5 rules + indexes)
  2. k6 run scripts/loadtest/chat.js (load test vs deployed stack)
  3. PDPA live erasure drill (<72h end-to-end) + Derek sign-off on PDPA-SIGNOFF.md
  4. Backup/restore drill (gcloud firestore export + restore to test project)
  5. SLO finalization (Derek reviews PROPOSED p95 numbers in PERF-COST.md)
  6. Derek A1 (voice in Storage?) + A6 (gcloud export OK?) confirmations
  7. Phase 3: live finder/router Promptfoo evals + Playwright e2e + FIND-12 provisioning
  8. Phase 4: live browser verification (all Reply + admin surfaces)

User standing instruction: do NOT push to any remote without explicit confirmation.
