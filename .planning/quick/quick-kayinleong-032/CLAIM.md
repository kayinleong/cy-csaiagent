# Claim: quick-kayinleong-032

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-032-chat-redesign
- started: 2026-07-19
- status: done
- summary: Redesign the agent chat surface to the provided screenshot (lime accent, warm bg, serif hero, suggestion cards) with the new visual language propagated app-wide; verify the PDF's Phase 1 (Coach MVP) scope against the codebase; deliver a Phase 1 test table.

## Context

The user invoked `/gsd-plan-phase --research --auto` to "kick start Phase 1," read `docs/D2Co Feature to Benefit.pdf` for scope, "implement all the scope functionality," produce a test table, and redesign the chat UI per an in-chat screenshot.

Key reconciliation:
- **Phase numbering mismatch.** The PDF numbers phases from 0. PDF "Phase 1 = AI Onboarding Coach MVP" (weeks 3–6) maps to GSD ROADMAP **Phase 2** (Coach + Admin v1); the PDF's Foundations (Phase 0) is GSD Phase 1. The user relaxed phase-naming ("planning folder dont have to follow this phase naming").
- **The platform is already code-complete** (GSD Phases 1–7 all `[x]`). PDF Phase 1 (Coach MVP) functionality already exists. So "implement all scope" = **verify + gap-report**, not rebuild.
- User decisions (AskUserQuestion, 2026-07-19): (1) **Redesign + verify scope** — keep the working v1; (2) **Whole app** — propagate the new visual language app-wide.

## Scope of THIS claim

1. **UI redesign** (primary deliverable) — restyle the chat surface to the screenshot and propagate the new visual language app-wide via global tokens.
2. **Scope verification** — audit each PDF Phase-1 (Coach MVP) scope item against the code (done via Explore subagent).
3. **Test table** — a Phase 1 (Coach MVP) manual test matrix.

Explicitly **out of scope** for this claim (surfaced as findings, recommended as a follow-up claim): wiring the Coach journey/stall/escalation seams into the live streaming route (`app/api/chat/route.ts`). These are behavior changes to the core chat path with their own regression surface; per the global "minimal fix / behavior changes in a separate claim" rule they do not belong in a UI-redesign claim.

## What will change

- `app/layout.tsx` — add a serif display font (Fraunces) via `next/font`; expose `--font-fraunces`.
- `app/globals.css` — new light/dark design tokens: lime-green `--primary`/accent with dark foreground, warm off-white `--background`, serif `--font-heading`, robust `--font-sans` stack. Whole-app propagation.
- `app/[lang]/chat/chat-header.tsx` — restructure into the top nav from the screenshot: D2 logo + name (left), centered Auto/Coach/Finder/Reply segmented control, EN/BM/中文 text toggles + lime "Talk to my coach" pill (right), history affordance preserved.
- `app/[lang]/chat/hero-empty-state.tsx` (new) — serif hero greeting (agent name when available), subtitle, 2×2 suggestion cards.
- `app/[lang]/chat/chat-shell.tsx` — render hero empty state; wire suggestion-card → send; footer disclosure microcopy.
- `app/[lang]/chat/chat-input.tsx` — restyle rounded input + lime send button; accept a programmatic suggestion submit (no change to the SSE stream protocol).
- `src/i18n/messages/{en,ms,zh}.json` — new `chat` keys (hero greeting/subtitle, suggestion cards, footer disclosure), maintained to parity.

## What has changed

**UI redesign (delivered):**
- `app/layout.tsx` — added Fraunces serif via `next/font` (`--font-fraunces`), applied on `<html>`.
- `app/globals.css` — new light/dark tokens: warm off-white `--background`, vivid lime `--primary`/`--ring`/accent with near-black `--primary-foreground`, warm neutrals + borders, `--radius` 0.625→0.75rem, `--chart-1` → lime; fixed `--font-sans` (was self-referential) to an explicit Geist stack and `--font-heading` → Fraunces. Propagates app-wide.
- `app/[lang]/chat/chat-header.tsx` — rewritten as the top nav (history · D2 logo · name · AI badge · centered Auto/Coach/Finder/Reply segmented control · EN/BM/中文 text toggles · lime "Talk to my coach"). All props, handoff logic, `data-slot="chat-header"`, `data-slot`/`data-testid="ai-badge"`, and pillar `aria-label`s preserved.
- `app/[lang]/chat/hero-empty-state.tsx` (new) — serif hero (agent first name via Firebase Auth, name-less fallback), subtitle, 2×2 suggestion cards.
- `app/[lang]/chat/chat-input.tsx` — unified rounded input + lime icon send button + footer AI-disclosure microcopy; `submittedSuggestion` one-shot send path (explicit-text arg avoids input-state race). SSE streaming logic unchanged; removed one unused import + one stale eslint-disable.
- `app/[lang]/chat/chat-shell.tsx` — renders `HeroEmptyState`; suggestion→send handler (pins pillar, then dispatches); dropped now-unused `emptyStateMessage` prop.
- `app/[lang]/chat/page.tsx` — stopped passing `emptyStateMessage`.
- `src/i18n/messages/{en,ms,zh}.json` — added `chat.heroGreeting`, `heroGreetingNoName`, `heroSubtitle`, `footerDisclosure`, `suggestions.*` (at parity).
- `.claude/launch.json` (new) — `next dev` config used for visual verification.

**Scope verification + test table (delivered):**
- `PHASE-1-TEST-TABLE.md` — UI acceptance + 12 Coach-MVP scope items, with the 4 audit gaps flagged.

**Deferred (surfaced, not done):** wiring the Coach journey/stall/escalation seams into `app/api/chat/route.ts` (4 gaps). Recommended as `quick-kayinleong-033`.

## Verification

**Automated**
- `tsc --noEmit` — clean.
- `eslint` (all changed files) — 0 errors, 0 warnings.
- `vitest run` — 691 passed, 188 skipped, **1 failed**: `src/agents/reply/reply.test.ts` "hit → non-empty sopDocIds" — a 5s timeout in `replyAgent.run()` (live-model generation). Pre-existing + environmental: the file is in `src/agents/reply/` (not in the import graph of any changed file; `src/` never imports `app/`, and the reply agent does not import the i18n JSON), and it is a network/model timeout, not an assertion failure.
- i18n parity test — passes (en/ms/zh identical key trees).

**Visual (dev server + browser)**
- `/en/chat` renders the redesign at desktop and narrow widths (matches the target screenshot: nav, serif hero, 2×2 cards, lime send, footer).
- Computed styles confirm: "Talk to my coach" bg = lime `lab(87.9 -34.3 79.2)` with near-black text; hero `font-family` includes `Fraunces` at 48px.
- Segmented control interactive (Auto→Coach active pill moves).
- Whole-app token propagation confirmed on `/en/sign-in` (lime "Sign in" button).

**Regression Report**
- *Regression surface:* every `bg-primary`/`primary-foreground` consumer app-wide (buttons, sidebar-primary, active states), charts, radius, body/heading fonts, and the chat surface (header, input, empty state, disclosure, lead gate, SSE stream).
- *Global tokens:* lime primary + near-black foreground verified legible (chat + sign-in). Only `--chart-1` changed (chart-2..5 unchanged → multi-series contrast preserved). Radius +0.125rem and the `--font-sans` fix are cosmetic. `--font-heading` (Fraunces) only applies where `font-heading` is used (the hero) — other headings keep their existing sans styling.
- *Chat surface:* SSE stream/decoding preserved verbatim; suggestion send is additive (default typing path unchanged). Reply lead-gate still fires (A6). Language toggle keeps set/clear (toggle-off) semantics.
- *e2e selectors preserved:* `[data-slot="chat-header"]` (finder-flow), `getByTestId('ai-badge')` text "AI" (disclosure), pillar `[aria-label="…"]`.
- *Ruled out:* no `src/` behavior changed → agent/route/rules/eval suites unaffected (all green except the unrelated live-model timeout). `emptyState` i18n key retained in catalogs (parity intact) though unused in code.
- *Not exhaustively exercised (recommended human spot-check):* full admin/coach console click-through under the new tokens; BM/中文 native copy review of the new strings.
