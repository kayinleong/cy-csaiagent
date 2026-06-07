---
phase: 05-hardening-scale
verified: 2026-06-07T10:30:00Z
status: human_needed
score: 5/5 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "PDPA erasure live end-to-end drill"
    expected: "Admin triggers type-to-confirm erasure, sweep completes within 72h, erasureRequests doc shows 'complete' with completedAt set, rawSubjectId cleared, auditLogs unchanged with erasure event appended"
    why_human: "Requires a deployed App Hosting stack, a real Firestore emulator run with actual data seeded, and Derek's in-person confirmation. Emulator-gated coverage.test.ts is GREEN but the live drill (PDPA-SIGNOFF.md §6) and Derek's signature (§7) remain live-gated gates."
  - test: "PDPA sign-off: Derek reviews transient rawSubjectId design and countersigns PDPA-SIGNOFF.md"
    expected: "Derek signs the PDPA-SIGNOFF.md sign-off table (§7) after reviewing the transient-retain + clear-on-complete design flagged in §3 (T-05-RAWID / CR-01) and confirming A1 (voice in Storage?) and A6 (gcloud export posture)"
    why_human: "Legal / compliance sign-off; requires a human principal. PDPA-SIGNOFF.md is code-ready and signoff-ready; Derek's counter-signature is the final gate."
  - test: "Load test: k6 run scripts/loadtest/chat.js against deployed App Hosting stack at ~400 VUs"
    expected: "p95 < 3000ms, error rate < 1%, body contains SSE 'data:' markers. Results documented in .planning/phases/05-hardening-scale/LOADTEST.md"
    why_human: "Requires a live deployed stack in asia-southeast1. k6 harness is code-ready (scripts/loadtest/chat.js, WR-01 fixed). Execution is live-gated per D-11."
  - test: "Firestore rules + indexes deploy: firebase deploy --only firestore:rules,firestore:indexes"
    expected: "No errors; 3 new deny-by-default rules for usageEvents/usageRollups/erasureRequests are live; (day,uid,pillar) composite index on usageEvents is live"
    why_human: "Requires the Firebase CLI and a live Firebase project. Rules files are code-ready. This is the standard additive deploy step consistent with prior phases."
  - test: "Backup/restore drill against the deployed Firestore instance"
    expected: "gcloud firestore export succeeds to a GCS bucket, import to a test project restores data, completion time documented in HARDENING.md §3"
    why_human: "Requires a live GCP project + GCS bucket. Runbook is at docs/operations/backup-restore-runbook.md."
  - test: "SLO finalization: Derek confirms p95 numbers and load profile in HARDENING.md §1 and PERF-COST.md §4"
    expected: "Derek approves or adjusts the PROPOSED SLO numbers (p95 < 3000ms, p50 < 1500ms, error rate < 1%). Numbers currently marked PROPOSED per D-06/A4."
    why_human: "Product/business decision. Numbers are documented but require Derek's explicit sign-off before they become binding SLOs."
  - test: "Live admin UI smoke-test: PDPA erasure, conversation viewer, roles, usage dashboard, coach dashboard v2"
    expected: "Admin can navigate to /<lang>/erasure, /<lang>/conversations, /<lang>/roles, /<lang>/usage as admin; senior-coach can view dashboard with 3 new v2 panels; non-admin is redirected. All copy in BM/中文 is correctly localized."
    why_human: "Visual and navigation testing; requires browser + deployed app. Auth gate correctness is proven by automated tests; visual rendering and i18n display quality need human eyes."
---

# Phase 5: Hardening + Scale-Up — Verification Report

**Phase Goal:** The platform is provably ready for a ~400-agent rollout — PDPA erasure works, costs and performance are understood and bounded, the coach dashboard shows full funnel/knowledge-gap signals, and the system is load-tested and documented for handover.
**Verified:** 2026-06-07T10:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

All 5 roadmap success criteria are code-verified at HEAD. The phase delivers every required artifact, wiring, and behavioral invariant in code. Seven live-gated items (load test execution, PDPA live drill + Derek sign-off, backup drill, SLO finalization, rules/indexes deploy, and browser smoke-test) are not code gaps — they require a deployed stack, external tools, or a human principal — and are correctly handled as `human_needed` verification steps.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | An admin can run a PDPA data-erasure request and confirm the subject's data is removed within <72h; full audit-log surfaces are viewable | VERIFIED (code) / LIVE-GATED (drill + sign-off) | `src/pdpa/coverage.ts` (PII_ERASURE_MANIFEST, all collections), `src/pdpa/erasure.ts` (cascade + audit-exempt), `src/pdpa/sweep.ts` (idempotent sweep, FieldValue.delete() on complete), `app/[lang]/(admin)/erasure/actions.ts` (three-layer gate, CR-01 fix), `app/[lang]/(admin)/erasure/page.tsx`, erasure-request-form.tsx, erasure-status-list.tsx. Coverage test GREEN on emulator. PDPA-SIGNOFF.md signoff-ready. |
| SC2 | A cost/usage dashboard shows token spend and read/write breakdown per agent and per pillar; a performance pass keeps p95 within budget under load | VERIFIED (code) / LIVE-GATED (measured numbers) | `src/usage/record.ts` (single capture, final.totalUsage, counts-only), `src/usage/rollup.ts` (AggregateField.sum/count, idempotent set-merge, WR-04+IN-01+IN-02 fixes), `src/jobs/runDueJobs.ts` (usage-rollup 24h job), `app/[lang]/(admin)/usage/page.tsx` + `usage-dashboard.tsx` (reads usageRollups ONLY — HR-7), PERF-COST.md (pipeline documented, PROPOSED p95 marked). |
| SC3 | The senior-coach dashboard v2 shows funnel metrics tied to the 60-day → 7-10-day compression target plus knowledge-gap signals and inline-correction-to-eval feedback | VERIFIED | `app/[lang]/(coach)/_components/funnel-v2-panel.tsx`, `knowledge-gap-agg-panel.tsx`, `correction-eval-panel.tsx` — all exist and are wired to `dashboard/page.tsx` (lines 42-44, 151-153, 240-270). Data actions `getFunnelV2Metrics`, `getKnowledgeGapAggregation`, `getCorrectionEvalFeedback` added to `dashboard/actions.ts` (ADDITIONS ONLY, WR-05 fix applied). |
| SC4 | A load test demonstrates the system holds for ~400 concurrent agents, and the hardening checklist (SLOs, runbooks, backup/restore, security audit, cost projection) is complete with PDPA sign-off | VERIFIED (code + docs) / LIVE-GATED (test execution + sign-off) | `scripts/loadtest/chat.js` (code-ready, WR-01 fixed — correct body shape + status===200 + SSE data: check), HARDENING.md (SLOs PROPOSED, all 7 runbooks linked, backup = gcloud firestore export, security audit, cost projection), PDPA-SIGNOFF.md (coverage proof, signoff-ready, Derek sign-off LIVE-GATED). |
| SC5 | Internal handover documentation exists so D2's own team can operate the platform | VERIFIED | `docs/operations/` contains all 8 files: README.md, architecture-overview.md, deploy-secrets-runbook.md, lazy-cron-catalog.md (5 jobs listed), backup-restore-runbook.md, pdpa-erasure-runbook.md, incident-runbooks.md, cost-slo-dashboard-guide.md. All use placeholders only — no secrets committed. |

**Score:** 5/5 truths verified at code level. Live-gated execution items are `human_needed`.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pdpa/coverage.ts` | PII_ERASURE_MANIFEST single source of truth | VERIFIED | 9 agent + 4 lead collections, EXEMPT: ['auditLogs'], manifestCollections() helper. Framework-free. |
| `src/pdpa/erasure.ts` | eraseDataSubject cascade + audit exemption | VERIFIED | Iterates manifest only, exemptSet guard, recursiveDelete, BATCH_SIZE=20, audit event written, returns {complete, collectionsHit, collectionsRemaining}. |
| `src/pdpa/sweep.ts` | erasureSweep idempotent chunked completer | VERIFIED | Reads rawSubjectId from doc, re-runs erasure per request, FieldValue.delete() on complete (CR-01 fix applied), marks failed cleanly. |
| `src/usage/types.ts` | UsageEventInput + dayKey() | VERIFIED | Counts-only interface, dayKey() uses Asia/Kuala_Lumpur. |
| `src/usage/record.ts` | recordUsageEvent fire-and-forget | VERIFIED | Destructures input to prevent PII keys, swallows errors with console.warn (WR-06 fix applied). |
| `src/usage/rollup.ts` | rollupUsage AggregateField + idempotent set-merge | VERIFIED | AggregateField.sum/count per (day,uid,pillar), set(merge:true), dayKey() for resolution time (IN-02 fix), dead `now` variable removed (IN-01 fix). |
| `src/jobs/runDueJobs.ts` | usage-rollup + erasure-sweep JOB_REGISTRY | VERIFIED | Both jobs present, rollupUsage(dayKey(now)) wired, erasureSweep() wired, 24h and 1h windows respectively. |
| `app/api/chat/route.ts` | Single usage capture after() using final.totalUsage | VERIFIED | recordUsageEvent imported at line 64, single after() call at line 647, uses final.totalUsage (line 640). |
| `app/[lang]/(admin)/erasure/actions.ts` | eraseDataSubjectAction three-layer gate | VERIFIED | Session → admin role → zod Input.parse gate order. rawSubjectId: id on initial write. FieldValue.delete() on complete (CR-01 fix at line 201). getBlastRadius uses manifest-driven subject-scoped counts (WR-02 fix). |
| `app/[lang]/(admin)/erasure/page.tsx` | RSC shell with three-layer admin gate | VERIFIED | Verbatim kb/page.tsx gate pattern. |
| `app/[lang]/(admin)/erasure/erasure-request-form.tsx` | Type-to-confirm destructive flow | VERIFIED | AlertDialog disabled until typedToken === subjectRef (HR-9). |
| `app/[lang]/(admin)/erasure/erasure-status-list.tsx` | SLA status view | VERIFIED | StatusBadge variants, SLA tracking, auditRetainedNote on complete rows. |
| `app/[lang]/(admin)/conversations/actions.ts` | Admin-only audited read (ADMIN-02) | VERIFIED | auditDrilldown called BEFORE loadRecent (line 128 before 130+). No mutation exports. |
| `app/[lang]/(admin)/conversations/page.tsx` | RSC shell | VERIFIED | Three-layer gate. |
| `app/[lang]/(admin)/conversations/conversation-viewer.tsx` | Read-only Dialog+ScrollArea | VERIFIED | No resolve/reply/delete affordance. |
| `app/[lang]/(admin)/roles/actions.ts` | assignRole via setUserClaims (ADMIN-07) | VERIFIED | setUserClaims sole claim path, audited role-assign event, InvalidRoleError surfaced. |
| `app/[lang]/(admin)/roles/page.tsx` | RSC shell | VERIFIED | Three-layer gate, server-side user fetch. |
| `app/[lang]/(admin)/roles/role-assignment.tsx` | Role matrix + demotion confirm | VERIFIED | 8×3 capability table, demotion AlertDialog (HR-6). |
| `app/[lang]/(admin)/usage/page.tsx` | Admin RSC reads usageRollups ONLY | VERIFIED | usageEventsRef never imported (only mentioned in comment). Comment `// NEVER raw usageEvents — HR-7` present. |
| `app/[lang]/(admin)/usage/usage-dashboard.tsx` | KPI tiles + charts + stale watchdog | VERIFIED | recharts LineChart + BarChart, per-agent Table, noRollups empty state, stale watchdog (25h threshold). |
| `app/[lang]/(coach)/_components/funnel-v2-panel.tsx` | Full funnel + ramp KPI | VERIFIED | BarChart stages, avgDaysToProductive KPI vs 10-day ramp target. |
| `app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx` | Knowledge-gap aggregation | VERIFIED | Pillar Tabs filter, top-10 topics BarChart. |
| `app/[lang]/(coach)/_components/correction-eval-panel.tsx` | Correction table + eval scores | VERIFIED | Corrections table + suite-ordered LineChart (WR-05 fix applied, relabelled "Eval scores by suite"). |
| `app/[lang]/(coach)/dashboard/page.tsx` | Dashboard grown with 3 v2 sections | VERIFIED | Imports FunnelV2Panel, KnowledgeGapAggPanel, CorrectionEvalPanel (lines 42-44); fetches 3 data actions in Promise.all (lines 151-153); renders 3 sections (lines 240-270). Existing sections untouched. |
| `app/[lang]/_components/app-sidebar.tsx` | 4 admin NavItems added | VERIFIED | conversations, roles, usage, erasure NavItems with roles: ['admin']. |
| `firestore.rules` | 3 new collections deny-by-default | VERIFIED | usageEvents (lines 282-285), usageRollups (lines 291-294), erasureRequests (lines 300-303) — all: create/update/delete: if false; read: admin-only. No existing rule widened. |
| `scripts/loadtest/chat.js` | k6 harness code-ready | VERIFIED | Correct body shape `{messages: [...]}` (WR-01 fix), status===200 check, SSE 'data:' check, 400 VUs, PROPOSED thresholds, TOKEN via __ENV.TOKEN only. |
| `.planning/phases/05-hardening-scale/PERF-COST.md` | QUAL-08 cost/perf pass document | VERIFIED | Single pipeline documented, cache-hit measurement, PROPOSED p95, undercount finding flagged. |
| `.planning/phases/05-hardening-scale/HARDENING.md` | SC4 hardening checklist | VERIFIED | SLOs PROPOSED, 7 runbooks linked, backup = gcloud firestore export, security audit, cost projection, live-gated gates documented. |
| `.planning/phases/05-hardening-scale/PDPA-SIGNOFF.md` | QUAL-09 sign-off memo | VERIFIED | Coverage proof (manifest table, test assertions), transient rawSubjectId disclosed (CR-01), live drill LIVE-GATED, Derek sign-off LIVE-GATED. |
| `docs/operations/` (8 files) | Operator handover set (QUAL-10) | VERIFIED | README.md, architecture-overview.md, deploy-secrets-runbook.md, lazy-cron-catalog.md, backup-restore-runbook.md, pdpa-erasure-runbook.md, incident-runbooks.md, cost-slo-dashboard-guide.md — all exist, placeholders only. |
| `.planning/phases/01-foundations/PDPA-TIA.md` | Phase-5 TIA update (D-03) | VERIFIED | P5-1 through P5-6 sections appended, prior content intact. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/api/chat/route.ts` | `src/usage/record.ts` | `after(() => recordUsageEvent(...))` | WIRED | Import at line 64; after() call at line 647 using final.totalUsage (line 640). Single capture point confirmed. |
| `src/pdpa/erasure.ts` | `src/pdpa/coverage.ts` | `import { PII_ERASURE_MANIFEST }` | WIRED | PII_ERASURE_MANIFEST drives executor iteration. |
| `src/pdpa/sweep.ts` | `src/pdpa/erasure.ts` | `import { eraseDataSubject }` | WIRED | Sweep calls eraseDataSubject per pending request. |
| `src/jobs/runDueJobs.ts` | `src/usage/rollup.ts` | `rollupUsage(dayKey(now))` in 'usage-rollup' entry | WIRED | JOB_REGISTRY 'usage-rollup' body filled (line 228). |
| `src/jobs/runDueJobs.ts` | `src/pdpa/sweep.ts` | `erasureSweep()` in 'erasure-sweep' entry | WIRED | JOB_REGISTRY 'erasure-sweep' body filled (line 251). |
| `app/[lang]/(admin)/erasure/actions.ts` | `src/pdpa/erasure.ts` | `eraseCore(...)` call | WIRED | import eraseDataSubject as eraseCore; called after creating request doc. |
| `app/[lang]/(admin)/usage/page.tsx` | `src/firebase/collections.ts` | `usageRollupsRef()` | WIRED | Only usageRollupsRef imported; usageEventsRef absent from imports. |
| `app/[lang]/(admin)/roles/actions.ts` | `src/firebase/auth.ts` | `setUserClaims(targetUid, role)` | WIRED | setUserClaims is sole claim-setting call (line 128). |
| `app/[lang]/(admin)/conversations/actions.ts` | `src/audit/log.ts` | `auditDrilldown(user.uid, ...)` before `loadRecent` | WIRED | Line 128 (audit) before line 130+ (data fetch). |
| `app/[lang]/(coach)/dashboard/page.tsx` | funnel/gap/correction panels | `FunnelV2Panel`, `KnowledgeGapAggPanel`, `CorrectionEvalPanel` | WIRED | Imported at lines 42-44; rendered at lines 240-270 with serializable RSC props. |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `usage-dashboard.tsx` | `volumeTrend`, `tokenByPillar`, `perAgentRows` | `usageRollupsRef().where('day','>=',windowStart)` in `page.tsx` | Yes — reads from Firestore usageRollups (pre-aggregated by rollupUsage); shows empty state when no rollups | VERIFIED |
| `funnel-v2-panel.tsx` | `stages[]`, `avgDaysToProductive` | `getFunnelV2Metrics()` → `agentProfilesRef()` select projection | Yes — reads real agentProfiles with role-scoped filter | VERIFIED |
| `knowledge-gap-agg-panel.tsx` | `gapsByTopic` | `getKnowledgeGapAggregation()` → `knowledgeGapsRef()` select projection | Yes — reads real knowledgeGaps collection | VERIFIED |
| `correction-eval-panel.tsx` | `corrections[]`, `evalScores[]` | `getCorrectionEvalFeedback()` → `kbDocsRef()` + `evalsRef()` | Yes — reads kbDocs.where('correctedBy','!=',null) + evalsRef, both limited to 20 rows | VERIFIED |
| `conversation-viewer.tsx` | `messages[]` | `getConversationForReview(cid)` → `loadRecent(cid, 100)` | Yes — reads real conversation messages; audit-before-data enforced | VERIFIED |
| `erasure-status-list.tsx` | `requests[]` | `listErasureRequests()` → `erasureRequestsRef()` | Yes — reads real erasureRequests docs; rawSubjectId not in row mapper | VERIFIED |

---

## Behavioral Spot-Checks

Step 7b: SKIPPED for live-network items (load test, live erasure drill). Static checks performed instead.

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| PII_ERASURE_MANIFEST.EXEMPT contains 'auditLogs' | `grep "'auditLogs'" src/pdpa/coverage.ts` | Found at line 228 | PASS |
| Usage capture uses final.totalUsage (not final.usage) | `grep "totalUsage" app/api/chat/route.ts` | Line 640: `final.totalUsage` | PASS |
| Usage dashboard never imports usageEventsRef | `grep "usageEventsRef" app/[lang]/(admin)/usage/page.tsx` | Not in imports; only in comment (HR-7 note) | PASS |
| setCustomUserClaims not used directly in roles/actions.ts | `grep "setCustomUserClaims" app/[lang]/(admin)/roles/actions.ts` | Not found (setUserClaims used exclusively) | PASS |
| k6 harness body shape correct (WR-01 fix) | `grep "messages:" scripts/loadtest/chat.js` | `{messages: [{role:'user', content:'...'}]}` at line 93 | PASS |
| CR-01 fix: FieldValue.delete() on complete in actions.ts | `grep "FieldValue.delete" .../erasure/actions.ts` | Line 201: `updateData.rawSubjectId = FieldValue.delete()` | PASS |
| CR-01 fix: FieldValue.delete() on complete in sweep.ts | `grep "FieldValue.delete" src/pdpa/sweep.ts` | Line 127: `rawSubjectId: FieldValue.delete()` | PASS |
| core/shell split: src/ never imports from app/ | Grep all src/pdpa/ and src/usage/ for app/ imports | No matches found | PASS |
| dayKey() used for window boundary (WR-04 fix) | `grep "nDaysAgo\|toISOString" usage/page.tsx` | nDaysAgo() uses dayKey() per line 50; no raw toISOString | PASS |
| WR-05 fix: eval panel orders by suite not score desc | `grep "orderBy.*suite" dashboard/actions.ts` | Line 812: `.orderBy('suite', 'asc')` | PASS |
| No hard-coded model IDs in Phase 5 code | Grep src/pdpa/ src/usage/ for claude/anthropic model strings | No matches found | PASS |
| tenantId on erasureRequests doc | `grep "tenantId" erasure/actions.ts` | Line 159: `tenantId: TENANT_ID` | PASS |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| CDASH-08 | 05-07 | Coach dashboard v2 — full funnel metrics | SATISFIED | funnel-v2-panel.tsx, knowledge-gap-agg-panel.tsx, correction-eval-panel.tsx, 3 data actions in dashboard/actions.ts |
| ADMIN-02 | 05-06 | Conversation log viewer | SATISFIED | conversations/actions.ts (audited read), page.tsx (RSC gate), conversation-viewer.tsx (read-only Dialog) |
| ADMIN-07 | 05-06 | Role and permission controls | SATISFIED | roles/actions.ts (setUserClaims sole path, audited), page.tsx, role-assignment.tsx (8×3 matrix + demotion confirm) |
| ADMIN-08 | 05-07 | Usage analytics — active agents, message volume, resolution time, escalation rate | SATISFIED | usage/page.tsx + usage-dashboard.tsx reading usageRollups; KPI tiles include activeAgents, msgCount, resolutionTimeMs, escalationRate |
| QUAL-08 | 05-04, 05-07, 05-08 | Performance + cost optimization pass before production rollout | SATISFIED (code) / LIVE-GATED (measured numbers) | Single pipeline documented in PERF-COST.md, rollupUsage AggregateField discipline, PROPOSED p95 targets |
| QUAL-09 | 05-03, 05-05, 05-08 | PDPA audit + sign-off before production rollout | SATISFIED (code) / LIVE-GATED (drill + signature) | PII_ERASURE_MANIFEST, eraseDataSubject, erasureSweep, PDPA-SIGNOFF.md signoff-ready |
| QUAL-10 | 05-08 | Internal documentation for D2's team (handover) | SATISFIED | All 8 docs/operations/ runbooks present and placeholder-safe |

All 7 Phase 5 requirements are satisfied in code. QUAL-08 and QUAL-09 have live-gated measurement/sign-off steps that require human action during rollout prep.

---

## Code Review Confirmation (05-REVIEW.md)

The code review (05-REVIEW.md, status: resolved) found 1 Critical + 6 Warnings + 6 Info items. All Critical + Warning items are confirmed fixed at HEAD:

| Finding | Fix Verified |
|---------|-------------|
| CR-01: rawSubjectId persisted in plaintext | FIXED — `updateData.rawSubjectId = FieldValue.delete()` on complete in actions.ts (line 201) + `rawSubjectId: FieldValue.delete()` on complete in sweep.ts (line 127). PDPA-SIGNOFF.md discloses transient design. |
| WR-01: k6 body shape wrong — chat path never exercised | FIXED — SAMPLE_CHAT_BODY uses `{messages:[...]}` shape, k6 check requires status===200 + 'data:' in body |
| WR-02: getBlastRadius returns whole-collection counts | FIXED — iterates PII_ERASURE_MANIFEST entries, applies keyField/docId/keyVia strategy per entry |
| WR-03: lastMessageAt always null | FIXED — falls back to createdAt (line 203-205 in conversations/actions.ts) |
| WR-04: usage dashboard window boundary in UTC vs MYT rollup keys | FIXED — nDaysAgo() uses dayKey() (line 50 in usage/page.tsx) |
| WR-05: correction-eval panel orders by score desc, misleading as "trend" | FIXED — orders by suite asc (line 812 in dashboard/actions.ts), relabelled "eval scores by suite" in i18n |
| WR-06: recordUsageEvent silently swallows all errors | FIXED — console.warn emitted on catch (line 83 in record.ts) |
| IN-01, IN-02: dead `now` variable; resolution time in UTC | FIXED — `now` removed from rollup.ts; dayKey() used for resolvedMs formatting |
| IN-03, IN-04, IN-05, IN-06 | Consciously deferred (no behavior bugs, v1 scope) |

---

## Anti-Patterns Found

No blockers or warnings identified. The following are informational only:

| File | Pattern | Severity | Impact |
|------|---------|---------|--------|
| `src/pdpa/coverage.ts` line 185 | STORAGE entry near-no-op (voice samples are Firestore strings today) | Info | Documented A1; confirm with Derek if voice moves to Storage before sign-off |
| `app/[lang]/(admin)/erasure/erasure-status-list.tsx` line 37 | Static initial state, no auto-refresh after queue (IN-06, deferred) | Info | UX gap only; requires page reload to see new requests. Security unaffected. |
| `src/usage/rollup.ts` line 170 | computeResolutionTimeMs fetches all resolved escalations without limit (IN-03, deferred) | Info | Bounded by pilot agent count; not a blocker for v1 |
| `app/api/chat/route.ts` lines 607/522/620 | final.usage.totalTokens (last step only) used for rate-limit + audit tokenCount — pre-Phase-5 undercount | Info | Documented in PERF-COST.md §6 as flagged finding; separate claim + Derek sign-off required before fix. usageEvents capture correctly uses final.totalUsage. |

---

## Hard Guarantee Confirmations

All hard guarantees verified against the actual codebase at HEAD:

**PDPA erasure:**
- PII_ERASURE_MANIFEST is the single source of truth: `src/pdpa/coverage.ts` — exported as a const, imported by erasure.ts, sweep.ts, and coverage.test.ts. No other file hard-codes collection names for erasure. CONFIRMED.
- auditLogs EXEMPT (never deleted): EXEMPT guard in erasure.ts `exemptSet` — constructive skip, not a rule check. CONFIRMED.
- recursiveDelete for conversations+messages: `{ collection: 'conversations', keyField: 'ownerUid', recursive: true }` in manifest; `deleteByKeyFieldRecursive` calls `adminDb.recursiveDelete(docRef)`. CONFIRMED.
- Idempotent erasure + sweep: deleting a gone doc is a Firestore no-op; re-running returns complete:true immediately. CONFIRMED.
- erasure-sweep is a JOB_REGISTRY entry (NOT external scheduler): `'erasure-sweep': { windowMs: 60 * 60 * 1000, run: async () => { await erasureSweep(); await writeHeartbeat('erasure-sweep') } }` in runDueJobs.ts. CONFIRMED.

**Usage capture:**
- Exactly ONE capture site: `after(() => recordUsageEvent({...}))` at route.ts line 647 alongside the existing audit after(). Single import of recordUsageEvent. CONFIRMED.
- Counts-only / no PII / no content: UsageEventInput destructured explicitly; no content/text/originalDraft/routeDecision fields in UsageEventDoc interface. CONFIRMED.
- final.totalUsage for multi-step turns: line 640 `const u = final.totalUsage`. CONFIRMED.
- rollupUsage via AggregateField + idempotent set-merge: `AggregateField.sum()` / `count()` per group; `set(rollupData, { merge: true })` keyed `${day}__${uid}__${pillar}`. CONFIRMED.

**Admin surfaces:**
- Three-layer admin gate on erasure/conversations/roles: layout (layer 1) → RSC page redirect (layer 2) → Server Action role check from VERIFIED token (layer 3). Role from `requireUser(req)` (token), NEVER from action args. CONFIRMED on all three surfaces.
- Conversation viewer is READ-ONLY and audits-before-returning-data: Only `getConversationForReview` + `searchConversations` exported; `auditDrilldown` called at line 128 before `loadRecent` at line 130+. CONFIRMED.
- Roles assign via setUserClaims only (audited): `setUserClaims(targetUid, role)` at line 128; `audit.log({action:'role-assign',...})` follows; no `setCustomUserClaims` in file. CONFIRMED.
- Usage dashboard reads usageRollups ONLY: `usageEventsRef` not imported in usage/page.tsx; comment `// NEVER raw usageEvents — HR-7` confirms intent. CONFIRMED.

**3 new collections deny-by-default:**
- usageEvents: `allow create, update, delete: if false;` (line 283). CONFIRMED.
- usageRollups: `allow create, update, delete: if false;` (line 292). CONFIRMED.
- erasureRequests: `allow create, update, delete: if false;` (line 301). CONFIRMED.
- No existing rule widened. CONFIRMED.

**Project hard constraints:**
- No Cloud Functions: all logic in Next.js Route Handlers / Server Actions / lazy-cron on App Hosting. CONFIRMED.
- No GCP beyond Firebase SDK surface: backup = documented `gcloud firestore export` (operator step, not app code); Gemini via Developer API (unchanged); no BigQuery. CONFIRMED.
- No hard-coded model IDs: no claude-*/anthropic model strings found in src/pdpa/ or src/usage/. Remote Config pattern unchanged. CONFIRMED.
- core/shell split (src/ never imports app/): Grep of all src/pdpa/ and src/usage/ for `from '@/app'` returns no matches. CONFIRMED.
- Every Firestore doc carries tenantId: usageEvents (tenantId via converter), usageRollups (tenantId via converter), erasureRequests (`tenantId: TENANT_ID` in actions.ts line 159). CONFIRMED.
- Trilingual i18n key parity: en/ms/zh each contain 4 occurrences of the Phase-5 namespaces (adminErasure, adminConversations, adminRoles, adminUsage, dashboard.v2). CONFIRMED.

---

## Human Verification Required

The following items cannot be verified programmatically and must be performed against the deployed stack or require a human principal. They are NOT code gaps — all enabling code and documentation exist.

### 1. PDPA Erasure Live End-to-End Drill

**Test:** Sign in as admin, navigate to `/<lang>/erasure`, select a subject (use a synthetic test account), verify blast-radius preview shows correct subject-scoped counts, type the subject ref to confirm, submit. Monitor `erasureRequests/{reqId}` in Firestore console: status should progress `pending → complete` (if synchronous pass completes) or `pending → sweeping → complete` after the next authorized page load triggers `erasure-sweep`. Verify `rawSubjectId` field is absent on the completed doc. Verify `auditLogs` row count is unchanged + an `action:'erasure'` event was appended.
**Expected:** Status reaches `complete` within 72h SLA. auditLogs survives.
**Why human:** Requires deployed App Hosting stack + real Firestore data. The emulator-gated `coverage.test.ts` GREEN is the code-level proof; the live drill is the production-readiness proof.

### 2. Derek Sign-Off on PDPA-SIGNOFF.md

**Test:** Derek reviews `.planning/phases/05-hardening-scale/PDPA-SIGNOFF.md` §3 (transient rawSubjectId design, T-05-RAWID / CR-01), §4 A1 (are voice samples in Storage?), §4 A6 (is managed gcloud firestore export posture acceptable?), and §6 (live drill results). Then signs §7 sign-off table.
**Expected:** Derek's name, date, and signature in the §7 table. A1 and A6 confirmations filled.
**Why human:** Legal/compliance sign-off. Requires a human principal who is the designated PDPA responsible party for D2.

### 3. Load Test Execution

**Test:** With a deployed App Hosting stack: `k6 run -e TARGET=<app-hosting-url> -e TOKEN=<test-jwt> scripts/loadtest/chat.js`. Document results in `.planning/phases/05-hardening-scale/LOADTEST.md`.
**Expected:** p95 < 3000ms, error rate < 1%, body contains `data:` SSE markers. (Numbers PROPOSED — Derek to confirm final SLO targets.)
**Why human:** Requires a deployed stack and the k6 binary. The harness is code-ready; execution is deferred to rollout prep per D-11.

### 4. Firestore Rules + Indexes Deploy

**Test:** `firebase deploy --only firestore:rules,firestore:indexes` from the project root (with Firebase CLI configured for the `cy-csaiagent` project, `asia-southeast1`).
**Expected:** Zero errors. New deny-by-default rules for collections 18-20 and the usageEvents composite index go live.
**Why human:** Requires Firebase CLI auth and the live Firebase project. Consistent with Phase 2-4 live-gated deploy steps.

### 5. Backup/Restore Drill

**Test:** Follow `docs/operations/backup-restore-runbook.md`. Run `gcloud firestore export gs://<BUCKET_NAME>/exports/$(date +%Y-%m-%d)/`. Verify export completes. Test import to a scratch project. Record results in HARDENING.md §3 drill table.
**Expected:** Export + import succeed. Restoration time documented.
**Why human:** Requires GCP project access and a GCS bucket. Derek also needs to confirm A6 (gcloud export posture) during this step.

### 6. SLO Finalization

**Test:** After load test results are in, Derek reviews the PROPOSED numbers in HARDENING.md §1 (p95 < 3000ms, p50 < 1500ms, error rate < 1%) and confirms or adjusts them.
**Expected:** HARDENING.md §1 SLO table updated from PROPOSED to CONFIRMED with Derek's sign-off date.
**Why human:** Product/business decision — SLOs affect on-call alerting thresholds and the operations agreement with D2.

### 7. Admin UI Smoke-Test (Visual + Navigation)

**Test:** As admin: sign in, navigate to `/<lang>/erasure` (verify form + status list render, BM/中文 irreversibility copy correct), `/<lang>/conversations` (verify search + read-only dialog + audit banner), `/<lang>/roles` (verify capability matrix + assign role + demotion AlertDialog), `/<lang>/usage` (verify KPI tiles, volume chart, pillar chart, per-agent table — or noRollups empty state if no data). As senior-coach: visit dashboard, confirm 3 v2 panels (funnel, gap-agg with pillar filter tabs, correction+eval table). Verify non-admin redirect from admin routes.
**Expected:** All surfaces render correctly; non-admin is redirected; BM/中文 copy is correct.
**Why human:** Visual rendering quality and i18n copy correctness require human eyes. Auth gate correctness is proven by automated tests.

---

## Gaps Summary

No code gaps identified. All 5 success criteria are achieved at the code level. The 7 human verification items above are live-gated execution steps (load test run, PDPA drill + sign-off, backup drill, SLO finalization, rules/indexes deploy, browser smoke-test) that require a deployed stack, external tools, or a human principal. These are not regressions or missing implementations — they are the same category of live-gated items that closed Phases 2, 3, and 4.

The only open technical item is the pre-Phase-5 token undercount at `route.ts:607/:522/:620` (rate-limit + audit tokenCount use `final.usage.totalTokens`, last-step only for multi-step Finder/Reply turns). This is explicitly documented in PERF-COST.md §6 as a flagged finding requiring a separate claim + Derek sign-off. It is not a Phase 5 gap — it predates Phase 5, does not affect the usageEvents capture (which correctly uses final.totalUsage), and the fix requires a behavioral change to TOKEN_CAP consumption that is a product decision.

---

_Verified: 2026-06-07T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Phase: 05-hardening-scale_
