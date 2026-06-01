@AGENTS.md

> This project's CLAUDE.md **extends** the global `~/.claude/CLAUDE.md` — it does not override it. The global Claim-Before-Start protocol, owner-slug commit format, regression-prevention rules, secrets hygiene, and review/merge etiquette all still apply. What follows is the project-specific layer.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**D2 Customer Service AI Agent Platform** (`cy-csaiagent`) — a multi-pillar AI agent platform for D2, a Malaysian real-estate brokerage. New agents talk to ONE mobile-first chat surface that routes between three specialist AI agents:

1. **Onboarding Coach** — D2-grounded training Q&A, onboarding journey state machine, proactive stall nudges, escalation to senior coaches.
2. **Property Finder** — paste lead criteria → ranked D2-project matches with collateral attached.
3. **Reply Assistant** — paste incoming WhatsApp → drafted reply grounded in D2 SOPs (suggested only, never auto-sent).

Plus a **senior-coach dashboard** (downline progress, stall alerts, knowledge gaps, inline AI correction) and an **admin web app** (plain-language knowledge-base management, no engineering involvement).

**Core value:** compress new-agent ramp from 60 days to 7–10 days. If one thing must work: a new agent gets a *useful, D2-specific* answer in their pocket at 11pm.

**Stakeholder:** Derek (project lead + KB owner). **Team:** 2 engineers (AI lead + product lead). **Timeline:** 16 weeks, 5 phases.

Planning artifacts (read these before non-trivial work):
- `.planning/PROJECT.md` — full context, requirements, key decisions
- `.planning/TSD.md` — **technical spec: architecture, data model, execution model, security** (the HOW)
- `.planning/ROADMAP.md` — 5-phase build order + success criteria
- `.planning/REQUIREMENTS.md` — 85 v1 requirements with REQ-IDs + traceability
- `.planning/research/SUMMARY.md` — executive research read (stack, risks, spikes, build order)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

- **Frontend:** Next.js `16.2.6` (App Router) + React `19.2.4` + shadcn/ui (`radix-ui` + `@base-ui/react`) + Tailwind 4. **All shadcn components already vendored in `components/ui/`.**
- **Backend:** Firebase only — Auth (+ custom claims), Firestore (Native), Cloud Storage, App Hosting. Region `asia-southeast1` (confirm with Derek before creating resources — immovable).
- **Vector store:** Firestore native `findNearest` KNN (no Cloud Functions). Fallback behind the `rag/` adapter: Pinecone Serverless.
- **AI:** Vercel AI SDK v5 (`ai` + `@ai-sdk/anthropic`) over Anthropic SDK. Default `claude-sonnet-4-6`; `claude-opus-4-7` for eval judge; model IDs in **Remote Config, never hard-coded**.
- **Embeddings:** Gemini `gemini-embedding-001` (1024-d via `outputDimensionality`, normalized, multilingual) through `@ai-sdk/google` (Gemini **Developer API**, key `GOOGLE_GENERATIVE_AI_API_KEY` — NOT Vertex AI). Standardize 1024-d across all collections.
- **Scheduled jobs:** **on-visit lazy-cron Server Action** — periodic work (stall-detect, escalate, eval-nightly, usage-rollup) runs when an authorized user loads the app, guarded by a Firestore last-run-per-window check. No QStash, no external scheduler. (Tradeoff: not wall-clock cron; fires on visit.)
- **i18n:** `next-intl ^4`, `app/[lang]/` segment. **EN / BM / 中文 from day one.**
- **Evals:** Promptfoo (Opus 4.7 judge). **Testing:** Vitest, Playwright, `@firebase/rules-unit-testing`.

### ⛔ Hard constraints — violating any of these is a defect, not a style choice
- **No Google Cloud Functions.** All server logic = Next.js Route Handlers / Server Actions / Server Components.
- **No GCP beyond the Firebase SDK surface.** No Cloud Run (direct), Vertex AI, BigQuery, Pub/Sub, Cloud Scheduler. (No external scheduler at all — periodic work is an on-visit lazy-cron Server Action. Gemini embeddings use the **Developer API**, not Vertex.)
- **No WhatsApp Business API in v1.** Paste-and-draft only.
- **No auto-send, ever.** Reply Assistant = copy-to-clipboard; the agent sends from their own phone.
- **Model-agnostic.** Never hard-code a model ID; resolve from Remote Config.
- **PDPA / data residency.** Pseudonymize PII at the Claude boundary; audit log on every client-related conversation; never log PII.
- **Multilingual is not a late add-on.** It affects retrieval, routing, and UI copy.

### ⚠️ Next.js 16 gotchas (this is NOT the Next.js in your training data — see AGENTS.md)
- It's `proxy.ts`, **not** `middleware.ts`.
- `cookies()` / `headers()` are **async** — await them.
- Implicit data-fetch caching was **removed** — every fetch is uncached unless you opt in. Do not assume caching.
- Streaming = Route Handler returning `streamText().toDataStreamResponse()` with `X-Accel-Buffering: no`. **Never** stream from a Server Action.
- **Read `node_modules/next/dist/docs/` before writing Next.js code.**
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:TSD.md -->
## Conventions

- **Core/shell split:** `app/` may import from `src/`; `src/` must **never** import from `app/`. The application core (`src/agents`, `router`, `llm`, `memory`, `rag`, `kb`, `escalation`, `audit`, `ratelimit`, `i18n`, `firebase`) is portable and unit-testable without Next.
- **Every Firestore doc carries `tenantId`** (single-tenant `"d2"` now; don't paint into a corner).
- **Messages live in a subcollection** (`conversations/{cid}/messages`), never an inline array (1 MB doc-size trap).
- **Agent tools are read-only** and authenticate **as the user** — never as admin from a user-facing path.
- **Grounding is mandatory:** answers cite source IDs. Finder's `searchProjects` enforces `status:'active'` (no sold-out recommendations). Reply emits `no_sop_match` rather than inventing SOP content.
- **PII pseudonymized at the boundary**; a `pdpa_redacted:true` gate refuses unredacted production model calls. Audit log stores hashes only.
- **Long-running work is chunked + client-driven** (PDF ingestion polls `/api/kb/ingest/process`) — never one mega-request (Cloud Run timeout).
- **Secrets** via App Hosting + Secret Manager. Never in client bundles, never logged. (Global secrets-hygiene rules apply in full.)
- **Tests:** security rules covered in CI for every collection; model-swap proven by integration test (QUAL-01); trilingual eval gold sets scored independently.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Single Next.js 16 monolith on Firebase App Hosting. Firestore is the system of record **and** the vector index **and** the cross-agent message bus — no event bus, no microservices.

- **Chat flow:** `proxy.ts (auth+locale) → /api/chat (SSE, Node runtime) → router → agent → rag.retrieve (lang-filtered findNearest) → llm.stream (Sonnet, prompt-cached) → SSE tokens`; side effects write `memory`, `audit` (via `after()`), and decrement `ratelimit`.
- **Cross-pillar memory:** `leadContext/{leadId}` shared doc with **agent-scoped write slots** + rolling summary — the handoff medium between Coach/Finder/Reply.
- **Intent router:** heuristic-first, LLM-classifier fallback (the seam exists from Phase 1; the LLM classifier activates in Phase 3 when a second pillar shares the surface) + manual-override chip.
- **Background jobs:** on-visit lazy-cron Server Action — when an authorized user loads the app, a Server Action runs any DUE jobs (stall-detect, escalate, eval-nightly, usage-rollup), gated by a Firestore last-run-per-window doc (the heartbeat doubles as the run-ledger). No external scheduler. A UI watchdog surfaces a stale last-run.

See `.planning/TSD.md` §3–§4 for the full component map, data-flow diagrams, and the 14-collection Firestore data model.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found yet. Add skills to `.claude/skills/<name>/SKILL.md` as domain knowledge stabilizes (e.g., a `d2-domain` skill for bumiputera/foreign-buyer rules, or a `voice-calibration` skill once tone patterns are validated).
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

This project uses the GSD workflow. Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Entry points:
- `/gsd-plan-phase 1` — plan the next phase (start here; Phase 1 = Foundations)
- `/gsd-discuss-phase 1` — gather context / clarify approach before planning
- `/gsd-ui-phase <n>` — generate the UI design contract (all 5 phases carry a UI hint)
- `/gsd-execute-phase <n>` — execute planned phase work
- `/gsd-quick` — small fixes, doc updates, ad-hoc tasks
- `/gsd-progress` — check state at session start

Per the global Claim-Before-Start protocol: **no code changes without a committed claim.** Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

**Phase 1 is spike-gated:** SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON must resolve (with documented pass/fallback) and a PDPA TIA must be on file before downstream phases begin. A signed week-4 go/no-go memo gates Phase 3.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
