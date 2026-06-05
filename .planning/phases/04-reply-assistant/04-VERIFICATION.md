---
phase: 04-reply-assistant
verified: 2026-06-05T22:00:00Z
status: human_needed
score: 5/5 must-haves verified (code) — 0 code gaps; 5 live-gated human steps
overrides_applied: 0
human_verification:
  - test: "Deploy firestore.indexes.json (additive) and run the kbChunks.pillar backfill, then confirm reply-pillar findNearest returns only reply SOPs"
    expected: "Pillar-filtered retrieve(query, lang, { pillar:'reply' }) returns published reply chunks; existing chunks stamped pillar:'coach'; vector index built (no 'requires index' error)"
    why_human: "Requires `firebase deploy --only firestore:indexes,firestore:rules` and `npx tsx scripts/backfill-kb-chunks-pillar.ts` against the live project — cannot run from the verifier (no creds, no deploy). Consistent with Pitfall F flagged in 04-03-SUMMARY."
  - test: "Run the emulator-gated Firestore rules suite for replyEdits (deny-by-default + downline read)"
    expected: "agent reads only own rows; senior-coach reads downline via denormalized seniorCoachId; admin reads all; cross-tenant + client create/update/delete DENIED"
    why_human: "src/firebase/__tests__/rules.test.ts skips without FIRESTORE_EMULATOR_HOST. Run via `firebase emulators:exec --only firestore \"npm run test:rules\"`. Java/emulator not available offline."
  - test: "Run live promptfoo Reply evals (Opus judge) over the 3 trilingual gold sets"
    expected: "Reply rubric (groundedSop [SOP:doc-id], voiceMatch, qualifyingQuestions, noAutoPitch) scores ≥90% on EN gold; D2 voice not generic AI"
    why_human: "Requires a live Anthropic key + Remote Config JUDGE_MODEL + deployed reply SOPs. QUAL judge quality is a model-output assessment that cannot be verified by static checks."
  - test: "Browser click-through of the Reply draft card on a live seeded stack"
    expected: "Paste inbound → grounded draft renders with editable textarea + EXACTLY ONE Copy button; NO send/share/post affordance; after Copy → 'Copied — go send it from WhatsApp' (never 'sent'); thumbs-down marks pressed without any egress; no_sop_match shows refusal with no textarea/Copy"
    why_human: "e2e/reply-draft.spec.ts is skip-guarded behind E2E_BASE_URL (needs a live App Hosting deploy + seeded reply SOPs). Visual + interaction UX is human-verifiable only. The static structure is confirmed in code."
  - test: "Manual parallel-lead isolation check (no cross-lead bleed) on a live stack"
    expected: "Two parallel lead conversations produce drafts grounded only in their own leadContext.replySlot; lead-B draft never references lead-A content; a leadless Reply turn returns HTTP 400 before any model spend"
    why_human: "Per-lead isolation is structurally enforced (slot keyed by leadId, server 400 fail-closed verified in code + route test) but the end-to-end behavior under real concurrent use is a runtime/UX assertion best confirmed live."
---

# Phase 4: Reply Assistant + Reply Analytics Verification Report

**Phase Goal:** An agent can paste an incoming WhatsApp message and get a D2-voiced draft reply grounded in reply SOPs, edit it, and copy it to send themselves — never auto-sent — with edits captured as signals to refine the SOPs.
**Verified:** 2026-06-05T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Paste inbound → draft grounded in D2 reply SOPs (cold-prospect/objection/financing), D2 voice not generic, explicit edit-before-send UX, never auto-sent | ✓ VERIFIED (code) | `replyAgent.run` builds grounded draft citing real `[SOP:doc-id]`s (schema `sopDocIds: z.array(...).min(1)` — non-empty grounding mandate); cold-prospect branch uses qualifying questions not a pitch (index.ts:250-256); `reply-draft-card.tsx` renders editable Textarea + EXACTLY ONE `navigator.clipboard.writeText` Copy path; voice via `makeFetchVoiceSamplesTool` (curated org-voice doc). LIVE-GATED: D2-voice quality + visual edit-before-send UX (promptfoo + browser). |
| 2 | Drafts isolated per lead across parallel conversations (no cross-lead bleed); no-SOP-match flagged not hallucinated | ✓ VERIFIED (code) | `readReplySlot(leadId)` keyed by leadId (per-lead isolation, REPLY-03); route enforces required-leadId **400 BEFORE streamText** (route.ts:393-398, fail-closed); `retrieveReplySop` returns `{found:false, reason:'no_sop_match'}` on a miss and `buildOutputFromSopResult` emits a grounded `noSopMatch` refusal — never a fabricated draft (index.ts:194-220); route test asserts 400 + dispatch. LIVE-GATED: concurrent runtime bleed check. |
| 3 | Agent edits captured as a signal; edit-rate per SOP surfaces on a reply-quality dashboard | ✓ VERIFIED (code) | `editRatio` (dependency-free Levenshtein, src/reply/diff.ts); `captureReplyEdit` writes an append-only `replyEdits` row on EVERY Copy (denominator) via Admin SDK with denormalized `seniorCoachId`; `reply-quality-panel.tsx` (recharts) renders edit-rate per SOP / thumbs-down rate / top-edited SOP / escalation rate / drafts-per-agent; `getReplyQualityMetrics` uses read-time Firestore `count()` aggregation, role-scoped. LIVE-GATED: seeded dashboard render. |
| 4 | Reply Assistant reachable through the intent router alongside Coach + Finder — all three pillars active in one chat surface | ✓ VERIFIED (code) | `heuristicPillar` returns `'reply'` for structural signals checked BEFORE `FINDER_PATTERNS` (heuristic.ts:165-176, correct precedence); `classifyIntent` RouteSchema is ternary `['coach','finder','reply']` resolving model from `modelFor('router')` (no hard-code); route has a `pillar === 'reply'` dispatch arm; override chip widened to coach/finder/reply with invalid→undefined. |
| 5 | Reply SOPs manageable through the admin app; WABA graduation gate criteria documented (criteria only, not implemented) | ✓ VERIFIED (code) | `kb-doc-list.tsx` pillar filter (All/Coach/Reply) on `d.data.pillar`; `kb-doc-form.tsx` pillar enum includes `'reply'` + category field; `WABA-GATE.md` documents PROPOSED graduation criteria with ZERO WABA code ("No WhatsApp Business API integration, library, webhook, or scaffold exists in v1, and this document creates none"). |

**Score:** 5/5 success criteria verified in code. **0 code gaps.** Status is `human_needed` solely because of 5 deployment/runtime verification steps (below), consistent with prior phases.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/agents/reply/index.ts` | replyAgent frozen + offline run() | ✓ VERIFIED | `as const`; mirrors finder; XOR enforced; grounded refusal |
| `src/agents/reply/tools.ts` | read-only retrieveReplySop/fetchVoiceSamples/fetchLeadContext | ✓ VERIFIED | No `.set/.add/.update` in any execute; `pillar:'reply'` wired |
| `src/agents/reply/schema.ts` | ReplyOutputSchema | ✓ VERIFIED | `sopDocIds.min(1)` non-empty grounding; 3 optional branches |
| `src/memory/leadContext.ts` | ReplySlot + readReplySlot | ✓ VERIFIED | empty-object → null; per-lead keyed |
| `src/router/heuristic.ts` | REPLY_PATTERNS + reply branch | ✓ VERIFIED | Reply precedence over Finder confirmed |
| `src/router/classifier.ts` | ternary RouteSchema + modelFor('router') | ✓ VERIFIED | enum includes 'reply'; no hard-coded model |
| `app/api/chat/route.ts` | 3-pillar dispatch + 400 + GATE-3 + onFinish + kb-miss | ✓ VERIFIED | 400 before streamText; GATE-3 name injection before model; replySlot + recordKnowledgeGap in onFinish |
| `src/audit/pdpa.ts` | IC/email/financial regex + name path | ✓ VERIFIED | IC_REGEX/EMAIL_REGEX/FINANCIAL_REGEX chained in redactText; assertRedacted still THROWS |
| `src/firebase/collections.ts` | kbChunks.pillar + ReplyEditDoc + replyEditsRef | ✓ VERIFIED | pillar field; converter; KnowledgeGapDoc.pillar discriminator |
| `firestore.rules` | replyEdits deny-by-default + downline read | ✓ VERIFIED | create/update/delete `if false`; agent-self + coach-downline + admin read |
| `firestore.indexes.json` | pillar vector index + replyEdits composites (additive) | ✓ VERIFIED | (pillar,lang,status,embedding) vector + 3 replyEdits indexes + kbDocs(pillar,category,status) |
| `scripts/backfill-kb-chunks-pillar.ts` | idempotent pillar:'coach' backfill | ✓ VERIFIED | exists (file present); run is LIVE-GATED |
| `src/reply/diff.ts` | editRatio dependency-free | ✓ VERIFIED | bounded Levenshtein, [0,1], no diff lib |
| `app/[lang]/chat/reply-edit-actions.ts` | captureReplyEdit Admin SDK + role-from-session | ✓ VERIFIED | uid from verified __session token, not args; thumbsDown conditional |
| `app/[lang]/chat/reply-draft-card.tsx` | copy-only egress + distinct thumbs-down | ✓ VERIFIED | only egress = clipboard; thumbs-down feedback-only; copied terminal never "sent"; no_sop_match no textarea/Copy |
| `app/[lang]/chat/lead-selector.tsx` | lead selector before dispatch | ✓ VERIFIED | uid-scoped own-leads fetch; blocks leadless dispatch |
| `app/[lang]/(admin)/kb/kb-doc-list.tsx` + `kb-doc-form.tsx` | Reply pillar filter + category (ADMIN-05) | ✓ VERIFIED | All/Coach/Reply tabs; category select incl. voice |
| `src/eval/judge.ts` | combinedReplyJudgeRubric | ✓ VERIFIED | voiceMatch/qualifyingQuestions/noAutoPitch/groundedSop; JUDGE_MODEL from RC |
| `evals/gold/reply-*.yaml` | 3 gold sets, synthetic PII | ✓ VERIFIED | cold-prospect/objection/financing; registered in promptfooconfig.yaml |
| `app/[lang]/(coach)/_components/reply-quality-panel.tsx` | recharts panel | ✓ VERIFIED | 5 metrics; role-scoped; recharts client island |
| `app/[lang]/(coach)/dashboard/actions.ts` | replyEdits count() aggregation | ✓ VERIFIED | `adminAll ? base : where('seniorCoachId','==',uid)`; no rollup, no fetch-all |
| `.planning/phases/04-reply-assistant/WABA-GATE.md` | gate criteria only | ✓ VERIFIED | PROPOSED thresholds; zero WABA code |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| reply tools | rag retrieve | `retrieve(query, lang, { pillar:'reply' })` | ✓ WIRED |
| route GATE-3 | pdpa pseudonymize | knownNames injected from lead record; runs before streamText | ✓ WIRED |
| route onFinish | writeLeadSlot('replySlot') | extractReplySopIds + classification → slot write | ✓ WIRED |
| route onFinish (no_sop_match) | recordKnowledgeGap | PDPA-safe redacted topic, pillar:'reply' | ✓ WIRED |
| draft card Copy | captureReplyEdit | read textarea → editRatio → Server Action | ✓ WIRED |
| draft card thumbs-down | captureReplyEdit({thumbsDown:true}) | ADMIN-06 producer; never touches clipboard | ✓ WIRED |
| message-list | ReplyDraftCard | renders card for msg.replyOutput | ✓ WIRED |
| captureReplyEdit | replyEditsRef() | Admin SDK .add, seniorCoachId from agentProfiles | ✓ WIRED |
| firestore.rules replyEdits | seniorCoachId == auth.uid | denormalized downline read | ✓ WIRED |
| rag search | findNearest pillar pre-filter | `where('pillar','==',opts.pillar)` (search.ts:138) | ✓ WIRED |
| ingest pipeline | kbChunks write | pillar destructured + written (pipeline.ts:217) | ✓ WIRED |
| dashboard page | ReplyQualityPanel | server-fetched props, role-conditional | ✓ WIRED |
| dashboard actions | replyEditsRef count() | role-scoped aggregation | ✓ WIRED |
| heuristicPillar | REPLY_PATTERNS | checked before FINDER_PATTERNS | ✓ WIRED |
| classifyIntent | modelFor('router') | Remote Config, never hard-coded | ✓ WIRED |
| judge rubric | JUDGE_MODEL | Remote Config (RC_KEY model.grader.default) | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| reply-draft-card.tsx | output (ReplyOutput) | route streamText experimental_output → message-list props | Yes (model-authored draft, grounded SOP citations) | ✓ FLOWING (live model on deploy) |
| reply-quality-panel.tsx | perSop / thumbsDownRate / etc. | getReplyQualityMetrics → replyEditsRef count() aggregation | Yes (real Firestore count() over replyEdits rows; empty-state when none) | ✓ FLOWING |
| retrieveReplySop | filtered RetrievalResult[] | rag.retrieve pillar-filtered findNearest | Yes after backfill+index deploy | ⚠️ STATIC until backfill+index deployed (LIVE-GATED, not a code gap) |
| lead-selector.tsx | leads (LeadOption[]) | listLeadsForReply → leadsRef.where('ownerUid','==',uid) | Yes (uid-scoped own leads) | ✓ FLOWING |

Note: `retrieveReplySop` flows real data once the additive vector index is deployed and the one-time chunk backfill is run — both are documented deployment steps (Pitfall F, 04-03-SUMMARY), not code defects.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| `npx tsc --noEmit` clean | tsc | exit 0, no errors | ✓ PASS |
| `npx vitest run` full suite | vitest | 525 passed / 107 skipped / 0 failed | ✓ PASS |
| Reply agent offline gate (clarify/miss/hit/per-classification/no-write) | vitest src/agents/reply/reply.test.ts | 13/13 pass | ✓ PASS |
| Router ternary + reply precedence | vitest src/router/classifier.test.ts | pass (in 37/37 batch) | ✓ PASS |
| editRatio dependency-free | vitest src/reply/diff.test.ts | pass | ✓ PASS |
| captureReplyEdit incl. thumbsDown:true write | vitest src/reply/reply-edit-actions.test.ts | pass | ✓ PASS |
| PDPA IC/email/financial coverage | vitest src/audit/pdpa.test.ts | pass | ✓ PASS |
| No auto-send/share/WhatsApp-send egress in reply paths | grep | only a doc comment in prompt.ts | ✓ PASS |
| No WhatsApp Business API code anywhere | grep src/ app/ | none (WABA-GATE doc only) | ✓ PASS |
| No Cloud Functions / GCP-beyond-Firebase | grep src/ app/ | none | ✓ PASS |
| No hard-coded model IDs in reply paths | grep | none (modelFor only) | ✓ PASS |
| Core/shell: src/ never imports app/ (non-test) | grep | clean (only a co-located test imports the action under test) | ✓ PASS |
| Phase-4 i18n keys present en/ms/zh | node | all present in all 3 langs | ✓ PASS |
| Reply rules suite (replyEdits) | emulator | SKIP (no FIRESTORE_EMULATOR_HOST) | ? SKIP → human |
| e2e copy-only/no-send click-through | playwright | SKIP (no E2E_BASE_URL) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| REPLY-01 | 04-03 | Reply SOP KB ingested + retrievable | ✓ SATISFIED | kbChunks.pillar + ingest write + pillar findNearest index; backfill+index deploy LIVE-GATED |
| REPLY-02 | 04-05/06 | Paste → grounded draft | ✓ SATISFIED | replyAgent + route reply dispatch + retrieveReplySop |
| REPLY-03 | 04-05/06 | Per-lead context persisted across parallel convos | ✓ SATISFIED | readReplySlot(leadId) + replySlot onFinish; isolation structural |
| REPLY-04 | 04-08 | Explicit edit-before-send; never auto-sent | ✓ SATISFIED | editable Textarea + single Copy egress; no send/share affordance |
| REPLY-05 | 04-05/09 | Cold-prospect qualifying questions, not a pitch | ✓ SATISFIED | cold-prospect draft branch + judge qualifyingQuestions/noAutoPitch |
| REPLY-06 | 04-05/09 | Objection-handling drafts | ✓ SATISFIED | objection classification branch + objection gold set |
| REPLY-07 | 04-05/09 | Financing answered via D2 financing SOP | ✓ SATISFIED | financing branch + financing gold set |
| REPLY-08 | 04-05/09 | Tone calibration (anonymized samples) | ✓ SATISFIED | makeFetchVoiceSamples (curated org-voice doc) + judge voiceMatch; trilingual voice samples deferred to Derek (live eval) |
| REPLY-09 | 04-07/08 | Edit-feedback capture as signal | ✓ SATISFIED | editRatio + captureReplyEdit row-on-every-copy |
| REPLY-10 | 04-04 | Reply added to intent router (3 pillars) | ✓ SATISFIED | heuristic + ternary classifier + route dispatch + override chip |
| REPLY-11 | 04-10 | Reply quality analytics dashboard | ✓ SATISFIED | reply-quality-panel + count() aggregation |
| REPLY-12 | 04-10 | WABA graduation criteria defined (not implemented) | ✓ SATISFIED | WABA-GATE.md criteria only, zero code |
| ADMIN-05 | 04-09 | Reply SOP management | ✓ SATISFIED | kb pillar filter + Reply create + category |
| ADMIN-06 | 04-07/08/10 | Feedback-loop visibility (thumbs-down, rewrites, escalation) | ✓ SATISFIED | thumbsDown producer (card) → captureReplyEdit → dashboard count(thumbsDown==true)/count(all) + escalation rate |
| QUAL-02 | 04-08 | Non-API WhatsApp posture (suggested drafts only) | ✓ SATISFIED | copy-only egress; no auto-send; agent reviews; no WABA |

All 16 requirements accounted for. No ORPHANED requirements (every REQ-ID maps to a plan and has implementation evidence).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | No TODO/FIXME/placeholder/empty-return stubs found in any Phase-4 production file |

### Wave-0 Blocker Closure (04-RESEARCH)

| Blocker | Status | Evidence |
| --- | --- | --- |
| PDPA free-text coverage (IC/email/RM-financial) | ✓ CLOSED | IC_REGEX/EMAIL_REGEX/FINANCIAL_REGEX in pdpa.ts, all chained in redactText; GATE-3 covers reply pastes |
| kbChunks.pillar schema migration | ✓ CLOSED | pillar field + ingest write + backfill script + pillar findNearest index |
| Required-leadId fail-closed | ✓ CLOSED | HTTP 400 before streamText for leadless reply (route.ts:393-398); route test green |

### Hard-Guarantee Confirmation

| Guarantee | Status | Evidence |
| --- | --- | --- |
| No auto-send (copy-only egress) | ✓ CONFIRMED | Only egress = navigator.clipboard.writeText; thumbs-down is feedback-only |
| No WhatsApp Business API code | ✓ CONFIRMED | grep src/ app/ clean; WABA-GATE doc only |
| No Cloud Functions / GCP-beyond-Firebase | ✓ CONFIRMED | grep clean |
| Model IDs from Remote Config | ✓ CONFIRMED | modelFor() everywhere; no hard-coded IDs in reply paths |
| PII pseudonymized at boundary (GATE-3 covers reply) | ✓ CONFIRMED | pseudonymize + assertRedacted (422) before streamText; lead-name injection |
| Grounding mandate (cite SOP IDs; no_sop_match never invents) | ✓ CONFIRMED | sopDocIds.min(1); grounded refusal path |
| Core/shell split (src/ never imports app/) | ✓ CONFIRMED | clean for production code (one co-located test imports its action) |
| Per-lead isolation; required leadId fail-closed | ✓ CONFIRMED | slot keyed by leadId; 400 before streamText |
| tenantId on every doc; messages in subcollection; deny-by-default + CI rules tests | ✓ CONFIRMED | replyEdits stamps tenantId; conversations/{cid}/messages; deny-by-default rules; emulator rules test authored (live-gated) |

### Human Verification Required

5 items require a live stack / deploy / emulator / model run (see frontmatter `human_verification`). All are deployment or runtime-quality steps consistent with prior phases — NOT code gaps:

1. **Deploy indexes + run chunk backfill** — `firebase deploy --only firestore:indexes,firestore:rules` + `npx tsx scripts/backfill-kb-chunks-pillar.ts`; confirm reply-pillar retrieval returns only reply SOPs.
2. **Emulator rules suite for replyEdits** — `firebase emulators:exec --only firestore "npm run test:rules"`; confirm deny-by-default + downline read.
3. **Live promptfoo Reply evals** — Opus judge over 3 gold sets; confirm ≥90% EN + D2 voice.
4. **Browser click-through** — copy-only / no-send / lead-selector / thumbs-down / no_sop_match states on a seeded deploy.
5. **Parallel-lead isolation runtime check** — two concurrent leads produce isolated drafts; leadless reply → 400.

### Gaps Summary

**Zero code gaps.** All 5 ROADMAP success criteria are achieved in substantive, wired code; all 16 requirements have implementation evidence; all hard guarantees are confirmed; all 3 Wave-0 RESEARCH blockers are closed in code. Quality gates pass cleanly (tsc exit 0; vitest 525 pass / 107 skip / 0 fail).

The phase status is `human_needed` (not `passed`) only because the deliverable's operational proof depends on 5 live-gated human/deployment steps that the verifier cannot execute (no creds, no emulator, no deploy). These are the same class of deployment/human verification steps carried by prior phases and explicitly flagged in the SUMMARYs (Pitfall F) and CLAIM.md verification section — they do not represent missing or stubbed implementation.

---

_Verified: 2026-06-05T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
