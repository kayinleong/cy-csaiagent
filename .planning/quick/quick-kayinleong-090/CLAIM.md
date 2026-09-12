# Claim: quick-kayinleong-090
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-12
- summary: admin-editable "Priority List" prompt injected into Coach/Finder recommendation ordering, plus a two-format contract for the Finder (table for recommendations, full fact-sheet for a single property, no AI summarization)
- status: done

## What will change

Two tasks, one claim — they share the Finder prompt surface, so splitting them would mean
two conflicting edits to the same system prompt.

### Task 1 — Priority List (admin surface → Firestore → agent prompt)

A free-text prompt an admin types in the admin dashboard, persisted to Firestore, and
injected into the Coach/Finder system prompt so property recommendations follow the
admin's stated ordering for the area the user asked about.

### Task 2 — Finder answers in exactly two formats

1. **Recommendations / plural ask → markdown table only.**
2. **Single-property ask → the fact-sheet layout** defined by the user's attached
   `Fact + Layout + Reason summary (Royal Suites).docx`, captured verbatim in
   `FORMAT-CONTRACT.md` in this directory.

Plus: **no AI summarization of property data** — stored detail is emitted in full, not
condensed.

## What has changed

### Task 1 — Priority List

**Firestore.** `appConfig` now holds two singletons with different shapes, so it gets a
second typed accessor rather than a widened union (`collections.ts` one-converter-per-shape
precedent): `PriorityListDoc`, `priorityListConverter`, `PRIORITY_LIST_DOC_ID`,
`priorityListRef()`. **`firestore.rules` needed no change** — the existing
`match /appConfig/{configId} { allow read, write: if false }` wildcard already denies all
client access to the new doc, and the Admin SDK bypasses rules.

**Admin surface** — `app/[lang]/(admin)/priority-list/`, copied from the model-config
analog: RSC page behind `requireRole({ allowed: ['admin'] })`, `'use server'` actions with
the three-layer gate (role read from the **verified token, never args**), transactional
write with an `expectedCurrent` conflict check so two admins cannot blind-overwrite each
other, 4000-char cap, generic error codes (no raw Firestore text to the client), and a
success-only `audit.log({ action: 'priority_list_publish' })`. Nav entry added under
System & Compliance, `roles: ['admin']`. i18n keys added to **all three** catalogs with
real BM and 中文 translations.

**The read** — `src/config/priority-list.ts`, the exact counterpart of `modelFor`:
fail-soft, returns `''` on any error. An admin ordering preference is never worth failing
a chat turn over.

**Injection — two halves, and both are required.** The Finder model only ever sees the
first `MAX_MATCHES = 8` of the result array. A prompt-only priority list silently no-ops
whenever the named project ranks 9th or lower, which is most of the time on an 82-project
corpus. So:

| Half | Where | Does what |
|---|---|---|
| Ranking | `src/inventory/priority.ts` → `searchProjects` | hoists the project **into** the model's 8-row window |
| Prompt | `finder/prompt.ts`, `coach/prompt.ts` | orders presentation **within** what the model then sees |

`app/api/chat/route.ts` reads the doc **once** per turn, above the dispatch, and passes it
to both.

**Coach framing is deliberately different from Finder framing.** The Coach has no
inventory tools and its Scope section forbids property advice, so it receives the same text
as *awareness* — do not contradict D2 policy, do not act on it, route any real
recommendation to Finder. Dropping the admin's raw "recommend X first" into an agent that
cannot call `searchProjects` would invite exactly the ungrounded project-naming the
grounding rules exist to stop.

### Task 2 — Finder output formats

**Detail branch (rewritten).** A mandatory three-section format replacing the previous
one-line "organise it like a D2 agent would" instruction: a 14-row fact sheet, then
`LAYOUT SUMMARY BREAKDOWN`, then `TOP REASONS WHY <name>` — the layout from the user's
attached docx, recorded in `FORMAT-CONTRACT.md`. Values are copied **verbatim**; a field
with nothing on record reads exactly `not on record` rather than being guessed, borrowed
from a comparable project, or filled from the model's own knowledge.

⚠ **The fact sheet is a markdown TABLE, not the docx's plain `Label: value` lines.** The
renderer runs `remark-gfm` only — no `remark-breaks` — so single newlines collapse and
14 plain lines would have rendered as one unreadable paragraph. A two-column table is the
faithful rendering of the docx's tab-aligned label/value columns and is already styled in
`markdown-message.tsx`. Verified in source, not assumed.

**Table branch (no change, by the user's decision).** The recommendations path already
rendered table-only: `MatchList` dispatches to `MatchTable`, a server-truth React table
built from `rows` that the server overwrites from the tool result. The model's `rationale`
prose is never rendered on that path. The user chose to keep the model-written `Highlight`
column as-is. One prompt rule was added: a shortlist must go in `matches`, **never** in
`answer` — writing it as prose into `answer` replaces the rendered table with an essay and
loses every per-row price, size and Details button.

## Verification

### Regression surface
`searchProjects` ranking (every Finder search), the Finder and Coach system prompts (every
turn on those pillars), the chat route dispatch, the `appConfig` collection, and the admin
nav. Each is covered below.

### Mutation-verified — every guard broken on purpose, confirmed red, restored green

| Guard broken | Result |
|---|---|
| ambiguity guard removed from `applyPriorityBoost` | **1 fail** — "Royal Suites" also hoisted "Royal Gardens" |
| `applyPriorityBoost` call removed from `search.ts` | **1 fail** — prioritised project stayed outside the 8-row window |
| `priorityList` dropped from the route's `makeTools`/`buildSystemPrompt` | **3 fails** |
| conflict check neutered (admin actions) | 1 fail |
| `MAX_TEXT_LENGTH` raised | 1 fail |
| admin role gate deleted | 2 fails |
| `zh.adminPriorityList.helpText` deleted | i18n parity, 2 fails |
| nav roles widened to senior-coach | 2 fails |

No guard passes vacuously.

### What the boost provably cannot do
Asserted through the real `searchProjects`, not the pure function:
- **cannot defeat the location hard gate** — a prioritised Damansara project is still
  excluded from a Cheras search (`search.test.ts`)
- **cannot add, drop or duplicate** a project — set membership is asserted unchanged
- **cannot disturb the ordering of unprioritised projects** — it is a stable partition,
  not a re-sort, so the quick-050 relevance-tier ordering survives intact
- **no-ops entirely** on empty/whitespace/null text, returning the same array reference

The boost runs last, after `status:'active'`, the eligibility gates, the location and price
hard filters, and the `MIN_RELEVANCE` floor.

### Suite
`npm run typecheck` clean. `eslint` clean on all changed paths. Full suite
**1408 passed / 0 failed / 197 skipped**.

One `reply.test.ts` 5s timeout appeared on the first full run and did **not** reproduce on
a clean re-run — the load-sensitive timeout diagnosed in quick-085, not this diff. The two
genuine failures that first run were mine (`route.test.ts` pins `makeTools` arity); both
were real signal and both are fixed, with the new 5th argument now asserted positionally so
a future signature change cannot silently drop the boost.

### Honest limits — read these before trusting the feature

⚠ **Prompt compliance is unproven.** Everything above verifies that the right text reaches
the model and that the ranking is correct. Whether the model actually *obeys* the
three-section format on a live turn is not tested here — no live model call was made. The
trilingual promptfoo gold sets are `live_pilot_gated` and do not run in CI. First live use
should be spot-checked against `FORMAT-CONTRACT.md`.

⚠ **Fact-sheet fidelity is capped by the corpus, not by the prompt.** The 14 docx fields
mostly do not exist as structured Firestore fields — they live inside each project's free
text. Measured coverage across all 82 records: developer 71/82, total units 69/82,
completion 67/82, carpark 62/82, maintenance fee 62/82, **top reasons 39/82**, **no. of
blocks 6/82**. So `not on record` will legitimately be the honest answer for many rows,
and for "No. of Blocks" it will be the answer almost every time. The user chose verbatim
echo now over building extractors first; hardening this is a separate claim.

⚠ **A priority project below the `MIN_RELEVANCE` floor (0.20) is still excluded.** The
boost reorders the post-floor set, so it cannot rescue a project the query is semantically
unrelated to. This is intended, but it means "always" in the admin's text is not literally
always.

⚠ **`CLAUDE.md`'s "prompt-cached" claim is stale.** There is no `cacheControl` /
`providerOptions.anthropic` anywhere in `src/` or `app/`; the `cachedInputTokens` column in
`usageEvents` will be flat zero. Not fixed here (out of scope), but the priority block was
placed immediately **before** each prompt's Output Format section rather than at the tail —
keeping the recency-sensitive JSON contract last, and leaving the static rules above it
cacheable when caching does land.

### Docs
`CLAUDE.md` updated: `config` added to the core-module list, and the new
admin-authored-runtime-config convention documented (one module per `appConfig` doc,
fail-soft, prompt builders receive config rather than fetching it). No public API broke, so
no `CHANGELOG.md` entry.
