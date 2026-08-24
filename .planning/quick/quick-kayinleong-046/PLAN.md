# Plan: quick-kayinleong-046

**Four bundled defects.** Research: `RESEARCH-motion.md`, `RESEARCH-chat-persistence.md`,
`RESEARCH-agents.md`, `RESEARCH-leads.md`, `RESEARCH-perf.md`.

## User decisions (2026-08-24)

- **KB content:** code fixes + fix the `pillar` tagging in the scrape scripts. Ingestion
  itself is a **human action** (needs the user's Gemini key, writes live Firestore).
  Onboarding must fail *cleanly and honestly* until content is loaded.
- **Coach envelope:** enforce the schema server-side via `experimental_output`, parse on
  the server, stream `answer` as text and emit `citations`/`handoff` as their own SSE
  events. Preserves mandatory grounding; client decoder stops guessing from `pillarOverride`.

## Landing order (hard constraint from RESEARCH-agents.md)

Defect A's fix (server emits the authoritative pillar) **must land before or with** defect
C's fix (clearing `pillarOverride`) — otherwise clearing the override removes Finder/Reply
card rendering, because today one variable gates both routing and rendering.

## Track ownership (parallel agents share one working tree — file sets MUST stay disjoint)

No agent runs `next build` (concurrent writes to `.next` corrupt each other). Each track
verifies with `tsc --noEmit` + targeted `vitest`. A single `next build` runs at the end.

### Track CHAT (owner: orchestrator) — Tasks 2 + 3
Files: `app/api/chat/route.ts`, `src/agents/coach/prompt.ts`, `src/agents/coach/index.ts`,
`src/rag/search.ts`, `app/[lang]/chat/{chat-shell,chat-input,message-list,markdown-message}.tsx`,
`app/[lang]/chat/decode-structured-output.ts`, `app/[lang]/chat/decode-stream-chunk.ts`,
`app/api/auth/session/route.ts`, `src/ratelimit/window.ts`,
`scripts/scrape-skool/{to-kb,to-kb-ocr}.ts`

1. **A — envelope leak.** Add `experimental_output` + `CoachOutputSchema` to the streaming
   call; parse server-side; stream `answer` as text; emit `citations`/`handoff` as discrete
   SSE events; emit the **authoritative resolved pillar** as an SSE event. Add the missing
   `decodeCoachOutput`; stop gating decode on `pillarOverride` — use the server's pillar.
2. **C — sticky override.** `handleNewConversation` must clear `pillarOverride`; hero-card
   pin becomes per-turn, not sticky. Lands with (1).
3. **B — honest kb_miss.** Add `distanceThreshold` to `src/rag/search.ts:141-148` (today
   `limit:8` always returns 8 rows once the KB is non-empty → confidently-wrong citations).
   Add the missing `tenantId` filter (`search.ts:132`). Fix `pillar:'finder'` hard-codes at
   `to-kb.ts:157` / `to-kb-ocr.ts:129`.
4. **RC-1 — history loss.** Persist the conversation id (URL param, so refresh + share both
   work) and hydrate the transcript at mount. `loadConversationMessages` currently has one
   call site: the history-drawer handler.
5. **RC-2 — mid-stream turn loss.** Both writes sit in `onFinish`, run from a TransformStream
   `flush` that is skipped on cancel. Add `consumeStream()` / `onAbort` so a refresh
   mid-stream still persists the turn.
6. **RC-3 — "didn't respond".** Stream errors arrive as HTTP 200 + an `error` chunk that
   `decode-stream-chunk.ts:20-35` deliberately drops. Surface it: toast + unlatch `isStreaming`.
7. **RC-5** await auth rehydration before the first send. **RC-4** raise/correct `TOKEN_CAP`
   and fix the "hourly" copy (it is a 24 h window). **RC-6** stop storing a raw 1 h ID token
   under a 14 day `maxAge`.
8. **Perf #2 — quadratic re-render.** Remove the duplicate `setMessages` mirror; `memo` the
   message list and markdown renderer. Never animate per streamed token.
9. **Chat waiting state** (`message-list.tsx:184`): replace the 2 s `animate-pulse` loop with
   `@starting-style` entrance, 60 ms dot stagger, and a `filter: blur(2px)` masked handoff
   (asymmetric 120 ms exit / 180 ms delayed enter).

### Track MOTION (agent) — Task 1 (design system)
Files: `app/globals.css`, `app/layout.tsx`, `app/[lang]/chat/page.tsx`, new `loading.tsx`/`error.tsx`
No i18n edits (skeletons need no copy). Must not touch any chat file except `chat/page.tsx`.

1. Motion tokens in `@theme inline` (Emil's three curves + duration scale).
2. Retune `tw-animate-css` `--animate-in`/`--animate-out` off `ease` → `ease-out` (13 components).
3. Global `prefers-reduced-motion` guard (currently zero handling).
4. `@media (hover: hover)` gating — 22 `hover:` utilities currently fire on tap on mobile.
5. Dedupe `<Toaster />` (mounted twice: `app/layout.tsx:50` + `app/[lang]/chat/page.tsx:65`).
6. Add `loading.tsx` + `error.tsx` (currently **zero** app-wide).
7. **Do NOT** use React `<ViewTransition>` — needs Next's vendored canary; bare `react@19.2.4`
   lacks it and it breaks Vitest. Route transitions: CSS only, scoped to list→detail descents.
   `→ chat` gets none (100+/day).

### Track PERF (agent) — Task 1 (performance)
Files: `src/firebase/client.ts`, `app/[lang]/_components/{sign-out-button,app-sidebar,console-shell}.tsx`,
recharts consumers, `app/[lang]/page.tsx`, `app/[lang]/(admin)/usage/page.tsx`, `src/router/heuristic.ts`

1. Split the eager Firebase client SDK (461 KB on every page, 60% waste).
2. `next/dynamic` for recharts (375 KB; dashboard 1477 KB).
3. `limit()` on the unbounded `usageRollups` scans.
4. Widen `COACH_PATTERNS` (9 regexes vs 51 finder) to cut the 400–1200 ms blocking
   `classifyIntent` round-trip on ordinary coach questions. **Must keep `vitest run src/router`
   green — quick-041's finder cases are regression guards.**

### Track LEADS (agent) — Task 4
Files: new `app/[lang]/(admin)/leads/{page,actions,lead-management,actions.test}.tsx|ts`,
`app/[lang]/_components/app-sidebar-nav.ts`, `src/i18n/messages/{en,ms,zh}.json`,
`firestore.rules`, rules test. **Owns i18n exclusively.**

1. Admin Leads page (list + create + edit), mirroring `(admin)/cohorts/` exactly.
2. Create action writes **both** `leads/{id}` and `leadContext/{id}` (same id, three slots
   seeded `{}`) — `writeLeadSlot` uses `.update()` and throws NOT_FOUND otherwise, and the
   Reply call in `onFinish` is not try/caught.
3. `tenantId:'d2'` on every doc. `name` is the **pseudonym label** (never raw PII); hash the
   phone into `phoneHash`; reject a blank `ownerUid` (would create un-erasable orphan PII).
4. firestore.rules admin create/update/delete delta + rules test.
5. Chat side needs **zero** changes — picker, `handleLeadPicked` and the 400 gate all work;
   they were starved of data.

## Verification

- `tsc --noEmit` 0, `eslint` 0 new, full `vitest` green, single `next build` at the end.
- `e2e/persist.spec.ts:231` (`SC2-C`) is a pre-existing test for RC-1 — use as acceptance gate.
- Browser click-through on the chat surface (history survives refresh, no raw JSON, router
  not sticky) and the new admin Leads page.
- Regression Report per the global rules before the claim is marked `done`.

## Out of scope / carried

- **Actually ingesting coach KB content** — human action, needs the user's Gemini key.
  `src/coach/journey/config.ts:9` `kbDocIds` are placeholders (incl.
  `kb-coach-meta-ads-playbook-en`). Onboarding cannot answer until this is done.
- Bundle-size budget in CI (nothing catches a 461 KB regression today).
