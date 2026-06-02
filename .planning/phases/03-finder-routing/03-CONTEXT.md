# Phase 3: Finder + Intent-Routing Activation - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning
**Mode:** auto (gray areas auto-resolved to recommended defaults — review the logged choices)

<domain>
## Phase Boundary

Add the **second pillar (Property Finder)** and **activate the LLM intent classifier** so two pillars genuinely share one chat surface. Pilot expands to 15–20 agents.

1. **Property Finder** — agent pastes a lead's criteria → ranked, **active-only** D2-project matches, each with attached collateral + a "why this match" rationale; per-lead context remembered + mid-conversation re-rank; investment-vs-own-stay + financing factored; sub-threshold/ineligible → grounded refusal (no bad match); filtered inventory queries ("which projects completed VP this year").
2. **Intent-routing activation** — the dormant `src/router/classifier.ts` seam (built P1, untouched P2) goes LIVE: the surface routes Coach↔Finder automatically, with the manual-override chip available.
3. **Project inventory + collateral admin** (ADMIN-04) — add/edit/hide projects + attach collateral, growing the Phase-2 admin app.

**Stack, architecture, data model, exec model, security are locked in TSD.md + PROJECT.md Key Decisions (incl. the 2026-06-01 Gemini + lazy-cron overrides). NOT re-litigated** — this captures Phase-3 implementation depth.

**⛔ Hard-constraint reminder:** "No GCP beyond Firebase" → collateral is NOT fetched via the Google Drive API. Collateral lives in **Firebase Storage** (or is referenced as plain share-link URLs); the `collateral` collection stores the reference, never a Drive-API integration.
</domain>

<decisions>
## Implementation Decisions

> `--auto`: each gray area resolved to its recommended default (logged). Reverse any in this file before `/gsd-plan-phase 3`.

### Intent classifier activation (FIND-11, SC5)
- **D-01:** **Activate the dormant `src/router/classifier.ts`** — heuristic-first, LLM-classifier fallback (the TSD seam). The heuristic handles obvious cases; the classifier disambiguates Coach vs Finder; the manual-override chip (built P2) forces the pillar. Classifier model resolves from **Remote Config** (TSD names `claude-haiku-4-5` for the router — never hard-coded). *Auto-selected: heuristic→classifier→override, model from Remote Config.*
- **D-02:** Routing decision is recorded on the message (`routeDecision`) for observability + eval; a mis-route is correctable via the override chip and feeds eval. *Auto-selected: record routeDecision + override-correctable.*

### Finder matching engine (FIND-01/03/09/10, SC1/SC3)
- **D-03:** **Hybrid match** — an LLM parses pasted free-text criteria into a structured query; ranking combines Firestore `findNearest` over **project embeddings (Gemini 1024-d)** + structured filters. **`searchProjects` ALWAYS enforces `status:'active'`** (no sold-out/hidden recommendations — grounding mandate). *Auto-selected: hybrid vector+structured, active-only enforced.*
- **D-04:** Each match carries a **"why this match" rationale grounded in real project fields** (priceBand, tenure, vpStatus, bumiQuota, foreignEligible) + the matched criteria — cites project IDs, never invents. *Auto-selected: grounded per-match rationale.*
- **D-05:** **Eligibility + segmentation gate the results:** investment-vs-own-stay (D-09 segmentation) + financing/affordability (D-10) + bumiputera/foreign eligibility filter matches; a sub-threshold or ineligible lead gets a **clear refusal-with-explanation** (`no_match`/`ineligible` signal), never a bad match (SC3). *Auto-selected: eligibility gate + grounded refusal over forcing a match.*

### Per-lead context + re-rank (FIND-05/06/08, SC2)
- **D-06:** **`leadContext/{leadId}` finderSlot** (the P1 shared-doc seam — coachSlot was wired P2; Phase 3 wires the **finderSlot**) stores the parsed criteria + projects already discussed + a rolling summary. Mid-conversation, when the lead's budget/preference shifts, the Finder **re-ranks from the updated leadContext without re-typing** (SC2/FIND-08); returning-client new-launch surfacing reuses the stored criteria (FIND-06). *Auto-selected: leadContext.finderSlot drives re-rank + returning-client recall.*

### Filtered inventory queries (FIND-07, SC4)
- **D-07:** The Finder tool supports **structured/filtered queries** (e.g., "completed VP this year") over the `projects` collection (status, vpStatus, completion date, priceBand) — inventory-grounded answers, NOT a vector-only match. *Auto-selected: structured query path alongside the vector match.*

### Inventory ingestion + collateral (FIND-02/04, ADMIN-04)
- **D-08:** **Admin-managed `projects` collection** (ADMIN-04 CRUD: add/edit/hide + attach collateral), seeded via a **structured import adapter** (CSV/JSON). The exact D2 source FORMAT (TSD §14 G4) is **flagged for Derek** — build the schema + a pluggable import path; default to a CSV importer. *Auto-selected: admin CRUD + CSV import adapter; confirm source format w/ Derek.*
- **D-09:** **`collateral` collection** links each asset (poster/video/fact-sheet) to a `projectId` via a Firebase **Storage path or external URL** (NOT the Drive API — no-GCP constraint). Matches attach the relevant collateral. *Auto-selected: collateral via Storage/URL reference, not Drive API.*

### Admin inventory management (ADMIN-04)
- **D-10:** **Grow the Phase-2 admin app** with a project-inventory manager (list + add/edit/hide + collateral attach), reusing the admin route group + role gate + the versioning/publish patterns. *Auto-selected: extend the admin surface, not a separate app.*

### Claude's Discretion (research/planning defaults)
- Exact criteria-parsing schema + ranking weights (vector vs structured blend) — researcher/planner propose.
- Classifier confidence threshold + heuristic-vs-LLM cutover — tune in planning; default to heuristic for clear keywords, classifier otherwise.
- Project-embedding text composition (which fields feed the 1024-d vector) — planner decides; keep 1024-d standard.

</decisions>

<carried_forward>
## Carried Forward (locked — do NOT re-ask)
- **Stack overrides (2026-06-01):** Gemini `gemini-embedding-001` @1024-d via `@ai-sdk/google` (project embeddings use `embedText`); on-visit lazy-cron (no QStash); AI SDK v5 `toUIMessageStreamResponse`.
- **Router:** the classifier seam built dormant in P1 (`src/router/classifier.ts`) is **activated here** — P2 kept it heuristic→Coach; Phase 3 is exactly where CHAT-03's multi-pillar routing becomes real.
- **Grounding mandate** (cite project/chunk IDs; `searchProjects` enforces `status:'active'`; refuse rather than invent), **model IDs from Remote Config**, **PII pseudonymized at the boundary** (lead criteria may carry PII → pseudonymize before the model) + `pdpa_redacted` gate + append-only audit, `tenantId` everywhere, **deny-by-default rules + CI rules tests**, mobile-first, trilingual.
- **leadContext** shared doc with agent-scoped write slots is the cross-pillar memory medium (coachSlot wired P2 → finderSlot wired here); the rolling summary is the Coach↔Finder handoff context.
- **No WhatsApp / no auto-send** (Reply Assistant is Phase 4); **no GCP beyond Firebase** (collateral via Storage/URLs, not Drive API).
</carried_forward>

<canonical_refs>
## Canonical References
**Downstream agents MUST read these. TSD = source of truth for HOW; PROJECT.md Key Decisions is authoritative for the 2026-06-01 overrides.**
- `.planning/TSD.md` — §3 architecture, §4 data model (**`projects` w/ status/priceBand/tenure/vpStatus/bumiQuota/foreignEligible/embedding(1024)**, `collateral`, `leadContext`, messages subcollection), §5 security (roles, deny-by-default, PDPA), §6 AI (grounding, model-swap, **intent router heuristic→LLM**), §14 **G4 (inventory format) — Phase-3 relevant**.
- `.planning/PROJECT.md` — Key Decisions (incl. Gemini + lazy-cron + D-09/calibration).
- `.planning/ROADMAP.md` — Phase 3 goal + 5 success criteria + the 13 req IDs.
- `.planning/REQUIREMENTS.md` — FIND-01..12, ADMIN-04.
- **Phase 1/2 outputs (the seams Phase 3 builds on):** `01-CONTEXT.md` (router/classifier/leadContext seams — note Voyage/QStash superseded), `02-CONTEXT.md` (carried_forward), and the P1/P2 SUMMARYs for `src/router/*` (01-07), `src/rag/*` (01-09 + 02-02 published filter), `src/memory/*` (leadContext slots), `src/agents/coach/*` (the agent pattern Finder mirrors), `app/[lang]/(admin)/*` (02-08 admin app to grow), `app/api/chat/route.ts` (the spine Finder plugs into).
- `CLAUDE.md` + `AGENTS.md` — hard constraints + Next.js 16 gotchas (read `node_modules/next/dist/docs/`).
- `.planning/research/{FEATURES,ARCHITECTURE,PITFALLS}.md` — Finder pillar table-stakes + pitfalls.
</canonical_refs>

<code_context>
## Existing Code Insights (Phase 3 extends, doesn't rebuild)
- **`src/router/*`** — `route()` heuristic + the **dormant `classifier.ts`** to activate; `routeDecision` + override seam exist.
- **`src/agents/coach/*`** — the agent shape (prompt + read-only tools + Zod schema, invoked through the router) that **`src/agents/finder/*`** mirrors; Finder's `searchProjects` tool enforces `status:'active'`.
- **`src/rag/*`** — `embedText` (Gemini 1024-d) + `findNearest` + the published/status filter (02-02); reuse for project vector search.
- **`src/memory/*`** — `leadContext` shared doc + slot writer (wire `finderSlot`); conversation subcollection.
- **`src/firebase/collections.ts`** — add/confirm `projects` + `collateral` typed refs (tenantId injected) + indexes (status, priceBand, vector field).
- **`app/[lang]/(admin)/*`** (02-08) — grow with the project-inventory manager (ADMIN-04).
- **`app/api/chat/route.ts`** — the Node SSE spine; Finder plugs in behind the now-active router.
- **Vendored:** shadcn + recharts + sonner; `app/[lang]/chat/*` surfaces the pillar (match cards + collateral).
</code_context>

<specifics>
## Specific Ideas
- The pilot litmus (SC1–5): paste criteria → ranked active-only matches w/ collateral + rationale; re-rank on preference shift without re-typing; investment/financing + eligibility refusal; filtered VP queries; and one conversation auto-routing Coach↔Finder with the override chip.
- "Grow, don't fork" continues: Finder mirrors the Coach agent pattern; the admin inventory manager grows the KB admin app; the classifier is the seam flipped on.
- Biggest watch-items: the **active-only enforcement** (never recommend sold-out — grounding), **router precision** (mis-routes erode trust — record + eval + override), and the **inventory source format (G4)** — confirm with Derek before the import is finalized.
</specifics>

<deferred>
## Deferred Ideas (NOT Phase 3)
- **Reply Assistant pillar + WhatsApp paste-and-draft** — Phase 4.
- **Public recommender / auto-assignment** — v2 (PUB-01/02).
- **Voice-fingerprint consumption** — Phase 4.
- **Drive-API live sync of collateral** — excluded by the no-GCP constraint; collateral is referenced, not API-synced.
</deferred>

---
*Phase: 03-finder-routing*
*Context gathered: 2026-06-02 (--auto)*
