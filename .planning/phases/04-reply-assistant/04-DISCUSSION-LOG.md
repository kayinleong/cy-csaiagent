# Phase 4: Reply Assistant + Reply Analytics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `04-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 04-reply-assistant
**Mode:** `--auto` (Claude auto-selected the recommended option for every gray area; all options listed below were considered)
**Areas discussed:** Reply agent shape & dispatch · 3-pillar router activation · Per-lead context isolation · Reply SOP knowledge base · Voice/tone calibration · Paste-and-draft UX · Edit-as-signal capture · Reply quality analytics · WABA graduation gate

---

## Reply agent shape & three-pillar dispatch (D-01, D-02, D-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Finder agent shape (`src/agents/reply/{index,prompt,schema,tools}.ts`) | Reuse the proven Phase-3 pattern: prompt builder + read-only tools + Zod schema + offline run() path. | ✓ |
| Build a parallel agent shape | Fresh design optimized for Reply (e.g., custom message format). | |
| Inline into Coach with a "reply mode" flag | Avoid a new agent module; treat Reply as a Coach mode. | |

**Selected:** Mirror Finder shape.
**Notes:** "Grow, don't fork" is the established Phase-2/3 discipline. The Finder pattern already proves: read-only tools → onFinish slot write → grounded refusal on no-match. Reply has the same shape requirements; reinventing is a smell.

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `app/api/chat/route.ts` to 3-pillar dispatch | Add a third branch (`pillar === 'reply'`) to the existing switch. Override chip widens. | ✓ |
| Fork `/api/reply` endpoint | New route, separate stream pipe. | |
| Reply runs in a Server Action | Replaces SSE with action-based draft return. | |

**Selected:** Extend the existing route.
**Notes:** GATE ordering (auth → ratelimit → PDPA → routeAsync → dispatch → stream → onFinish) is load-bearing and proven. A Server Action breaks streaming (TSD hard rule). A separate route forks the audit/rate-limit gates — a class of subtle bug we'd own forever.

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only tools + onFinish write | Tools fetch SOPs/voice samples; replySlot written in onFinish (mirror Finder). | ✓ |
| Tool-as-write | A `writeDraft` tool mutates state inside model dispatch. | |
| Manual post-stream write from the client | Client writes after receiving the draft. | |

**Selected:** Read-only tools + onFinish.
**Notes:** Pitfalls 23/36 — tool-as-write breaks audit determinism and lets the model "vote" to skip the slot write. Client-side writes break the audit chain.

---

## Intent classifier with 3 pillars (D-04, D-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `heuristicPillar` with Reply patterns in place | Add inbound-block / quoted-message / "draft a reply" patterns next to existing finder/coach. | ✓ |
| Replace heuristic with a stronger classifier | LLM classifies every message; drop heuristics. | |
| Disable heuristic for Reply; force chip-only | Reply only fires on explicit override. | |

**Selected:** Extend in place.
**Notes:** Heuristic-first / classifier-fallback is the Phase-3 pattern; it works. Forcing chip-only undermines the "paste-and-go" UX. Replacing the heuristic adds latency + cost to every message.

| Option | Description | Selected |
|--------|-------------|----------|
| Widen `classifyIntent` schema from binary to ternary | Same classifier, model from Remote Config, schema gains `'reply'` enum value. | ✓ |
| Train a separate Reply classifier | Two classifiers cascade. | |

**Selected:** Widen in place.
**Notes:** The router model resolves from Remote Config (no hard-coded model ID). Adding pillars is schema-only — exactly what the existing seam was designed for.

---

## Per-lead context isolation (D-06, D-07)

| Option | Description | Selected |
|--------|-------------|----------|
| Wire `replySlot` via existing `writeLeadSlot` | Mirror Finder; `replySlot` already declared on the `LeadSlot` type at Phase 1. | ✓ |
| New `replyContext/{leadId}` collection | A separate collection from `leadContext`. | |
| Store reply state inline on `messages` | Per-message draft state. | |

**Selected:** Existing slot writer.
**Notes:** `leadContext` shared-doc + agent-scoped slots is the cross-pillar memory medium. A separate collection breaks the Coach↔Finder↔Reply handoff context the leadContext is designed to carry. Inline-on-message hits the 1MB doc-size trap.

| Option | Description | Selected |
|--------|-------------|----------|
| Require explicit `leadId` for Reply turns (UI lead selector if absent) | Reply MUST have a lead; no auto-inference. | ✓ |
| Auto-infer from most recent leadContext touch | Use the agent's last-touched lead by default. | |
| Allow no-lead Reply (orphan drafts) | Treat lead as optional. | |

**Selected:** Explicit lead pick (default to recent lead only if < 24h).
**Notes:** A wrong-lead reply is the worst-class Reply failure — a client mix-up has reputational cost worse than a bad tone. Explicit beats implicit here.

---

## Reply SOP knowledge base (D-08, D-09, D-10, D-11)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `kbDocs` with a `pillar` tag (`'coach' \| 'reply'`) | Single KB, filter on retrieval. | ✓ |
| New `replySops` collection | Parallel KB pipeline. | |
| Inline SOPs in the Reply prompt | Static, no retrieval. | |

**Selected:** Reuse kbDocs.
**Notes:** The KB pipeline (chunker, embedder, versioning, multi-format upload) is proven; forking it is operational debt. Static-in-prompt loses versioning + Derek's plain-language editor.

| Option | Description | Selected |
|--------|-------------|----------|
| Free-form `category` field with seeded canonical values | Open string; seed cold-prospect / objection-handling / financing. | ✓ |
| Hard-coded enum | TypeScript enum, breaks on new categories. | |
| Tag-based (multi-value) | Tags array. | |

**Selected:** Free-form with seeded values.
**Notes:** Derek's SOP set will dictate exact categories; over-constraining now risks blocking the doc ingest. The seeded values are the canonical ones for v1 prompts.

| Option | Description | Selected |
|--------|-------------|----------|
| Grow the existing `(admin)/kb` surface | Add pillar filter/tab; reuse editor/upload/versioning. | ✓ |
| Build `/admin/reply-sops` as a new route group | Separate UX. | |

**Selected:** Grow existing.
**Notes:** Phase 3's ADMIN-04 set the precedent ("extend the admin surface, not a separate app").

| Option | Description | Selected |
|--------|-------------|----------|
| `no_sop_match` → grounded refusal + log kb-miss event | Mirror Finder's `no_match`. | ✓ |
| Generic fallback ("here's some general advice") | LLM produces a non-grounded answer. | |
| Hard error to user | "Cannot draft" with no explanation. | |

**Selected:** Grounded refusal + kb-miss log.
**Notes:** Grounding mandate. "General advice" violates the no-invent rule; hard error misses the chance to feed the knowledge-gap feed.

---

## Voice / tone calibration (D-12, D-13, D-14)

| Option | Description | Selected |
|--------|-------------|----------|
| Curated org-voice doc in KB (`pillar:'reply', category:'voice'`) | Derek's anonymized samples + tone rules + few-shot exchanges, retrieved by `fetchVoiceSamples`. | ✓ |
| Per-user voice learning from `users.voiceSamples[]` | Each rep's individual tone. | |
| Both, blended | Org + per-user. | |

**Selected:** Org-voice only for v1.
**Notes:** Per-user before validation = "AI imitates the wrong rep" failure class. Validate the org voice during pilot first; the `voiceSamples[]` schema stays reserved (P1 D-03).

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing 6-domain judge with Reply-specific rubric strings | Reuse voice + toneDrift skeleton; add qualifying-questions / no-AI-tell / no-pitch assertions. | ✓ |
| New Reply judge pipeline | Parallel eval. | |
| Voice eval only (no rubric extension) | Just judge tone; skip pillar-specific rubric. | |

**Selected:** Extend existing judge.
**Notes:** Pitfall 32 (judge-rubric drift) is worse with parallel pipelines. Voice-only misses REPLY-05 (qualifying questions over pitch) and the no-AI-tell test.

| Option | Description | Selected |
|--------|-------------|----------|
| EN-first voice tuning; full trilingual plumbing applies | Voice rubric calibrated EN; BM/中文 voice samples added when Derek provides. | ✓ |
| Trilingual voice tuning from day 1 | All three languages validated at launch. | |
| EN-only Reply for v1 | Defer BM/中文 entirely. | |

**Selected:** EN-first + full trilingual plumbing.
**Notes:** Trilingual machinery (detect, language match, UI copy) is already proven; voice nuance per language is what gates. EN-only would violate the project's multilingual-from-day-1 principle.

---

## Paste-and-draft UX (D-15, D-16, D-17)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in the existing chat surface + draft card | Same chat input, draft renders as a distinct card (mirror `match-list`). | ✓ |
| Separate `/reply` page | Dedicated paste-and-draft route. | |
| Side panel / modal in the chat surface | Draft renders in a slide-out panel. | |

**Selected:** Inline + draft card.
**Notes:** One surface, three pillars — the project's defining UX principle. Separate page breaks the routing-shared-surface story (SC1).

| Option | Description | Selected |
|--------|-------------|----------|
| Copy-to-clipboard is the ONLY action on the draft card | Single button: "Copy draft." | ✓ |
| Add a "Share via..." system sheet | Use Web Share API to push to messaging apps. | |
| Add a "Send via D2 channel" affordance | Future hook for WABA. | |

**Selected:** Copy only.
**Notes:** QUAL-02 + hard constraint. "Share via..." is a slippery slope toward auto-send (and a foot-gun: agents could pick the wrong app). WABA hook is REPLY-12 (documented gate, NOT built).

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase-2 disclosure machinery + add one Reply-specific line | First-run modal + persistent badge already cover QUAL-02. | ✓ |
| New Reply-specific disclosure modal | Separate modal on first Reply use. | |

**Selected:** Reuse + extend copy.
**Notes:** Two modals is double-friction. The persistent badge plus one updated line in i18n catalogs is enough.

---

## Edit-as-signal capture (D-18, D-19, D-20)

| Option | Description | Selected |
|--------|-------------|----------|
| In-card textarea + on-copy diff capture | Agent edits the draft inline; "Copy draft" reads from textarea, computes diff vs original, writes one row. | ✓ |
| Paste-back-the-sent-text flow | Agent sends from WhatsApp, then pastes the final text back into the app. | |
| No edit capture in v1 | Defer signals. | |

**Selected:** In-card + on-copy diff.
**Notes:** Paste-back-the-sent-text has high friction and unreliable adoption — the edit signal disappears. No-capture loses ADMIN-06 + REPLY-09. WABA-style webhooks would solve this perfectly, but are out of scope.

| Option | Description | Selected |
|--------|-------------|----------|
| New top-level `replyEdits` collection | Append-only, downline-scoped rules, indexed for dashboard queries. | ✓ |
| Embed edits inside `messages` | Add an `edits[]` array on the draft message. | |
| Embed edits inside `leadContext.replySlot` | Slot grows with edit history. | |

**Selected:** Top-level collection.
**Notes:** Dashboard queries need an indexable surface. Embedding inside `messages` runs into the 1MB doc-size trap as edits accumulate. `replySlot` should stay a small-state slot (mirrors finderSlot discipline).

| Option | Description | Selected |
|--------|-------------|----------|
| Read-time aggregation (Firestore queries + small derived caches if needed) | Compute per-SOP edit rate at dashboard load. | ✓ |
| Pre-compute via nightly rollup job | New job on the lazy-cron. | |
| Stream-aggregate in `onFinish` | Update aggregate doc each draft. | |

**Selected:** Read-time aggregation for v1.
**Notes:** Premature optimization. Pilot scale (15–20 agents, hundreds of drafts/week) doesn't justify rollup complexity. Revisit if pilot cost demands.

---

## Reply quality analytics dashboard (D-21, D-22)

| Option | Description | Selected |
|--------|-------------|----------|
| Grow `(coach)/dashboard` with a Reply Quality panel | Reuse downline scoping + claims+rules + recharts. | ✓ |
| New `/analytics` route group | Separate analytics surface. | |
| Embedded in the admin app | Derek's surface only. | |

**Selected:** Grow existing dashboard.
**Notes:** Phase 2 set the precedent. Coach already has downline scoping; analytics belongs alongside the stall-inbox and knowledge-gap feed.

| Option | Description | Selected |
|--------|-------------|----------|
| Single component, role-conditional scope (coach = downline, admin = org) | One panel renders for both roles; query scope flips on role. | ✓ |
| Separate admin-only view + coach-only view | Two components. | |

**Selected:** One component.
**Notes:** Drift risk between two views; same data shape, only the query scope changes.

---

## WABA graduation gate (D-23)

| Option | Description | Selected |
|--------|-------------|----------|
| `WABA-GATE.md` artifact (documented metrics; thresholds = Derek's call) | End-of-phase doc; no code; planning proposes initial values. | ✓ |
| Build a feature-flagged WABA integration | Scaffold the integration behind a flag. | |
| Skip REPLY-12 entirely until post-pilot | Defer the gate definition itself. | |

**Selected:** Documented gate.
**Notes:** REPLY-12 explicitly says "gate criteria, not implementation." Building a flagged integration drifts past the hard constraint (no WABA in v1). Skipping the doc loses the planning anchor for post-pilot.

---

## Claude's Discretion

The following were marked as planner/researcher discretion in `04-CONTEXT.md`:
- Exact Reply system-prompt content + few-shot example structure
- Exact set of canonical SOP categories beyond the seeded three
- Edit-rate / thumbs-down thresholds for `WABA-GATE.md`
- Draft-card editor choice (`<textarea>` vs richer editor; default = controlled textarea)

## Deferred Ideas

The following came up in the analysis and are explicitly out of Phase 4 scope (logged in `<deferred>` of `04-CONTEXT.md`):
- WhatsApp Business API integration / auto-send (WABA-01, post-pilot, gated by REPLY-12)
- Per-user voice learning from `users.voiceSamples[]` (post-pilot)
- Pre-computed analytics rollups (revisit only if pilot cost demands)
- BM/中文 voice fingerprint depth (added when Derek provides samples)
- Webhook-driven edit capture (depends on WABA)
- Rich draft editor (Tiptap etc.) — net-new dependency
- Reply Assistant on the senior-coach side (a coach drafting on behalf of an agent)

---

*Auto-mode discussion: every option above was considered; the recommended (✓) option was selected by Claude per the project's "grow, don't fork" discipline. Reverse any decision in `04-CONTEXT.md` before `/gsd-plan-phase 4`.*
