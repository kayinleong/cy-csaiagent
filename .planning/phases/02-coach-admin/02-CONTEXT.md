# Phase 2: Coach + Admin v1 - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning
**Mode:** `--auto` (gray areas auto-resolved with recommended defaults — review the logged choices below)

<domain>
## Phase Boundary

Take the Phase-1 **thin seams** to **pilot depth** for ONE pillar (the Onboarding Coach) plus its two management surfaces, shipped to a **5–10 agent pilot**:

1. **Coach, full** — a new agent is coached end-to-end: day-one pairing + content kickoff, a tracked onboarding journey with comprehension checkpoints, training Q&A grounded in the D2 KB (cited, never generic), channel playbooks + a Meta-ad walkthrough, proactive stall nudges, KB-miss + manual handoff.
2. **Mobile chat surface, full** — persistent history, conversation list/search, AI disclosure, inline "talk to my coach" handoff, streaming, trilingual auto-detect + manual override.
3. **Senior-coach dashboard v1** — downline-scoped: onboarding-stage view, stall-alert inbox, knowledge-gap feed (questions asked), inline AI correction that feeds the KB, funnel + ramp-time metrics.
4. **Admin KB app** — Derek manages the KB in plain language, no engineer: multi-doc list, versioning, plain-language editing, the (already-built) multi-format upload, publish/unpublish.

**Stack, architecture, data model, execution model, and security posture are locked in TSD.md and the PROJECT.md Key Decisions table (including the 2026-06-01 overrides — see `<carried_forward>`). They are NOT re-litigated here** — this discussion captured Phase-2 implementation depth and the choices a downstream researcher/planner needs.

**⛔ Execution gate:** Phase 2 build is **blocked until Phase 1's open gates close** — live provisioning (01-01), and the live spikes SPIKE-RAG / SPIKE-DEPLOY / SPIKE-INGEST (SPIKE-CRON retired). Planning ahead is fine; executing Phase 2 on an unverified foundation is not.
</domain>

<decisions>
## Implementation Decisions

> In `--auto` mode each gray area below was resolved to its **recommended default**. The default + one-line rationale is logged. Reverse any of these by editing this file before `/gsd-plan-phase 2`.

### Chat surface & conversation model (CHAT-01/02/04/07/08)
- **D-01 — Conversation model:** ONE persistent primary "Coach" thread per agent (the coaching relationship), PLUS a conversation list + search view for browsing history (CHAT-07). Mobile-first: the active thread is the default screen; history is a drawer/list. *Auto-selected: primary-thread-plus-history-list — matches a 1:1 coach relationship while satisfying CHAT-07.*
- **D-02 — Trilingual UX:** per-message auto-detect (franc-min, already built) drives reply language; a manual language override chip lets the agent pin EN/BM/中文 (CHAT-08). UI copy comes from the existing `next-intl` catalogs (extend them for Phase-2 strings). *Auto-selected: auto-detect + manual-override chip — the P1 machinery already supports this.*
- **D-03 — Streaming + persistence reuse the P1 spine** unchanged: Node-runtime `/api/chat` SSE (`toUIMessageStreamResponse`, `X-Accel-Buffering:no`) → messages subcollection → `after()` audit. Phase 2 does not re-architect the spine; it grows the Coach behind it.

### AI disclosure & human handoff (CHAT-05/06, COACH-06)
- **D-04 — AI disclosure:** a one-time first-run disclosure screen + a persistent "AI" badge in the chat header (PDPA-aligned, non-intrusive, shown before first interaction). *Auto-selected: first-run modal + persistent badge.*
- **D-05 — Handoff control:** an inline "Talk to my coach" action in the chat header that bundles context (rolling `leadContext` summary + recent messages + `journeyStage`) into an **escalation row** via the P1 `emitHandoffSignal` seam → surfaced on the senior-coach dashboard. KB-miss (COACH-06) reuses the same path automatically. *Auto-selected: header action → context-bundled escalation, reusing the P1 escalation seam.*

### Onboarding journey & Coach depth (COACH-01/03/07/08/09)
- **D-06 — Journey model:** a **config-driven linear journey of named checkpoints/stages** tracked in `agentProfiles.journeyStage` / `currentCheckpoint` (the P1 seam, grown), with **comprehension checks at key gates** (COACH-09 — replace passive video). Journey content references **KB doc IDs** so Derek edits it via the admin app (no code change). Day-one pairing (COACH-01) introduces the Coach, confirms the senior-coach assignment, and kicks off the PowerBoost playlist (KB-driven). *Auto-selected: config/KB-driven checkpoint journey with comprehension gates.*
- **D-07 — Playbooks & walkthroughs (COACH-07/08):** delivered as **KB-grounded structured guidance** — channel playbooks (Meta/WhatsApp/Google/iProperty/content) and the first-Meta-ad walkthrough are KB docs the Coach retrieves and walks through conversationally with comprehension checkpoints. No bespoke per-playbook UI; everything stays grounded + KB-driven (honors the grounding mandate). *Auto-selected: KB-grounded conversational walkthroughs over bespoke UI.*

### Stall nudges & escalation (COACH-04/05, CDASH-02/06)
- **D-08 — Nudge/escalation engine:** grow the P1 **on-visit lazy-cron Server Action** (`src/jobs/runDueJobs.ts`) with `stall-detect` (2+ days → in-app nudge written into the agent's coach thread, COACH-04), `escalate` (48h no response → escalation row + dashboard stall alert, COACH-05/CDASH-02), and working-hours gating on escalation delivery (CDASH-06). *Auto-selected: in-app nudges + escalations driven by the lazy-cron Server Action (no QStash — see [[carried_forward]]).*
- **D-09 — ⚠ KNOWN TENSION (flag for the user):** the lazy-cron fires **on an authorized visit**, so a truly idle overnight period defers nudges — which softens the "proactive nudge at 11pm" core value. For the pilot, **in-app-on-visit nudges are the default**; if the pilot shows nudges must fire on a wall clock, the documented escape hatch (a GitHub Actions scheduled workflow pinging the job endpoint) should be **escalated to the user as an explicit decision** rather than chosen by an agent. *Auto-selected: accept on-visit nudges for the pilot; flag scheduler revisit as a planning risk.*

### Senior-coach dashboard v1 (CDASH-01..07, AUTH-02/06)
- **D-10 — Dashboard scope:** a focused, downline-scoped dashboard — downline list with onboarding stage at a glance (CDASH-01), stall-alert inbox (CDASH-02/06), knowledge-gap feed of questions agents ask the AI (CDASH-03), inline AI correction (CDASH-04), and a metrics panel (training→lead→close funnel CDASH-05 + 60→7-10-day ramp reporting CDASH-07) rendered with the vendored `recharts`. *Auto-selected: single focused dashboard covering all 7 CDASH reqs; recharts for metrics.*
- **D-11 — Downline scoping (AUTH-06):** a coach sees ONLY their downline; admin sees all. Enforced by custom claims (`role` + the `uplineCoachId`/`seniorCoachId` relationship set via the P1 `set-claims` script) AND deny-by-default Firestore rules — both layers, with rules-unit-test coverage (the P1 CI gate, extended). *Auto-selected: claims + rules double-gate, rules-tested.*
- **D-12 — Inline correction → KB feedback (CDASH-04):** a coach correction creates an **attributed KB correction entry that re-ingests** (new `kbDocs` version → re-embed via the existing chunked-poll pipeline), closing the loop so the Coach's future answers reflect the correction. Admin oversight via the existing versioning (`supersedesId`). *Auto-selected: correction → versioned KB re-ingest (not a flag-for-later queue).*

### Admin KB app (ADMIN-01/03, AUTH-03)
- **D-13 — Grow, don't fork:** evolve the **existing** `app/[lang]/(admin)/kb` surface into the full plain-language manager (multi-doc list, version history, plain-language create/edit, the just-built **multi-format upload** (pdf/docx/doc/xlsx/pptx/txt), publish/unpublish) behind the `admin` role + an AUTH-03 sign-in surface. **No separate app/deployment** — same Next.js app, admin route group. *Auto-selected: extend the P1 admin KB surface in-app rather than a separate web app.*

### Auth surfaces (AUTH-02/03)
- **D-14 — Sign-in surfaces for coach & admin:** Phase 1 left coach/admin as thin (claims-via-script, no sign-in UI). Phase 2 adds real sign-in for `senior-coach` (→ dashboard) and `admin` (→ KB app), reusing the P1 `requireUser` gate + session-cookie pattern; `set-claims` remains the provisioning path for assigning roles + downline. *Auto-selected: add coach/admin sign-in surfaces on the existing auth machinery.*

### Quality / eval (QUAL-06)
- **D-15 — Prompt regression suite:** expand the P1 single trilingual gold fixture into a **Phase-2 Coach regression suite** (training Q&A, journey prompts, playbooks) with Opus-judge rubrics for grounding, tone drift, hallucination, and language-match — wired into CI (changed-prompt suites) + the lazy-cron `eval-nightly` job, and execute the P1 human-calibration plan with Derek + a coach (>85% judge-human agreement). *Auto-selected: expand gold set + tone/hallucination/lang rubrics in CI + nightly.*

### Claude's Discretion (research/planning defaults)
- Exact checkpoint taxonomy / how many journey stages — derive from the D2 onboarding KB + Impl Plan, propose in planning.
- Dashboard information architecture / component composition — researcher/planner choose using vendored shadcn + recharts.
- Voice-sample capture UX during onboarding (P1 reserved the `voiceSamples[]` schema; D-03 deferred capture UX to "Phase 2 onboarding", consumed Phase 4) — **low priority**; include only if it doesn't expand the pilot critical path, else defer.

</decisions>

<carried_forward>
## Carried Forward (locked — do NOT re-ask or reverse)

### From the 2026-06-01 stack overrides (supersede 01-CONTEXT.md / older TSD wording)
- **Embeddings = Gemini `gemini-embedding-001` @ 1024-d via `@ai-sdk/google`** (Developer API, `GOOGLE_GENERATIVE_AI_API_KEY`) — NOT Voyage. All Phase-2 KB content + retrieval uses Gemini. The 1024-d index/standard is unchanged.
- **Scheduling = on-visit lazy-cron Server Action** (`src/jobs/runDueJobs.ts` + `app/_actions/jobs.ts`, Firestore last-run-per-window guard) — **NO QStash, no Cloud Scheduler, no Cloud Functions**. Phase-2 nudge/escalate/eval jobs are job definitions added to `runDueJobs`. (See D-08/D-09 + the tradeoff.) Consider moving the chat-page trigger from bare `void` to `after()` for reliable post-response completion.
- **AI SDK v5** stream method is `toUIMessageStreamResponse()` (the v4 `toDataStreamResponse()` does not exist in v5.0.x).

### From Phase 1 (01-CONTEXT.md decisions)
- The Phase-2 Coach **grows the same P1 Coach** (`src/agents/coach`) — not a rewrite. Same router→agent→rag→llm→stream→persist→audit pipe.
- **Router stays heuristic→Coach in Phase 2.** The LLM intent classifier activates in **Phase 3** when Finder becomes a second pillar sharing the surface. CHAT-03's multi-pillar routing is realized in P3; in P2 the seam exists but routes to Coach.
- Grounding mandate (answers cite KB chunk IDs; KB-miss emits handoff, never invents), model IDs resolved from **Remote Config** (never hard-coded), **PII pseudonymized at the Claude boundary + `pdpa_redacted` gate**, append-only **audit** via `after()`, `tenantId` on every doc, messages in the subcollection, **deny-by-default Firestore rules + CI rules tests**, mobile-first, full trilingual machinery.
- Phase 2 lands the full depth of the four P1 seams: journey state machine, escalation (now lazy-cron), KB-miss handoff (now with the dashboard to receive it), KB admin (now the full plain-language app).
</carried_forward>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** TSD is the source of truth for HOW; PROJECT.md Key Decisions is authoritative for the 2026-06-01 stack overrides; when older docs disagree with those overrides, the overrides win.

### Technical spec & decisions (the HOW — primary)
- `.planning/TSD.md` — §3 architecture (core/shell, exec model §3.4), §4 data model (agentProfiles journeyStage, conversations/messages, escalations, kbDocs/kbChunks/kbIngestionJobs, evals, leadContext, jobRuns/heartbeats), §5 security (roles §5.1, deny-by-default §5.2, PDPA §5.3), §6 AI/agent design (grounding, voice fingerprint foundation, model-swap), §7 i18n, §8 evaluation, §9 observability/ratelimit, **§11 Phase→Spec mapping (the Phase 2 row)**. (Embeddings + scheduled-jobs sections already updated to Gemini + lazy-cron.)
- `.planning/PROJECT.md` — Key Decisions table, incl. the **2026-06-01 Gemini + lazy-cron overrides** (authoritative).
- `.planning/ROADMAP.md` — Phase 2 goal, the 31 requirement IDs, the 5 success criteria, the **Phase 2→3 go/no-go memo gate**, and Roadmap-Level Constraints.
- `.planning/REQUIREMENTS.md` — Phase-2 REQ-IDs: AUTH-02/03/06, CHAT-01..08, COACH-01..10, CDASH-01..07, ADMIN-01/03, QUAL-06 (+ traceability).

### Phase 1 outputs (the seams Phase 2 grows)
- `.planning/phases/01-foundations/01-CONTEXT.md` — P1 decisions D-01..D-12; **note its Voyage/QStash references are superseded by `<carried_forward>` above**.
- `.planning/phases/01-foundations/01-VERIFICATION.md` — what's verified vs the open human gates that block Phase-2 execution.
- `.planning/phases/01-foundations/SPIKES.md` — spike outcomes (RAG/DEPLOY/INGEST gate execution; CRON retired; AI-SDK recorded).
- P1 SUMMARYs for the seams: `01-07` (router/memory/ratelimit), `01-09` (RAG/Gemini), `01-10` (KB CRUD + ingestion), `01-11` (escalation/jobs — note lazy-cron supersede), `01-12` (Coach + chat spine), `01-13` (evals).

### Research (the WHY / decisive context)
- `.planning/research/FEATURES.md` — per-pillar table-stakes (Coach feature set) + cross-cutting features.
- `.planning/research/ARCHITECTURE.md` — component map + hidden dependencies.
- `.planning/research/PITFALLS.md` — the pitfalls relevant to multi-surface + dashboard work.
- `.planning/research/SUMMARY.md` — Build Order Phase 1 (= roadmap Phase 2) rationale + exit criteria.

### Project conventions / framework gotchas
- `CLAUDE.md` + `AGENTS.md` (repo root) — hard constraints, Next.js 16 gotchas, conventions; **read `node_modules/next/dist/docs/` before any Next.js code**.

</canonical_refs>

<code_context>
## Existing Code Insights (built in Phase 1 — Phase 2 extends, does not rebuild)

### Reusable assets to grow
- **`src/agents/coach/*`** (prompt + `retrieveKnowledge` tool + Zod schema) — grow the prompt + add journey/playbook tools; keep it invoked through the router.
- **`src/escalation/*`** (`findStalled`, `emitHandoffSignal`, handoff bundle) + **`src/jobs/runDueJobs.ts`** (lazy-cron) — add `stall-detect`/`escalate`/`eval-nightly` job definitions; the handoff bundle feeds the dashboard.
- **`src/memory/*`** — `conversations/{cid}/messages` subcollection, `leadContext` rolling summary + agent-scoped slots, `agentProfiles` (journeyStage/currentCheckpoint, lastActiveAt, seniorCoachId).
- **`src/rag/*`** (Gemini embed + findNearest + citations + miss detection) — the Coach's grounding; feed Phase-2 KB content through it.
- **`src/kb/*`** (CRUD + chunker + multi-format upload + chunked-poll pipeline) — grow into the admin app; correction → versioned re-ingest reuses `updateDoc` + `shardJob`.
- **`src/audit/*`**, **`src/ratelimit/*`**, **`src/firebase/*`** (admin/client/collections/auth + `set-claims` + deny-by-default `firestore.rules`) — extend rules + claims for coach/admin; reuse `requireUser`.
- **App surfaces:** `app/[lang]/chat/*` (chat shell), `app/[lang]/(auth)/sign-in/*` (add coach/admin), `app/[lang]/(admin)/kb/*` (grow to full admin), `app/api/chat/route.ts`, `app/api/kb/ingest/{process,upload}/route.ts`, `app/_actions/jobs.ts`.
- **Vendored UI:** 55 shadcn components + **`recharts`** (dashboard charts), `sonner`, `cmdk`, `react-resizable-panels`, `date-fns`, `next-themes`.

### Established patterns to honor
- Core/shell split (`src/` never imports `app/`); SSE from a Node Route Handler (never a Server Action); mutations via Server Actions; long work chunked + client-driven/poll; async `cookies()`/`headers()`; `proxy.ts` not `middleware.ts`.

### Integration points
- New `app/[lang]/(coach)/` (dashboard) route group, downline-scoped via claims+rules; AUTH-02/03 sign-in surfaces; extend `next-intl` catalogs with Phase-2 copy; extend `firestore.rules` + rules tests for the dashboard's downline reads and the correction writes.
</code_context>

<specifics>
## Specific Ideas
- The pilot litmus test (success criteria 1–5): a real pilot agent gets D2-grounded cited answers on mobile in EN/BM/中文; sees AI disclosure + can hand off with context; a 2-day stall nudges and a 48h stall escalates to a visible dashboard alert; Derek edits KB in plain language and the Coach reflects it; a senior coach sees only their downline and corrects the AI inline.
- "Grow, don't fork" is the Phase-2 discipline: every capability extends a P1 seam rather than introducing a parallel system.
- The single biggest open risk is **D-09** (lazy-cron vs. genuinely proactive nudges) — surface it to the user before the pilot, not after.
</specifics>

<deferred>
## Deferred Ideas (NOT Phase 2 scope)
- **Property Finder + Reply Assistant pillars** and **LLM intent-classifier activation** — Phase 3 / Phase 4.
- **WhatsApp Business API / any auto-send** — v1 constraint (paste-and-draft only; Reply is Phase 4).
- **Email/SMS nudge channels** — only if the pilot proves in-app-on-visit nudges insufficient (ties to D-09).
- **Full funnel automation / CRM integration** beyond the dashboard's read-only metrics — later.
- **Voice-sample consumption** (voice fingerprint in replies) — Phase 4 (capture UX optionally starts in P2 onboarding per D-03 discretion).
- **Multi-tenant / white-label, native apps, public recommender** — deferred v2 (per STATE.md Deferred Items).

</deferred>

---

*Phase: 02-coach-admin*
*Context gathered: 2026-06-01 (--auto)*
