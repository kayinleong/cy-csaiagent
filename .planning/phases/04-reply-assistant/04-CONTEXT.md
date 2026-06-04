# Phase 4: Reply Assistant + Reply Analytics - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning
**Mode:** auto (gray areas auto-resolved to recommended defaults — review the logged choices)

<domain>
## Phase Boundary

Ship the **third pillar (Reply Assistant)** and the **reply analytics loop** that turns agent edits into a signal Derek can act on. Pilot stays at 15–20 agents (no rollout in this phase).

1. **Reply Assistant** — agent pastes an incoming WhatsApp message → draft reply grounded in D2 reply SOPs (cold-prospect qualifying, objection-handling, financing), in D2's voice, with **explicit edit-before-send UX**. **Never auto-sent.** Per-lead context isolated across parallel conversations. Trilingual auto-detect.
2. **Three-pillar router activation** (REPLY-10) — Coach + Finder + Reply share one chat surface. The existing `routeAsync` and override chip are extended to a third pillar; the chat dispatch grows from two branches to three.
3. **Reply SOP admin** (ADMIN-05) — Derek manages reply SOPs in the existing KB admin app (same plain-language editor, same versioning), tagged for the Reply pillar.
4. **Reply quality analytics** (REPLY-11, ADMIN-06) — edit-rate per SOP, common edit patterns, thumbs-down rate, escalation rate. Grown onto the existing senior-coach dashboard (downline-scoped). **No separate analytics app.**
5. **WABA graduation gate (REPLY-12)** — documented criteria, **not implemented**. A `WABA-GATE.md` artifact captures the metrics that gate moving past paste-and-draft.

**Stack, architecture, data model, exec model, and security are locked in TSD.md and the PROJECT.md Key Decisions table (incl. the 2026-06-01 Gemini + lazy-cron overrides). NOT re-litigated** — this discussion captured Phase-4 implementation depth.

**⛔ Hard-constraint reminder — Reply is the highest reputational-risk pillar:**
- **No auto-send. Ever.** Copy-to-clipboard is the only path from draft → human. The agent sends from their own phone.
- **No WhatsApp Business API in v1.** Paste-in / copy-out only.
- **PII boundary is load-bearing here.** Inbound WhatsApp pastes carry the most PII of any pillar (names, phone numbers, addresses, financials). `pseudonymize` + `assertRedacted` MUST run before any model call (GATE 3, T-03-26 — already proven for Finder). Audit logs store hashes only.
- **Grounding mandate.** No SOP match → `no_sop_match` signal + grounded refusal. Never invent SOP content.
- **Model IDs from Remote Config.** Never hard-coded.

</domain>

<decisions>
## Implementation Decisions

> `--auto`: each gray area resolved to its recommended default (logged). Reverse any in this file before `/gsd-plan-phase 4`.

### Reply agent shape & three-pillar dispatch (REPLY-01/02/04/10)
- **D-01 — Reply agent mirrors Finder pattern.** Create `src/agents/reply/{index.ts, prompt.ts, schema.ts, tools.ts}` matching the Finder shape (system prompt builder + read-only tools + Zod output schema + offline `run()` path). Invoked through the router. Same `streamText` pipe — no new transport. *Auto-selected: mirror Finder; do NOT introduce a parallel agent shape.*
- **D-02 — Chat route grows to 3-pillar dispatch.** Extend `app/api/chat/route.ts` so `pillar === 'reply'` → `replyAgent.buildSystemPrompt({ replySlot, incoming, leadId }) + replyAgent.makeTools(...)`. Override chip type widens from `'coach' | 'finder'` to `'coach' | 'finder' | 'reply'` (the router `Pillar` type already includes `'reply'`). GATE ordering unchanged (auth → ratelimit → PDPA pseudonymize → routeAsync → dispatch → stream → onFinish). *Auto-selected: extend the existing route, do NOT fork a `/api/reply` endpoint.*
- **D-03 — Read-only tools only.** Reply tools: `retrieveReplySop(category?, query)` (Gemini vector + structured filter on `pillar:'reply'`), `fetchVoiceSamples()` (returns the curated org-voice doc from KB, **not** per-user `voiceSamples[]` in v1 — see D-11), `fetchLeadContext(leadId)` (recent Reply turns for this lead, isolation enforced via leadId scoping). **No tool writes** — `replySlot` write happens in `onFinish` (mirrors Finder's `finderSlot` pattern, Pitfall 23/36 avoided). *Auto-selected: read-only tools + onFinish write.*

### Intent classifier with 3 pillars (REPLY-10, SC1)
- **D-04 — Heuristic patterns extended for Reply.** Add Reply-leaning keyword/structure signals to `heuristicPillar`: an inbound message block (quoted block, multi-line paste, "lead said …", "client wrote …", "draft a reply", "reply to this", "what should I say"). Finder/Coach patterns untouched. *Auto-selected: extend heuristic in-place; do NOT replace it.*
- **D-05 — Classifier expanded to 3 pillars.** `classifyIntent` schema widens from binary to ternary; classifier model still resolved from Remote Config (TSD names `claude-haiku-4-5` for the router). Mis-routes feed eval via the existing `routeDecision` observability seam (D-02 from Phase 3) + the override chip is the user-facing correction. *Auto-selected: expand classifier in-place + record + override-correctable.*

### Per-lead context isolation (REPLY-03, SC2)
- **D-06 — `leadContext.replySlot` is the third slot.** The type was reserved at Phase 1 (`'coachSlot' | 'finderSlot' | 'replySlot'`); Phase 4 wires it. The slot stores: parsed inbound classification (cold-prospect / objection / financing / other), the latest draft, edit history pointers, and a rolling per-lead summary. Cross-lead bleed is structurally impossible — slot is keyed by `leadContext/{leadId}`, the same isolation Finder proved. *Auto-selected: wire replySlot via the existing slot writer; no new memory primitive.*
- **D-07 — Required `leadId` for Reply turns.** Unlike Coach (no leadId required), Reply MUST have a `leadId` — there is no "draft a reply to no-one." The UI flow: if no `leadId` is set, the Reply chip shows a "Which lead?" selector (downline-scoped) before dispatch. Default to the most recent lead the agent has touched **only** if it's < 24h old; otherwise force an explicit pick. **No auto-inferred lead linking** — a client mix-up is the worst possible Reply failure mode. *Auto-selected: explicit lead pick over implicit inference.*

### Reply SOP knowledge base (REPLY-01/05/06/07, ADMIN-05)
- **D-08 — Reply SOPs are KB documents.** Reuse the `kbDocs` collection unchanged; introduce a `pillar` field with values `'coach' | 'reply'` (default `'coach'` for existing docs — backfill is a one-time migration). `retrieveReplySop` filters `findNearest` by `pillar:'reply'` AND `status:'published'`. *Auto-selected: reuse kbDocs with a pillar tag, do NOT create a `replySops` collection.*
- **D-09 — SOP categories surfaced via doc metadata.** Categories: `cold-prospect`, `objection-handling`, `financing`. Stored as a doc tag (`category` field on `kbDocs`). `retrieveReplySop` accepts an optional category filter. Coach (and future) docs may set `category` too. *Auto-selected: free-form `category` field; canonical values seeded but not hard-coded.*
- **D-10 — Grow the existing admin KB surface, do NOT fork.** Add a pillar filter/tab to `(admin)/kb` so Derek can list/edit Reply SOPs; reuse plain-language editor, multi-format upload, versioning, publish/unpublish. ADMIN-05 = a filter view on the existing manager. *Auto-selected: extend `(admin)/kb`; no new admin route group.*
- **D-11 — No-SOP-match → grounded refusal.** When `retrieveReplySop` returns no hit above threshold, Reply emits `no_sop_match` (mirrors Finder's `no_match`). The user-facing message: "I don't have a D2 reply SOP for this — please draft manually, or check with your senior coach." A `kb-miss` event is logged (same path as the Phase-2 knowledge-gap feed) so Derek sees the SOP gap on the dashboard. *Auto-selected: grounded refusal + log kb-miss; never invent SOP content.*

### Voice / tone calibration (REPLY-08, QUAL-02)
- **D-12 — Curated org-voice doc is the v1 source of voice.** A single KB doc (`pillar:'reply', category:'voice'`) holds Derek's anonymized samples + tone rules + 5–10 example exchanges. `fetchVoiceSamples` retrieves it. The schema field `users.voiceSamples[]` (reserved Phase 1) stays a **deferred per-user signal** — adding individual voice learning before validating the curated approach risks "AI imitating the wrong rep" failures. *Auto-selected: org-voice doc for v1; defer per-user voice to post-pilot.*
- **D-13 — Tone-aware eval rubric.** Extend `src/eval/judge.ts` with a Reply-specific rubric extension: voice match (vs the curated voice doc), no-AI-tell, qualifying-questions framework (cold-prospect path uses questions, not pitches — REPLY-05), no auto-pitch, language match. Reuse the existing `voice` + `toneDrift` domain skeleton — add Reply-specific assertions. Add Reply gold sets to the trilingual eval harness. *Auto-selected: extend judge in-place; do NOT introduce a parallel eval pipeline.*
- **D-14 — Trilingual voice posture (pragmatic).** Voice rubric is **calibrated EN-first** for the pilot; BM/中文 voice samples are part of the curated voice doc when Derek provides them. The trilingual machinery (`franc-min` detect, language match in judge, `next-intl` UI copy) applies fully — the open question is voice nuance, not language plumbing. Flag for Derek as a planning input. *Auto-selected: EN-first voice tuning, full trilingual plumbing.*

### Paste-and-draft UX (REPLY-02/04, QUAL-02)
- **D-15 — Inline in the existing chat surface.** No separate `/reply` page. The agent pastes the inbound message into the same chat input. The Reply Assistant detects intent (heuristic or override chip → `reply`) and emits a structured draft. The draft renders as a **visually distinct card** (mirrors the Phase-3 `match-list` pattern) inside the message stream: incoming-quoted block + draft text + **"Copy draft" button**. *Auto-selected: inline + draft card; do NOT build a separate Reply page.*
- **D-16 — Copy-to-clipboard is the ONLY send path.** The draft card has exactly one action: `Copy draft`. No share, no auto-post, no system-share-sheet. After copy, the card collapses to "Copied 2s ago — go send it from WhatsApp." This is a load-bearing UX constraint, not a v1 shortcut. *Auto-selected: copy-only; never expose share/send/post affordances.*
- **D-17 — Disclosure reuses Phase-2 machinery.** The existing first-run AI disclosure + persistent AI badge satisfy QUAL-02. Add one Reply-specific line to the disclosure copy: "Drafts are AI suggestions — review before sending from your phone." (en/ms/zh, in the existing `next-intl` catalogs.) *Auto-selected: extend existing disclosure copy; no new disclosure flow.*

### Edit-as-signal capture (REPLY-09, ADMIN-06)
- **D-18 — Capture draft + edited-final via the copy action.** The MVP edit signal is the diff between `originalDraft` (what the model emitted) and `editedFinal` (what the agent had on clipboard when they hit Copy). Implementation: a controlled textarea inside the draft card lets the agent edit in place; `Copy draft` reads from that textarea, computes the diff against `originalDraft`, and writes one `replyEdits/{eventId}` row (`{leadId, draftId, sopDocIds[], originalDraft, editedFinal, diff, agentUid, lang, timestamp}`). **No webhook from WhatsApp** (would require WABA — out of scope). *Auto-selected: in-card edit + on-copy diff capture.*
- **D-19 — `replyEdits` is a new top-level collection.** `replyEdits/{eventId}` with `tenantId`, downline-scoped rules (an agent reads only their own; a coach reads their downline; admin reads all). Indexes: `sopDocIds`, `agentUid`, `timestamp`. Append-only — edits are evidence, not editable. *Auto-selected: new collection; do NOT bury edits inside `messages` (queryability matters for the dashboard).*
- **D-20 — Aggregation is on read.** Per-SOP edit rate, common-edit patterns, and thumbs-down rate are computed by dashboard queries (Firestore aggregation + small derived caches if needed), not via a background rollup job in v1. The on-visit lazy-cron `eval-nightly` job picks up only judge-rubric metrics. Revisit aggregation cost during pilot. *Auto-selected: read-time aggregation for v1; pre-compute only if cost demands.*

### Reply quality analytics dashboard (REPLY-11, ADMIN-06)
- **D-21 — Grow the senior-coach dashboard.** Add a "Reply Quality" panel to the existing `(coach)/dashboard` surface: edit-rate per SOP (trend down = good), thumbs-down rate, top-edited SOP, escalation rate, drafts-per-agent. Reuse `recharts`. Downline-scoped via the existing claims+rules double-gate (AUTH-06, established Phase 2). *Auto-selected: extend the existing dashboard; no new analytics app or route group.*
- **D-22 — Admin gets the full org view.** Same panel renders for `admin` role without the downline filter (so Derek sees aggregate SOP performance org-wide). Single component, role-conditional query. *Auto-selected: one component, role-conditional scope.*

### WABA graduation gate (REPLY-12 — documented gate, not implemented)
- **D-23 — `WABA-GATE.md` artifact.** End-of-phase deliverable: a doc at `.planning/phases/04-reply-assistant/WABA-GATE.md` listing the gate metrics (e.g., edit-rate < threshold X% over ≥ Y weeks of pilot data, zero wrong-client incidents, judge tone PASS rate ≥ 90%, audit log clean of `pdpa_redacted:false` errors). **The thresholds are Derek's call** — planning proposes initial values; sign-off is a post-phase decision. *Auto-selected: documented gate; do NOT scaffold any WABA integration code.*

### Claude's Discretion (research/planning defaults)
- Exact Reply system-prompt content + few-shot example structure — derive from Derek's anonymized samples + the curated voice doc; researcher/planner propose.
- Exact set of canonical SOP categories beyond `cold-prospect / objection-handling / financing` — Derek's SOP doc set will dictate; treat `category` as open-string with a seeded enum.
- Edit-rate / thumbs-down thresholds in WABA-GATE.md — researcher/planner propose initial values; final values are Derek's call.
- Whether the draft card uses `<textarea>` directly or a richer editor (Tiptap is NOT installed; pulling it in would be net-new) — default to a controlled `<textarea>` + the existing shadcn `Input` styling; revisit if multi-line formatting demands more.

</decisions>

<carried_forward>
## Carried Forward (locked — do NOT re-ask)

### Stack overrides (2026-06-01, authoritative)
- **Embeddings = Gemini `gemini-embedding-001` @ 1024-d via `@ai-sdk/google`** (Developer API; `GOOGLE_GENERATIVE_AI_API_KEY`) — Reply SOPs use the same embedding pipeline.
- **Scheduling = on-visit lazy-cron Server Action** (`src/jobs/runDueJobs.ts`). Reply-related periodic work (eval-nightly rubric runs over Reply gold sets) is a job definition added to `runDueJobs`. **No QStash, no Cloud Scheduler, no Cloud Functions.**
- **AI SDK v5 stream method:** `toUIMessageStreamResponse()` (NOT `toDataStreamResponse()` — does not exist in v5.0.x).

### From Phase 1 (`01-CONTEXT.md`)
- Phase 1 reserved `users.voiceSamples[]` and the `replySlot` type for this phase. Phase 4 consumes both — D-12 stands up the org-voice doc path; D-06 wires `replySlot`.
- Core/shell rule: `src/` never imports from `app/`. The Reply agent core (`src/agents/reply/*`) is portable, unit-testable, and Next-free.
- The vertical-slice spine (auth → ratelimit → PDPA → route → dispatch → stream → persist → audit) is unchanged — Reply plugs in behind GATE 4.

### From Phase 2 (`02-CONTEXT.md`)
- Trilingual machinery: `franc-min` per-message detect + manual override chip + `next-intl` catalogs — Phase 4 extends catalogs, does not re-architect.
- Senior-coach dashboard surface (`(coach)/dashboard`) and downline-scoped claims+rules — Phase 4 adds a Reply Quality panel to it.
- KB admin app (`(admin)/kb`) with plain-language editor + multi-format upload + versioning — Phase 4 grows it with a pillar filter for Reply SOPs.
- AI disclosure UX (first-run modal + persistent badge) — Phase 4 extends copy only.

### From Phase 3 (`03-CONTEXT.md`)
- The intent classifier seam was activated (heuristic → classifier → override). Phase 4 extends to 3 pillars — does NOT rebuild.
- The override chip pattern (`pillarOverride` prop, validated against enum) — Phase 4 widens the enum.
- The Finder agent shape (read-only tools + leadSlot write in `onFinish` + grounded refusal on no-match) — Phase 4 mirrors it for Reply.
- `routeDecision` observability seam on every message — Phase 4 reuses unchanged.
- `leadContext` shared doc with per-agent slots is the cross-pillar memory medium.

### Hard constraints (every phase, every plan)
- **No Google Cloud Functions. No GCP beyond Firebase SDK. No WhatsApp Business API. No auto-send. No client PII in logs.**
- **Grounding mandate** — every answer cites a source ID; `no_sop_match` is the only correct response to a SOP gap.
- **Model IDs from Remote Config** — never hard-coded; QUAL-01 model-swap test must still pass.
- **PII pseudonymized at the Claude boundary** + `pdpa_redacted` gate refuses unredacted production calls. Audit stores hashes only.
- **Deny-by-default Firestore rules** + CI rules tests on every collection (`replyEdits` joins the list).
- **`tenantId` on every doc**, messages in subcollection, mobile-first.

</carried_forward>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** TSD = source of truth for HOW; PROJECT.md Key Decisions is authoritative for the 2026-06-01 overrides; when older docs disagree with those overrides, the overrides win.

### Technical spec, decisions, requirements
- `.planning/TSD.md` — §3 architecture (core/shell, exec model §3.4), §4 data model (kbDocs, kbChunks, leadContext slots, messages subcollection — extend with `replyEdits`), §5 security (roles §5.1, deny-by-default §5.2, **PDPA §5.3 — load-bearing for Reply pastes**), §6 AI/agent design (grounding, **voice fingerprint foundation**, model-swap, intent router heuristic→LLM — now 3 pillars), §7 i18n, §8 evaluation (extend Opus judge for Reply tone), §9 observability/ratelimit, §10 deployment, **§11 Phase→Spec mapping (the Phase 4 row)**, §14 G5 (voice-sample consent).
- `.planning/PROJECT.md` — Key Decisions table (incl. the 2026-06-01 overrides + the Reply pillar's explicit no-auto-send / paste-and-draft posture).
- `.planning/ROADMAP.md` — Phase 4 goal, the 15 requirement IDs (REPLY-01..12, ADMIN-05, ADMIN-06, QUAL-02), the 5 success criteria, Roadmap-Level Constraints.
- `.planning/REQUIREMENTS.md` — REPLY-01..12, ADMIN-05, ADMIN-06, QUAL-02 (+ traceability table); WABA-01 in Out-of-Scope confirms the v1 boundary.

### Phase 1–3 outputs (the seams Phase 4 grows)
- `.planning/phases/01-foundations/01-CONTEXT.md` — D-03 (`voiceSamples[]` reserved); core/shell + spine. Note Voyage/QStash superseded by 2026-06-01 overrides.
- `.planning/phases/02-coach-admin/02-CONTEXT.md` — dashboard, KB admin, AI disclosure, trilingual UX, lazy-cron, judge rubric expansion.
- `.planning/phases/03-finder-routing/03-CONTEXT.md` — **the closest analog to Phase 4**: how a new pillar is added (mirror agent shape, extend route dispatch, wire the leadSlot, extend admin app, extend the dashboard).
- P3 SUMMARYs especially load-bearing for Phase 4:
  - `03-04-SUMMARY.md` — Finder agent shape (mirror this for `src/agents/reply/*`)
  - `03-07-SUMMARY.md` — three-branch dispatch in `app/api/chat/route.ts` (Phase 4 extends to four — coach/finder/reply/override)
  - `03-06-SUMMARY.md` — `finderSlot` typed shape + slot writer + criteria-delta merge (mirror for `replySlot`)
  - `03-08-SUMMARY.md` — admin inventory manager grown onto `(admin)/kb` (mirror for ADMIN-05 pillar filter)
  - `03-09-SUMMARY.md` — Promptfoo gold sets + Playwright e2e patterns (extend for Reply gold sets + e2e)

### Reply pillar specifics
- `src/router/heuristic.ts` — extend `heuristicPillar` with Reply patterns (the existing `Pillar` type already includes `'reply'`).
- `src/router/classifier.ts` — widen schema to 3 pillars.
- `src/memory/leadContext.ts` — `replySlot` type already declared on `LeadSlot`; wire reader/writer following `finderSlot` (`readFinderSlot`, `writeLeadSlot`).
- `src/firebase/collections.ts` — add `replyEdits` typed ref + index hints; confirm `kbDocs` `pillar` + `category` fields.
- `src/eval/judge.ts` — extend rubric with Reply-specific voice/qualifying-questions/no-AI-tell assertions; reuse the six-domain rubric skeleton.

### Project conventions / framework gotchas (every phase reads these)
- `CLAUDE.md` (repo root) — hard constraints, Next.js 16 gotchas, conventions (core/shell split, `tenantId`, grounding, PII boundary), GSD workflow.
- `AGENTS.md` (repo root) — **read `node_modules/next/dist/docs/` before writing any Next.js 16 code** (`proxy.ts` not `middleware.ts`, async `cookies()/headers()`, implicit caching removed).
- `node_modules/next/dist/docs/` — authoritative Next.js 16 API reference (MANDATORY pre-read).

### Research (the WHY / decisive context)
- `.planning/research/FEATURES.md` — Reply pillar table-stakes (paste-and-draft, voice calibration, edit-as-signal, no-auto-send posture).
- `.planning/research/ARCHITECTURE.md` — component map + hidden dependencies (memory/audit/ratelimit/eval/i18n must precede a third agent — all satisfied by P1).
- `.planning/research/PITFALLS.md` — the pitfalls Reply most-easily hits: 6 (PII leakage), 7 (sync path race), 21 (model invents instead of refusing), 22 (cross-conversation context bleed), 23/36 (tool-as-write anti-pattern), 32 (judge-rubric drift), 35 (single-tenant assumption).

</canonical_refs>

<code_context>
## Existing Code Insights (Phase 4 extends, does NOT rebuild)

### Reusable assets to grow
- **`src/router/*`** — `Pillar` type already includes `'reply'`; `heuristic.ts` + `classifier.ts` extend in place. `routeAsync` signature unchanged.
- **`src/agents/finder/*`** — the literal template for `src/agents/reply/*`: prompt builder, read-only tools, Zod output schema, offline `run()` + streaming `streamText` path. Mirror it; don't reinvent it.
- **`src/memory/leadContext.ts`** — `LeadSlot = 'coachSlot' | 'finderSlot' | 'replySlot'` already declared. Add `readReplySlot` + a typed `ReplySlot` shape next to the existing `readFinderSlot` / `FinderSlot`.
- **`src/rag/*`** — `embedText` (Gemini 1024-d) + `findNearest` + the `status:'published'` filter. Reuse with the new `pillar:'reply'` filter on `kbChunks`.
- **`src/kb/*`** — CRUD + chunker + multi-format upload + chunked-poll pipeline. Reply SOPs use this unchanged; the only schema change is adding `pillar` + `category` fields to `kbDocs` (with a one-time backfill for existing coach docs).
- **`src/eval/judge.ts`** — six-domain rubric (grounding, scope, language, voice, hallucination, tone-drift). Extend the rubric strings with Reply-specific assertions; add Reply gold sets to `evals/`.
- **`src/audit/*`** — `pseudonymize` + `assertRedacted` + `pdpa_redacted` gate. Phase 4 routes the heaviest-PII payloads of the project through this gate (inbound WhatsApp pastes). No new code; new test coverage.
- **`src/firebase/*`** — `auth.ts` (custom claims + downline scoping for `replyEdits` rules), `collections.ts` (add `replyEdits` ref + indexes; extend `kbDocs` schema), `admin.ts` / `client.ts`, `set-claims` script.
- **`app/api/chat/route.ts`** — extend the dispatch switch from `coach | finder` to `coach | finder | reply`; widen override-chip validation; wire `replySlot` write in `onFinish` mirroring the existing finderSlot write.
- **App surfaces:**
  - `app/[lang]/chat/chat-input.tsx` — widen `pillarOverride` enum to `'coach' | 'finder' | 'reply'`; thread `leadId` (already in place for Finder).
  - `app/[lang]/chat/chat-header.tsx` — widen pillar chip.
  - `app/[lang]/chat/message-list.tsx` — render new draft-card message variant (mirror `match-list.tsx`).
  - `app/[lang]/(admin)/kb/*` — add Reply-pillar filter/tab; reuse plain-language editor.
  - `app/[lang]/(coach)/dashboard/*` — add Reply Quality panel; reuse `recharts`.
- **Vendored UI:** 55 shadcn components + `recharts` + `sonner` + `cmdk` + `lucide-react` + `next-themes`. Everything Phase 4 needs is already on disk — no new dependencies.

### Established patterns to honor
- Core/shell split (`src/` never imports from `app/`); SSE from a Node Route Handler (never a Server Action); mutations via Server Actions; long work chunked + client-driven; async `cookies()`/`headers()`; `proxy.ts` not `middleware.ts`; `import type { Role }` to keep server-only `auth.ts` out of client bundles.
- "Grow, don't fork" — every Phase-4 capability extends a Phase 1/2/3 seam. No new app, no new route group, no new auth pattern.

### Integration points (where new code clips into existing structure)
- `src/agents/reply/` — new dir, mirrors `src/agents/finder/`.
- `src/firebase/collections.ts` — `replyEdits` typed ref + indexes; `kbDocs` schema (`pillar`, `category`) + migration.
- `firestore.rules` — `replyEdits` rules (agent reads own; coach reads downline; admin reads all; ALL writes server-side only via Admin SDK).
- `app/api/chat/route.ts` — 3-pillar switch + `replySlot` onFinish write + override-chip enum widening.
- `app/[lang]/chat/*` — draft-card message variant + override-chip widening + lead-selector flow for Reply turns without a `leadId`.
- `app/[lang]/(admin)/kb/*` — pillar filter + Reply SOP creation.
- `app/[lang]/(coach)/dashboard/*` — Reply Quality panel.
- `src/eval/judge.ts` + `evals/promptfooconfig.yaml` — Reply rubric strings + Reply gold sets (EN; BM/中文 added when Derek provides samples).
- `src/jobs/runDueJobs.ts` — `eval-nightly` reaches Reply gold sets (no new job; gold sets are an input to the existing nightly).

</code_context>

<specifics>
## Specific Ideas
- The pilot litmus (the 5 ROADMAP success criteria) maps to: paste-an-inbound → grounded D2-voiced draft in EN/BM/中文 → explicit edit-before-send card (copy-to-clipboard only); parallel-leads isolated (no context bleed); no-SOP-match flagged (never invented); agent edits captured into `replyEdits` with edit-rate trending down on the dashboard; one chat session routes Coach↔Finder↔Reply with the override chip available.
- "Grow, don't fork" continues from Phase 3. The Finder pillar is the literal template; if Phase 4 ever introduces a parallel agent shape, a separate app, or a webhook, that's a smell, not a feature.
- The single biggest watch-item is **PII at the boundary**. Inbound WhatsApp pastes carry the most PII of any pillar. The PDPA gate (GATE 3) is already in the route, but Reply must have explicit unit + integration coverage proving names/phones/addresses/financials are pseudonymized **before** the model call — no exceptions, no flag bypass.
- The second biggest watch-item is **wrong-lead replies**. The Reply pillar requires explicit `leadId` (D-07). Auto-inferring the lead is a class of failure with worse reputational cost than a bad tone.
- WABA (REPLY-12) is **documented, not built**. Any code touching a WhatsApp Business API in Phase 4 is out of scope.

</specifics>

<deferred>
## Deferred Ideas (NOT Phase 4)
- **WhatsApp Business API integration / auto-send** — forever excluded in v1 per hard constraint; revisit only after the WABA-GATE.md criteria are met during pilot (REPLY-12 / WABA-01).
- **Per-user voice learning from `users.voiceSamples[]`** — post-pilot. Curated org-voice doc (D-12) is v1; per-user voice risks "AI imitates the wrong rep" before the org voice is validated.
- **BM/中文 voice fingerprint depth** — full trilingual machinery applies (detection, language match, UI copy); fine-tuned BM/中文 voice samples land when Derek provides them.
- **Webhook-driven edit capture from WhatsApp** — depends on WABA; the v1 capture path is the in-card edit + on-copy diff (D-18).
- **Rich draft editor (Tiptap-style)** — pulling in a new editor is net-new dependency; v1 uses a controlled `<textarea>` + shadcn styling.
- **Pre-computed analytics rollups** — read-time aggregation in v1 (D-20); revisit only if pilot cost shows it's needed.
- **Reply Assistant on the senior-coach side** (a coach drafting on behalf of an agent) — single-agent ownership of each thread holds; if it surfaces in pilot feedback, evaluate post-Phase 4.

</deferred>

---
*Phase: 04-reply-assistant*
*Context gathered: 2026-06-04 (--auto)*
