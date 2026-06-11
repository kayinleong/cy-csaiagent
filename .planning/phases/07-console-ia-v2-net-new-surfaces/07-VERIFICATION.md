---
phase: 07-console-ia-v2-net-new-surfaces
verified: 2026-06-11T15:05:00Z
status: human_needed
score: 18/18 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Deploy Firestore rules + indexes and confirm composite index build"
    expected: "firebase deploy --only firestore:rules,firestore:indexes completes; all 4 new composite indexes (conversationFlags seniorCoachId,status; conversationFlags status,createdAt; auditLogs action,ts; auditLogs actorUid,ts) reach status Enabled in the Firebase console"
    why_human: "Live Firebase credentials required; index build is async and cannot be verified by code inspection"
  - test: "Confirm App Hosting SA has Remote Config publish IAM scope and test end-to-end model swap"
    expected: "App Hosting service account has firebaseremoteconfig.remoteConfig.update; publishing a model.coach.default change via the admin UI is reflected in modelFor('coach') on the next chat turn"
    why_human: "Requires GCP IAM console access; modelFor() live resolution requires a deployed environment"
  - test: "BM / 中文 native sign-off on the 8 surfaces' copy"
    expected: "A native BM speaker and a native Mandarin speaker review the machine-assisted catalog translations (flagged with _note and _review markers in ms.json and zh.json) and approve the copy for production use"
    why_human: "Translation quality cannot be verified programmatically; ms/zh catalogs carry machine-assisted drafts awaiting native review"
  - test: "Browser click-through: read-only role is denied on all 8 Phase-7 surfaces"
    expected: "A user with the read-only role browsing to /[lang]/cohorts, /[lang]/coach-assignment, /[lang]/agents, /[lang]/agents/[uid], /[lang]/flags, /[lang]/audit-log, /[lang]/model-config, /[lang]/pdpa-settings is redirected (not shown the surface or a 404) and the sidebar shows none of the 8 nav items"
    why_human: "Server-side gate behavior (requireRole redirect) can only be confirmed in a running application"
  - test: "Browser click-through: senior-coach sees only flags + agentProfiles nav items, accesses own-downline agents and flags only"
    expected: "A senior-coach user sees agentProfiles and flags in the sidebar (not cohorts, coachAssignment, auditLog, modelConfig, pdpaSettings, daysToFirstClose); navigating to agents/[uid] for an out-of-downline agent is denied; the flag queue shows only own-downline flags"
    why_human: "Role-scoped Firestore reads and server-side downline filtering require a live environment with real agent data"
  - test: "Admin can publish a model-config change via the UI and observe it reflected in modelFor()"
    expected: "Admin visits /[lang]/model-config, changes a pillar model ID, confirms the neutral-primary publish dialog, and the next call to modelFor() returns the new model ID (after propagation); a stale-ETag conflict surfaces the conflict error copy instead of a silent overwrite"
    why_human: "Requires a deployed environment with Remote Config IAM configured; ETag conflict path requires a concurrent publish to reproduce"
---

# Phase 7: Console IA v2 — Net-new Surfaces Verification Report

**Phase Goal:** Build the 8 net-new console surfaces deferred out of Phase 6 — cohort management (+ data model), agent profile pages, coach-assignment UI, conversation flagged queue, audit-log viewer, model-config admin UI (Remote Config read/write), PDPA-settings read-only display, days-to-first-close metric — INTO the established Phase-6 6-section IA + read-only role (neither rebuilt). All v1 hard constraints in force.
**Verified:** 2026-06-11T15:05:00Z
**Status:** HUMAN_NEEDED — all automated checks pass; 3 live-gated rollout items and 3 browser click-through items require human verification.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | cohorts and conversationFlags exist as first-class collections with converter, tenantId auto-stamp, numbered ref factory | VERIFIED | `src/firebase/collections.ts` lines 656-974: `CohortDoc`, `ConversationFlagDoc`, `cohortConverter`, `conversationFlagConverter`, `cohortsRef()` (Collection 21), `conversationFlagsRef()` (Collection 22) — all present |
| 2 | AgentProfileDoc carries optional cohortId? and firstCloseAt?; pre-Phase-7 docs still valid | VERIFIED | `src/firebase/collections.ts` lines 86-100: both optional fields with Phase-7 doc-comments; TypeScript type tests pass (rules.test.ts `AgentProfileDoc Phase-7 optional fields`) |
| 3 | Both new collections are deny-by-default; read-only DENIED; conversationFlags client writes DENIED; coach reads own-downline only | VERIFIED | `firestore.rules` lines 304-332: cohorts block (no `isAnalyticsReader`/`isReadOnlyRole` grant); conversationFlags block (`allow create, update, delete: if false`; senior-coach read gated by `resource.data.seniorCoachId == request.auth.uid`); ci-guard 3 GREEN (6/6) |
| 4 | Emulator rules matrices GREEN (171/171 rules tests) | VERIFIED | 07-02-SUMMARY confirms 171/171 emulator pass; `vitest run` reports 639 passed / 186 skipped (emulator-gated rules skip when emulator is offline — ci-guard 6 anti-vacuous gate fails CI if emulator absent) |
| 5 | Composite indexes declared for conversationFlags (seniorCoachId,status) and (status,createdAt); auditLogs (action,ts) and (actorUid,ts) | VERIFIED | `firestore.indexes.json` lines 168-198: all 4 entries present |
| 6 | Admin can create/edit/delete cohorts; every cohort write audited; non-admin Forbidden; read-only DENIED | VERIFIED | `app/[lang]/(admin)/cohorts/actions.ts`: admin gate (`user.role !== 'admin'` → Forbidden), `audit.log` called for each action; `app/[lang]/(admin)/cohorts/page.tsx`: `requireRole({ allowed: ['admin'] })`; `cohort-management.tsx` present |
| 7 | Coach-assignment is admin-only atomic dual-write (agentProfiles.seniorCoachId + users.uplineCoachId), audited; senior-coach denied | VERIFIED | `app/[lang]/(admin)/coach-assignment/actions.ts`: `user.role !== 'admin'` → Forbidden; `adminDb.batch()` → `batch.update(agentProfilesRef()...)` + `batch.update(usersRef()...)` → `batch.commit()`; audit.log called; Wave-0 ASSIGN-01 test: 4/4 GREEN |
| 8 | The /[lang]/agents index (coach/admin gated, read-only DENIED) resolves via NAV-01 href; rows deep-link to [uid] drill-in | VERIFIED | `app/[lang]/(coach)/agents/page.tsx` exists; `requireRole(['admin','senior-coach'])` gate; uses `getDownline`; `agent-list.tsx` renders `<Link>` per row to `/[lang]/agents/${row.id}`; build output confirms `/agents` route present |
| 9 | Agent profile is read-only composition only; coach reads write auditDrilldown before returning; non-downline coach denied; read-only DENIED; NO journey-edit affordance | VERIFIED | `src/dashboard/queries.ts` line 317: `auditDrilldown(coachUid,'agentProfiles')` called BEFORE the doc read; `NotInDownlineError` thrown for non-downline coach; `app/[lang]/(coach)/agents/[uid]/page.tsx`: `requireRole(['admin','senior-coach'])`; ci-guard 5 GREEN (no journey-edit symbol); queries.test.ts PROF-02 4/4 GREEN |
| 10 | days-to-first-close = firstCloseAt − snapshot.createTime (NEVER lastActiveAt); read-time; per-agent + org aggregate (avg/median); absent close = em-dash | VERIFIED | `src/dashboard/queries.ts` line 350: `snap.createTime ? snap.createTime.toDate() : null`; `daysToFirstClose()` fn; `aggregateDaysToFirstClose()`; `getOrgDaysToFirstClose()`; usage-dashboard.tsx wired; queries.test.ts CLOSE-02 2/2 GREEN |
| 11 | recordFirstClose is idempotent (second call no-ops); coach own-downline + admin; audited | VERIFIED | `app/[lang]/(coach)/agents/actions.ts` line 112-113: reads `firstCloseAt`, returns `already-recorded` if set; `audit.log` on success; agents/actions.test.ts CLOSE-01 4/4 GREEN |
| 12 | Flagged queue stores conversationId reference only (no content); stamps denormalized seniorCoachId; Admin-SDK write only; manual flagging only | VERIFIED | `app/[lang]/(admin)/conversations/actions.ts` `flagConversation`: writes `conversationFlagsRef()` with `conversationId` + `seniorCoachId` (looked up from agentProfiles); no message content field; `ConversationFlagDoc` has no content field; admin-viewer flag button content-free |
| 13 | Flagged queue read = admin all / coach own-downline; bounded limit(50); read-only DENIED; deep-links to existing viewer | VERIFIED | `app/[lang]/(coach)/flags/actions.ts` `listFlags`: coach filters `where('seniorCoachId','==',user.uid)`, admin all; `.limit(50)`; `app/[lang]/(coach)/flags/page.tsx`: `requireRole(['admin','senior-coach'])` |
| 14 | Audit-log viewer is admin-only bounded read (limit 50, cursor); hashes NOT decoded; does NOT self-audit | VERIFIED | `app/[lang]/(admin)/audit-log/actions.ts`: `orderBy('ts','desc').limit(50)`; returns `{id, actorUid, action, targetRef, ts}` only; no import of `auditDrilldown`; Wave-0 AUDIT-01 5/5 GREEN |
| 15 | Model-config reads/writes the 5 model.{pillar}.default keys via getTemplate→publishTemplate WITHOUT {force:true}; ETag concurrency; unknown pillar rejected; admin-only; audited; no hard-coded model ID | VERIFIED | `app/[lang]/(admin)/model-config/actions.ts`: `rc.getTemplate()` (NOT getServerTemplate); `rc.publishTemplate(template)` — no `{force:true}`; stale-ETag → `{ok:false,error:'conflict'}`; pillar validated against 5-pillar union; `audit.log('model_config_publish')`; no model-id literal in file; Wave-0 MODEL-02 6/6 GREEN; ci-guard 4 GREEN |
| 16 | PDPA-settings is static admin-only display from policy-constants + erasure link; zero editable knobs | VERIFIED | `src/pdpa/policy-constants.ts`: 5 policy items (asia-southeast1, PII pseudonymization, 90d TTL, hashes-only, <72h erasure SLA); `PDPA_ERASURE_ROUTE` constant; `app/[lang]/(admin)/pdpa-settings/page.tsx`: `requireRole(['admin'])`; no form/input elements |
| 17 | 8 role-filtered nav entries under correct Phase-6 sections; read-only sees NONE; nav is UX-only | VERIFIED | `app/[lang]/_components/app-sidebar-nav.ts` lines 64-72: 8 new `NavItemKey` values; cohorts/agentProfiles/coachAssignment under 'agents'; flags under 'conversations'; auditLog/modelConfig/pdpaSettings under 'system'; daysToFirstClose under 'analytics'; none list 'read-only' in roles; app-sidebar-nav.test.ts NAV-01 8/8 GREEN |
| 18 | All new strings trilingual EN/BM/中文 with identical key sets; i18n-parity.test.ts GREEN | VERIFIED | `src/i18n/messages/{en,ms,zh}.json`: 23 namespaces including all 7 Phase-7 surface namespaces + 8 nav keys; i18n-parity.test.ts 6/6 GREEN; _note/_review markers in ms/zh are metadata (excluded by the parity test) |

**Score:** 18/18 truths verified

---

### Deferred Items

None — all Phase 7 goal items are implemented. Three live-gated rollout items are not code gaps; they require human action in the deployment environment (structured in human_verification above).

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/firebase/collections.ts` | CohortDoc + cohortConverter + cohortsRef() (Coll 21); ConversationFlagDoc + conversationFlagConverter + conversationFlagsRef() (Coll 22); AgentProfileDoc.cohortId?/firstCloseAt? | VERIFIED | All present; header inventory updated |
| `firestore.rules` | /cohorts + /conversationFlags deny-by-default blocks; read-only not granted in either | VERIFIED | Lines 304-332; no isAnalyticsReader/isReadOnlyRole in either block |
| `firestore.indexes.json` | 4 composite indexes (conversationFlags ×2, auditLogs ×2) | VERIFIED | Lines 168-198 |
| `src/firebase/__tests__/rules.test.ts` | cohorts + conversationFlags 4-role matrices; RO-01 DENY extended | VERIFIED | Lines 650-665 (conversationFlags suite), 741-751 (cohorts suite), 1648-1665 (RO-01 DENY entries) |
| `app/[lang]/(admin)/cohorts/actions.ts` | Admin-only audited cohort CRUD | VERIFIED | createCohort/updateCohort/deleteCohort with admin gate + audit |
| `app/[lang]/(admin)/cohorts/page.tsx` | Admin-only RSC gate | VERIFIED | requireRole(['admin']) |
| `app/[lang]/(admin)/cohorts/cohort-management.tsx` | Table + dialog + destructive AlertDialog | VERIFIED | Present |
| `app/[lang]/(admin)/coach-assignment/actions.ts` | Admin-only atomic assignCoach dual-write | VERIFIED | adminDb.batch() with both updates + commit; Forbidden for non-admin |
| `app/[lang]/(admin)/coach-assignment/page.tsx` | Admin-only RSC gate | VERIFIED | requireRole(['admin']) |
| `app/[lang]/(admin)/coach-assignment/coach-reassign.tsx` | Agent/coach selectors + neutral-primary AlertDialog | VERIFIED | Present |
| `app/[lang]/(coach)/agents/page.tsx` | Coach/admin index at /[lang]/agents; read-only DENIED | VERIFIED | requireRole(['admin','senior-coach']); reuses getDownline |
| `app/[lang]/(coach)/agents/agent-list.tsx` | Table with Link rows to agents/[uid] | VERIFIED | Present |
| `app/[lang]/(coach)/agents/[uid]/page.tsx` | Read-only profile drill-in (coach/admin gated) | VERIFIED | requireRole(['admin','senior-coach']); no journey-edit |
| `app/[lang]/(coach)/agents/[uid]/record-first-close.tsx` | Idempotent close action island | VERIFIED | Present |
| `app/[lang]/(coach)/agents/actions.ts` | recordFirstClose idempotent + audited | VERIFIED | Idempotency guard at line 112-113 |
| `src/dashboard/queries.ts` | getAgentProfile (audit-before-read) + daysToFirstClose + aggregateDaysToFirstClose + getOrgDaysToFirstClose + NotInDownlineError | VERIFIED | All present; createTime used for onboardingStart (never lastActiveAt) |
| `app/[lang]/(admin)/conversations/actions.ts` | flagConversation content-free write added | VERIFIED | Lines 224+: content-free, Admin-SDK write, denormalized seniorCoachId stamped |
| `app/[lang]/(coach)/flags/actions.ts` | listFlags + reviewFlag + dismissFlag | VERIFIED | Present; bounded; audited |
| `app/[lang]/(coach)/flags/page.tsx` | Coach/admin gated flag queue | VERIFIED | requireRole(['admin','senior-coach']) |
| `app/[lang]/(coach)/flags/flag-queue.tsx` | Table + status Badges + review/dismiss + deep-link | VERIFIED | Present |
| `app/[lang]/(admin)/audit-log/actions.ts` | listAuditLogs bounded + no self-audit | VERIFIED | limit(50); no auditDrilldown import |
| `app/[lang]/(admin)/audit-log/page.tsx` | Admin-only RSC gate | VERIFIED | requireRole(['admin']) |
| `app/[lang]/(admin)/audit-log/audit-log-viewer.tsx` | Table + filter toolbar + Load more | VERIFIED | Present |
| `app/[lang]/(admin)/model-config/actions.ts` | publishModelConfig ETag-safe + readModelConfig | VERIFIED | getTemplate(); publishTemplate without force:true; conflict handling |
| `app/[lang]/(admin)/model-config/page.tsx` | Admin-only RSC gate | VERIFIED | requireRole(['admin']) |
| `app/[lang]/(admin)/model-config/model-config-form.tsx` | Per-pillar cards + neutral-primary publish confirm | VERIFIED | Present |
| `app/[lang]/(admin)/pdpa-settings/page.tsx` | Static admin-only PDPA display + erasure link | VERIFIED | requireRole(['admin']); renders policy-constants; no editable inputs |
| `src/pdpa/policy-constants.ts` | 5 policy-fixed values (asia-southeast1, etc.) | VERIFIED | Present; PDPA_ERASURE_ROUTE constant |
| `app/[lang]/_components/app-sidebar-nav.ts` | 8 new NavItemKey entries; read-only excluded from all | VERIFIED | Lines 64-72 (keys) + 132-177 (items in buildSections); no 'read-only' in any new item |
| `src/i18n/messages/en.json` | All Phase-7 nav + surface strings | VERIFIED | 23 namespaces; all 7 new surface namespaces present |
| `src/i18n/messages/ms.json` | BM parity | VERIFIED (machine-draft, native sign-off pending) | Parity gate GREEN; _note/_review markers signal pending native review |
| `src/i18n/messages/zh.json` | 中文 parity | VERIFIED (machine-draft, native sign-off pending) | Parity gate GREEN; _note/_review markers signal pending native review |
| `app/[lang]/(admin)/usage/usage-dashboard.tsx` | days-to-first-close avg/median/count tile | VERIFIED | daysToFirstClose prop rendered; em-dash when no close |
| `app/[lang]/(admin)/usage/page.tsx` | getOrgDaysToFirstClose wired | VERIFIED | Imports and calls getOrgDaysToFirstClose; passes to dashboard |
| `scripts/ci-guards.test.ts` | 6 invariant guards | VERIFIED | 6/6 GREEN in live run |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app-sidebar-nav.ts` agentProfiles href `/[lang]/agents` | `app/[lang]/(coach)/agents/page.tsx` | Next.js route resolution | VERIFIED | Index route exists under (coach) group; NAV-01 href resolves |
| `app/[lang]/(coach)/agents/[uid]/page.tsx` | `src/dashboard/queries.ts getAgentProfile` | Server Component call with requireRole(['admin','senior-coach']) | VERIFIED | Import + call present; requireRole gate enforced |
| `src/dashboard/queries.ts getAgentProfile` | `auditDrilldown(coachUid,'agentProfiles')` | audit-before-read (PROF-02) | VERIFIED | Called at line 317 before the doc read; ordering asserted by test |
| `app/[lang]/(admin)/conversations/actions.ts flagConversation` | `conversationFlagsRef()` + `agentProfiles.seniorCoachId` lookup | Admin-SDK write with denormalized seniorCoachId | VERIFIED | Resolves ownerUid → agentProfile → seniorCoachId → stamps on flag |
| `app/[lang]/(coach)/flags/page.tsx` | existing `/[lang]/conversations` audited viewer | deep-link by conversationId (D-10) | VERIFIED | flag-queue.tsx renders link using conversationId; no content on flag |
| `app/[lang]/(admin)/model-config/actions.ts publishModelConfig` | `firebase-admin/remote-config getTemplate + publishTemplate` | ETag optimistic concurrency (no force), same backend as modelFor read | VERIFIED | getTemplate() → mutate → publishTemplate(template) without force:true |
| `app/[lang]/(admin)/audit-log/actions.ts listAuditLogs` | auditLogs collection (admin-read rule, existing) | orderBy('ts','desc').limit(50) bounded cursor | VERIFIED | adminDb.collection('auditLogs'); limit(50); no self-audit |
| `app/[lang]/(admin)/usage/usage-dashboard.tsx` | `src/dashboard/queries.ts daysToFirstClose` | Analytics aggregate tile via getOrgDaysToFirstClose | VERIFIED | usage/page.tsx imports getOrgDaysToFirstClose; passes to usage-dashboard.tsx |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `agents/[uid]/page.tsx` | `profile` | `getAgentProfile()` → agentProfiles Firestore doc + usageRollups + escalations/knowledgeGaps counts | Yes — live Firestore reads | FLOWING |
| `flags/page.tsx` | `flags` | `listFlags()` → conversationFlagsRef().where().limit(50) | Yes — Firestore Admin SDK query | FLOWING |
| `audit-log-viewer.tsx` | `rows` | `listAuditLogs()` → adminDb.collection('auditLogs').orderBy.limit(50) | Yes — Firestore Admin SDK query | FLOWING |
| `model-config-form.tsx` | `configs` | `readModelConfig()` → getServerTemplate().evaluate().getString() per pillar | Yes — Remote Config server template | FLOWING |
| `pdpa-settings/page.tsx` | `PDPA_POLICY` | `src/pdpa/policy-constants.ts` constant | Static constants (by design — D-18) | FLOWING (static by design) |
| `usage-dashboard.tsx` | `daysToFirstClose` | `getOrgDaysToFirstClose()` → agentProfiles collection read → aggregateDaysToFirstClose | Yes — Firestore Admin SDK query | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `npx tsc --noEmit` | Exit 0 (no output) | PASS |
| CI guard suite (6 guards) | `npx vitest run scripts/ci-guards.test.ts` | 6 passed (1 file) | PASS |
| i18n parity (EN/BM/中文) | `npx vitest run src/i18n/__tests__/i18n-parity.test.ts` | 6 passed (1 file) | PASS |
| Nav test (8 items + read-only blindness) | `npx vitest run` (full suite, reading app-sidebar-nav results) | 8/8 Phase-7 nav specs GREEN | PASS |
| Full test suite | `npx vitest run` | 639 passed, 186 skipped (emulator-gated rules), 0 failed | PASS |
| ASSIGN-01 atomic dual-write contract | `vitest` (coach-assignment/actions.test.ts) | 4/4 GREEN | PASS |
| AUDIT-01 bounded/no-self-audit contract | `vitest` (audit-log/actions.test.ts) | 5/5 GREEN | PASS |
| MODEL-02 ETag/no-force/conflict contract | `vitest` (model-config/actions.test.ts) | 6/6 GREEN | PASS |
| CLOSE-01 idempotency contract | `vitest` (agents/actions.test.ts) | 4/4 GREEN | PASS |
| PROF-02 audit-before-read + downline gate | `vitest` (dashboard/queries.test.ts) | 4/4 GREEN | PASS |

---

### Probe Execution

No probe scripts declared or found under `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no conventional probes).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COH-01 | 07-02 | cohorts collection (converter + ref + rules + rules-test) | SATISFIED | cohortsRef() Collection 21; firestore.rules /cohorts block; 171/171 rules tests |
| COH-02 | 07-01/07-02 | cohortId? optional on AgentProfileDoc; where('cohortId','==',cid) filtering | SATISFIED | collections.ts line 92; queries.ts line 460 (getOrgDaysToFirstClose opts.cohortId filter); TypeScript type test GREEN. Note: REQUIREMENTS.md shows `- [ ]` (unchecked) — this is a documentation tracking oversight, not a code gap. The field and filtering are both present in code. |
| COH-03 | 07-03 | Admin-only audited cohort CRUD; read-only DENIED | SATISFIED | cohorts/actions.ts admin gate + audit; cohorts/page.tsx requireRole(['admin']) |
| PROF-01 | 07-03 | Read-only agent profile; no journey-edit affordance | SATISFIED | agents/[uid]/page.tsx; ci-guard 5 GREEN; no journey-state mutation anywhere on profile route |
| PROF-02 | 07-03 | auditDrilldown before read; downline-gated; read-only DENIED | SATISFIED | queries.ts line 317; NotInDownlineError; queries.test.ts 4/4 |
| ASSIGN-01 | 07-03 | Admin-only atomic dual-write of seniorCoachId + uplineCoachId | SATISFIED | coach-assignment/actions.ts adminDb.batch(); actions.test.ts 4/4 |
| ASSIGN-02 | 07-03 | Historical denorm NOT backfilled on reassign (documented) | SATISFIED | D-08 comment in actions.ts; no backfill code path |
| FLAG-01 | 07-02 | conversationFlags collection (converter + ref + rules + rules-test; content-free) | SATISFIED | conversationFlagsRef() Collection 22; ConversationFlagDoc has no content field; firestore.rules /conversationFlags block |
| FLAG-02 | 07-04 | Manual flag write (content-free, denormalized seniorCoachId, Admin-SDK, audited) | SATISFIED | conversations/actions.ts flagConversation; D-10 enforced; D-11 (manual only) |
| FLAG-03 | 07-04 | Bounded scoped flag queue; read-only DENIED; deep-links to existing viewer | SATISFIED | flags/actions.ts limit(50); flags/page.tsx requireRole(['admin','senior-coach']) |
| AUDIT-01 | 07-05 | Admin-only bounded audit-log viewer; hashes not decoded; no self-audit | SATISFIED | audit-log/actions.ts; no auditDrilldown import; actions.test.ts 5/5 |
| MODEL-01 | 07-05 | Read 5 model.{pillar}.default from Remote Config | SATISFIED | model-config/actions.ts readModelConfig() |
| MODEL-02 | 07-05 | Write via ETag-safe publishTemplate without force:true; admin-only; audited | SATISFIED | model-config/actions.ts publishModelConfig(); actions.test.ts 6/6; ci-guard 4 GREEN |
| PDPA-01 | 07-05 | Static admin-only PDPA display from policy-constants + erasure link; zero knobs | SATISFIED | pdpa/policy-constants.ts; pdpa-settings/page.tsx requireRole(['admin']); no form inputs |
| CLOSE-01 | 07-03 | firstCloseAt field + idempotent audited recordFirstClose action | SATISFIED | collections.ts line 100; agents/actions.ts idempotency guard; actions.test.ts 4/4 |
| CLOSE-02 | 07-03/07-06 | days-to-first-close = firstCloseAt − snapshot.createTime; per-agent + org aggregate tile | SATISFIED | queries.ts daysToFirstClose (createTime confirmed line 350); usage-dashboard.tsx tile |
| NAV-01 | 07-06 | 8 role-filtered nav entries; read-only sees none | SATISFIED | app-sidebar-nav.ts; nav test 8/8 GREEN |
| I18N-07 | 07-06 | All new strings in EN/BM/中文; i18n-parity.test.ts GREEN | SATISFIED | i18n-parity.test.ts 6/6 GREEN; _note/_review are metadata markers excluded from parity check |

**Requirements: 18/18 SATISFIED** (COH-02 REQUIREMENTS.md checkbox unchecked is a documentation tracking bug — the implementation is present and tested)

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/i18n/messages/ms.json` | top-level | `_note`, `_review` meta keys present (machine-assisted draft markers) | INFO | Expected — signals pending native BM sign-off; not a UI string; excluded from i18n-parity check |
| `src/i18n/messages/zh.json` | top-level | `_note`, `_review` meta keys present | INFO | Expected — signals pending native 中文 sign-off |
| `.planning/REQUIREMENTS.md` | line 167 | COH-02 checkbox `- [ ]` (unchecked) despite implementation existing | INFO | Documentation tracking oversight only; code evidence confirms the field and filtering are present |

No TBD/FIXME/XXX debt markers in Phase-7 source files. No hard-coded model IDs (ci-guard 1 GREEN). No src/→app/ imports in production code (ci-guard 2 GREEN). No read-only grants in new rule blocks (ci-guard 3 GREEN). No {force:true} publish (ci-guard 4 GREEN). No journey-edit symbols on the agent-profile route (ci-guard 5 GREEN).

---

### Human Verification Required

#### 1. Deploy Firestore Rules + Indexes (07-02 live-gate)

**Test:** Run `firebase deploy --only firestore:rules,firestore:indexes` against the Asia-Southeast1 project; confirm with Derek on region before deploying.
**Expected:** Deploy completes; Firebase console → Firestore → Indexes shows all 4 new composite indexes at status "Enabled" (not "Building"): `conversationFlags (seniorCoachId,status)`, `conversationFlags (status,createdAt)`, `auditLogs (action,ts)`, `auditLogs (actorUid,ts)`. Also confirm the cohorts + conversationFlags rule blocks are visible in the Firebase console Rules tab.
**Why human:** Live Firebase credentials required; composite index build is async (Firestore throws FAILED_PRECONDITION until an index reaches "Enabled" status).

#### 2. Remote Config Publish IAM + End-to-End Model Swap (07-05 live-gate)

**Test:** In Google Cloud IAM, confirm the App Hosting service account has `firebaseremoteconfig.remoteConfig.update`. Then visit the admin model-config UI, change a pillar's model ID, confirm the publish dialog, and trigger a chat turn that uses that pillar.
**Expected:** The publish succeeds (no permission error); `modelFor('coach')` (or the changed pillar) returns the new model ID on the next chat turn (allow for propagation latency — the UI shows "may take a moment to take effect"). A concurrent publish scenario should surface the conflict message, not a silent overwrite.
**Why human:** Requires GCP IAM console access and a deployed environment; live Remote Config propagation cannot be verified by code inspection.

#### 3. BM / 中文 Native Copy Sign-off

**Test:** Have a native BM speaker review `src/i18n/messages/ms.json` and a native Mandarin speaker review `src/i18n/messages/zh.json`, focusing on the Phase-7 surface namespaces (`adminCohorts`, `adminCoachAssignment`, `agentsIndex`, `agentProfile`, `flagQueue`, `adminModelConfig`, `adminAuditLog`, `adminPdpa`) and the 8 new nav keys.
**Expected:** Native reviewers confirm the copy is natural, correct, and appropriate for a professional real-estate agent coaching platform. The `_review: native-review-pending` markers in both catalogs should be updated to `_review: approved` after sign-off.
**Why human:** Translation quality cannot be assessed programmatically; the machine-assisted draft is structurally correct (parity GREEN) but may contain unnatural phrasing.

#### 4. Browser: Read-Only Role Denied on All 8 Phase-7 Surfaces

**Test:** Log in with a read-only role account. Attempt to navigate to `/cohorts`, `/coach-assignment`, `/agents`, `/agents/[uid]`, `/flags`, `/audit-log`, `/model-config`, `/pdpa-settings`. Verify the sidebar shows none of the 8 nav items.
**Expected:** Each direct URL navigation results in a redirect (not a 404, not the surface content). The sidebar shows Home, Knowledge Management (kb viewer), and Analytics (usage) only — the three read-only-visible surfaces from Phase 6. No Phase-7 surface is accessible.
**Why human:** Server-side redirect behavior (requireRole fallback) and sidebar rendering require a running application with an authenticated session.

#### 5. Browser: Senior-Coach Scope Enforcement

**Test:** Log in as a senior-coach. Verify: (a) agentProfiles and flags appear in the nav but not cohorts/coachAssignment/auditLog/modelConfig/pdpaSettings/daysToFirstClose; (b) navigating to `/agents/[uid]` for a non-downline agent is denied; (c) the flag queue shows only own-downline flags; (d) `/cohorts` and `/coach-assignment` redirect.
**Expected:** Role-scoped data isolation holds across all surfaces — a coach cannot see or reach admin-only content, and cannot see another coach's data.
**Why human:** Requires a live environment with multiple agents assigned to different coaches to verify cross-coach isolation end-to-end.

#### 6. Admin End-to-End: Publish Model-Config + ETag Conflict

**Test:** Two admin tabs simultaneously read the model-config page. Tab A publishes a change. Tab B (without reloading) attempts to publish a different change. Verify Tab B receives the conflict error copy ("Template changed — reload and retry.") and the change is not silently applied.
**Expected:** The ETag optimistic-concurrency path is exercised; Tab B's publish is blocked (no blind overwrite); Tab B can reload, see Tab A's published value, and then publish successfully.
**Why human:** Concurrent publish race requires two live sessions and cannot be simulated without a deployed Remote Config environment.

---

### Gaps Summary

**No code gaps found.** All 18 REQ-IDs are implemented and tested. The following items are correctly classified as live-gated rollout actions (not code gaps), consistent with the Phase 1-6 precedent:

1. **07-02 deploy checkpoint** — `firebase deploy --only firestore:rules,firestore:indexes` + composite index build. The rules and indexes are code-complete and tested against the local emulator (171/171 GREEN). This requires a human action with live Firebase credentials.
2. **07-05 RC-publish IAM** — App Hosting SA `firebaseremoteconfig.remoteConfig.update` grant + live end-to-end model swap verification. The publish path is code-complete and unit-tested (ETag/no-force/conflict 6/6 GREEN). This requires GCP IAM configuration.
3. **BM/中文 native sign-off** — Trilingual parity is programmatically enforced (i18n-parity.test.ts 6/6 GREEN). The machine-assisted translations are structurally correct. Production readiness requires human native-language review.

The REQUIREMENTS.md COH-02 unchecked checkbox (`- [ ]`) is a documentation tracking oversight. The implementation is present: `AgentProfileDoc.cohortId?` at `src/firebase/collections.ts:92` and `where('cohortId','==',cid)` filtering at `src/dashboard/queries.ts:460`. This does not represent a code gap.

---

_Verified: 2026-06-11T15:05:00Z_
_Verifier: Claude (gsd-verifier)_
