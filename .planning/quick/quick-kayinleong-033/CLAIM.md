# Claim: quick-kayinleong-033

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-033-chat-sessions
- started: 2026-07-19
- status: in-progress
- summary: Fix two bugs found during Phase 1 testing — (1) sidebar "Home" nav item always highlighted regardless of route; (2) chat "New conversation" concatenates into the single primary thread instead of creating separate sessions. Revamp chat to support separate, listable, non-mixed sessions.

## Bug 1 — Home nav always highlighted

**Cause:** `isActive` in `app-sidebar.tsx` uses `pathname === base || pathname.startsWith(base + '/')`. The Home item's href is the locale root `/${lang}` (e.g. `/en`), which is a prefix of every console route, so `/en/dashboard` matches `/en/` → Home stays active everywhere.

**Fix:** a locale-root href (one path segment) must match EXACTLY, not by prefix. Extract a pure, testable `isNavItemActive(pathname, href)` into `app-sidebar-nav.ts`, use it in `app-sidebar.tsx`, add unit tests.

## Bug 2 — chat sessions not separated

**Cause:** `ensurePrimaryThread(uid,lang)` returns a deterministic `coach-${uid}` (design D-01 = ONE primary thread). The chat route resolves an empty cid to that thread, and "New conversation" only clears the UI (`activeCid=''`) — so the next message re-resolves to `coach-${uid}` and concatenates. A client-provided cid was also used with **no ownership check** and **no conversation-doc creation** (a new cid's messages would be unreadable — rules key on the parent doc's `ownerUid`).

**Fix (revamp):**
- New `ensureConversationOwned(uid, cid, lang, pillar, titleHint)` in `src/memory/conversation.ts`: empty cid → primary thread; provided cid → create the doc (owned by caller, with a `title`) if missing, use it if owned by caller, else fall back to the primary thread (never write into another user's thread — hardening).
- Chat route: for a provided cid, resolve via `ensureConversationOwned` (creates the doc so the thread is listable + client-readable); empty cid still → `ensurePrimaryThread` (Test-8 behavior preserved).
- "New conversation" generates a fresh unique cid client-side (`chat-<uuid>`) → the next message opens a genuinely separate thread.
- Add an owner-scoped `title` field (first user message, truncated) to `ConversationDoc`; the history drawer shows `title || summary || date` instead of the raw cid. PDPA-safe: owner-read only, never sent to the model/handoff/logs (the handoff bundle uses `summary`, which is left untouched).

## What will change

- `app/[lang]/_components/app-sidebar-nav.ts` — add `isNavItemActive`.
- `app/[lang]/_components/app-sidebar.tsx` — use `isNavItemActive`.
- `app/[lang]/_components/app-sidebar-nav.test.ts` — tests for `isNavItemActive`.
- `src/firebase/collections.ts` — add optional `title?: string` to `ConversationDoc`.
- `src/memory/conversation.ts` — add `ensureConversationOwned` + `truncateTitle`.
- `src/memory/index.ts` — export `ensureConversationOwned` (if barrel re-exports).
- `app/api/chat/route.ts` — resolve a provided cid via `ensureConversationOwned`.
- `app/[lang]/chat/chat-shell.tsx` — "New conversation" generates a fresh cid.
- `app/[lang]/chat/conversation-list.tsx` — show `title || summary || date`.
- `src/memory/memory.test.ts`, `app/api/chat/route.test.ts` — cover/adjust for the new function.

## What has changed

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
