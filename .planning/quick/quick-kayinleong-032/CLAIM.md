# Claim: quick-kayinleong-032

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-032-chat-redesign
- started: 2026-07-19
- status: in-progress
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

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
