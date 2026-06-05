# Claim: phase-kayinleong-04

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-05
- status: in-progress
- summary: Execute Phase 4 (Reply Assistant + Reply Analytics) — 10 plans across waves 0-6. Third pillar (Reply) mirrors the Finder shape; 3-pillar router activation; reply SOP KB + admin; edit-as-signal analytics; copy-only paste-and-draft (no auto-send). Grow-don't-fork throughout.

## What will change

All 10 Phase-4 plans (04-01..04-10), executed SEQUENTIALLY on `phase-kayinleong-01` (global CLAUDE.md: no worktree isolation for agents):

- **04-01 (Wave 0)** — failing-test stubs (RED) for every requirement: PDPA coverage, reply agent, diff, router 3-pillar, replyEdits rules, rag/kb pillar, route dispatch, Reply gold sets, e2e.
- **04-02 (Wave 1)** — close the PDPA false-positive gate: inject lead names + IC/email/RM-financial regexes; make `pdpa_redacted` reflect real coverage (security blocker).
- **04-03 (Wave 1)** — `kbChunks.pillar` migration + pipeline write + backfill + composite vector index; `retrieveReplySop` pillar filter.
- **04-04 (Wave 1)** — router 3-pillar: heuristic Reply patterns (precedence over finder keywords) + classifier ternary; fix `classifier.test.ts:95`.
- **04-05 (Wave 2)** — `src/agents/reply/*` (mirror Finder) + read-only tools (`retrieveReplySop`/`fetchVoiceSamples`/`fetchLeadContext`) + `ReplySlot`/`readReplySlot`.
- **04-06 (Wave 3)** — 3-pillar chat-route dispatch + required-`leadId` fail-closed (400) + GATE-3 lead-name injection + replySlot onFinish + `no_sop_match → knowledgeGaps` kb-miss write.
- **04-07 (Wave 4)** — `replyEdits` collection + downline-scoped rules + indexes + `src/reply/diff.ts` + `captureReplyEdit` Server Action.
- **04-08 (Wave 5)** — Reply draft card (copy-only egress + thumbs-down feedback) + lead selector + override chip widening + disclosure copy + all Phase-4 i18n (en/ms/zh).
- **04-09 (Wave 6)** — Reply SOP admin pillar filter (ADMIN-05) + judge rubric extension + Reply gold sets (REPLY-05/06/07/08).
- **04-10 (Wave 6)** — Reply Quality dashboard panel (REPLY-11/ADMIN-06) + `WABA-GATE.md` (REPLY-12, documented gate only).

Built against the locked overrides (Gemini 1024-d embeddings, on-visit lazy-cron, AI SDK v5). Hard constraints honored: no Cloud Functions / no GCP beyond Firebase / no WABA code / no auto-send (copy-only) / model-from-Remote-Config / PDPA boundary / core-shell split / trilingual.

Continues on branch `phase-kayinleong-01`; not pushed (standing user hold).

## What has changed

(per-plan detail in each `04-0{1..10}-SUMMARY.md`)

- **04-01 (Wave 0) — DONE** (commits `cb8ba1e`, `c2cd157`, `e34d2a9`): Wave-0 RED/skip-guarded test stubs for all Phase-4 requirements. 7 files created, 8 modified. Every requirement now has an automated verify (Nyquist gate). Security-critical PDPA coverage (IC/email/RM-financial), the ADMIN-06 `captureReplyEdit(thumbsDown:true)` producer, the inverted classifier 'reply' assertion, replyEdits downline rules, pillar retrieval, route dispatch, three EN reply gold sets, and a copy-only e2e — all failing-now/passing-later. See `04-01-SUMMARY.md`.
- **04-02 (Wave 1) — DONE** (commit `aad4f40`): closed the PDPA false-positive gate (threat T-04-PDPA) — extended `src/audit/pdpa.ts` with IC/email/RM-financial regexes + `replaceIC`/`replaceEmail`/`replaceFinancial` helpers wired into `redactText`; flipped the Wave-0 IC/email/RM-financial `it.fails()` guards to GREEN. `assertRedacted` throw-don't-warn contract preserved; presence-gate semantics kept (Derek/legal decision). `npm run test` exit 0, tsc/lint clean. See `04-02-SUMMARY.md`.
- **04-03 (Wave 1) — DONE** (commits `aa29ed1`, `a984be8`): denormalized `pillar` onto `kbChunks` (schema + `processBatch` write + idempotent `scripts/backfill-kb-chunks-pillar.ts`) + parameterized the rag facade with `opts { pillar?, category? }` (pillar = index-backed `findNearest` pre-filter, category = in-memory narrowing) + added the `kbChunks (pillar,lang,status,embedding 1024-d)` vector index & `kbDocs (pillar,category,status)` composite (additive); also persisted `kbDocs.category` (D-09) and added the optional `KnowledgeGapDoc.pillar` discriminator (D-11). Gates all Reply retrieval (REPLY-01, Pitfall B). Flipped 3 Wave-0 RED guards (kb Test 5b + 2 rag pillar tests) GREEN. `npm run test` exit 0 (464 pass | 30 expected-fail | 0 fail), tsc/lint clean, indexes JSON valid. Index deploy + chunk backfill flagged in `04-03-SUMMARY.md` (Pitfall F). See `04-03-SUMMARY.md`.
- **04-04 (Wave 1) — DONE** (commits `bebd52a`, `e8868f2`): activated the 3rd pillar in the intent router (REPLY-10). Extended `heuristicPillar` with `REPLY_PATTERNS` + a `looksLikeInboundPaste` inbound-block heuristic checked BEFORE the `FINDER_PATTERNS` scan (Pitfall C — RM/financing pastes that are reply requests now route to `'reply'`, not `'finder'`; pure Finder queries still route to `'finder'`) and widened the return union to `'coach'|'finder'|'reply'`; widened the classifier `RouteSchema` enum binary→ternary + `classifyIntent` return type + added a Reply paragraph to `ROUTER_SYSTEM_PROMPT`, preserving `modelFor('router')` Remote-Config resolution (no hard-coded model ID — QUAL-01). Flipped all 5 Wave-0 RED guards GREEN (3 in `heuristic.test.ts`, 2 inverted `classifier.test.ts` assertions — schema now ACCEPTS `'reply'`) + added a Finder-precedence regression test. Sync `route()`/`routeAsync` decision logic untouched (Pitfall 7 / T-03-18 — coach 28/28 pass). `npm run test` exit 0 (470 pass | 25 expected-fail | 107 skip | 0 fail), tsc clean. See `04-04-SUMMARY.md`.

## Verification

(gsd-verifier goal-backward verification → `04-VERIFICATION.md` after all waves)

### 04-01 Regression Report (Wave 0)

- **Quality gates:** `npm run test` exits 0 (457 passed | 37 expected-fail | 107 skipped | **0 failed**); `tsc --noEmit` exits 0; `eslint` 0 errors (warnings only, in-style with existing test files).
- **What was tested:** ran the three Task-1 files, the six Task-2 files, the rules file (skips offline), and the full offline suite; YAML-parsed all three gold sets + promptfooconfig; PII-scanned the gold sets (zero `+60`/IC literals).
- **What passed:** all pre-existing tests stay green; the 2 new green baselines in pdpa (known-name + MY-phone) act as regression guards; the 37 expected-fail markers genuinely capture unmet contracts (no false-green `it.fails`).
- **Ruled out (regression surface):** these are TEST-ONLY changes — no `src/` runtime, no `app/` runtime, no `firestore.rules`, no config behavior changed. The only non-test edits are `evals/promptfooconfig.yaml` (added 3 `tests:` entries; existing suites untouched) and `src/firebase/__tests__/rules.test.ts` (added a `replyEdits` describe + one entry to the deny-by-default list; existing collection blocks untouched). No production code path can break from this plan.
- **Deviations:** 3 auto-fixed (all Rule 3 blocking — mock typing for tsc, classifier RED-test correctness, e2e path note); documented in `04-01-SUMMARY.md`. The `tests/e2e/` vs playwright `testDir: ./e2e` mismatch is flagged for Plan 04-08 to reconcile.
