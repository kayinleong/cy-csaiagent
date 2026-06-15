# Claim: quick-kayinleong-018

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: claimed
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

_TBD._

## Verification

_TBD._
