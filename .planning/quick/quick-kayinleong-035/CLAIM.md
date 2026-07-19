# Claim: quick-kayinleong-035

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-035-chat-loading-cleanup
- started: 2026-07-19
- status: done
- summary: (1) Add a proper loading state (skeleton) while the history drawer fetches conversations. (2) Stop using the legacy `coach-${uid}` primary thread — all conversations should be `chat-*`; hide any legacy `coach-*` threads from history.

## Context

Follow-up to quick-033 (separate chat sessions). The history drawer showed the "just date" entry = the legacy `coach-${uid}` primary thread (no `title` → falls back to the date). The user wants all conversations to be `chat-*` and the `coach-*` one gone. Also wants a clear loading state while history loads.

## What will change

- `app/[lang]/chat/chat-shell.tsx` — initialize `activeCid` to a fresh `chat-<uuid>` on mount (lazy `useState` initializer) so the DEFAULT conversation is a `chat-*` session, never the empty-cid → `ensurePrimaryThread` → `coach-${uid}` path. New/Select flows already use real cids.
- `app/[lang]/chat/conversation-list.tsx` —
  - Replace the "Thinking…" text with skeleton rows (vendored `Skeleton`) while loading; ensure `isLoading` is set before the auth check so the skeleton actually shows (and cleared on the no-user early return).
  - Filter out legacy `coach-*` conversations from the drawer so they no longer appear.

## Out of scope / notes

- The route's empty-cid fallback (`ensurePrimaryThread` → `coach-${uid}`) and the unwired stall-detect job (`runDueJobs.ts` writes nudges into `coach-{uid}`) still reference `coach-*`. The chat UI no longer sends an empty cid, so the fallback is unreachable from the UI; the stall job is a separate, currently-unwired feature. Left as-is (out of scope), noted for the future stall-wiring work.
- **Data:** existing `coach-*` docs are hidden from the UI by the filter (non-destructive). Physically deleting them is a destructive external action — left to the user (Firestore console, or a cleanup script on request). Not run autonomously.

## What has changed

- `app/[lang]/chat/chat-shell.tsx` — `activeCid` now initializes to a fresh `chat-<uuid>` via a lazy `useState` initializer (was `''`). The default conversation is a `chat-*` session; the empty-cid → `ensurePrimaryThread` → `coach-${uid}` path is no longer reachable from the chat UI.
- `app/[lang]/chat/conversation-list.tsx`:
  - Loading state: `isLoading` is set before the auth check (and cleared on the no-user early return) so the skeleton actually renders; the "Thinking…" text is replaced with 5 `Skeleton` rows (`data-slot="conversation-list-loading"`, `aria-busy`).
  - Filter: legacy `coach-*` conversations are excluded from the drawer (`!id.startsWith('coach-')`).

## Verification

**Automated**
- `tsc --noEmit` clean; `eslint` on both changed files clean.
- Targeted tests: `app/[lang]/chat/*` + `src/memory/memory.test.ts` → 75/75 pass (chat-session behavior from quick-033 intact).

**Visual smoke (dev server):** app serves with no 500 and **no console errors** after the `activeCid` initializer change — the chat surface render path is runtime-safe. The skeleton + `coach-*` filter require authenticated conversation data to see, so they are verified by code review + the isLoading/filter logic; behavioral proof is auth-gated (see below).

**Regression Report**
- *Surface:* chat-shell initial conversation state + the history drawer (loading + list filtering). No route/memory/schema change.
- *Bug 2 (quick-033) preserved:* "New conversation" and history-select still set real cids; only the DEFAULT cid changed from `''` (→ coach-*) to a fresh `chat-*`. `ensureConversationOwned` creates the `chat-*` doc on first message exactly as before. Separate sessions + titles unaffected (75 tests green).
- *SSR:* `activeCid` is internal state (not rendered to HTML), and `newConversationId()` has a non-crypto fallback, so the lazy initializer causes no hydration mismatch and no crash (confirmed: clean serve, no console errors).
- *Left as-is (out of scope, noted):* the route's empty-cid fallback and the unwired stall-detect job still reference `coach-${uid}`; the UI no longer sends an empty cid so the fallback is unreachable from the chat surface. If the stall feature is later wired, its nudge should target the agent's active `chat-*` thread (a coach-* nudge would now be filtered from the drawer).
- **Data:** existing `coach-*` docs are hidden by the filter (non-destructive). Physically deleting them was NOT done autonomously (destructive external action) — delete in the Firestore console, or request a cleanup script.
- *Not exercised (needs a signed-in session):* skeleton visible during a real fetch; `coach-*` thread absent from the drawer; the "just date" entry gone.
