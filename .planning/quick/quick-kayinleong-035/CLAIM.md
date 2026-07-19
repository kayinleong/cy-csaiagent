# Claim: quick-kayinleong-035

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-035-chat-loading-cleanup
- started: 2026-07-19
- status: in-progress
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

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
