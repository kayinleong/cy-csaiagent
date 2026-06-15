---
quick_id: quick-kayinleong-018
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-018

**Fix:** selecting a past conversation in the history drawer left the chat view empty — the transcript
never loaded.

**Root cause:** `chat-shell.handleSelectConversation` set `activeCid` and cleared messages but never
fetched the thread's persisted messages. The `/api/chat` route builds context from client-held
`body.messages`, not storage, so after a reload there was nothing to show. `chat-input` had an unused
`initialMessages` prop and only seeded from it once on mount. Ordering blocker: `MessageDoc` had no
timestamp and `appendMessage` used random auto-IDs, so a transcript couldn't be reliably ordered.

## What changed (per file)

- **`src/firebase/collections.ts`** — added optional `MessageDoc.createdAt?: Timestamp | FieldValue`.
- **`src/memory/conversation.ts`** — `appendMessage` stamps `createdAt: serverTimestamp()` at the single
  write site (no caller change); `loadRecent` left unchanged (admin/coach/stall paths out of scope).
- **NEW `app/[lang]/chat/conversation-messages-map.ts`** — pure mapper: orders by `createdAt` ascending
  (null kept as oldest, not dropped), filters `system`, maps `MessageDoc`→`ChatMessage`.
- **NEW `app/[lang]/chat/load-conversation-messages.ts`** — `'use client'` loader: bounded client-SDK
  read of `conversations/{cid}/messages` (no orderBy → no null-drop), maps via the pure helper,
  non-fatal catch (error object only).
- **`app/[lang]/chat/chat-shell.tsx`** — `handleSelectConversation` loads the transcript and passes it as
  `initialMessages`; New conversation clears it.
- **`app/[lang]/chat/chat-input.tsx`** — re-seed effect (deps `[conversationId, initialMessages]`)
  replaces the visible transcript on conversation change.
- **Tests** — new mapper test (ordering/null-keep/filter/citations/no-mutation) + appendMessage
  createdAt-stamp test.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <8 changed files>` | 0 errors (4 pre-existing warnings, none mine) |
| `npx vitest run <2 changed test files>` | 39 passed |
| `npx vitest run` (full suite) | 676 passed / 188 skipped / 0 failed |
| `npx next build` | success — `/[lang]/chat` + `/api/chat` compiled, no client/RSC boundary leak |

Full regression report in `CLAIM.md`.

## Commits

- `551c9f0` feat(quick-kayinleong-018): load and display a selected conversation's transcript
- `25d00dc` test(quick-kayinleong-018): cover transcript mapping/ordering + createdAt stamp

## Caveat

Messages persisted before this claim have no `createdAt`; the loader still shows them (sorted as oldest)
but cannot perfectly order them among themselves — only newly-sent turns gain true chronological order.
This was the accepted trade-off of the chosen approach. Relationship: quick-010 made the sidebar list
conversations, quick-016 fixed the list permission denial, quick-018 makes selecting one load its
messages.
