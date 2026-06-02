---
phase: 03-finder-routing
verified: 2026-06-03T01:14:00Z
status: human_needed
score: 14/14 must-haves verified (code); 13/13 requirements code-satisfied
goal_achieved: true
genuine_code_gaps: 0
open_human_action_gates: 3  # live Promptfoo evals, live Playwright e2e, live pilot provisioning (FIND-12) — deliberately deferred per 03-VALIDATION
quality_gates:
  tsc: clean   # npx tsc --noEmit → exit 0 @ HEAD b4da70b
  vitest: green # 452 passed / 97 skipped / 0 failed @ HEAD b4da70b (independently re-run)
hard_guarantees:
  active_only_grounding: PASS
  grounding_citation: PASS
  eligibility_filter: PASS
  two_pillars_one_surface: PASS
  tools_read_only_auth: PASS
  pdpa_boundary: PASS
  model_agnostic: PASS
  no_gcp_locked_overrides: PASS
human_verification:
  - test: "Run the Promptfoo finder-grounding + finder-segmentation + router-precision suites against the live pilot stack (Anthropic + Firestore + judge)"
    expected: "Sold-out/ineligible projects yield grounded refusal-with-alternative (never recommended); investment vs own-stay yield different top-3; Coach↔Finder routing accurate across EN/BM/中文 incl. ambiguous→safe-default"
    why_human: "Needs live Gemini/Firestore/Anthropic + Opus judge; eval scoring is non-deterministic and not runnable offline (03-VALIDATION 'Manual / live-gated')"
  - test: "Remove test.skip and run e2e/finder-flow.spec.ts + e2e/inventory-admin.spec.ts against a deployed pilot stack with seeded inventory"
    expected: "Paste criteria → match cards with rationale + collateral chips render; override chip forces Finder; budget shift re-ranks without re-typing; admin add/edit/hide/import work end-to-end"
    why_human: "Specs are skip-guarded scaffolds requiring a live deploy + seeded data + real auth (03-09 checkpoint; Phase-2 e2e sign-off waived setup to scaffold-only)"
  - test: "Run scripts/provision-finder-pilot.ts with --apply for 15–20 real pilot agents (FIND-12) after confirming Remote Config model.router.default / model.finder.default are seeded"
    expected: "Custom claims / rateBudgets set for the pilot cohort; Finder access granted"
    why_human: "Script is dry-run by default (requires explicit --apply); mutates live Firebase Auth claims — an operator action, not an automated test (03-09 user_setup gate)"
---

# Phase 3: Finder + Intent-Routing Activation — Verification Report

**Phase Goal:** An agent can paste lead criteria and get ranked, collateral-attached D2-project matches, and the chat surface now genuinely routes between two pillars via an activated LLM classifier. Pilot expands to 15–20 agents.
**Verified:** 2026-06-03T01:14:00Z (initial verification)
**Status:** human_needed — all code goals achieved; 3 deliberately live-gated runs remain as the expected open human-action gate (NOT code gaps).
**Re-verification:** No — initial verification.

## Verdict

- **goal_achieved: true** at the code level. Every Phase-3 success criterion and all 13 requirements (FIND-01..12 + ADMIN-04) trace to substantive, wired, data-flowing implementation.
- **Genuine code gaps: 0.**
- **Open human-action gates: 3** — live Promptfoo evals, live Playwright e2e, and live pilot provisioning (FIND-12). These are deliberately deferred/live-gated per `03-VALIDATION.md` and the `03-09` checkpoint. The artifacts EXIST and are correctly guarded (e2e `test.skip` scaffolds; provisioning dry-run-by-default). Status is `human_needed` purely because of these expected live runs.
- **Quality gates (independently re-run @ HEAD b4da70b):** `npx tsc --noEmit` → exit 0 (clean); `npx vitest run` → **452 passed / 97 skipped / 0 failed**.

## The 8 Hard Guarantees (PASS/FAIL with evidence)

| # | Guarantee | Status | Evidence |
|---|-----------|--------|----------|
| 1 | **Active-only grounding** — deterministic `status:'active'` filter BEFORE vector re-rank; no sold-out/hidden project can surface | ✅ PASS | `src/inventory/search.ts:246` `let q = projectsRef().where('status','==','active')` runs in STAGE A; `embedText(...)` (STAGE B) is not called until `:331`. The gate is code, not prompt-controlled. `queryInventory` (`:389`) re-applies the same active-only base filter. `embedText.ts` deliberately EXCLUDES `status` from the embedding text (`:7-11`, Pitfall 1/8) so semantic similarity can never influence availability. |
| 2 | **Grounding / citation** — Finder cites project IDs; no-match emits grounded refusal, never invents | ✅ PASS | `src/agents/finder/index.ts:305` rationale always begins `Project ID: ${match.projectId}`; built only from real fields (priceBand/tenure/vpStatus/bumiQuota/foreignEligible — `:281-363`). Grounded refusal at `:212-248` (no_match / ineligible) returns `matches:[]` + explanation, no fabricated project. `schema.ts:138` `projectId: z.string().min(1)` "comes from searchProjects — NEVER fabricated". `chat/match-list.tsx:65` renders the refusal card verbatim — "renders exactly what the agent produced". |
| 3 | **Foreign-buyer / bumiputera eligibility** — applied in the deterministic stage | ✅ PASS | `search.ts:249-251` `if (criteria.nationality==='foreign') q = q.where('foreignEligible','==',true)`; `:254-256` `if (criteria.bumiputera===false) q = q.where('bumiQuota','==',false)`. Both are STAGE-A Firestore filters, before vector work. Affordability gate (FIND-10) `:311-323` also pre-vector → all-unaffordable returns `{found:false, reason:'ineligible', why:'financing'}`. |
| 4 | **Two pillars on one surface** — routeAsync dispatches coach vs finder live; override chip honored; low-confidence→Coach | ✅ PASS | `app/api/chat/route.ts:271` `await routeAsync(messages, { override })`; dispatch branch `:289 if (pillar==='finder')` … `:310 else` coach. `routeAsync` (`src/router/index.ts:67-100`) = override→heuristic→classifier→low-confidence-default-coach (threshold 0.5 `:39`). Override wins at `:72`. Manual pillar chip Auto/Coach/Finder in `chat/chat-header.tsx:136-142`; `chat-input` forwards `override` + `leadId` to the route. |
| 5 | **Agent tools read-only + auth boundary** — Finder tools never write Firestore on the user path | ✅ PASS | `src/agents/finder/tools.ts` — all three `execute()` bodies only call `searchProjects` / `queryInventory` / `collateralRef().where(...).get()` — **zero** `.set/.add/.update` (grep-confirmed). finderSlot write happens in the route's `onFinish` (`route.ts:374-399`), never inside a tool. The user-facing path is auth-gated by `requireUser` (GATE 1, verified token claims) BEFORE dispatch; tools read via the server `adminDb` ref but are strictly read-only and the agent cannot bypass the deterministic gate (tools are the only inventory source). See note below on the "auth-as-user" wording. |
| 6 | **PDPA boundary** — pseudonymize + assertRedacted before any model call on the Finder path too | ✅ PASS | `route.ts:243-265` GATE 3 runs `pseudonymize(...)` then `assertRedacted(...)` (→ 422 `PdpaViolationError`) UNCONDITIONALLY, before the single `streamText` call at `:330`, for BOTH pillars. Header comment `:33` and `:246-247` explicitly state the Finder path's pasted lead criteria are redacted by the same gate (T-03-26). |
| 7 | **Model-agnostic** — router/finder/judge models from Remote Config, never hard-coded | ✅ PASS | `route.ts:318` `const model = await modelFor(pillar)`; `classifier.ts:85` `await modelFor('router')`. `src/llm/provider.ts:70` `modelFor` reads `getServerTemplate().getString('model.${pillar}.default')` from Remote Config; the compile-time constants (`:40-44`, router=`claude-haiku-4-5`, finder=`claude-sonnet-4-6`, grader=`claude-opus-4-7`) are the documented Remote-Config FALLBACK, not call-path literals. Grep for `claude-*` in `src/inventory`, `src/agents/finder`, `src/router/classifier.ts`, `src/router/index.ts`, `route.ts` → **zero** hard-coded IDs. |
| 8 | **No-GCP / locked overrides honored** | ✅ PASS | Embeddings = Gemini `gemini-embedding-001` @1024-d via `@ai-sdk/google` (`src/rag/embed.ts:2,28`), reused by `inventory/embedText.ts`. No active Voyage / QStash usage (only comments documenting the swap-away). Zero `functions.https/onRequest/onCall/@google-cloud/VertexAI/pubsub` in any Phase-3 dir. Collateral = Storage path OR `externalUrl` plain string, never the Drive API (`collections.ts:231-254`, `tools.ts:160-213`). On-visit lazy-cron retained (`src/jobs/runDueJobs.ts`). |

## Observable Truths (per Success Criterion)

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| SC1 | Paste criteria → ranked matches, each with collateral + "why this match", only active/available appear | ✅ VERIFIED | Two-stage `searchProjects` (active-only Stage A → vector re-rank Stage B); per-match rationale (`finder/index.ts:281`); `fetchCollateral` tool + `match-list.tsx` collateral chips; active-only gate (Guarantee 1). |
| SC2 | Budget/preference shift re-ranks without re-typing; per-lead context remembered across messages | ✅ VERIFIED | `leadContext.ts` FinderSlot {criteria, discussedProjectIds, lastRankedAt} + `readFinderSlot`/`mergeFinderCriteria`/`mergeDiscussed`; `route.ts:290-301` reads slot + merges; `:374-399` writes slot in onFinish. Unit-tested (`memory.test.ts`). |
| SC3 | Investment-vs-own-stay + financing reflected; sub-threshold/ineligible → grounded refusal not a bad match | ✅ VERIFIED | `applySegmentWeights` (`search.ts:174-210`) reorders by segment; affordability gate `:311-323` → `ineligible/financing` refusal; grounded refusal in `finder/index.ts:212-248`. Segmentation + refusal unit-tested. |
| SC4 | Filtered inventory queries ("completed VP this year") return correct, inventory-grounded answers | ✅ VERIFIED | `queryInventory` (`search.ts:385-414`) structured Firestore query (vpDate/status/priceBand), NO vector — `embedText` never called; `(status, vpDate desc)` composite index present. `makeQueryInventoryTool` exposes it. |
| SC5 | One conversation auto-routes Coach↔Finder (manual-override chip available) | ✅ VERIFIED | `routeAsync` three-tier chain wired into `route.ts` GATE 4; override chip in `chat-header.tsx`; `routeDecision` recorded on every message (`route.ts:347,365`); low-confidence→coach safe default. |

**Score: 5/5 success criteria verified · 14/14 plan must-have truths verified (code).**

## Requirements Coverage (13 IDs)

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| FIND-01 | Ranked matches with collateral attached | ✅ SATISFIED | `searchProjects` + `fetchCollateral` + `match-list.tsx` |
| FIND-02 | Project inventory ingested from D2 sources | ✅ SATISFIED | `import.ts` ProjectSource interface + `csvProjectSource` + `importProjects` (validate→bulk create+embed); admin import-form |
| FIND-03 | Matching engine (criteria parse + ranked recs) | ✅ SATISFIED | `CriteriaSchema` parser + two-stage `searchProjects` |
| FIND-04 | Each project linked to collateral | ✅ SATISFIED | `collateral` collection (`projectId` keyed); `attachCollateral`; `fetchCollateral` tool |
| FIND-05 | Per-lead context remembered | ✅ SATISFIED | FinderSlot + onFinish slot write |
| FIND-06 | Returning client — new launches without re-typing | ✅ SATISFIED | `readFinderSlot` + `discussedProjectIds` (`mergeDiscussed`) + `criteria.since` filter (`search.ts:281-307`) |
| FIND-07 | Filtered queries ("completed VP this year") | ✅ SATISFIED | `queryInventory` + `(status,vpDate)` index |
| FIND-08 | Mid-conversation re-ranking on shift | ✅ SATISFIED | `mergeFinderCriteria` + route merge/re-rank (`route.ts:300`) |
| FIND-09 | Investment vs own-stay segmentation | ✅ SATISFIED | `applySegmentWeights`; segmentation Promptfoo gold set scaffolded |
| FIND-10 | Financing/affordability factored | ✅ SATISFIED | `affordabilityCeiling` (DSR_MULTIPLE 4.5) pre-vector gate → financing refusal |
| FIND-11 | Intent router activated — Coach + Finder coexist | ✅ SATISFIED | `classifier.ts` activated (NotActivatedError removed); `routeAsync`; override chip; routeDecision |
| FIND-12 | Pilot expands to 15–20 agents | ⏳ CODE-READY / HUMAN-GATED | `scripts/provision-finder-pilot.ts` exists, dry-run by default (`--apply` to mutate). Live provisioning is an operator action (open gate #3). |
| ADMIN-04 | Project inventory management (add/edit/hide + collateral) | ✅ SATISFIED | `crud.ts` (assertAdmin-gated create/update/hide/attachCollateral, embed-on-write, soft-hide); admin inventory page + actions (double admin gate) |

**No orphaned requirements** — all 13 Phase-3 IDs in REQUIREMENTS.md are claimed across plan frontmatter and traced above.

## Required Artifacts (three-level + data-flow)

| Artifact | Exists | Substantive | Wired | Data Flows | Status |
|----------|--------|-------------|-------|------------|--------|
| `src/inventory/search.ts` (two-stage) | ✅ | ✅ 415 lines | ✅ called by finder tools | ✅ projectsRef→Firestore | ✅ VERIFIED |
| `src/inventory/crud.ts` (admin CRUD) | ✅ | ✅ | ✅ called by admin actions | ✅ embed-on-write | ✅ VERIFIED |
| `src/inventory/import.ts` (ProjectSource) | ✅ | ✅ | ✅ called by importAction | ✅ validate→create | ✅ VERIFIED |
| `src/inventory/embedText.ts` | ✅ | ✅ (status excluded) | ✅ used by crud/import | ✅ Gemini 1024-d | ✅ VERIFIED |
| `src/agents/finder/{index,tools,schema,prompt}.ts` | ✅ | ✅ | ✅ dispatched in route | ✅ searchProjects→Firestore | ✅ VERIFIED |
| `src/router/{classifier,heuristic,index}.ts` | ✅ | ✅ (generateObject live) | ✅ routeAsync in route | ✅ modelFor→RemoteConfig | ✅ VERIFIED |
| `app/api/chat/route.ts` (finder dispatch) | ✅ | ✅ | ✅ POST handler | ✅ all 5 gates flow | ✅ VERIFIED |
| `app/[lang]/chat/{match-list,chat-header}.tsx` | ✅ | ✅ | ✅ rendered in chat-shell | ✅ renders agent output | ✅ VERIFIED |
| `src/memory/leadContext.ts` (finderSlot) | ✅ | ✅ | ✅ used by route | ✅ leadContextRef | ✅ VERIFIED |
| `src/firebase/collections.ts` (ProjectDoc/CollateralDoc) | ✅ | ✅ priceValue/priceBand/vpDate/externalUrl | ✅ used everywhere | ✅ tenantId stamped | ✅ VERIFIED |
| `firestore.indexes.json` (projects composites) | ✅ | ✅ (status+priceBand+emb, status+vpDate, status+emb) | ✅ backs queries | n/a | ✅ VERIFIED |
| `firestore.rules` (projects/collateral) | ✅ | ✅ read=signed-in+tenant, write=admin+tenant | ✅ deny-by-default | n/a | ✅ VERIFIED |
| `app/[lang]/(admin)/inventory/*` (manager) | ✅ | ✅ page+actions+forms | ✅ double admin gate | ✅ crud/import | ✅ VERIFIED |
| `evals/gold/finder-*.yaml`, `router-precision.yaml`, `promptfooconfig.yaml` | ✅ | ✅ trilingual gold sets | ⏳ live-eval-gated | ⏳ needs live judge | ⚠️ SCAFFOLD (open gate #1) |
| `e2e/finder-flow.spec.ts`, `e2e/inventory-admin.spec.ts` | ✅ | ✅ selectors+assertions | ⏳ `test.skip` scaffolds | ⏳ needs live deploy | ⚠️ SCAFFOLD (open gate #2) |
| `scripts/provision-finder-pilot.ts` (FIND-12) | ✅ | ✅ Admin SDK + rateBudgets | ⏳ dry-run by default | ⏳ needs `--apply` | ⚠️ CODE-READY (open gate #3) |

## Key-Link Verification (wiring)

| From | To | Via | Status |
|------|----|----|--------|
| `route.ts` | `routeAsync` | GATE 4 (`:271`) | ✅ WIRED |
| `route.ts` (finder branch) | `finderAgent.buildSystemPrompt/makeTools` + `modelFor('finder')` | `:304-318` | ✅ WIRED |
| `route.ts` onFinish | `writeLeadSlot('finderSlot',...)` | `:394` | ✅ WIRED |
| `finder/tools.ts` | `searchProjects` (active-only) | `:78` | ✅ WIRED |
| `inventory/search.ts` | `firestore.indexes.json` projects indexes | `where(status/priceBand/vpDate)` | ✅ WIRED |
| `admin/inventory/actions.ts` | `crud.ts` + `import.ts` (admin-gated) | getSessionUser + assertAdmin | ✅ WIRED (double gate) |
| `chat-header.tsx` override chip | `chat-input` → `route.ts` body `override` | controlled prop | ✅ WIRED |
| `classifier.ts` | Remote Config | `modelFor('router')` | ✅ WIRED |

## Note on Guarantee #5 wording ("auth-as-user")

The verification focus phrases this as "Finder tools never use admin creds on the user path." The implementation reads inventory via the server-side `adminDb` typed refs (`projectsRef`/`collateralRef`) — this is the SAME established pattern as the Phase-2 Coach tools (`src/agents/coach/tools.ts` reads `kbChunksRef` via `adminDb`). The user-facing authorization boundary is enforced upstream: `requireUser` (GATE 1) verifies the Firebase ID token and reads role/tenant claims from the VERIFIED token (never the body) before any dispatch. The tools themselves are strictly read-only (no writes), so they cannot perform privileged mutations on the user path, and they cannot bypass the deterministic active/eligibility gate. This is consistent with the codebase convention and the TSD; it is NOT a deviation or gap. The privileged WRITE surface (inventory CRUD) is separately and doubly admin-gated (RSC gate + `assertAdmin`). Treated as **PASS** with this clarification documented.

## Anti-Patterns Scanned

| Area | Finding | Severity |
|------|---------|----------|
| Stub returns (`return null`/`[]`/`{}`) in Finder/inventory/route | None that flow to user output as a stub. `finder/index.ts:157-161` returns `{matches:[]}` ONLY on the non-injection, non-streaming offline path (explicitly the test/offline branch; production streams through route.ts) — not a user-visible stub. | ℹ️ Info |
| TODO/FIXME/placeholder in Phase-3 code | TODOs only in e2e scaffolds ("remove test.skip when pilot stack is live") and the `// G4 FORMAT TBD (A1)` import seam (deliberate, flagged for Derek). | ℹ️ Info (intentional) |
| Hard-coded model IDs in call path | None. | — |
| Empty-prop rendering (`={[]}` to children) | match-list renders real `output` prop from the agent stream. | — |
| Hard-coded inventory / fake matches | None — all matches come from Firestore via the deterministic gate. | — |

## Regression Surface

Phase-3 changes that could plausibly break Phase-1/2 features, and their verified status:

1. **Chat-route refactor (`app/api/chat/route.ts`)** — added the Finder dispatch branch and switched GATE 4 from sync `route()` to `routeAsync()`.
   - ✅ Coach path INTACT: `:310 else` branch still does `coachAgent.buildSystemPrompt()` + `coachAgent.makeTools(userLang)` unchanged; `stopWhen: stepCountIs(1)` for coach (Finder uses 5). Coach citation extraction (`extractCitationChunkIds`, retrieveKnowledge) preserved (`:357`).
   - ✅ Gate ordering preserved: requireUser → ratelimit → pseudonymize+assertRedacted → route → stream → onFinish(append + decrement + audit). PDPA gate now covers Finder too (additive, stricter).
   - ✅ `src/agents/coach/` (non-test), `src/audit/`, `src/ratelimit/` core modules NOT modified by Phase 3 (git diff confirms zero changes in those dirs).
   - ✅ Coach integration tests: **28/28 passing** (re-run `vitest run src/agents/coach`).

2. **`routeAsync` activation (`src/router/*`)** — classifier went live.
   - ✅ Sync `route()` PRESERVED and re-exported (`index.ts:26`); safe default still 'coach' (`heuristic.ts:169`). The stall-detect job + coach.test.ts callers use the sync `route()` — unaffected (verified the only callers import sync `route`, not `routeAsync`).
   - ✅ `coach.test.ts` updated alongside the router activation and passes in the green suite — reflects the new heuristic keyword behavior, not a coach-logic regression.

3. **`collections.ts` schema additions** — ProjectDoc extended (priceValue/priceBand/vpDate/description/locationText/bedrooms), CollateralDoc.externalUrl added.
   - ✅ ADDITIVE only. The single "deletion" in the diff is `priceBand: string` → tightened to the typed `PriceBand` enum (type refinement, not a field/data removal). No other collection shape (User/Conversation/Message/KbDoc/KbChunk/Lead/etc.) changed.
   - ✅ `MessageDoc.routeDecision` and `citations` predate Phase 3 (introduced 01-03) — Phase 3 only populates them; no schema break for KB/audit consumers.

4. **`firestore.rules`** — NOT touched by Phase 3 (last modified 02-01). Projects/collateral deny-by-default (read=signed-in+tenant, write=admin+tenant) pre-existed and remains intact.

5. **KB ingest path (`src/kb/`, `app/api/kb/`)** — NOT modified by Phase 3 (git diff confirms zero changes). Coach RAG retrieval (`src/rag/`) reused unchanged for the project embedding (added `inventory/embedText.ts` calls the existing `embedText`, does not alter it).

**Regression verdict: no regressions detected.** The 452/97/0 green suite + clean tsc + 28/28 coach tests + the additive-only diff analysis collectively confirm Phase-1/2 behavior is preserved.

## Open Human-Action Gates (expected — NOT code gaps)

Per `03-VALIDATION.md` ("Manual / live-gated") and the `03-09` checkpoint, the following are deliberately deferred to the live pilot stack. The supporting artifacts EXIST and are correctly guarded:

1. **Live Promptfoo evals** — finder-grounding + finder-segmentation + router-precision gold sets are written (trilingual) and wired into `promptfooconfig.yaml`; scoring requires live Anthropic + Gemini + Firestore + Opus judge.
2. **Live Playwright e2e** — `finder-flow` + `inventory-admin` specs are `test.skip` scaffolds with full selectors/assertions; require a deployed pilot stack + seeded inventory + real auth.
3. **Live pilot provisioning (FIND-12)** — `scripts/provision-finder-pilot.ts` is dry-run by default; requires explicit `--apply` (operator action) after confirming `model.router.default` / `model.finder.default` are seeded in Remote Config.

These are surfaced in the frontmatter `human_verification` block.

---

_Verified: 2026-06-03T01:14:00Z_
_Verifier: Claude (gsd-verifier) — goal-backward verification against HEAD b4da70b_
