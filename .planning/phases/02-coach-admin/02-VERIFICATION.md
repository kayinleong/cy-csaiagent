---
phase: 02-coach-admin
verified: 2026-06-02T21:05:00Z
status: human_needed
score: 5/5 success criteria code-complete (the markSuperseded gap was CLOSED post-verification); all 5 await live-stack proof
overrides_applied: 0
gap_resolution: "2026-06-02 (commit fdb1199) — the markSuperseded wiring gap below is CLOSED. supersedesId is now threaded KbIngestionJobDoc + IngestFile → updateDoc/updateDocFromFile/correctKbDoc pass the old docId → shardJob stores it → processBatch retires the old doc + chunks to 'superseded' on remaining===0 (inlined to avoid the crud<-pipeline circular import). tsc clean, 325 vitest pass. Follow-up: a processBatch-supersede integration test (markSuperseded unit logic is covered by kb.test.ts Test 6; wiring is tsc+grep-verified). The gaps block below is retained for the audit record but is RESOLVED."
gaps:
  - truth: "Publishing a new KB version marks the superseded doc's chunks 'superseded' so the Coach cannot cite both old and corrected content."
    status: partial
    reason: "markSuperseded() is implemented and tested in src/kb/crud.ts but is NEVER called at ingest-completion. The /api/kb/ingest/process route handler calls only processBatch(); the job doc (KbIngestionJobDoc) does not store supersedesId; processBatch() has no markSuperseded call. The 02-02-SUMMARY correctly documented this as '02-06/02-08 responsibility' but those plans also did not wire the call. The 02-08-SUMMARY incorrectly claims the cascade 'fires on ingest completion (existing pipeline path)' — it does not. Effect: after updateDoc/correctKbDoc, old kbChunks retain status:'published' and remain retrievable simultaneously with new chunks until manual intervention."
    artifacts:
      - path: "src/kb/ingest/pipeline.ts"
        issue: "processBatch() at lines 218-236 (when remaining===0) does not call markSuperseded; KbIngestionJobDoc schema has no supersedesId field"
      - path: "app/api/kb/ingest/process/route.ts"
        issue: "handleIngest() calls only processBatch(); never imports or invokes markSuperseded"
    missing:
      - "Add supersedesId?: string to KbIngestionJobDoc in src/firebase/collections.ts"
      - "In updateDoc / updateDocFromFile / correctKbDoc (crud.ts), pass supersedesId to shardJob so it is stored in the job doc"
      - "In processBatch() pipeline.ts when remaining===0, read job.supersedesId; if present call markSuperseded(supersedesId, docId)"
human_verification:
  - test: "SC1: Live mobile chat — D2-grounded cited answers on phone over 4G"
    expected: "Pilot agent asks a training question and receives a cited, non-generic answer in EN/BM/中文 with streaming tokens on a mobile browser"
    why_human: "Requires live Firebase App Hosting deploy + real mobile network (SPIKE-DEPLOY gate)"
  - test: "SC2: AI disclosure modal renders and blocks input; 'talk to my coach' handoff fires with context"
    expected: "Modal appears before first message; after ack the AI badge is visible; tapping handoff creates an escalation row visible to the senior coach"
    why_human: "Browser rendering and Firestore write visibility require live stack"
  - test: "SC3: 2-day stall → nudge in coach thread; 48h → stall alert on dashboard"
    expected: "Idle agent's coach thread receives exactly one nudge message; dashboard stall inbox shows the escalation during KL working hours"
    why_human: "Requires on-visit lazy-cron to trigger with real Firestore data and KL time zone"
  - test: "SC4: Derek edits KB, old content stops being retrievable; new content is cited by Coach"
    expected: "After Derek publishes a corrected doc, the Coach retrieves only the new chunk and never cites the old one"
    why_human: "Requires live ingest (SPIKE-INGEST gate) AND the markSuperseded wiring gap to be closed first (see gaps section)"
  - test: "SC5: Senior coach UI — downline table, stall inbox, gap feed, correction dialog render correctly in browser"
    expected: "Dashboard loads with coach's downline; recharts funnel/ramp charts display; inline correction dialog submits and shows 'Correction published' toast"
    why_human: "recharts client-side rendering and real Firestore data require live deploy"
  - test: "QUAL-06: Live Promptfoo eval run + Opus judge calibration (>85% human agreement)"
    expected: "npm run eval completes all three gold suites in EN/BM/ZH; Derek + a senior coach independently score a sample; agreement >= 85% recorded in CALIBRATION.md"
    why_human: "Requires ANTHROPIC_API_KEY + JUDGE_MODEL configured in Remote Config (model.grader.default); human raters Derek + coach must participate"
  - test: "COACH-10: 5-10 agent pilot provisioned via set-claims"
    expected: "set-claims script assigns senior-coach + new-agent roles with correct seniorCoachId relationships; agents appear in coach's downline table"
    why_human: "Operational provisioning step on live Firebase project; no code artifact to verify offline"
  - test: "Playwright e2e: disclosure, coach dashboard cross-coach denial, KB edit retrieval"
    expected: "e2e/disclosure.spec.ts, e2e/coach-dashboard.spec.ts pass against live deploy"
    why_human: "Playwright specs are scaffolded but skip when TEST_BASE_URL is unset; require live stack"
---

# Phase 2: Coach + Admin v1 Verification Report

**Phase Goal:** A new agent is coached end-to-end by a D2-grounded Coach (onboarding tracked, stalls escalated, AI disclosed, handoff available) while Derek manages the KB and a senior coach watches their downline — shipped to a 5–10 agent pilot.
**Verified:** 2026-06-02T21:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Quality Gates (Run Offline)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | CLEAN — 0 errors |
| `npx vitest run` | 325 pass, 87 skip (emulator/live-gated), 0 fail |
| `npm run lint` | 0 errors (39 warnings, unused var prefixed with `_`) |

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pilot agent gets D2-grounded cited answers on mobile in EN/BM/中文 with auto-detect | HUMAN NEEDED | Chat route wired (ensurePrimaryThread, langOverride, extractCitationChunkIds) + trilingual i18n keys present in all 3 catalogs; live mobile streaming requires SPIKE-DEPLOY gate |
| 2 | AI disclosure + "talk to my coach" handoff with context + KB-miss auto-escalates | HUMAN NEEDED | disclosure-modal.tsx + disclosureAckAt Server Action + emitHandoffSignal in requestHandoff() all implemented and wired; browser rendering requires live deploy |
| 3 | 2-day stall → proactive nudge; 48h → auto-escalate visible on coach dashboard | HUMAN NEEDED | stall-detect nudge body (cadence-capped via loadRecent) + escalate body (48h + isWithinWorkingHours gate) implemented in runDueJobs.ts; lazy-cron fires on visit, not wall-clock (D-09 accepted) |
| 4 | Derek creates/edits/versions KB in plain language, no engineer, retrievable by Coach | PARTIAL | Admin KB UI wired end-to-end (list, publish, edit, version history, re-ingest poll); markSuperseded() is NOT called at ingest-completion — old chunks stay 'published' after a version update (see gaps) |
| 5 | Senior coach signs in, sees only their downline's stage + questions, corrects AI inline | HUMAN NEEDED | Dashboard RSC + 5 panels implemented; downline queries double-gated (server query filter + Firestore rules); inline-correction-dialog wired to correctKbDoc + re-ingest poll; recharts chart rendering requires live deploy |

**Score:** 0/5 truths fully verified offline (all have live-stack or gap dependencies; 4/5 are code-complete pending live deploy; 1/5 has a code gap)

### Deferred Items

None. All 5 success criteria are targeted at Phase 2; none are deferred to later phases.

## Required Artifacts

All 43 expected Phase 2 source artifacts verified to exist:

| Artifact Group | Status | Key Files |
|----------------|--------|-----------|
| Data foundation (02-01) | VERIFIED | collections.ts (knowledgeGapsRef, KnowledgeGapDoc, KB status fields), firestore.rules (/knowledgeGaps block), firestore.indexes.json (lang+status+embedding + knowledgeGaps indexes) |
| Published-only retrieval (02-02) | VERIFIED (with gap) | search.ts (where status==published), pinecone.ts (metadata filter), pipeline.ts (status:'published' on write), crud.ts (publishDoc/unpublishDoc/markSuperseded/correctKbDoc) |
| Chat surface (02-03) | VERIFIED | conversation.ts (ensurePrimaryThread/listConversations), route.ts (stable cid, citations, langOverride), disclosure-modal.tsx, chat-header.tsx, conversation-list.tsx, _actions/chat.ts |
| Journey state machine (02-04) | VERIFIED | coach/journey/config.ts (D2_JOURNEY), transition.ts (nextCheckpoint/advance/commitAdvance), comprehension.ts (gradeParaphrase), coach/prompt.ts (buildCoachSystemPrompt with journey section), coach/tools.ts (read-only getCurrentCheckpoint/getCheckpointContent) |
| Lazy-cron jobs (02-05) | VERIFIED | workingHours.ts (isWithinWorkingHours), runDueJobs.ts (stall-nudge + 48h-escalate + eval-nightly seam), knowledgeGaps.ts (recordKnowledgeGap PDPA-safe), runNightly.ts (runNightlyEval body with offline-skip guard) |
| Coach dashboard (02-06) | VERIFIED | queries.ts (downline-scoped + auditDrilldown), metrics.ts (daysInJourney/checkpointVelocity/trainingFunnel, no lead/close), dashboard/page.tsx (RSC role gate), all 5 client panels, inline-correction-dialog.tsx |
| Eval suite (02-07) | VERIFIED (calibration deferred) | judge.ts (6-domain rubric incl. hallucination+toneDrift), 3 trilingual gold sets (EN/MS/ZH each), promptfooconfig.yaml, CALIBRATION.md (v2.0, pending live sign-off) |
| Admin KB UI (02-08) | VERIFIED (with gap) | kb-doc-list.tsx (status badges), publish-toggle.tsx, [docId]/page.tsx (version lineage), actions.ts (publish/unpublish Server Actions), kb-doc-form.tsx (edit mode re-ingest poll) |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| sign-in-form.tsx | /${lang}/dashboard | role from /api/auth/session verifyIdToken response | WIRED | Lines 84-94 in sign-in-form.tsx; role stamped from verified token (T-02-02) |
| firestore.rules /knowledgeGaps | request.auth.uid | resource.data.seniorCoachId == request.auth.uid && sameTenant() | WIRED | Line 231 in firestore.rules; cross-coach denied test at rules.test.ts:748 |
| chat-input.tsx | /api/chat | POST {messages, cid, langOverride} | WIRED | langOverride passed to POST body; ensurePrimaryThread produces stable cid |
| route.ts onFinish | conversations/{cid}/messages | appendMessage(user) + appendMessage(assistant with citations) | WIRED | extractCitationChunkIds + two appendMessage calls in onFinish |
| chat-header.tsx Talk-to-my-coach | escalations | Server Action requestHandoff → emitHandoffSignal with no-PII contextBundle | WIRED | app/_actions/chat.ts:124 |
| rag/search.ts firestoreRetrieve | kbChunks | where('status','==','published') + where('lang','in',...) + findNearest | WIRED | search.ts:100 |
| dashboard/page.tsx | queries.ts getDownline | server-side where('seniorCoachId','==',coach.uid) | WIRED | queries.ts:86+106; auditDrilldown called on each read |
| inline-correction-dialog.tsx | crud.ts correctKbDoc | Server Action submitCorrection → correctKbDoc → /api/kb/ingest/process poll | WIRED | actions.ts:28+105; dialog polls at line 81 |
| updateDoc/correctKbDoc | old kbChunks | markSuperseded(oldDocId, newDocId) at ingest-completion | NOT WIRED | markSuperseded() is defined but never called; no caller in pipeline.ts processBatch or ingest/process route; job doc schema has no supersedesId field |
| runDueJobs.ts eval-nightly | runNightly.ts runNightlyEval() | delegation with writeHeartbeat | WIRED | runDueJobs.ts imports + calls runNightlyEval; offline-skip guard in runNightly.ts |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| downline-table.tsx | downline[] prop | getDownline(coachUid) → agentProfilesRef().where(seniorCoachId) | Yes (real Firestore query) | FLOWING |
| stall-inbox.tsx | stalls[] prop | getOpenStalls(coachUid) → escalationsRef().where(seniorCoachId).where(status,'open') | Yes | FLOWING |
| knowledge-gap-feed.tsx | gaps[] prop | getKnowledgeGaps(coachUid) → knowledgeGapsRef().where(seniorCoachId).orderBy(lastSeenAt) | Yes | FLOWING |
| conversation-list.tsx | threads | getDocs(conversationsRef().where(ownerUid)) | Yes | FLOWING |
| metrics-panel.tsx | funnelData / rampData | trainingFunnel + checkpointVelocity (pure functions over downline prop) | Yes | FLOWING |
| rag/search.ts | chunks | kbChunks.where(status,'published').where(lang,...).findNearest(...) | Yes (with note: old superseded chunks not filtered until markSuperseded is wired) | PARTIAL |

## Behavioral Spot-Checks

| Behavior | Result | Status |
|----------|--------|--------|
| `npx tsc --noEmit` | 0 errors | PASS |
| `npx vitest run` (325 tests across 24 suites) | 325 pass, 87 skip | PASS |
| `npm run lint` | 0 errors | PASS |
| All 43 expected Phase 2 source artifacts exist | 43/43 FOUND | PASS |
| markSuperseded() called at ingest-completion | NOT FOUND in pipeline.ts or route handler | FAIL |
| No hard-coded model IDs in coach or eval code | Confirmed (test mock only) | PASS |
| No lead/close metrics in dashboard metrics.ts | Confirmed (scope docs say Phase 3) | PASS |
| PDPA: pseudonymize gate in route.ts | Found (assertRedacted at line 189) | PASS |
| No raw query in knowledgeGaps store | topicLabel capped at 120 chars; test asserts no verbatim storage | PASS |

## Requirements Coverage

All 31 Phase 2 requirement IDs are claimed across the 8 plans with no orphans.

| Req ID | Plan(s) | Code Evidence | Status |
|--------|---------|---------------|--------|
| AUTH-02 | 02-01 | sign-in-form.tsx redirects senior-coach→dashboard | SATISFIED |
| AUTH-03 | 02-01 | sign-in-form.tsx redirects admin→kb | SATISFIED |
| AUTH-06 | 02-01, 02-06 | firestore.rules + queries.ts double-gate; cross-coach rules test | SATISFIED |
| CHAT-01 | 02-03 | h-[100dvh] layout preserved; chat-shell.tsx mobile-first | HUMAN NEEDED (live phone) |
| CHAT-02 | 02-03 | ensurePrimaryThread + loadRecent; conversation persists across cid | SATISFIED |
| CHAT-03 | 02-03 | router/heuristic.ts always→coach; LLM classifier dormant | SATISFIED |
| CHAT-04 | 02-03 | toUIMessageStreamResponse() unchanged; SSE headers preserved | HUMAN NEEDED (live stream) |
| CHAT-05 | 02-03 | disclosure-modal.tsx blocks until ack; AI badge in chat-header.tsx | HUMAN NEEDED (browser render) |
| CHAT-06 | 02-03 | requestHandoff Server Action → emitHandoffSignal with no-PII bundle | HUMAN NEEDED (live Firestore) |
| CHAT-07 | 02-03 | conversation-list.tsx with searchConversations() | HUMAN NEEDED (browser render) |
| CHAT-08 | 02-03 | langOverride in route.ts + ToggleGroup chip in chat-header.tsx | SATISFIED |
| COACH-01 | 02-04 | D2_JOURNEY config: day-one-pairing first checkpoint; day-one-pairing kbDocIds | SATISFIED |
| COACH-02 | 02-04 | grounding mandate in buildCoachSystemPrompt; cite [KB:chunk-id]; no invent | SATISFIED |
| COACH-03 | 02-04 | journeyStage/currentCheckpoint tracked in agentProfiles; transition.ts | SATISFIED |
| COACH-04 | 02-05 | stall-detect nudge: appendMessage(routeDecision:'nudge') cadence-capped | HUMAN NEEDED (on-visit timing) |
| COACH-05 | 02-05 | escalate: findStalled 48h + isWithinWorkingHours + emitHandoffSignal | HUMAN NEEDED (on-visit timing) |
| COACH-06 | 02-04 | KB-miss → emitHandoffSignal in tool; handoff never invents | SATISFIED |
| COACH-07 | 02-04 | first-Meta-ad walkthrough checkpoint in D2_JOURNEY + getCheckpointContent tool | SATISFIED |
| COACH-08 | 02-04 | channel-playbooks checkpoint + KB-grounded conversational delivery | SATISFIED |
| COACH-09 | 02-04 | gradeParaphrase (no MCQ); injectable grader; threshold 0.78 | SATISFIED |
| COACH-10 | 02-06 | set-claims.ts provisions via --seniorCoachId; documented ops step | HUMAN NEEDED (ops provisioning) |
| CDASH-01 | 02-06 | downline-table.tsx shows stage/checkpoint/lastActive per agent | HUMAN NEEDED (browser render) |
| CDASH-02 | 02-06 | stall-inbox.tsx + resolveStall Server Action | HUMAN NEEDED (browser render) |
| CDASH-03 | 02-05, 02-06 | knowledgeGaps.ts records; knowledge-gap-feed.tsx displays | HUMAN NEEDED (browser render) |
| CDASH-04 | 02-02, 02-06 | correctKbDoc + inline-correction-dialog + re-ingest poll; markSuperseded NOT wired (see gaps) | PARTIAL (gap) |
| CDASH-05 | 02-06 | trainingFunnel + BarChart in metrics-panel.tsx (Phase 2 scope: training only) | HUMAN NEEDED (browser render) |
| CDASH-06 | 02-05 | isWithinWorkingHours(now) gates escalate job; KL 09:00-18:00 Mon-Fri | SATISFIED |
| CDASH-07 | 02-06 | checkpointVelocity + daysInJourney + LineChart in metrics-panel.tsx | HUMAN NEEDED (browser render) |
| ADMIN-01 | 02-08 | kb-doc-list.tsx + [docId]/page.tsx + publish-toggle; admin-only RSC gate | HUMAN NEEDED (browser render) |
| ADMIN-03 | 02-02, 02-08 | createDoc/updateDoc/deleteDoc/publishDoc/unpublishDoc all wired; supersede cascade NOT wired | PARTIAL (gap) |
| QUAL-06 | 02-07 | 6-domain rubric, 3 trilingual gold sets, promptfoo config; calibration pending live gate | HUMAN NEEDED (calibration) |

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/eval/runNightly.ts` | `runNightlyEval` is a no-op when JUDGE_MODEL unset | INFO | Intentional offline-skip guard; activates once JUDGE_MODEL is in Remote Config |
| `src/jobs/runDueJobs.ts:~210` | `usage-rollup` job body is a no-op | INFO | Phase 3 scope; unchanged from P1 |
| `src/kb/ingest/pipeline.ts:221-232` | processBatch() marks job complete but does not call markSuperseded | BLOCKER | Old kbChunks stay 'published' after a version update; Coach can retrieve stale content |

## Open Human / Live-Gated Items

### 1. SPIKE-DEPLOY: Live streaming on mobile (CHAT-01/04, SC1)

**Test:** Deploy to App Hosting asia-southeast1; open the chat surface on a real phone over a 4G mobile network; send a training question.
**Expected:** Tokens stream chunk-by-chunk; response is grounded with [KB:chunk-id] citations; no cold-start timeout.
**Why human:** SSE streaming behavior on a real mobile network cannot be verified offline.

### 2. Chat UI browser rendering (SC1, SC2, CHAT-05/06/07/08)

**Test:** Load the chat surface in a browser; verify disclosure modal blocks input; acknowledge; send a message; use the language chip; open conversation history drawer; tap "Talk to my coach."
**Expected:** All four components render; handoff creates an escalation; language override changes reply language.
**Why human:** React client islands (disclosure-modal, chat-header, conversation-list) require a live browser.

### 3. 2-day stall nudge + 48h escalation (COACH-04/05, CDASH-02/06, SC3)

**Test:** After deploy, mark an agent as lastActiveAt > 2 days ago in Firestore; visit the app as an authorized user to trigger the lazy-cron; verify a nudge appears in the agent's coach thread and an escalation row appears in the dashboard stall inbox.
**Expected:** Exactly one nudge (cadence-capped), and one stall escalation during KL working hours.
**Why human:** Lazy-cron fires on visit; Firestore state manipulation requires live project.

### 4. Admin KB flow: create, version, publish/unpublish (ADMIN-01/03, SC4) — AFTER markSuperseded gap is closed

**Test:** Sign in as admin; create a KB doc; publish it; edit it to create v2; observe the poll progress until remaining===0; verify the Coach retrieves only the v2 chunk.
**Expected:** v1 chunks are marked 'superseded'; v2 chunks are 'published'; retrieval returns only v2.
**Why human:** Requires live Firestore + Gemini embedding (SPIKE-INGEST gate) AND the markSuperseded wiring gap to be closed in code first.

### 5. Senior-coach dashboard browser rendering (CDASH-01..07, SC5)

**Test:** Sign in as a senior coach; verify the downline table, stall inbox, gap feed, and recharts charts all render; test the inline correction dialog.
**Expected:** All panels load with real data; recharts BarChart and LineChart display; correction dialog submits and the ingest poll completes.
**Why human:** recharts client-side rendering and real downline data require a live deploy.

### 6. QUAL-06 Opus judge calibration (QUAL-06, Phase 2→3 gate)

**Test:** After live stack is up, run `npm run eval` with JUDGE_MODEL configured in Remote Config; execute the human-calibration protocol in evals/CALIBRATION.md with Derek + a senior coach; record the agreement percentage.
**Expected:** All three gold suites (coach-training/journey/playbooks) run in EN/BM/ZH; judge-human agreement >= 85% across all 6 domains; result committed to CALIBRATION.md §10.
**Why human:** Requires Anthropic API key, Remote Config access, and human raters.

### 7. COACH-10: 5-10 agent pilot provisioning (COACH-10)

**Test:** Run `npx ts-node scripts/set-claims.ts <coachUid> senior-coach` and `npx ts-node scripts/set-claims.ts <agentUid> new-agent --seniorCoachId <coachUid>` for the pilot cohort.
**Expected:** Firebase Auth custom claims set correctly; agentProfiles docs created with correct seniorCoachId; agents appear in coach's downline table.
**Why human:** Operational step on live Firebase project; requires real UIDs.

## Gaps Summary

### Gap 1: markSuperseded is defined but never called (blocker for SC4, ADMIN-03, CDASH-04)

The `markSuperseded()` function in `src/kb/crud.ts` is well-implemented (sets old kbDoc + bulk-updates old kbChunks to status:'superseded') and is unit-tested. However, it has no call site in production code:

- `KbIngestionJobDoc` has no `supersedesId` field, so the ingest/process route cannot know which old doc to supersede
- `processBatch()` in `src/kb/ingest/pipeline.ts` does not import or call `markSuperseded`
- `app/api/kb/ingest/process/route.ts` does not import or call `markSuperseded`

The 02-02-SUMMARY correctly acknowledged this as "the 02-06/02-08 responsibility," but those plans shipped without completing the wiring. The 02-08-SUMMARY incorrectly states the cascade "fires on ingest completion (existing pipeline path)" — this is a factual error.

**Practical impact:** After Derek edits a KB doc, both the old version's chunks AND the new version's chunks are simultaneously retrievable (both have status:'published'). The Coach may cite stale content alongside corrected content. The same issue affects the inline-correction-dialog: it toasts "Correction published; previous version superseded" but the supersession never actually fires.

**Fix (3 steps):**
1. Add `supersedesId?: string` to `KbIngestionJobDoc` in `src/firebase/collections.ts`
2. In `updateDoc`, `updateDocFromFile`, and `correctKbDoc` in `src/kb/crud.ts`: pass `supersedesId: docId` into the `shardJob`/`shardJobForContent` call (requires shardJob to accept and store it in the job doc)
3. In `processBatch()` in `src/kb/ingest/pipeline.ts` when `remaining === 0`: read `jobData.supersedesId`; if present, call `markSuperseded(supersedesId, docId)` before returning

This is an offline-fixable code gap that should be resolved before the live ingest is tested.

---

_Verified: 2026-06-02T21:05:00Z_
_Verifier: Claude (gsd-verifier)_
