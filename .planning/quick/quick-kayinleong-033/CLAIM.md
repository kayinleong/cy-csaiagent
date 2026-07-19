# Claim: quick-kayinleong-033

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-033-chat-sessions
- started: 2026-07-19
- status: done
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

**Bug 1 — Home nav active state**
- `app/[lang]/_components/app-sidebar-nav.ts` — added pure `isNavItemActive(pathname, href)`: a locale-root href (`/${lang}`) matches EXACTLY; deeper hrefs match self + descendants; strips `#anchor` + trailing slash.
- `app/[lang]/_components/app-sidebar.tsx` — replaced the inline prefix-matching `isActive` with `isNavItemActive(pathname, …)`.
- `app/[lang]/_components/app-sidebar-nav.test.ts` — 5 unit tests (Home exact-only, deep-item + descendant, sibling non-match, anchor strip, non-en locale).

**Bug 2 — separate chat sessions**
- `src/firebase/collections.ts` — added optional `title?: string` to `ConversationDoc`.
- `src/memory/conversation.ts` — added `ensureConversationOwned(uid, cid, lang, pillar, titleHint)` + `truncateTitle()`.
- `src/memory/index.ts` — re-export `ensureConversationOwned` + `truncateTitle`.
- `app/api/chat/route.ts` — provided cid now resolves via `ensureConversationOwned` (creates the owned doc for a new session, verifies ownership); empty cid still → `ensurePrimaryThread`.
- `app/[lang]/chat/chat-shell.tsx` — "New conversation" generates a fresh unique cid (`chat-<uuid>`) instead of `''`, so the next message opens a separate thread.
- `app/[lang]/chat/conversation-list.tsx` — history drawer shows `title || summary || date` (never the raw cid); search matches title + summary.
- Tests: `src/memory/memory.test.ts` (4 `ensureConversationOwned` cases), `app/api/chat/route.test.ts` + `tests/chat-route.test.ts` (mock the new fn; new provided-cid assertion).

## Verification

**Automated**
- `tsc --noEmit` — clean.
- `eslint` (all changed files) — 0 errors. (6 warnings remain on PRE-EXISTING lines in the two route test files + memory.test mock — not introduced here.)
- Targeted: `memory.test.ts` + `app/api/chat/route.test.ts` + `app-sidebar-nav.test.ts` → 90/90 pass. `tests/chat-route.test.ts` → 9/9 pass.
- Full suite: sporadic `Test timed out (5000ms)` failures under the full parallel run (kb/rag/rules/crud-contribution/reply) are ENVIRONMENTAL — the sandbox's import time is ~47s and those files pass in isolation (44/44) in <1s. `reply.test.ts` "hit" remains a pre-existing live-model timeout (unrelated).

**Regression found + fixed during verification:** `tests/chat-route.test.ts` (a second route test file) mocked `@/src/memory` without `ensureConversationOwned`; a provided cid then hit `undefined()` and the SSE-header tests failed fast. Added the mock → 9/9 green.

**Visual smoke (dev server, unauthenticated):** chat surface + history drawer render with the changes; "New conversation" click closes the drawer with **no console errors** (fresh-cid path is runtime-safe). Full behavioral proof of both bugs is auth-gated (console sidebar; signed-in chat send) — the unit tests are the authoritative proof; recommend a signed-in manual pass (see below).

**Regression Report**
- *Bug 1 surface:* the sidebar active highlight for every role/section. `isNavItemActive` is pure + unit-tested across exact/prefix/sibling/anchor/locale cases. Anchor deep-links (e.g. `#stalls`) still key off the base route (preserved). No other consumer of the removed inline `isActive`.
- *Bug 2 surface:* chat cid resolution + persistence (the delicate streaming route), history drawer, message read rules. Empty-cid path is unchanged (Test 8 green → primary thread preserved). Provided-cid path now creates an owned doc + is ownership-checked (also HARDENS the prior no-ownership-check path — another user's cid can never be written into; falls back to the caller's primary thread). New `title` is owner-read only, consistent with the already-stored raw message content, and never enters the model (`redactedMessages`), the handoff bundle (`summary`), or logs (hashes) — PDPA path unchanged.
- *Ruled out:* Finder/Reply slot writes, audit, ratelimit, disclosure/handoff untouched. `ensurePrimaryThread` retained + still used for empty cid. Both route test files green.
- *Not exercised (needs a signed-in session):* (a) console sidebar highlight — sign in as admin, visit `/en` then `/en/dashboard`/`/en/kb`, confirm only the current section highlights; (b) chat sessions — send a message, click "New conversation", send again, confirm two separate threads in history (each titled by its first message) with no cross-mixing.
