---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: "Phase 7 code-complete + verified (human_needed: 18/18 must-haves, 0 code gaps); 6 human-action items in 07-UAT.md (live deploy + RC IAM + native i18n sign-off + 3 browser click-throughs)"
last_updated: "2026-06-11T07:09:01.518Z"
last_activity: "2026-06-15 -- Completed quick-kayinleong-009: assistant chat messages now render Markdown (bold/lists/links/code) instead of raw **...** / - text. New MarkdownMessage component (react-markdown ^10 + remark-gfm ^4) wired into the assistant plain-text branch of message-list.tsx; user bubbles + Reply/Finder cards unchanged. No rehype-raw -> XSS-safe (raw HTML escaped). +6 render/XSS tests via react-dom/server (no new test infra). Gate clean: tsc 0, eslint 0, vitest 650/186 skip, next build OK (63 routes). Commit f6081d9."
progress:
  total_phases: 8
  completed_phases: 7
  total_plans: 62
  completed_plans: 62
  percent: 88
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** Compress new-agent ramp-up from 60 days to 7–10 days via a D2-grounded multi-pillar AI chat surface (the 11pm-on-a-phone answer).
**Current focus:** Phase 7 — Console IA v2 — Net-new Surfaces

## Current Position

Phase: 7 (Console IA v2 — Net-new Surfaces) — CODE-COMPLETE (6/6 plans)
Plan: 6 of 6 — DONE
Status: Phase 7 code-complete. All 8 net-new surfaces built, reachable via role-filtered nav (read-only blind), trilingual to parity, and gated server-side. Open live-gated checkpoints carried to rollout: 07-02 deploy (cohorts + conversationFlags rules + 4 composite indexes incl. auditLogs (action,ts)/(actorUid,ts)) and 07-05 RC-publish IAM (firebaseremoteconfig.remoteConfig.update on the App Hosting SA). Manual gate: BM/中文 native sign-off on the 8 surfaces' copy.
Last activity: 2026-06-15 -- Completed quick-kayinleong-012: /en/audit-log Actor column now shows staff email instead of raw UID (server-side adminAuth.getUsers, batched, graceful UID fallback; D-12/PDPA preserved).
Prior activity: 2026-06-11 -- Completed 07-06-PLAN.md (FINAL Wave-3, NAV-01/I18N-07/CLOSE-02): 8 role-filtered nav entries placed per D-25 (cohorts/agentProfiles/coachAssignment → Agents & Cohorts; flags → Conversations & Escalations; auditLog/modelConfig/pdpaSettings → System & Compliance; daysToFirstClose → Analytics & Performance), read-only blind to all 8 (D-24) → app-sidebar-nav.test.ts GREEN (8/8); authored 8 nav labels + 7 surface namespaces + adminUsage daysToClose keys across en/ms/zh → i18n-parity GREEN; getOrgDaysToFirstClose() read-time aggregate (D-22, no new pipeline) + avg/median/count tile in the usage dashboard (#days-to-first-close). Full gate clean (tsc, vitest 638/186 skip, next build 26 routes).

Progress: [██████████] v1 100% (5/5 phases). Post-v1: Phase 6 CODE-COMPLETE (8/8 plans); Phase 7 CODE-COMPLETE (6/6 plans). Next: Phase 8 (WABA — graduation-gated) or rollout.

### Phase 7 open human-action gate (07-02 — BLOCKING for Wave-2 consuming surfaces 07-04/07-05)

1. `firebase deploy --only firestore:rules,firestore:indexes` — deploys the new `cohorts` + `conversationFlags` rule blocks and the 4 new composite indexes (region `asia-southeast1` — confirm with Derek if prompted).
2. In Firebase console → Firestore → Indexes, confirm the 4 new composites show status **"Enabled"** (not "Building"): `conversationFlags (seniorCoachId,status)`, `conversationFlags (status,createdAt)`, `auditLogs (action,ts)`, `auditLogs (actorUid,ts)`. Firestore throws FAILED_PRECONDITION until built (Pitfall 6) — the `auditLogs` composites back the 07-05 filtered `listAuditLogs(action/actorUid)` queries (single-field `orderBy('ts','desc')` needs no composite).
3. Confirm the deployed rules (Firestore → Rules) include the `cohorts` + `conversationFlags` blocks.

### Phase 7 open human-action gate (07-05 — RC-publish IAM; live-gated, carried to rollout)

1. (07-RESEARCH Open Q5 / A2) Confirm the App Hosting service account IAM includes `firebaseremoteconfig.remoteConfig.update` (Remote Config **publish**, not just read). `modelFor()` read already works in production; the new `publishModelConfig` WRITE path (Surface 6) needs this scope. If absent, grant Remote Config Admin (or a custom role with the publish permission) to the SA.
2. In Firebase console → Remote Config, confirm the 5 keys (`model.{coach,finder,reply,router,grader}.default`) exist — or accept that the first publish CREATES a missing key (the write path handles create-or-update either way).
3. (Manual end-to-end, carried to the phase gate) Publish a `model.coach.default` change via the admin UI; confirm the next chat turn resolves the new model id through `modelFor('coach')` (allow for propagation latency — the UI copy says "may take a moment to take effect").

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
| 7 | 6 | ~78 min | ~13 min |

**Recent Trend:**

- Last plan: 07-06 (~8 min, 2 tasks, 7 files) — net-new surface nav wiring + trilingual parity + days-to-first-close tile (FINAL Wave-3)
- Trend: steady (8–18 min per Phase-7 plan)

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
- [07-01]: Wave-0 RED scaffold landed (mirrors Phase-5/6 D-27). 8 test files + 2 optional AgentProfileDoc fields; all new assertions RED-by-construction (or emulator-gated skip) until 07-02/03/05/06.
- [07-01]: ci-guards Guard 2 (src/→app/) excludes *.test.ts — colocated tests legitimately import the app/ module they verify; the portable core production code is verified app/-clean. The core/shell rule governs the portable core, not its tests.
- [07-01]: Nyquist anti-vacuous Guard 6 — under CI=true, FAIL if FIRESTORE_EMULATOR_HOST is unset, so the read-only-DENY + cross-coach-DENY rules matrices can never describe.skip vacuously. No-op offline. Verified failing under CI w/o emulator, passing with it.
- [07-01]: scripts/**/*.test.ts added to vitest include (was uncovered) so the CI guard suite is collected.
- [07-01]: src/dashboard/queries.test.ts created new (only dashboard.test.ts existed) — isolates Phase-7 PROF-02/CLOSE-02 contracts from the Phase-2 dashboard tests.
- [07-01]: record-first-close + agent-profile contracts placed under the (coach) route group (admits senior-coach + admin); the (admin) group redirects coaches to /dashboard (07 CLAIM routing correction).
- [07-03]: assignCoach is admin-ONLY (D-07) — a senior-coach/read-only token → Forbidden; atomic adminDb.batch() dual-write of agentProfiles.seniorCoachId + users.uplineCoachId + commit (D-06). Historical denorm rows NOT backfilled (D-08/ASSIGN-02).
- [07-03]: days-to-first-close computed read-time off the agentProfiles doc snapshot.createTime (Pitfall 4 zero-migration), NEVER lastActiveAt; null → em-dash; aggregate = avg+median over agents WITH a close (D-22). No stored metric.
- [07-03]: getAgentProfile audits BEFORE read (PROF-02) and throws NotInDownlineError for a non-downline coach (gate 1); the RSC catches it and renders an Empty denied state. The agent profile is pure read-only — NO journey-edit path (D-04; ci-guard 5 GREEN).
- [07-03]: requireRole({allowed}) page-gate helper (Wave-0) now consumed; read-only excluded from every Phase-7 allow-list (D-24). Imported via relative ../../_lib/require-role (bracket route-group path).
- [07-03]: profile totalTokens sums inputTokens+outputTokens (no `tokens` field on UsageRollupDoc); cohort writes stamp tenantId:TENANT_ID explicitly to satisfy WithFieldValue<CohortDoc> (converter also stamps).
- [07-03]: [Rule 1] fixed TDZ in two Wave-0 test harnesses (coach-assignment + queries) — wrapped captured mock refs in vi.hoisted() so hoisted vi.mock factories can reference them; assertions unchanged.
- [07-03]: i18n keys (adminCohorts/adminCoachAssignment/agentsIndex/agentProfile) + the 8 sidebar nav items are referenced here but AUTHORED in 07-06 (cross-plan split); app-sidebar-nav.test.ts stays RED until 07-06.
- [07-04]: flagConversation lives in (admin)/conversations/actions.ts (flag originates from the admin viewer) but is coach-or-admin gated; own-downline is enforced at WRITE time (resolve conversation.ownerUid → agentProfiles.seniorCoachId → assert == coach uid) — a coach never gains read access to conversation content. Admin may flag any.
- [07-04]: When the owning agent has no assigned senior coach, the flag's denormalized seniorCoachId is stamped '' — admins still flag (they bypass the assert); no coach uid equals '', so the flag stays admin-visible only (consistent with the coach read-rule).
- [07-04]: Trilingual flagQueue.* namespace authored NOW in all three catalogs (NOT deferred to 07-06) — the i18n-parity test is a live GREEN gate and next-intl resolves missing keys at build; deferring would break parity + the build. 07-06 still owns the nav-item wiring.
- [07-04]: flagConversation write passes tenantId:TENANT_ID explicitly (mirrors cohorts/actions.ts) to satisfy WithFieldValue<ConversationFlagDoc>; converter also stamps (idempotent).
- [07-04]: scoped listFlags depends on the 07-02 conversationFlags composite indexes being live (built at the rollout deploy checkpoint); until then FAILED_PRECONDITION (Pitfall 6), surfaced via the queue error toast.
- [07-06]: 8 net-new nav items wired into app-sidebar-nav.ts per D-25 (cohorts/agentProfiles/coachAssignment→agents; flags→conversations; auditLog/modelConfig/pdpaSettings→system; daysToFirstClose→analytics); read-only in NO new item's roles (D-24); coach-visible = flags+agentProfiles ['admin','senior-coach'], rest ['admin']. Wave-0 NAV-01 test GREEN. Nav filtering UX-only — requireRole() page gate is the boundary.
- [07-06]: agentProfiles nav href = /[lang]/agents (the 07-03 index route, rows deep-link to [uid]) NOT the [uid]-only drill-in (no dead link). daysToFirstClose href = /[lang]/usage#days-to-first-close (anchors the existing Analytics tile) — CLOSE-02 is presentation-only, no new route.
- [07-06]: 7 surface namespaces (adminCohorts/adminCoachAssignment/agentsIndex/agentProfile/adminModelConfig/adminAuditLog/adminPdpa) + 8 nav labels + adminUsage daysToClose keys authored in all three catalogs to exact key-set parity (i18n-parity GREEN). EN = UI-SPEC source; BM/中文 machine-assisted (ms/zh _note marker, D-08) awaiting native sign-off (carried gate). flagQueue was already authored in 07-04.
- [07-06]: getOrgDaysToFirstClose() added to src/dashboard/queries.ts — read-time org/cohort aggregate over agentProfiles (createTime=onboardingStart, Pitfall 4), folds through the existing daysToFirstClose + aggregateDaysToFirstClose; NO stored metric, NO lazy-cron (D-22). Computed admin-only in usage/page.tsx; read-only never reaches the admin-gated tile section.
- [07-06]: days-to-first-close tile renders avg/median (rounded) + closedCount with literal em-dash '—' when closedCount===0 + the "No first-close recorded for this cohort yet." empty line; section guarded by role==='admin' (D-24). Phase 7 CODE-COMPLETE.

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
| quick-kayinleong-007 | Fix chat UI not rendering streamed assistant text (v4→v5 UI Message Stream parser mismatch) | 2026-06-12 | c2c8327 | [quick-kayinleong-007](./quick/quick-kayinleong-007/) |
| quick-kayinleong-008 | Fix RateLimitError NOT_FOUND on first chat — create rateBudgets/{uid} doc via set() in decrement() | 2026-06-12 | c3d40d9 | [quick-kayinleong-008](./quick/quick-kayinleong-008/) |
| quick-kayinleong-009 | Render assistant chat messages as Markdown (react-markdown + remark-gfm), XSS-safe, plain-text branch only | 2026-06-15 | f6081d9 | [quick-kayinleong-009](./quick/quick-kayinleong-009/) |
| quick-kayinleong-011 | Agent dropdown shows user email instead of truncated uid (admin roles) | 2026-06-15 | 62789cd | [quick-kayinleong-011](./quick/quick-kayinleong-011/) |
| quick-kayinleong-012 | Show staff email instead of raw UID in /en/audit-log Actor column (server-side adminAuth.getUsers, batched, PDPA-safe) | 2026-06-15 | 3a3e831 | [quick-kayinleong-012](./quick/quick-kayinleong-012/) |

## Deferred Items

Items acknowledged and carried forward (v2 / post-pilot):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| WhatsApp | WABA-01/02 (direct API, volume monitoring) | Deferred to v2 | Roadmap |
| Public surface | PUB-01/02 (public recommender, auto-assignment) | Deferred to v2 | Roadmap |
| Advanced coaching | COACH2-01/02 (voice input, playlist sequencing) | Deferred to v2 | Roadmap |
| Scale | SCALE-01/02 (multi-tenant white-label, native apps) | Deferred to v2 | Roadmap |

## Session Continuity

Last session: 2026-06-11T07:09:01.501Z
Stopped at: Phase 7 code-complete + verified (human_needed: 18/18 must-haves, 0 code gaps); 6 human-action items in 07-UAT.md (live deploy + RC IAM + native i18n sign-off + 3 browser click-throughs)
Resume file: .planning/phases/07-console-ia-v2-net-new-surfaces/07-UAT.md
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
