---
phase: 04-reply-assistant
plan: 08
subsystem: ui
tags: [react, nextjs16, next-intl, shadcn, cmdk, sonner, clipboard, server-actions, playwright, i18n]

# Dependency graph
requires:
  - phase: 04-reply-assistant
    provides: "ReplyOutputSchema (Plan 05), captureReplyEdit Server Action + editRatio (Plan 07), required-leadId fail-closed route (Plan 06)"
provides:
  - "Inline Reply draft card (reply-draft-card.tsx): copy-only egress (HR-1) + distinct thumbs-down feedback control (ADMIN-06 producer) + draft/copied/no-sop-match/clarifying states"
  - "Reply lead-selector flow (lead-selector.tsx + lead-actions.ts): cmdk Command in a bottom Sheet, required-leadId UX (D-07), <24h recent affordance (HR-3, no auto-select)"
  - "Pillar override chip widened to coach|finder|reply (chat-header/chat-input/chat-shell)"
  - "AI disclosure Reply line (Surface 6) trilingual"
  - "ALL Phase-4 i18n keys (sole catalog owner): chat.replyDraft/leadSelector/pillarOverride.reply/disclosure.replyLine + kb.pillarFilter/category/noReplySops/pillarSelectLabel + dashboard.replyQuality.*"
  - "Reconciled + discoverable Wave-0 e2e (e2e/reply-draft.spec.ts)"
affects: [04-09 (consumes kb.* keys for the SOP admin filter), 04-10 (consumes dashboard.replyQuality.* incl. thumbsDownLabel — the thumbs-down control here is its KPI producer)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copy-only egress card (HR-1): exactly one Copy/clipboard CTA; thumbs-down is feedback (writes thumbsDown:true), never a send"
    - "onBeforeSend dispatch gate on ChatInput — parent (chat-shell) blocks a leadless Reply turn and opens the lead-selector before any POST"
    - "Server-action-backed picker: cmdk Command in a bottom Sheet, uid-scoped fetch, explicit pick only (no auto-inference)"

key-files:
  created:
    - "app/[lang]/chat/reply-draft-card.tsx"
    - "app/[lang]/chat/lead-selector.tsx"
    - "app/[lang]/chat/lead-actions.ts"
  modified:
    - "app/[lang]/chat/message-list.tsx"
    - "app/[lang]/chat/chat-input.tsx"
    - "app/[lang]/chat/chat-header.tsx"
    - "app/[lang]/chat/chat-shell.tsx"
    - "app/[lang]/chat/disclosure-modal.tsx"
    - "src/i18n/messages/en.json"
    - "src/i18n/messages/ms.json"
    - "src/i18n/messages/zh.json"
    - "e2e/reply-draft.spec.ts (relocated from tests/e2e/)"
    - ".gitignore"

key-decisions:
  - "Reconciled the e2e selector contract toward the Wave-0 spec (data-testid=reply-copy / reply-draft-textarea / reply-thumbs-down, data-slot=reply-draft-card / lead-selector) rather than the plan's prose aliases (reply-copy-button / lead-selector-sheet) — the e2e is the canonical, discoverable contract; added id=reply-copy-button as a non-load-bearing alias."
  - "Relocated tests/e2e/reply-draft.spec.ts → e2e/ (playwright testDir is ./e2e) rather than widening testDir — matches the other 5 specs and the 04-01 deviation note."
  - "Wired ReplyOutput into the message stream by extending ChatMessage with replyOutput/replyIncoming/replyLeadId/replyLang (MatchList is defined but not yet stream-wired); the plain-text+citations path is unchanged."
  - "DialogDescription rendered asChild→<div> so the disclosure can carry two <p> blocks (body + replyLine) without invalid nested <p>."

patterns-established:
  - "Pattern: copy-only egress with a separable feedback affordance — HR-1 governs the send path; thumbs-down coexists as feedback."
  - "Pattern: dispatch-time required-field gate via onBeforeSend (UI defence-in-depth over the server's fail-closed 400)."

requirements-completed: [REPLY-04, REPLY-10, ADMIN-06, QUAL-02]

# Metrics
duration: 18min
completed: 2026-06-05
---

# Phase 4 Plan 08: Reply Paste-and-Draft UI Summary

**Copy-only inline Reply draft card (single clipboard egress + a distinct thumbs-down feedback control that produces the ADMIN-06 KPI), a required-leadId lead-selector (cmdk in a bottom Sheet, explicit pick only), the Reply pillar override chip + AI-disclosure line, and ALL Phase-4 trilingual i18n keys — with the Wave-0 e2e relocated so Playwright discovers it.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-05T21:07Z (approx)
- **Completed:** 2026-06-05T21:21:01+08:00
- **Tasks:** 2
- **Files modified/created:** 13 (3 created, 8 modified, 1 renamed, 1 gitignore)

## Accomplishments
- **Copy-only draft card** (`reply-draft-card.tsx`, client island): quoted incoming block + controlled editable `Textarea` (the D-18 edit-capture surface) + category badge + SOP citation chips. States: `draft` / `copied` (terminal — "Copied — go send it from WhatsApp", never a "sent" state, HR-2) / `no-sop-match` (grounded refusal, no textarea/copy, HR-4) / `clarifying`. EXACTLY ONE Copy/egress CTA (`data-testid="reply-copy"`, HR-1) — no share/send/post/whatsapp affordance anywhere. Copy reads the textarea → `navigator.clipboard.writeText` → `editRatio` → `captureReplyEdit({...})` → toast → collapse.
- **Thumbs-down feedback control** (`data-testid="reply-thumbs-down"`, icon-only ghost `ThumbsDown`, `aria-pressed`): distinct from Copy, idempotent in-session, calls `captureReplyEdit({..., thumbsDown:true})` and NEVER touches the clipboard/share — the producer for Plan 10's thumbs-down-rate KPI (ADMIN-06).
- **Lead-selector flow** (D-07/HR-3): `lead-selector.tsx` (cmdk `Command` in a bottom `Sheet`, `data-slot="lead-selector"`, `min-h-11` `lead-option`s, `CommandEmpty`, Skeleton rows) + `lead-actions.ts` `listLeadsForReply` (uid-scoped own leads, `<24h` recent affordance — pre-highlighted with a confirm tap, NOT auto-selected). `chat-input` gained an `onBeforeSend` gate; `chat-shell` blocks a leadless Reply dispatch, opens the selector, sets `leadId` on pick, treats dismiss as cancel.
- **Override chip widened** to `coach|finder|reply` across `chat-header`/`chat-input`/`chat-shell`; a third `ToggleGroupItem value="reply"` (aria-label "Reply") styled identically.
- **Disclosure replyLine** rendered as a second `<p>` (Surface 6 option b) — no new modal.
- **ALL Phase-4 i18n keys seeded trilingually** (sole catalog owner): `chat.replyDraft.*` (incl. `thumbsDownAria`/`thumbsDownToast`, verbatim `refusalBody`), `chat.leadSelector.*`, `chat.pillarOverride.reply`, `chat.disclosure.replyLine`, `kb.pillarFilter/category/noReplySops/pillarSelectLabel` (Plan 09), `dashboard.replyQuality.*` incl. `thumbsDownLabel` (Plan 10). All three catalogs parse as valid JSON.
- **e2e reconciled:** relocated `tests/e2e/reply-draft.spec.ts` → `e2e/` so Playwright (`testDir: ./e2e`) discovers it (10 cases listed across chromium + Mobile Chrome); selectors honored by the live UI; `playwright-report/` gitignored.

## Task Commits

1. **Task 1: Reply draft card + thumbs-down feedback + message-list wiring + chat.replyDraft copy** — `e7113b1` (feat)
2. **Task 2: Override-chip + lead selector + disclosure + seed ALL Phase-4 i18n keys + e2e reconcile** — `d2d5d13` (feat)

## Files Created/Modified
- `app/[lang]/chat/reply-draft-card.tsx` — NEW client island; the copy-only draft card + thumbs-down feedback; 4 states.
- `app/[lang]/chat/lead-selector.tsx` — NEW; cmdk Command in a bottom Sheet; required-leadId picker.
- `app/[lang]/chat/lead-actions.ts` — NEW Server Action `listLeadsForReply` (uid-scoped, recent affordance, no auto-inference).
- `app/[lang]/chat/message-list.tsx` — renders the `ReplyDraftCard` variant for `ReplyOutput` turns; `ChatMessage` extended (replyOutput/replyIncoming/replyLeadId/replyLang).
- `app/[lang]/chat/chat-input.tsx` — `pillarOverride` widened to include `reply`; `onBeforeSend` dispatch gate added.
- `app/[lang]/chat/chat-header.tsx` — `PillarOverride` widened; third Reply `ToggleGroupItem`.
- `app/[lang]/chat/chat-shell.tsx` — `leadId` state + lead-selector wiring + Reply lead gate; threads `leadId`/`onBeforeSend` to ChatInput.
- `app/[lang]/chat/disclosure-modal.tsx` — second `<p>` rendering `chat.disclosure.replyLine` (DialogDescription asChild→div).
- `src/i18n/messages/{en,ms,zh}.json` — all Phase-4 keys seeded; `chat.copyReply` updated to "Copy draft".
- `e2e/reply-draft.spec.ts` — relocated from `tests/e2e/`; docstring updated; selectors live.
- `.gitignore` — ignore `playwright-report/`, `test-results/`, `blob-report/`, `playwright/.cache`.

## Decisions Made
- **Selector reconciliation:** used the Wave-0 e2e's `data-testid`/`data-slot` names as canonical (`reply-copy`, `reply-draft-textarea`, `reply-thumbs-down`, `reply-draft-card`, `lead-selector`) rather than the plan prose's `reply-copy-button`/`lead-selector-sheet`. Added a non-load-bearing `id="reply-copy-button"` on the Copy button and a `data-testid="reply-draft-card"` alongside the `data-slot` so both selector vocabularies resolve. Rationale: the e2e is the discoverable, executable contract; honoring it makes the test pass against the shipped UI.
- **e2e relocation over testDir change:** moved the spec into `e2e/` (where the other 5 specs live) instead of editing `playwright.config.ts`. Lower-risk, matches convention, satisfies the 04-01 deviation note.
- **ReplyOutput stream wiring:** `MatchList` (Finder) is defined but not stream-wired in `message-list.tsx`; rather than retrofit that, `ChatMessage` was extended with optional Reply fields and the card renders when `replyOutput` is present. The structured-output production end (parsing SSE into `replyOutput`) is a route/chat-input concern outside this UI plan's file set — the card + selectors + capture wiring are complete and unit/type-clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] React 19 purity/effect lint errors in lead-selector.tsx**
- **Found during:** Task 2 (lead-selector implementation)
- **Issue:** ESLint (react-hooks/purity, react-hooks/set-state-in-effect) errored on a `Date.now()` call during render and a synchronous `setState` in the open-effect — both block a clean lint gate.
- **Fix:** Moved the `<24h` recent-lead partition into a `partitionLeads()` helper invoked inside the fetch callback (an event, not render), stored the pre-partitioned `{status, recent, others}` in one state object; guarded the one legitimate open-time `setState({status:'loading'})` with the codebase's existing `eslint-disable-next-line react-hooks/set-state-in-effect` convention (same as disclosure-modal).
- **Files modified:** app/[lang]/chat/lead-selector.tsx
- **Verification:** `npx eslint` on the file exits 0; `tsc --noEmit` clean.
- **Committed in:** `d2d5d13` (Task 2 commit)

**2. [Rule 3 - Blocking] Invalid attribute / removed nested-<p> risk**
- **Found during:** Task 1 (draft card) + Task 2 (disclosure)
- **Issue:** (a) An invalid `data-testid-alias` attribute on the Copy button; (b) rendering two `<p>` inside `DialogDescription` (a `<p>`) would be invalid HTML.
- **Fix:** (a) replaced with `id="reply-copy-button"`; (b) used `DialogDescription asChild` wrapping a `<div>` so the two `<p>` blocks are valid.
- **Files modified:** app/[lang]/chat/reply-draft-card.tsx, app/[lang]/chat/disclosure-modal.tsx
- **Verification:** tsc + lint clean.
- **Committed in:** `e7113b1` / `d2d5d13`

**3. [Rule 2 - Missing Critical] gitignore generated playwright-report/**
- **Found during:** Task 2 (playwright discovery `--list`)
- **Issue:** Running playwright generated an untracked `playwright-report/` that would otherwise be committed.
- **Fix:** added `playwright-report/` (+ `test-results/`, `blob-report/`, `playwright/.cache`) to `.gitignore`.
- **Files modified:** .gitignore
- **Verification:** `git status --short` shows no untracked artifacts.
- **Committed in:** `d2d5d13`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing-critical). **Impact:** all necessary for a clean lint/HTML/working-tree gate. No scope creep.

## Issues Encountered
- None beyond the lint deviations above. `npm run test` exits 0 (503 pass | 107 skip | 0 fail); `tsc --noEmit` clean; lint clean on all touched files (two pre-existing `chat-input.tsx` warnings — an unused `onAuthStateChanged` import at line 29 and an unused eslint-disable at line 130 — are pre-existing and out of scope per the deviation scope boundary).

## Threat surface
No new threat surface beyond the plan's `<threat_model>`. The mitigations are honored:
- **T-04-SEND:** exactly one Copy/egress action; no share/send/post; e2e asserts those locators count 0; copied is terminal.
- **T-04-FEEDBACK:** thumbs-down is feedback-only (writes thumbsDown:true; distinct ghost icon + aria-label + testid; never clipboard/share).
- **T-04-WRONGLEAD:** explicit downline-scoped pick; `<24h` is an affordance not auto-select; server fails closed (Plan 06).
- **T-04-CARD-PII / T-04-DISCLOSE:** card shows only what the agent holds; no client-side PII logging; the Reply disclosure line added trilingually.

## Verification honesty (NOT browser-verified)
This environment has **no Firebase credentials**, so the live browser path was NOT exercised. What IS verified:
- `npx tsc --noEmit` — clean.
- `npm run test` (vitest) — exits 0 (503 pass | 107 skip | 0 fail).
- `npx eslint` on every touched file — clean (errors 0).
- All three i18n catalogs — valid JSON; full cross-namespace key validator passes.
- `npx playwright test --list` — the relocated `e2e/reply-draft.spec.ts` is discovered (10 cases).
- Grep self-checks — the card has no send/share/post/whatsapp affordance; Copy calls `captureReplyEdit(`+`editRatio(`; thumbs-down calls `captureReplyEdit(` with `thumbsDown: true` and does NOT call `navigator.clipboard`.

What STILL needs a human/live click-through (a live App Hosting stack + seeded reply SOPs + a real agent session):
- The copy-to-clipboard → toast → collapsed-copied transition in a real browser.
- The lead-selector opening before dispatch on a leadless Reply turn (and dispatch resuming after a pick).
- The thumbs-down → `replyEdits` row write reaching Firestore.
- The trilingual BM/中文 strings are machine-assisted drafts (`_review: native-review-pending`) — awaiting native sign-off before production (carried-forward D-08 posture).

## Known Stubs
- **`reply-draft-card.tsx` `inferCategory()`** — a display-only heuristic picks the category badge from the incoming text. The authoritative classification lives server-side in `replySlot` (Plan 06). This is intentional for v1 (the badge has a sensible default); when the route surfaces `replySlot.classification` as a prop it can replace the heuristic. Not goal-blocking — REPLY-04's copy-only/edit-capture path does not depend on the badge.
- **`lead-actions.ts` downline scope** — scopes leads to the agent's OWN leads (`ownerUid == uid`), which is the correct scope for an individual agent picking a lead for their own reply. A broader senior-coach "draft on behalf of" scope is explicitly deferred (04-CONTEXT deferred list). Not a stub gap — D-07 requires the agent's own explicit pick.

## Next Phase Readiness
- **Plan 09** can consume the seeded `kb.pillarFilter.*` / `kb.category.*` / `kb.noReplySops` / `kb.pillarSelectLabel` keys for the Reply SOP admin filter — no JSON edits needed there (this plan is the sole catalog owner).
- **Plan 10** can consume `dashboard.replyQuality.*` (incl. `thumbsDownLabel`); the thumbs-down control shipped here is its KPI producer (it writes `replyEdits` rows with `thumbsDown:true`).
- No blockers. The structured-output → `replyOutput` SSE production wiring (so a real Reply turn renders the card) is the remaining integration seam, tracked outside this UI plan.

## Self-Check: PASSED

- Created files exist: `reply-draft-card.tsx`, `lead-selector.tsx`, `lead-actions.ts`, `e2e/reply-draft.spec.ts`, `04-08-SUMMARY.md` — all FOUND.
- Task commits exist: `e7113b1` (Task 1), `d2d5d13` (Task 2) — both FOUND.
- `tests/e2e/` removed (spec relocated to `e2e/`); no orphaned untracked artifacts.
- Gates: `tsc --noEmit` clean; `npm run test` exits 0 (503 pass | 107 skip | 0 fail); lint clean on touched files; all 3 i18n catalogs valid JSON; e2e discoverable.

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
