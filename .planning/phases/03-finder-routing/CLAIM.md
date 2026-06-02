# Claim: phase-kayinleong-03

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-02
- status: done
- summary: Execute Phase 3 (Finder + Intent-Routing Activation) — 9 plans across 5 waves. Property Finder pillar + activated LLM intent classifier; two pillars share one chat surface; pilot 15–20.

## What will change

All 9 Phase-3 plans (03-01..03-09): inventory data model (priceValue/vpDate + indexes/rules), classifier activation, two-stage searchProjects (active/eligibility filter → Gemini vector re-rank), inventory CRUD + import seam, Finder agent, leadContext finderSlot re-rank, chat-route Finder dispatch + match cards, admin inventory manager, Finder/router evals + pilot provisioning. Built against real Firebase (Gemini embeddings, on-visit lazy-cron) per the locked overrides; collateral via Storage/URL (no Drive API); grounding (active-only, cite project IDs); PDPA on the Finder path.

Two checkpoints: 03-08 (G4 inventory source format → Derek) + 03-09 (FIND-12 pilot provisioning + live evals — live-gated).

Continues on branch `phase-kayinleong-01` (stacks on P1+P2); split into PRs at the user's direction.

## What has changed

All 9 plans executed across 5 waves (per-plan detail in each `03-0{1..9}-SUMMARY.md`):

- **03-01** inventory data model — `ProjectDoc` (`priceValue`/`priceBand`/`vpDate`), `CollateralDoc.externalUrl`, Firestore composite indexes + deny-by-default read rules.
- **03-05** intent classifier activated — `src/router/classifier.ts` (`classifyIntent` via `generateObject` + `modelFor('router')`); `routeAsync` (override → heuristic → classifier → low-confidence-default-Coach); sync `route()` preserved + re-exported.
- **03-02** two-stage `searchProjects` — Stage A deterministic `status=='active'` + eligibility/affordability filter, Stage B Gemini 1024-d `findNearest` re-rank (sold-out can never surface).
- **03-03** inventory CRUD + import seam — admin-gated embed-on-write/soft-hide/`attachCollateral` (Storage/URL, no Drive API) + pluggable `ProjectSource` (CSV default).
- **03-04** Finder agent — criteria parser, read-only tools (`searchProjects`/`fetchCollateral`/`queryInventory`), Zod `outputSchema`, grounded refusal/no-match; cites project IDs.
- **03-06** `leadContext` finderSlot — per-lead criteria remembered + re-rank across messages (cross-pillar memory).
- **03-07** chat-route Finder dispatch — gate order `requireUser → ratelimit → pseudonymize+assertRedacted → routeAsync → dispatch coach|finder → toUIMessageStreamResponse`; match-card rendering + manual-override chip.
- **03-08** admin inventory manager UI (ADMIN-04, FIND-02/04).
- **03-09** Finder/router Promptfoo gold sets (finder-grounding, finder-segmentation, router-precision; trilingual) + `promptfooconfig.yaml` + skip-guarded Playwright scaffolds (`e2e/finder-flow.spec.ts`, `e2e/inventory-admin.spec.ts`) + dry-run-guarded `scripts/provision-finder-pilot.ts` (FIND-12).

Built against real Firebase per the locked overrides (Gemini embeddings, on-visit lazy-cron, Firestore findNearest; zero Functions/Vertex/PubSub/QStash). PDPA boundary (pseudonymize+assertRedacted) runs on the Finder path; models resolve from Remote Config (no hard-coded IDs).

## Verification

Per-plan SUMMARY self-checks PASSED + `gsd-verifier` goal-backward verification (`03-VERIFICATION.md`):

- **Verdict:** `goal_achieved: true` (status `human_needed` only for the 3 deliberately live-gated runs) — **0 genuine code gaps**.
- 5/5 success criteria · 14/14 plan must-have truths · 13/13 requirements (FIND-12 code-ready, human-gated).
- **8/8 hard guarantees PASS** (active-only grounding two-stage, citation/grounded-refusal, eligibility filter, two-pillar routing, read-only auth-as-user tools, PDPA boundary, model-agnostic, no-GCP overrides).
- **Quality gates:** `npx tsc --noEmit` clean; `npx vitest run` GREEN (452 passed / 97 skipped / 0 failed at HEAD `b4da70b`).
- **Regression report:** no regressions — Coach path/audit/ratelimit/KB unmodified by Phase 3 (git-diff confirmed); 28/28 coach tests pass; sync `route()` preserved (stall-detect caller unaffected); `collections.ts` + `routeAsync` additive; `firestore.rules` untouched by Phase 3.

### Open human-action gate (live-gated, NOT a code gap)
1. Live Promptfoo finder/router evals (need live Anthropic/Gemini/Firestore + Opus judge from Remote Config).
2. Playwright `finder-flow` + `inventory-admin` — remove `test.skip`, run against a deployed seeded stack.
3. FIND-12 pilot provisioning — `scripts/provision-finder-pilot.ts --apply` to 15–20 real agents (dry-run by default).
