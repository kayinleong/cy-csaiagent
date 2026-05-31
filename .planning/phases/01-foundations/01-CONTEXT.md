# Phase 1: Foundations - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up every shared platform component in **thin, working form** and resolve the three de-risking spikes, proving one vertical slice end-to-end: a logged-in agent sends a message → the heuristic router picks Coach → a grounded, streamed, cited Coach response → the message persists across refresh → an append-only audit row is written.

Phase 1 delivers the portable application core (`src/agents`, `router`, `llm`, `memory`, `rag`, `kb`, `escalation`, `audit`, `ratelimit`, `i18n`, `firebase`), the Firebase data plane (Auth + custom claims, Firestore + region, Storage, deny-by-default rules), the streaming chat shell, the eval harness scaffold, and the QStash cron seam.

**Stack, architecture, data model, exec model, and security posture are already locked in TSD.md and are NOT re-litigated here** — this discussion captured implementation depth, sequencing, and the P1↔P2 seam only.

</domain>

<decisions>
## Implementation Decisions

### Build shape & "thin" calibration
- **D-01:** Build as **spine + real-but-thin cross-cutting**. One vertical slice (sign-in → stream → persist → audit) is the integration spine; everything hangs off proving it works on real infrastructure.
- **D-02:** These cross-cutting concerns are **REAL but thin from day 1** (expensive to retrofit per research): `audit/` (append-only, written via `after()`), `tenantId` on every doc, deny-by-default Firestore rules + `@firebase/rules-unit-testing` CI coverage, the `app/[lang]/` i18n segment, the `ratelimit/` interface with real decrement, and the `llm/` abstraction with a deterministic fake provider.
- **D-03:** These stay **deliberate stubs** in Phase 1: the intent router (heuristic-only, always routes to Coach; LLM classifier activates Phase 3), the eval harness (Promptfoo + Opus-judge config + ONE trilingual gold fixture + documented human-calibration plan), and voice-sample capture (reserve `users.voiceSamples[]` schema only; capture UX deferred to Phase 2 onboarding, consumed Phase 4).

### Spike sequencing & gating
- **D-04:** Run the 3 required spikes (**SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON**) in **week 1, in parallel** with spike-independent scaffolding (Auth + custom claims, Firestore schema, deny-by-default rules, i18n segment, `llm/` fake provider). Module implementations that hinge on a spike outcome (`rag/` adapter, chat-route deploy target, `jobs/` handler) wait for that spike's go/no-go.
- **D-05:** **Spike-failure protocol:** SPIKE-RAG fail → swap `rag/` adapter to Pinecone Serverless (app state stays in Firestore); SPIKE-CRON fail → GitHub Actions scheduled-workflow backup. Both **fork in-place and the phase continues**, with the decision logged in PROJECT.md Key Decisions. **SPIKE-DEPLOY failure escalates to Derek** — its fallback (Vercel front-end + Firebase backend) has data-residency implications that are his call, not an engineering default.
- **D-06:** Also in Phase 1 scope alongside the 3 required: **SPIKE-AI-SDK** (AI SDK v5 `useChat`/`streamText` + typed tools + Anthropic `cache_control` on Next.js 16; fallback = `@anthropic-ai/sdk` direct for the chat route), **SPIKE-INGEST** (chunked-poll loop ingests a 100–200pg PDF within timeout budget), and the **Next.js 16 caching audit** (verify implicit caching removed, `proxy.ts` not `middleware.ts`, async `cookies()/headers()`; add CI lint rule). The **PDPA TIA is a non-negotiable gate** regardless.

### Language / multilingual depth
- **D-07:** **English is the end-to-end proof slice** (UI copy + seeded KB content + retrieval + a real streamed answer). Satisfies success-criterion #3 at lowest cost. The multilingual cliff is **not hidden** because SPIKE-RAG measures BM/中文 recall on ~500 multilingual chunks and the eval fixture is trilingual from day 1.
- **D-08:** **Full trilingual machinery is REAL in Phase 1:** all three `next-intl` catalogs (`app/[lang]`: `en|ms|zh`), `proxy.ts` locale detection, per-message `franc-min` language detection, a trilingual eval gold fixture (1 scenario × 3 languages), and a **documented native-review process** (not raw MT). Only the seeded **KB content** is proof-language (EN) for now; full trilingual KB translation + retrieval proof is Phase 2.

### Phase-1 Coach & the P1↔P2 seam
- **D-09:** The Phase-1 Coach is **minimal-but-extensible with real grounding**: a thin scoped system prompt + ONE read-only tool (`retrieveKnowledge` → `rag.retrieve` over the seeded EN doc, lang-filtered `findNearest`) + **real citations** (KB chunk IDs) + a Zod output schema, **invoked through the heuristic router** (not called directly). It exercises the full pipe (router→agent→rag→llm→stream→persist→audit) and proves the grounding mandate. Phase 2 grows this *same* Coach — it is not throwaway.
- **D-10:** **Real-but-thin SEAMS** for four capabilities the user pulled into Phase 1 (originally P2-mapped). Present but minimal, matching the spine philosophy — full depth lands in Phase 2:
  - **Journey state machine:** tracks `agentProfiles.journeyStage` / `currentCheckpoint` (no rich checkpoint UI).
  - **Escalation:** `escalation/` interface + a QStash stall-detect job wired (uses SPIKE-CRON output); the senior-coach *receiving* side is thin.
  - **KB-miss handoff:** retrieval miss **emits a handoff signal** (full senior-coach dashboard to land it is Phase 2).
  - **KB + admin:** KB layer stays **multi-doc-capable** with a **minimal authenticated CRUD form** (NOT the full plain-language admin web app). This supersedes the earlier "1 small doc, no admin UI" stub: ingestion is *proven* on a small doc but the data model and CRUD are multi-doc-capable.
- **D-11:** **Consequence of D-10 — three roles needed thin in Phase 1**, not just `new-agent`: the seams require a **thin `senior-coach`** role (to receive a handoff/escalation) and a **thin `admin`** role (to use the KB CRUD form). All three roles must be covered by the deny-by-default rules + CI rules tests. Full sign-in surfaces and dashboards for coach/admin remain Phase 2.
- **D-12:** **Scope note:** D-10/D-11 expand Foundations by ~1 week and partially advance P2 requirements (COACH-03/04/05/06, CHAT-06, ADMIN-01/03, and minimal AUTH-02/06) **without** absorbing Phase 2. The ROADMAP structure stands as-is; the planner must account for the added seams and the ~1-week expansion. This was a deliberate user decision (chose "real-but-thin seams" over both "defer to P2" and "full P2 merge").

### Explicitly grounded by TSD (carried forward, not re-asked)
- Stack/versions (TSD §2), core/shell split + 14-collection model + messages-in-subcollection (§3–§4), SSE-from-Node-Route-Handler + chunked client-driven ingestion + QStash-signed `/api/jobs/*` (§3.4), deny-by-default rules + pseudonymize-at-boundary + append-only audit + `pdpa_redacted` gate (§5), grounding-mandate + model-swap-via-Remote-Config (§6), Voyage 1024-d embeddings standardized across collections, region default `asia-southeast1`.

### Claude's Discretion (skipped gray areas → research/planning defaults)
- **Firebase dev environment (G1):** emulator-suite-first vs. a real in-region dev project. Default to **emulator-first for rules/unit/integration tests, real in-region project for SPIKE-DEPLOY**. **Region confirmation with Derek is a HARD prerequisite** before any Firebase resource is created (TSD §14 G1 — immovable once set); planner must surface this as a blocking pre-task.
- **Auth role scaffolding depth:** how thin the three roles are beyond claims + rules. Default to **custom claims + rules coverage + rules-unit-tests for all three; minimal sign-in only for `new-agent`** (the proof slice), coach/admin claims set via script/Admin SDK for seam testing.
- **PDPA TIA ownership + redaction depth:** default to **team-drafted TIA + Derek sign-off** (escalate to external counsel only if Derek requires); the pseudonymization layer + `pdpa_redacted` gate are **fully implemented + unit-tested** in Phase 1 (cheap, and the gate is load-bearing) even though Phase 1 runs on synthetic data. TIA gates the *pilot*, redaction gates the *build*.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** The TSD is the source of truth for HOW; when TSD and research disagree, TSD wins.

### Technical spec (the HOW — primary)
- `.planning/TSD.md` — full technical spec. Phase-1-critical sections:
  - §1.1 — Hard Constraints C1–C7 (no Cloud Functions, Firebase-SDK-surface only, no WABA, no auto-send, model-agnostic, PDPA residency, multilingual)
  - §2 — Technology Stack with locked versions (Next.js 16.2.6, AI SDK v5, Voyage `voyage-3-large` 1024-d, QStash, next-intl ^4, Zod ^4, Promptfoo, vitest/playwright/`@firebase/rules-unit-testing`)
  - §3 — System Architecture: directory layout, core/shell import rule, component responsibilities (§3.2), per-pillar data flow (§3.3), **server execution model §3.4** (SSE headers, chunked ingestion, QStash cron, secrets)
  - §4 — Data Model: 14 collections, `tenantId` on every doc, messages subcollection, vector specifics (`findNearest` DOT_PRODUCT, lang pre-filter)
  - §5 — Security: roles (§5.1), deny-by-default rules posture + CI gate (§5.2), **PDPA/cross-border §5.3** (TIA, boundary pseudonymization, `pdpa_redacted` gate, audit hashes-only)
  - §6 — AI/Agent Design (grounding mandate, voice fingerprint foundation, model swap via Remote Config)
  - §7 — i18n; §8 — Evaluation; §9 — Observability/ratelimit; §10 — Deployment (App Hosting `asia-southeast1`, `minInstances=1`)
  - §11 — Phase→Spec mapping (the Phase 1 row enumerates which TSD sections must be realized)
  - §14 — Open Questions **G1 (region), G2 (Anthropic residency / Bedrock-SG fallback), G3 (embedding BM/中文 quality), G4 (inventory format), G5 (voice-sample consent)** — G1/G2/G3 are Phase-1 relevant

### Roadmap, requirements, project
- `.planning/ROADMAP.md` — Phase 1 details (goal, depends-on, requirements list), the **three Required Spikes with pass/fallback criteria**, the 5 success criteria, and the Roadmap-Level Constraints every plan must honor
- `.planning/REQUIREMENTS.md` — Phase-1 REQ-IDs: **FND-01–11, AUTH-01/04/05, QUAL-01/03/04/05/07** (+ traceability table). Note: D-10/D-11 also partially touch COACH-03/04/05/06, CHAT-06, ADMIN-01/03, AUTH-02/06 as thin seams
- `.planning/PROJECT.md` — vision, core value, constraints, Key Decisions table, Out-of-Scope boundaries

### Research (the WHY / decisive context)
- `.planning/research/SUMMARY.md` — executive read; **Build Order Phase 0** (the foundations rationale + exit criteria), **Top 5 Risks + Mitigations**, the **Phase 0 spike table** (RAG/DEPLOY/CRON/AI-SDK/INGEST/caching/TIA with pass criteria + fallbacks)
- `.planning/research/STACK.md` — full stack table with version rationale and rejected alternatives
- `.planning/research/ARCHITECTURE.md` — component map; **§10 hidden dependencies** (why memory/audit/ratelimit/eval/i18n/`tenantId` must precede any agent)
- `.planning/research/PITFALLS.md` — full 36 pitfalls; the P0 set (6, 7, 8, 9, 21, 22, 32, 35) must be avoided in Phase 1
- `.planning/research/FEATURES.md` — table-stakes per pillar; cross-cutting foundation features

### Project conventions / framework gotchas
- `CLAUDE.md` (repo root) — project layer: stack, hard constraints, Next.js 16 gotchas, conventions (core/shell split, `tenantId`, grounding, PII boundary), GSD workflow enforcement
- `AGENTS.md` (repo root) — "this is NOT the Next.js you know"; **read `node_modules/next/dist/docs/` before writing any Next.js 16 code** (`proxy.ts` not `middleware.ts`, async `cookies()/headers()`, implicit caching removed)
- `node_modules/next/dist/docs/` — authoritative Next.js 16 API reference (MANDATORY pre-read for any Next.js code)

### Source docs (superseded — reference only)
- `Impl Plan.docx`, `Requirements.docx` (repo root) — original D2 source documents; **superseded by the `.planning/` markdown above**, retained for provenance only

</canonical_refs>

<code_context>
## Existing Code Insights

Scaffold scouted 2026-05-31. The repo is a **stock Next.js 16 skeleton with the full shadcn component library vendored** — the entire application core is net-new.

### Reusable Assets
- **`components/ui/` — 55 shadcn components already vendored** (cards, dialogs, forms, tabs, etc.). Use these for the chat shell, the minimal KB CRUD form, and any seam UI. Do not re-add shadcn.
- **`lib/`** — shadcn `utils.ts` (cn helper) present; `hooks/` directory exists.
- **Installed UI libs ready to use:** `next-themes` (dark mode), `sonner` (toasts), `cmdk` (command palette), `recharts` (charts for future dashboards), `lucide-react`, `react-resizable-panels`, `embla-carousel-react`, `date-fns`.

### Established Patterns
- **Stock Next.js 16 App Router**: `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (Tailwind 4) only. No routing structure beyond the default page yet.
- **No `src/` directory exists** — the framework-agnostic core (`src/agents`, `router`, `llm`, `memory`, `rag`, `kb`, `escalation`, `audit`, `ratelimit`, `i18n`, `firebase`) is built from scratch per TSD §3.1.
- **No `proxy.ts`, no `app/[lang]/` segment yet** — both are net-new in Phase 1.

### Integration Points
- **`app/[lang]/` segment** to be created (i18n); **`proxy.ts`** to be created at app root for locale + auth gate (NOT `middleware.ts`).
- **`app/api/chat/route.ts`** (Node runtime, SSE) and **`app/api/jobs/*`** (QStash-signed) are the server entrypoints.
- **`package.json` is frontend-only today** — Phase 1 adds Firebase (`firebase`, `firebase-admin`), AI (`ai`, `@ai-sdk/anthropic`, `@anthropic-ai/sdk`), `next-intl`, `zod`, ingestion libs (`pdfjs-dist`, `mammoth`, `franc-min`, `gpt-tokenizer`), QStash client, `promptfoo`, and test deps (`vitest`, `@playwright/test`, `@firebase/rules-unit-testing`). None are present yet.

### Constraints from the scaffold
- Greenfield core means **no legacy patterns to honor** — follow TSD §3 layout exactly. The only fixed surface is the shadcn UI library and Tailwind 4 config.

</code_context>

<specifics>
## Specific Ideas

- The vertical-slice spine is the litmus test for "done" in Phase 1: **sign-in → heuristic router → grounded Coach (real `rag.retrieve` + citations) → SSE stream → persist to messages subcollection → append-only audit row**, demonstrated on a real phone over a real mobile network (SPIKE-DEPLOY conditions), in **English**.
- "Real-but-thin" is the recurring discipline: the things that are expensive to retrofit (audit, `tenantId`, rules, i18n segment, ratelimit interface, `llm` fake provider, the pseudonymization gate) are **real**; the things that are cheap to grow later (LLM router classifier, full KB scale, eval gold sets, voice-capture UX, coach/admin dashboards) are **thin/stubbed**.
- The Phase-1 Coach is the *same* Coach Phase 2 grows — design its prompt/tool/schema for extension, not as a throwaway.

</specifics>

<deferred>
## Deferred Ideas

Captured during discussion, explicitly NOT in Phase 1 scope:

- **Full Coach depth** (rich checkpoint UI, comprehension checkpoints, channel-specific playbooks) — Phase 2 (COACH-07/08/09).
- **Senior-coach dashboard** (downline list, read-only drilldown, knowledge-gap inbox, inline correction) — Phase 2 (CDASH-01–07); Phase 1 only emits the handoff/escalation signal a thin coach role can receive.
- **Full plain-language admin web app** — Phase 2 (ADMIN-01/03); Phase 1 ships only a minimal authenticated KB CRUD form.
- **Full trilingual KB content + retrieval proof** (native-reviewed BM/中文 docs) — Phase 2; Phase 1 seeds EN content only but keeps the machinery trilingual.
- **LLM intent classifier activation** — Phase 3 (a second pillar must share the surface first); Phase 1 keeps the heuristic stub.
- **Voice-sample capture UX** — Phase 2 onboarding build; Phase 1 reserves the `voiceSamples[]` schema field only. Consumed in Phase 4.
- **"Full P2 merge" alternative** — the user considered merging Phase 2's Coach+Admin into Phase 1 at full depth, then chose the bounded "real-but-thin seams" path instead. If foundations runs ahead of schedule, the merge remains an option to revisit at the Phase-1→2 boundary.

</deferred>

---

*Phase: 01-foundations*
*Context gathered: 2026-05-31*
