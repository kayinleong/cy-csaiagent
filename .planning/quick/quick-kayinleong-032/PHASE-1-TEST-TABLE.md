# Phase 1 (AI Onboarding Coach MVP) — Manual Test Table

**Scope source:** `docs/D2Co Feature to Benefit.pdf` §8 "Phase 1 — AI Onboarding Coach MVP (weeks 3–6)".
**Note on numbering:** the PDF numbers phases from 0. PDF "Phase 1" = the Coach MVP, which maps to GSD ROADMAP **Phase 2** (Coach + Admin v1). The codebase already ships this (and later pillars) — this table is a **verification + redesign-acceptance** matrix, not a build checklist.

**Legend:** ✅ works today · 🎨 delivered by this redesign (quick-kayinleong-032) · ⚠️ **gap** — seam built + unit-tested but not wired into the live chat route (`app/api/chat/route.ts`); see "Audit gaps" at the bottom.

**Test setup**
- App: `npm run dev` → `http://localhost:3000/en/chat` (also test `/ms/chat`, `/zh/chat`).
- Most Coach tests need a **signed-in New Agent** (unauthenticated visits redirect to `/sign-in`). Use a seeded pilot agent; a senior-coach account is needed for the dashboard rows.
- The unauthenticated chat page still renders the redesigned hero/nav (useful for UI checks only).

---

## A. UI redesign acceptance (this claim — quick-kayinleong-032)

| # | Area | Steps | Expected result | Status |
|---|------|-------|-----------------|--------|
| A1 | Brand tokens | Load any page (`/en/chat`, `/en/sign-in`, admin console) | Warm off-white background; vivid lime-green primary (buttons/active states) with near-black text on lime; lime focus rings | 🎨 |
| A2 | Top nav | Load `/en/chat` at desktop width | Left: history icon · D2 lime logo · "D2 Agent Assistant" · "AI" badge. Center: segmented **Auto / Coach / Finder / Reply** (Auto = white active pill). Right: **EN / BM / 中文** + lime "Talk to my coach" pill | 🎨 |
| A3 | Serif hero | Signed-in agent opens an empty chat | "Hi {firstName}, ready to close your first deal?" in Fraunces serif; name resolves from the agent's displayName (name-less fallback if none) | 🎨 |
| A4 | Suggestion cards | Look at the empty state | 2×2 grid: Finder / Coach / Reply / Coach cards with a muted pillar label + prompt text | 🎨 |
| A5 | Suggestion → send | Tap "Walk me through my first Meta ad campaign" | Pillar pins to **Coach**, the prompt is sent, the Coach streams a reply | 🎨 |
| A6 | Suggestion → Reply lead gate | Tap "Draft: loan eligibility for Bangsahill Park" | Pillar pins to **Reply**; because no lead is active, the lead-selector opens first (no send until a lead is picked); prompt text is preserved | 🎨 |
| A7 | Segmented control | Click Coach / Finder / Reply tabs | Active white pill moves; the pillar override is applied to the next message | 🎨 |
| A8 | Rounded input + send | Type a message | Unified rounded input; lime square send button (arrow); Enter sends, Shift+Enter = newline; disabled while streaming | 🎨 |
| A9 | Footer disclosure | Look under the input | "You're chatting with AI. Escalate to your coach any time." (persistent AI disclosure) | 🎨 |
| A10 | Responsive | Narrow the window (<640px) | App name + language toggles hide; cards stack to 1 column; nav stays usable | 🎨 |
| A11 | Trilingual copy | Switch to `/ms/chat` and `/zh/chat` | Hero, subtitle, suggestion prompts, footer all render in BM / 中文 | 🎨 |
| A12 | Dark mode | Emulate dark color-scheme | Dark surfaces with the same lime accent; text legible | 🎨 |

---

## B. Phase 1 (Coach MVP) scope functionality

| # | Scope item (PDF §8) | Steps | Expected result | Status |
|---|---------------------|-------|-----------------|--------|
| B1 | Mobile chat + persistent history | Send a message; refresh; reopen from history drawer | Message streams token-by-token; transcript persists across refresh/sessions; history drawer lists past threads | ✅ |
| B2 | Coach: D2-grounded, cited answers | Ask "What's the pricing structure for Royal Suites?" | Answer grounded in D2 KB with `[KB:chunk-id]` citations; no generic real-estate advice | ✅ (grounding is prompt-enforced live; the server-side empty-retrieval gate runs only via `coachAgent.run()`, which the streaming route bypasses — see G-Reason) |
| B3 | KB-miss → no hallucination + handoff | Ask something absent from the KB | UI toast "couldn't find a D2 KB article… coach notified" | ⚠️ Client toast fires, but **no escalation/knowledge-gap row is written** for a live Coach miss (`emitHandoffSignal`/`recordKnowledgeGap` not called from the route) — Gap 2 |
| B4 | Onboarding checkpoint tracking | Progress through onboarding; ask the Coach where you are | Coach is journey-aware; checkpoint reflected in prompt/tools and on the dashboard | ⚠️ Journey modules exist + tested, but the route calls `buildSystemPrompt()`/`makeTools()` **without journeyContext/agentUid** → Coach is journey-blind live — Gap 1 |
| B5 | Checkpoint advancement / comprehension gate | Complete a checkpoint's comprehension check | Checkpoint advances; `agentProfiles/{uid}` updates | ⚠️ `commitAdvance`/`gradeParaphrase` are **never called from any Server Action** → journey never advances in-app — Gap 4 |
| B6 | Proactive stall nudge (2+ days) | Simulate an agent idle 2+ days; load the app (lazy-cron) | Stall detected → in-app nudge + stall alert | ⚠️ Logic runs, but `touchLastActive` is **never called**, so `lastActiveAt` is frozen at provisioning → stalls aren't activity-driven — Gap 3 |
| B7 | Auto-escalation after 48h no response | Leave a nudge unanswered 48h (working-hours gated) | Escalation row created, visible to senior coach | ⚠️ Escalate job exists but depends on the same stale `lastActiveAt` — Gap 3 |
| B8 | AI disclosure (upfront) | First-ever visit | Blocking disclosure modal before chatting; persistent "AI" badge + footer thereafter | ✅ |
| B9 | Human handoff | Click "Talk to my coach" | Handoff Server Action fires; PII-free context bundle sent; success toast | ✅ |
| B10 | Admin KB CRUD (plain-language) | As admin, create/edit/publish a KB doc; ask the Coach about it | Doc saved without an engineer; retrievable by the Coach | ✅ |
| B11 | Admin conversation-log viewer | As admin, open a conversation | Read-only transcript; access audited | ✅ |
| B12 | Senior-coach downline visibility | As senior coach, open the dashboard | Only own downline; per-agent stage/checkpoint/days; stall inbox; drill into transcript | ✅ (the knowledge-gap feed is under-fed for Coach until Gap 2 is wired) |
| B13 | Multilingual EN/BM/中文 | Chat in each language; use the EN/BM/中文 toggle | UI copy localized; reply language matches; per-message auto-detect works | ✅ |
| B14 | Intent router + manual override | Ask a Finder-style question in Auto; then pin a pillar | Router routes correctly; override chip forces the chosen pillar | ✅ (exceeds Phase 1 — heuristic **and** LLM classifier active) |
| B15 | Model-agnostic provider | Change `appConfig/modelConfig` via admin Model config; send a message | New model used; no hard-coded model IDs | ✅ |
| B16 | PDPA pseudonymization + audit | Send a message containing a phone/IC/email | PII tokenized before the model; append-only audit row (hashes only) | ✅ (name redaction only triggers when a `leadId` is present — minor edge for name-only Coach chats) |

---

## Audit gaps (recommended follow-up claim — NOT fixed in this UI redesign)

All four are Coach-journey seams that are **built and unit-tested** but not invoked by the live streaming route `app/api/chat/route.ts`. They are behavior changes to the core chat path (own regression surface), so per the global "minimal fix / behavior changes in a separate claim" rule they are surfaced here rather than bundled into a re-skin.

1. **Journey context/tools not injected live** — route calls `coachAgent.buildSystemPrompt()` / `makeTools(userLang)` without `journeyContext` / `agentUid` (Gap 1 → B4).
2. **Coach KB-miss not recorded live** — `emitHandoffSignal` / `recordKnowledgeGap` never fire for a live Coach miss; only a client toast shows (Gap 2 → B3, weakens B12).
3. **`touchLastActive` never called** — `lastActiveAt` frozen at provisioning; stall/48h escalation not activity-driven (Gap 3 → B6/B7).
4. **`commitAdvance` / `gradeParaphrase` never called from a Server Action** — comprehension gate + checkpoint advancement don't run in-app (Gap 4 → B5).

**G-Reason (B2):** the streaming route uses `streamText` directly and relies on the prompt to self-enforce KB grounding; the stricter server-side gate (empty-retrieval → handoff, Zod citation validation) lives in `coachAgent.run()`, which the live route does not call.

> The ROADMAP marks Phases 1–2 "verified (0 code gaps)", so confirm whether these seams were intentionally deferred before wiring them. Suggested follow-up: `quick-kayinleong-033 — wire Coach journey/stall/escalation into the live chat route`.
