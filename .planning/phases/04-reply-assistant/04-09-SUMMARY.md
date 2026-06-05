---
phase: 04-reply-assistant
plan: 09
subsystem: ui
tags: [admin, kb, eval, judge, promptfoo, reply, shadcn-tabs, next-intl]

# Dependency graph
requires:
  - phase: 04-reply-assistant (04-03)
    provides: "CreateDocInput.category / UpdateDocInput.category + kbDocs.category persistence; kbChunks.pillar"
  - phase: 04-reply-assistant (04-08)
    provides: "Plan-08-seeded kb.* i18n keys (pillarFilter / category / noReplySops / pillarSelectLabel) in en/ms/zh"
  - phase: 04-reply-assistant (04-01)
    provides: "Reply gold-set stubs (reply-cold-prospect/objection/financing) registered in promptfooconfig.yaml"
  - phase: 02 (Coach + Admin)
    provides: "(admin)/kb editor + judgeRubric/combinedJudgeRubric 6-domain skeleton"
provides:
  - "(admin)/kb pillar filter (All/Coach/Reply) over the fetched docs — client-side, no new route (ADMIN-05)"
  - "kb-doc-form category select (cold-prospect/objection-handling/financing/voice) threaded into create + upload paths"
  - "src/eval/judge.ts replyJudgeRubric + combinedReplyJudgeRubric (groundedSop [SOP:], voiceMatch, qualifyingQuestions, noAutoPitch)"
  - "Offline judge.test.ts gates for the Reply rubric + the three Reply gold sets (EN-first, synthetic-only)"
affects: [04-10 (reply quality dashboard), reply-pilot-eval, kb-admin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pillar filter as a client-side useState over already-fetched admin docs (mirrors showSuperseded toggle)"
    - "Reply judge rubric REUSES Coach voice/toneDrift/languageMatch verbatim + adds Reply-specific domains (no parallel pipeline)"

key-files:
  created:
    - .planning/phases/04-reply-assistant/04-09-SUMMARY.md
  modified:
    - app/[lang]/(admin)/kb/kb-doc-list.tsx
    - app/[lang]/(admin)/kb/kb-doc-form.tsx
    - src/eval/judge.ts
    - src/eval/judge.test.ts
    - evals/gold/reply-cold-prospect.yaml
    - evals/gold/reply-objection.yaml
    - evals/gold/reply-financing.yaml
    - evals/promptfooconfig.yaml

key-decisions:
  - "Grew (admin)/kb in place — added a Tabs pillar filter + category select; no new admin route (ADMIN-05 = a filter view on the existing manager)"
  - "category select offers the seeded enum but the backend type stays open-string (CreateDocInput.category: string?) — admin can curate other categories later"
  - "Reply judge rubric reuses Coach voice/toneDrift/languageMatch verbatim and adds groundedSop([SOP:])/voiceMatch/qualifyingQuestions/noAutoPitch; combinedReplyJudgeRubric mirrors combinedJudgeRubric. Judge model stays JUDGE_MODEL (Remote Config) — no hard-coded ID"
  - "Reply gold sets kept EN-first (D-14); BM/中文 deferred until Derek supplies voice samples. Structural asserts run offline; the llm-rubric is live-gated"

patterns-established:
  - "Admin pillar filter: client-side filter on d.data.pillar with a vendored Tabs control + a per-tab empty state (kb.noReplySops)"
  - "Reply eval rubric extension lives alongside the Coach rubric in src/eval/judge.ts (one judge module, two combined rubrics)"

requirements-completed: [ADMIN-05, REPLY-05, REPLY-06, REPLY-07, REPLY-08, QUAL-02]

# Metrics
duration: 7min
completed: 2026-06-05
---

# Phase 4 Plan 09: Reply SOP Admin Filter + Tone-Aware Eval Rubric Summary

**`(admin)/kb` gains an All/Coach/Reply pillar filter + a category select (incl. the curated voice doc), and `src/eval/judge.ts` gains a Reply rubric (`combinedReplyJudgeRubric`: groundedSop `[SOP:]` / voiceMatch / qualifyingQuestions / noAutoPitch) reusing the Coach voice/tone/language domains — with the three Reply gold sets finalized synthetic + EN-first.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-05T13:25:42Z
- **Completed:** 2026-06-05T13:32:06Z
- **Tasks:** 2
- **Files modified:** 8 (1 created)

## Accomplishments
- ADMIN-05: a vendored `Tabs` (All / Coach / Reply) pillar filter above the KB admin list, filtering client-side on `d.data.pillar` (same `useState` shape as the existing `showSuperseded` toggle); Reply tab + zero Reply SOPs → the `kb.noReplySops` empty state. No new admin route — the existing plain-language editor, multi-format upload, versioning, and publish toggle are unchanged.
- A `category` select on `kb-doc-form.tsx` (cold-prospect / objection-handling / financing / voice — seeded enum, open-string at the type level) threaded through both the text Server-Action path and the file-upload FormData; consumes the Plan-08 `kb.*` i18n keys without editing the catalogs.
- REPLY-05/06/07/08 + D-13: extended `src/eval/judge.ts` with `replyJudgeRubric` (`groundedSop` mapping `[KB:chunk-id]`→`[SOP:doc-id]`, `voiceMatch`, `qualifyingQuestions`, `noAutoPitch`) and `combinedReplyJudgeRubric`, reusing the Coach `voice`/`toneDrift`/`languageMatch` domains verbatim. Judge model stays resolved from `JUDGE_MODEL` (Remote Config) — verified no hard-coded model ID.
- Finalized the three Reply gold sets (synthetic-only, EN-first), pointed their headers + the promptfoo config at the now-live `combinedReplyJudgeRubric`, and added offline `judge.test.ts` gates (Reply rubric structure + per-gold-set EN-present / `[SOP:` grounding / no real MY phone+IC PII).

## Task Commits

Each task was committed atomically:

1. **Task 1: KB admin pillar filter + category form field** - `5ee326c` (feat)
2. **Task 2: Reply judge rubric + gold-set assertions** - `355c49a` (feat)

**Plan metadata:** (final docs commit — SUMMARY + STATE/ROADMAP left to the orchestrator)

## Files Created/Modified
- `app/[lang]/(admin)/kb/kb-doc-list.tsx` - Added the All/Coach/Reply `Tabs` pillar filter (client-side filter on `d.data.pillar`) + the Reply-empty state (`kb.noReplySops`).
- `app/[lang]/(admin)/kb/kb-doc-form.tsx` - Added the optional `category` select (seeded enum) threaded into the text + upload submit paths; `pillar` label now uses `kb.pillarSelectLabel`.
- `src/eval/judge.ts` - Added `replyJudgeRubric` + `combinedReplyJudgeRubric` (Reply domains + reused Coach domains); judge model stays `JUDGE_MODEL`-resolved.
- `src/eval/judge.test.ts` - Added offline structural tests for the Reply rubric + the three Reply gold sets.
- `evals/gold/reply-cold-prospect.yaml` / `reply-objection.yaml` / `reply-financing.yaml` - Pointed comments at the live `combinedReplyJudgeRubric`; assertions + synthetic EN-first data already in place from Wave 0.
- `evals/promptfooconfig.yaml` - Updated the Reply-suite comment to reflect the now-live rubric; suites remain registered + live-gated.

## Decisions Made
- **Grow, don't fork:** ADMIN-05 is a filter view on the existing `(admin)/kb` manager — added a Tabs control + a category field only. No new route group, no editor changes. `actions.ts` already forwards `CreateDocInput`/`UpdateDocInput.category` (Plan 03), so no action change was needed.
- **Category as open-string:** the form offers the seeded enum, but the backend type stays `string?` so Derek can curate additional categories without a code change.
- **One judge module, two rubrics:** the Reply rubric reuses the Coach voice/toneDrift/languageMatch domains verbatim and adds Reply-specific domains — no parallel judge pipeline. `combinedReplyJudgeRubric` mirrors `combinedJudgeRubric`'s shape.
- **EN-first gold sets (D-14):** BM/中文 Reply cases are deferred until Derek supplies voice samples (noted in each gold-set header). The structural `assert` rows run offline; the `llm-rubric` tone/voice/grounding scoring is live-gated.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `files_modified` frontmatter listed `app/[lang]/(admin)/kb/actions.ts` and `page.tsx`, but neither required a code change: `actions.ts` already forwards `category` (Plan 03 added the type and the actions pass `input`/`patch` through verbatim), and `page.tsx` renders the list/form unchanged. The plan's Task 1 `<action>` explicitly anticipated this ("no logic change beyond ensuring `CreateDocInput`/`UpdateDocInput` carry `category`"), so this is in-plan, not a deviation.

The plan also referenced "judge/admin RED tests flipped GREEN." No dedicated Reply-rubric or Reply-gold-set RED test existed in the suite (Wave-0's gold-set guards were YAML-parse + PII scans at the config level, not vitest `it.fails` markers). I added affirmative offline structural tests to `judge.test.ts` to make the Reply rubric + gold sets a real GREEN contract — additive, no inversion needed.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required for this plan.

The live promptfoo Reply eval (`npm run eval -- --filter-pattern "reply"`, ≥90% tone PASS for EN) remains a **live-gated** human step: it needs `ANTHROPIC_API_KEY` + `JUDGE_MODEL` (from Remote Config) + seeded reply SOPs (`pillar:'reply'`, categories cold-prospect/objection-handling/financing + the curated `category:'voice'` doc) in a live Firestore. It is not runnable in this offline environment.

## Verification (what IS and what is NOT verified)

**Verified (offline, this environment):**
- `npm run typecheck` (tsc --noEmit): PASS, clean.
- `eslint` on all touched files: PASS, 0 errors/0 warnings (`kb-doc-list.tsx`, `kb-doc-form.tsx`, `src/eval/judge.ts`, `src/eval/judge.test.ts`).
- `npx vitest run src/kb/kb.test.ts`: 23/23 PASS (KB pipeline unregressed).
- `npx vitest run src/eval/judge.test.ts`: 54/54 PASS (Coach + new Reply rubric + Reply gold-set structural gates).
- Full offline suite `npm run test`: 525 passed | 107 skipped | **0 failed** (EXIT 0).
- `combinedReplyJudgeRubric` present in `src/eval/judge.ts`; `JUDGE_MODEL` still referenced; **no hard-coded model ID** (grep for `claude-`/`opus-N`/`anthropic:` returns nothing).
- All three Reply gold sets parse as valid YAML (js-yaml) and assert `[SOP:`; PII scan finds **no** real MY phone (`+60…`) or IC (`\d{6}-\d{2}-\d{4}`) literals — synthetic-only.
- Plan-08 `kb.*` i18n keys present in en/ms/zh; this plan did **not** modify the catalogs.

**NOT verified (needs a human / live stack):**
- Browser click-through of the admin pillar filter (All/Coach/Reply tab switching, Reply-empty state, creating a Reply SOP with `category:'voice'`) — no Firebase creds / live admin session in this environment.
- The live promptfoo Reply tone eval (≥90% EN PASS) — live-gated (API keys + seeded reply SOPs + Opus judge from Remote Config).

## Next Phase Readiness
- Reply SOP admin management (ADMIN-05) + the Reply eval rubric (REPLY-05/06/07/08, QUAL-02) are code-complete; Plan 04-10 (Reply Quality dashboard + WABA gate doc) can proceed.
- Open live-gated items carried: browser click-through of the admin filter + the live Reply promptfoo run during pilot rollout.

## Self-Check: PASSED

- Created file `04-09-SUMMARY.md` exists.
- Modified files all exist (`kb-doc-list.tsx`, `kb-doc-form.tsx`, `src/eval/judge.ts`, `src/eval/judge.test.ts`, `evals/gold/reply-*.yaml`, `evals/promptfooconfig.yaml`).
- Task commits `5ee326c` (Task 1) and `355c49a` (Task 2) exist in git history.

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
