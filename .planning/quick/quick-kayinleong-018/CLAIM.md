# Claim: quick-kayinleong-018

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Selecting a past conversation in the history drawer does not load its messages — the chat view stays empty. `handleSelectConversation` (chat-shell.tsx) sets activeCid and CLEARS messages but never fetches the persisted transcript; the chat route only ever uses client-held `body.messages`, so after a reload there is nothing to show. Fix: stamp a server timestamp on each message at write time (appendMessage), add a client-side history loader ordered by it, and re-seed the chat on conversation select.

## What will change

**Symptom:** Open the history drawer, click a past conversation → the chat view is empty (no transcript loads). New messages can still be sent (they create a fresh-looking exchange), but the prior turns never appear.

**Root cause:**
- `chat-shell.tsx handleSelectConversation(cid)` (:81-84) does `setActiveCid(cid); setMessages([])` — it clears messages and never loads the selected thread's transcript.
- The `/api/chat` route builds model context from the CLIENT-SENT `body.messages` (route.ts:273-308), not from storage. `loadRecent` (server) is used only by admin review / coach dashboard / stall jobs — never the chat display path. So on reload the client has no history.
- `chat-input.tsx` already declares an `initialMessages` prop ("from server-loaded conversation history", :43-44) but chat-shell never passes it, and chat-input only seeds `messages` from it once on mount (:86) — nothing re-seeds when the selected cid changes (:92-102 updates `cidRef` only).
- Ordering blocker: `MessageDoc` (collections.ts:120-132) has NO timestamp, and `appendMessage` uses `.add()` (random auto-IDs), so there is no reliable field to order a transcript by. Chosen fix (user-approved): stamp a write-time timestamp.

**Planned edits (user chose: add message timestamp + order correctly):**
- `src/firebase/collections.ts` — add `createdAt?: Timestamp | FieldValue` to `MessageDoc`.
- `src/memory/conversation.ts` — `appendMessage` stamps `createdAt: serverTimestamp()` at the single write site (no caller changes); `loadRecent` orders by `createdAt`.
- NEW shell-side client loader (app/[lang]/chat/) — reads `conversations/{cid}/messages` via the client SDK, orders by `createdAt` (legacy null-timestamp messages handled), maps `MessageDoc → ChatMessage`.
- `app/[lang]/chat/chat-shell.tsx` — `handleSelectConversation` loads the transcript and passes it to ChatInput as `initialMessages`.
- `app/[lang]/chat/chat-input.tsx` — re-seed `messages` from `initialMessages` when the selected `conversationId` changes.
- Tests for the loader mapping/ordering + the appendMessage timestamp stamp + (emulator) messages list read.

## What has changed

- `src/firebase/collections.ts` — added `type Timestamp` to the firebase-admin import and an OPTIONAL
  `createdAt?: Timestamp | FieldValue` field to `MessageDoc`. Optional so legacy docs and existing
  callers still type-check; the `makeConverter` `toFirestore` spreads caller data so the field persists.
- `src/memory/conversation.ts` — `appendMessage` now stamps `createdAt` at the single write site:
  `messagesRef(cid).add({ ...msg, createdAt: msg.createdAt ?? FieldValue.serverTimestamp() })`. EVERY chat
  turn (route.ts `onFinish`) gets a server timestamp with no caller change. `loadRecent` left UNCHANGED
  (still `orderBy('__name__')`) — the admin-review / coach-dashboard / stall-job read paths are out of
  scope and must not start dropping legacy null-`createdAt` messages.
- **NEW** `app/[lang]/chat/conversation-messages-map.ts` — pure, node-testable mapper
  `mapConversationMessages(records)`: orders ascending by `createdAt` (null treated as oldest and KEPT,
  not dropped — the quick-010 lesson), filters `system` turns, maps `MessageDoc`→`ChatMessage` (citation
  chunk-id strings → `{chunkId}` objects). No React/firebase imports (only an erased `import type`).
- **NEW** `app/[lang]/chat/load-conversation-messages.ts` — `'use client'` loader: reads
  `conversations/{cid}/messages` via the client SDK (bounded `limit(200)`, NO `orderBy` so null-timestamp
  messages are not dropped), maps via the pure helper. Non-fatal `catch` logs the error object only (no
  PII). The messages-list read rule keys on the parent doc's `ownerUid`, not a message field, so no
  per-field query constraint is needed.
- `app/[lang]/chat/chat-shell.tsx` — `handleSelectConversation` is now async: it loads the transcript,
  then sets `historyMessages` + the `messages` mirror + `activeCid` together. `historyMessages` is passed
  to `<ChatInput initialMessages=… />`. `handleNewConversation` clears `historyMessages`.
- `app/[lang]/chat/chat-input.tsx` — added a `useEffect` (deps `[conversationId, initialMessages]`) that
  re-seeds the canonical `messages` state when the SELECTED conversation changes, so history select loads
  the thread and New conversation clears it. Uses the project-standard
  `/* eslint-disable react-hooks/set-state-in-effect */` (same pattern as conversation-list.tsx). Deps
  only change on select/new, so an in-flight stream is never clobbered.
- **NEW** `app/[lang]/chat/conversation-messages-map.test.ts` — null-`createdAt` kept + sorts first;
  timestamped ascending; `system` filtered; citations mapped; input not mutated; missing fields default.
- `src/memory/memory.test.ts` — added "Behavior 1c": `appendMessage` stamps `createdAt` without the
  caller passing it, preserving the caller's other fields.

**Commits (on `main`):**
- `551c9f0` feat(quick-kayinleong-018): load and display a selected conversation's transcript
- `25d00dc` test(quick-kayinleong-018): cover transcript mapping/ordering + createdAt stamp

## Verification

**Automated gates (all green):**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <8 changed files>` → **0 errors** (4 pre-existing warnings, none introduced here:
  `onAuthStateChanged` unused import + an unused exhaustive-deps directive in chat-input.tsx, and two
  unused mock vars in memory.test.ts).
- `npx vitest run app/[lang]/chat/conversation-messages-map.test.ts src/memory/memory.test.ts` → **39 passed**.
- `npx vitest run` (full suite) → **676 passed | 188 skipped | 0 failed** (no regressions).
- `npx next build` → **success** — all routes compiled incl. `/[lang]/chat` and `/api/chat` (proves the
  new `'use client'` loader + pure mapper resolve cleanly and no server-only module leaked into the
  client bundle).

**Self-audit of the diff (regression-prevention):**
- *Chat send path* — unchanged. `chat-input` still posts `body.messages` + `cid`; the new re-seed effect
  fires only when `conversationId`/`initialMessages` change (select/new), never during a stream
  (`onMessagesChange` feeds chat-shell's own `messages` mirror, not `historyMessages`). Verified by full
  suite + build.
- *Message write path* — `appendMessage` only ADDS a `createdAt` field; the converter already spreads
  caller data and stamps `tenantId`. The 1 MB inline-array invariant is untouched (still `.add()` to the
  subcollection). `MessageDoc.createdAt` is optional, so all existing callers and persisted docs remain
  valid.
- *`loadRecent` consumers* (admin `/conversations` review, coach `/dashboard`, stall-detect job, PDPA
  sweep) — UNCHANGED; still `orderBy('__name__')`. No behavior shift, no risk of dropping legacy
  messages in those paths.
- *Ordering of legacy data* — messages persisted before this claim have no `createdAt`; the loader keeps
  them (sorted as oldest, stable) rather than dropping them, so an existing thread still loads. Only NEW
  messages gain true chronological ordering — an inherent limit of un-timestamped historical data
  (acknowledged when the approach was chosen).
- *PII* — the loader's `console.error` logs the error object only; no message content/uid logged.
- *Core/shell split* — the pure mapper + client loader live in `app/[lang]/chat/` (shell); the
  server-only `src/firebase/collections.ts` is NOT imported by any client component (the loader uses
  `clientDb`). `next build` confirms.

**Not verified here:** the live browser click-through (no auth'd dev session this run). The unit tests
prove the mapping/ordering at the data layer and the timestamp stamp at the write layer; the remaining
human check is: open `/en/chat`, send a turn, reload, open the drawer, select the thread → the transcript
renders (newly-sent turns in correct order). Existing pre-quick-018 messages will load but may not be
perfectly ordered among themselves (no timestamp existed when they were written).
