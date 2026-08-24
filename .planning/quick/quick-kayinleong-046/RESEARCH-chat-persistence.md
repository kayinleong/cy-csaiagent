# RESEARCH — Chat history lost on refresh + agent stops responding

- claim: `quick-kayinleong-046` (defect 2 of 4 in `CLAIM.md`)
- date: 2026-08-24
- scope: read-only investigation. No source files were modified.
- bug report (verbatim): *"User refresh the chat history and it went missing and also it didnt response."*

**One-line diagnosis:** the active conversation id is minted fresh on every mount and nothing
ever loads a transcript at mount time, so a reload always starts an empty thread; and the entire
turn (user + assistant message) is persisted *only* inside `streamText`'s `onFinish`, which the AI
SDK skips when the client disconnects or the model call fails — so the turn the user was looking at
when they hit refresh is not merely hidden, it was never written to Firestore.

---

## Root cause(s)

### RC-1 — `conversationId` is regenerated per mount; nothing hydrates the transcript (CERTAIN, primary cause of "history went missing")

`activeCid` is client-only React state with a lazy initializer. It is never read from or written to
the URL, `localStorage`, a cookie, or Firestore. Every reload mints a brand-new thread id.

`app/[lang]/chat/chat-shell.tsx:37-44`
```ts
/** Generate a unique conversation id for a brand-new session (quick-033). */
function newConversationId(): string {
  const rand = ... crypto.randomUUID() ...
  return `chat-${rand}`
}
```

`app/[lang]/chat/chat-shell.tsx:62`
```ts
const [activeCid, setActiveCid] = useState<string>(() => newConversationId())
```

`app/[lang]/chat/chat-shell.tsx:87,92` — message state starts empty on every mount:
```ts
const [messages, setMessages] = useState<ChatMessage[]>([])
...
const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])
```

There **is** a working read path — it is just never called on mount. `loadConversationMessages` has
exactly one call site, inside the history-drawer selection handler:

`app/[lang]/chat/chat-shell.tsx:108-113`
```ts
const handleSelectConversation = async (cid: string) => {
  const history = await loadConversationMessages(cid)
  setHistoryMessages(history)
  setMessages(history) // show immediately; ChatInput converges via onMessagesChange
  setActiveCid(cid)
}
```

Verified call-site inventory:
- `loadConversationMessages` (`app/[lang]/chat/load-conversation-messages.ts:37`) → called only from `chat-shell.tsx:109`.
- `loadRecent` (`src/memory/conversation.ts:237`) → admin/coach/job paths only (`app/[lang]/(admin)/conversations/actions.ts:145`, `app/[lang]/(coach)/dashboard/actions.ts:278`, `src/jobs/runDueJobs.ts:122`). Never the chat surface.
- `listConversations` (`src/memory/conversation.ts:195`) → **no production caller at all** (tests only). The drawer uses its own client query instead.

The server component contributes nothing: `app/[lang]/chat/page.tsx:57-72` renders `<ChatShell>`
with two i18n strings and fires `void triggerDueJobs()`. There is no `[cid]` route segment under
`app/[lang]/chat/` and no Firestore read.

Confirmed no persistence mechanism exists anywhere on the surface:
```
grep -rn "localStorage|sessionStorage|searchParams|useRouter|usePathname" app/[lang]/chat/
# → only the disclosure-modal's d2-disclosure-ack key. Nothing for cid.
```

**Regression origin.** `git log -S newConversationId` → `4250b5a fix(quick-kayinleong-033): separate
chat sessions instead of one merged thread`. Before 033, `activeCid` was `''`, so the server resolved
every turn to the stable primary thread `coach-${uid}` (`src/memory/conversation.ts:77-114`). A reload
still rendered an empty list (RC-1's second half predates 033), but at least the *next* message landed
back in the same thread. 033 removed that accidental continuity. `8033e86 (quick-035)` then hid the
legacy thread from the drawer, so pre-033 transcripts are now unreachable from the UI entirely:

`app/[lang]/chat/conversation-list.tsx:126-127`
```ts
// Hide legacy coach-* primary threads — all conversations are chat-* now (quick-035).
const chatThreads = items.filter((item) => !item.id.startsWith('coach-'))
```

Net effect: after a refresh the user sees `HeroEmptyState`, the old thread is only reachable by
manually opening the drawer, and the *newest* turn may not be there either (see RC-2).

---

### RC-2 — Both message writes live in `onFinish`, which never runs on client disconnect or model error (HIGH — loses the in-flight turn permanently)

`app/api/chat/route.ts:510-541` — the user message and the assistant message are *both* written from
inside `onFinish`:
```ts
onFinish: async (final) => {
  const userMsg: MessageDoc = { tenantId: TENANT_ID, role: 'user', content: userMessageContent, ... }
  await appendMessage(cid, userMsg)
  ...
  const assistantMsg: MessageDoc = { tenantId: TENANT_ID, role: 'assistant', content: final.text, ... }
  await appendMessage(cid, assistantMsg)
```

In `ai@5.0.193`, `onFinish` is invoked from the event-processor **TransformStream's `flush`**:

`node_modules/ai/dist/index.mjs:4802-4823`
```js
async flush(controller) {
  try {
    if (recordedSteps.length === 0) {
      const error = new NoOutputGeneratedError({ message: "No output generated. Check the stream for errors." });
      self._finishReason.reject(error); ... return;      // ← onFinish NOT called
    }
    ...
    await (onFinish == null ? void 0 : onFinish({ ... }));
```

`flush` is only invoked when the stream **closes**, never when it is **cancelled**:

`node_modules/ai/dist/index.mjs:4908-4910`
```js
cancel(reason) {
  return stitchableStream.stream.cancel(reason);
}
```

Two failure modes, both of which lose the whole turn:
1. **Client disconnect** — a browser refresh cancels the `fetch` response body → cancel propagates
   upstream → `flush` never runs → **neither** `appendMessage` fires. The route passes no
   `abortSignal`, defines no `onAbort` (available at `node_modules/ai/dist/index.d.ts:1437`), and
   never calls `result.consumeStream()` (documented at `index.d.ts:2204-2211`).
   Verified: `grep -rn consumeStream app src` → no matches.
2. **Model/stream error** (bad model id from `appConfig/modelConfig`, Anthropic overload, tool
   throw) — `recordedSteps.length === 0` → early `return` at `:4804-4811` → `onFinish` skipped.

This is the reason "history went missing" is worse than a display bug: the exchange the user was
reading at the moment of refresh does not exist in `conversations/{cid}/messages`, so even the
history drawer cannot recover it. It also silently voids `ratelimit.decrement` (`route.ts:630`),
`audit.log` (`route.ts:635`) and `recordUsageEvent` (`route.ts:655`) for that turn — an audit/PDPA
gap, not just a UX one.

---

### RC-3 — A stream-level error is decoded as silence: HTTP 200 + empty bubble + no toast (HIGH — the literal "it didnt response")

The route always returns 200 once the gates pass; failures arrive as an SSE `error` chunk. The
client decoder drops every non-`text-delta` chunk **by design**:

`app/[lang]/chat/decode-stream-chunk.ts:13-35`
```ts
/**
 * Returns the `delta` string only for `text-delta` chunks; every other chunk type
 * (start, start-step, text-start, text-end, finish-step, finish, tool-*, error) and any
 * malformed / non-JSON line returns null.
 */
export function parseTextDelta(line: string): string | null {
```

And the only error surfacing in `chat-input.tsx` is keyed on the HTTP status, which is 200:

`app/[lang]/chat/chat-input.tsx:213-224`
```ts
if (!response.ok) {
  const status = response.status
  if (status === 401) { toast.error('Session expired. Please sign in again.') }
  else if (status === 429) { toast.warning("You've reached your hourly limit. ...") }
  else { toast.error('Something went wrong. Please try again.') }
```

Result: the assistant placeholder inserted at `chat-input.tsx:226-234` stays `content: ''` forever.
There is no `onError` on `streamText` either, so nothing is logged server-side. Combined with RC-2b,
the turn is invisible *and* unpersisted. Note `isStreaming` in `chat-shell.tsx:100-102` is derived
from "last message is an assistant with empty content", so a silently-failed turn also leaves the
shell wedged in a pseudo-streaming state.

---

### RC-4 — `TOKEN_CAP` is 50k per **24 h** against a 5-step tool loop → 429 for the rest of the day (MEDIUM — "didn't response" after a handful of turns)

`src/ratelimit/window.ts:22-28`
```ts
export const WINDOW_MS = 24 * 60 * 60 * 1000
export const REQUEST_CAP = 100
export const TOKEN_CAP = 50_000
```

`src/ratelimit/index.ts:75-79` throws once `tokenCount >= TOKEN_CAP`; `route.ts:259-272` maps that to
429 **before** any model spend. Every pillar now runs `stopWhen: stepCountIs(5)` (`route.ts:509`)
with RAG context injected, so a Coach turn is thousands of tokens. A normal day of onboarding Q&A
exhausts 50k and then *every* message is refused for up to 24 h.

Three aggravators:
- The client re-posts the **entire** transcript each turn — up to the 200-message
  `loadConversationMessages` bound after a history select (`chat-input.tsx:191`, `load-conversation-messages.ts:28`).
- RC-1 makes agents re-ask questions they already asked, burning budget faster.
- The 429 toast says *"hourly limit"* (`chat-input.tsx:218`) while the window is 24 h — so the user
  waits ten minutes, retries, gets nothing, and reports "it didn't respond".

There is an existing acknowledged undercount note at `route.ts:622-629` (decrement uses
`final.usage.totalTokens`, i.e. the last step only), flagged as needing its own claim + sign-off.

---

### RC-5 — `clientAuth.currentUser` is read synchronously; it is `null` for the first moments after a reload (MEDIUM — first send after refresh silently does nothing)

`app/[lang]/chat/chat-input.tsx:170-178`
```ts
const currentUser = clientAuth.currentUser
if (!currentUser) {
  toast.error('You are not signed in. Please sign in to continue.')
  setIsStreaming(false)
  return
}
const idToken = await currentUser.getIdToken()
```

Persistence is LOCAL/IndexedDB (`src/firebase/client.ts:49-58`), which rehydrates **asynchronously**.
A send issued before rehydration completes aborts with no request at all. The codebase already has
the correct pattern elsewhere — `app/[lang]/chat/hero-empty-state.tsx:45` uses `onAuthStateChanged`
— and `authStateReady()` is available in the installed firebase `12.14.0`
(`node_modules/@firebase/auth/dist/auth-public.d.ts:402`). `conversation-list.tsx:94-98` has the same
bug: it silently renders "no history" if the drawer is opened before auth settles.

---

### RC-6 — `__session` stores a raw 1-hour ID token with a 14-day `maxAge`, and is never refreshed (MEDIUM, adjacent — "logged in but nothing works")

`app/api/auth/session/route.ts:69-75`
```ts
cookieStore.set(SESSION_COOKIE_NAME, idToken, {
  httpOnly: true, secure: ..., sameSite: 'strict', path: '/',
  maxAge: SESSION_DURATION_SECONDS,   // 14 days (line 32)
})
```

A Firebase **ID token** expires after 1 hour. The only writer is `sign-in-form.tsx:69`; nothing
re-POSTs on token refresh. After an hour every `__session`-verifying path fails closed and silently:
`requestHandoff` (`app/_actions/chat.ts:101-107`), `app/[lang]/chat/lead-actions.ts:49`,
`app/[lang]/chat/reply-edit-actions.ts:58`, `triggerDueJobs` (`app/_actions/jobs.ts:50-54`), and
`app/[lang]/page.tsx:74-93` (→ redirect to sign-in). `/api/chat` itself is **unaffected** because it
uses a Bearer token from `getIdToken()` (auto-refreshing) — which is exactly why the surface renders
and looks authenticated while its Server Actions are dead.

---

### Ruled out

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Firestore rules deny the transcript read | **No** | `firestore.rules:129-144` keys the messages rule on a `get()` of the parent's `ownerUid`, so an unfiltered `limit(200)` list is satisfiable. `load-conversation-messages.ts:40-43` needs no query constraint. |
| Firestore rules deny the conversations list | **No** | `firestore.rules:117-119` requires `sameTenant()`; the drawer already supplies both equality filters (`conversation-list.tsx:103-113`, the quick-016 fix). |
| An unknown `cid` is rejected by the API | **No** | `src/memory/conversation.ts:161-176` creates the doc (owned by the caller, `tenantId:'d2'`, `title` from the first message). It only falls back to the primary thread when the doc exists and is owned by someone else (`:181-182`). No 4xx path. |
| A `status`/lock field on the conversation blocks writes | **No such field** | `ConversationDoc` = `tenantId, ownerUid, pillar, leadId?, lang, createdAt, summary, title?` (`src/firebase/collections.ts:105-121`). |
| The converter strips `createdAt` on write | **No** | `makeConverter.toFirestore` is a spread + tenant stamp (`src/firebase/collections.ts:772-784`); `createdAt` is declared at `:145`. |
| `orderBy('createdAt')` silently drops messages | **Already fixed** | Deliberately avoided (`load-conversation-messages.ts:10-15`, `conversation-messages-map.ts:38-45`, quick-010/018). Do not reintroduce it. |
| The disclosure modal blocks input after reload | **No** | `disclosure-modal.tsx:52-66,78` returns `null` and calls `onAck()` when the localStorage flag is present; no Dialog mounts. |

---

## Reproduction trace

**First load of `/{lang}/chat`**
1. `app/[lang]/chat/page.tsx:45-51` — awaits `params`, fires `void triggerDueJobs()`, reads two i18n strings. No Firestore, no cid.
2. `chat-shell.tsx:62` — mints `activeCid = "chat-<uuid-A>"`. `messages = []`, `historyMessages = []`.
3. `disclosure-modal.tsx:52-66` — localStorage flag present → `onAck()` → modal unmounts.
4. `messages.length === 0` → `HeroEmptyState` renders (`chat-shell.tsx:194-195`).

**Send**
5. `chat-input.tsx:145-168` — optimistic user bubble; `nextMessages = [...messages, userMsg]`.
6. `chat-input.tsx:172-178` — `clientAuth.currentUser` must already be rehydrated (RC-5), then `getIdToken()`.
7. POST `/api/chat` with `{ messages: <entire array>, cid: "chat-<uuid-A>" }` (`:184-211`).
8. Route gates: auth (`route.ts:241`) → ratelimit (`:260`, RC-4) → parse (`:307`) → `ensureConversationOwned` (`:336`) **creates** `conversations/chat-<uuid-A>` with `ownerUid`, `tenantId:'d2'`, `title` → PDPA (`:373`) → `routeAsync` (`:388`) → `streamText` (`:494`).
9. Tokens stream; `chat-input.tsx:250-285` appends `text-delta` chunks. Nothing is in Firestore yet.
10. Stream closes → `flush` → `onFinish` → `appendMessage(user)` (`:523`), `appendMessage(assistant)` (`:541`), `decrement` (`:630`), `after(audit)` (`:635`), `after(usage)` (`:655`).

**Refresh (the reported bug)**
11a. *If the refresh lands after step 10* — the docs exist. But step 2 runs again with a **new**
`chat-<uuid-B>`, and no code path calls `loadConversationMessages` at mount. `HeroEmptyState`
renders. History appears "missing" though it is recoverable via the drawer. → **RC-1**
11b. *If the refresh lands during step 9* — the response body is cancelled →
`index.mjs:4908` cancel → `flush` never runs → `onFinish` never fires → **the user message and the
assistant message are never written**. The turn is gone from Firestore. Not recoverable from the
drawer either. → **RC-2**
12. The old thread is listed in the drawer only if it has a `title`/`createdAt` and is not `coach-*`
(`conversation-list.tsx:127`). The pre-quick-033 primary thread is filtered out permanently.

**Send after the refresh ("didn't response")**
13. Auth not yet rehydrated → `chat-input.tsx:173` bails with a toast and **no HTTP request**. → **RC-5**
14. Or `tokenCount >= 50_000` from earlier in the day → 429 → toast says "hourly limit" → **RC-4**
15. Or the stream returns 200 + an `error` chunk → `parseTextDelta` returns `null` for it →
the assistant bubble stays empty, `isStreaming` stays truthy, no toast, and (RC-2b) nothing is
persisted. This is the exact "it didn't respond" presentation. → **RC-3**
16. Every Server Action on the surface (`requestHandoff`, lead actions, reply-edit) has been failing
closed since the 1-hour mark. → **RC-6**

---

## Fix plan

Constraints honoured throughout: messages stay in the `conversations/{cid}/messages` **subcollection**
(never an inline array); every write carries `tenantId` (stamped by `makeConverter`, `collections.ts:772-784`);
streaming stays in the **Route Handler** (`app/api/chat/route.ts`) and never moves to a Server Action;
`cookies()`/`headers()` remain awaited (Next 16).

### F1 — Persist the cid and hydrate the transcript at mount (fixes RC-1)

`app/[lang]/chat/chat-shell.tsx`
- Keep `newConversationId()` as the **fallback only**. Add a mount effect that resolves the initial
  cid in this order: (a) a durable stored value, (b) the agent's most recent `chat-*` thread,
  (c) a fresh uuid.
- Durable store — minimal: `localStorage['d2-active-cid']`, written in an effect on every
  `activeCid` change and read once on mount. Follow-up (better, shareable, survives a new device):
  put the cid in a `?c=` search param via `useSearchParams()` + `router.replace()`; note this forces
  a `<Suspense>` boundary around the shell, so keep it out of the minimal fix.
- After resolving the cid, call the **existing** `loadConversationMessages(cid)` and set
  `historyMessages` + `messages` together — exactly the shape already used by
  `handleSelectConversation` (`:108-113`), so `ChatInput`'s re-seed effect (`chat-input.tsx:135-137`)
  converges without change.
- Gate that effect on auth readiness (`await clientAuth.authStateReady()`), otherwise the Firestore
  read is denied and the fallback silently wins.
- For (b), reuse the drawer's equality-only query verbatim (`conversation-list.tsx:101-114`:
  `where('ownerUid','==',uid)`, `where('tenantId','==','d2')`, `limit(50)`, no `orderBy`) plus
  `sortConversationsByCreatedAtDesc`. Both equality filters are mandatory (quick-016) or the
  `sameTenant()` list rule denies the whole query. Extract the query into a shared helper rather
  than duplicating it.
- Do **not** hydrate from a Server Component via `__session` — RC-6 makes that unreliable, and the
  client already has a rules-approved read path.

`app/[lang]/chat/load-conversation-messages.ts` — no change. Keep the no-`orderBy` + client-sort
design (quick-010/018 lesson).

### F2 — Make the turn survive a disconnect (fixes RC-2)

`app/api/chat/route.ts`
- **Move the user-message write out of `onFinish`.** Persist it immediately after the cid is resolved
  (`:337`) and the PDPA gate passes (`:382`), before `streamText` at `:494`. Lift the block currently
  at `:514-523` verbatim — it must keep going through `appendMessage`, which stamps `createdAt`
  (`src/memory/conversation.ts:52-55`) and `tenantId` via the converter.
- **Guarantee `onFinish` runs even if the client leaves.** Add `void result.consumeStream()` before
  returning the Response at `:686`. This is the documented mechanism (`index.d.ts:2204-2211`): it
  drains the model stream server-side, so `flush` → `onFinish` still fires and the assistant message,
  `ratelimit.decrement`, `audit.log` and `recordUsageEvent` all land.
- Additionally add `onAbort` (`index.d.ts:1437`) to persist a partial assistant message, and pass
  `abortSignal: req.signal` so the abort branch (`index.mjs:4884-4888`, `:4895-4898`) can actually
  fire. Pick one primary strategy — `consumeStream()` preserves accounting; `abortSignal` + `onAbort`
  saves cost. Do not enable both without deciding which owns the assistant write, or the turn will be
  written twice.
- Wrap the `onFinish` Firestore writes in try/catch so a `writeLeadSlot`/`recordKnowledgeGap` failure
  cannot abort the message writes that precede it.

### F3 — Surface stream-level failures (fixes RC-3)

- `app/[lang]/chat/decode-stream-chunk.ts` — add a new pure `parseStreamError(line): string | null`
  for `{"type":"error", ...}` chunks. Leave `parseTextDelta` untouched so
  `decode-stream-chunk.test.ts` keeps passing; add cases for the new function.
- `app/[lang]/chat/chat-input.tsx` — in the read loop (`:260-284`) toast and mark the assistant
  bubble as failed on an error chunk. After the loop (`:285`) add a guard: if `assistantContent` is
  still empty, replace the empty bubble with an error state so `isStreaming`
  (`chat-shell.tsx:100-102`) cannot latch on.
- `app/api/chat/route.ts` — add `onError` to `streamText` and log the error object only (no PII, no
  message content) per CLAUDE.md.
- Fix the misleading 429 copy at `chat-input.tsx:218` ("hourly" → daily).

### F4 — Await auth before the first send (fixes RC-5)

- `app/[lang]/chat/chat-input.tsx:172` — `await clientAuth.authStateReady()` (available in firebase
  `12.14.0`, `auth-public.d.ts:402`) before reading `currentUser`; only toast "not signed in" once
  auth has settled.
- `app/[lang]/chat/conversation-list.tsx:94` — same treatment, so opening the drawer early no longer
  shows a false "no history".

### F5 — Rate-limit realism (RC-4) — **separate claim**

Changing `TOKEN_CAP` is a behavioural change already flagged as needing its own claim + Derek
sign-off (`route.ts:622-629`). In *this* claim, only: (a) the 429 toast copy (F3), and (b) optionally
bound the posted transcript at `chat-input.tsx:191` to the last N turns instead of the full
200-message history — which also reduces the per-turn token bill. Note F2's `consumeStream()` will
start counting previously-free aborted turns, so budget burn goes **up**; sequence F5 accordingly.

### F6 — Session cookie (RC-6) — **separate claim**

Either mint a real Firebase session cookie (`adminAuth.createSessionCookie`, days-long, revocable)
instead of storing the raw ID token, or re-POST `/api/auth/session` from an `onIdTokenChanged`
listener. Keep `cookies()` awaited. Out of scope for the history fix but it is why the surface "looks
logged in and does nothing" after an hour.

---

## Regression surface

**Chat surface**
- `app/[lang]/chat/chat-shell.tsx` — `activeCid` feeds `ChatHeader.conversationId` (`:185`) →
  `requestHandoff(cid)` (`chat-header.tsx:82` → `app/_actions/chat.ts:101,118-121`) which reads
  `conversations/{cid}.summary`. Hydrating an *older* cid changes which thread gets escalated to the
  senior coach. Verify escalation still targets the visible thread.
- `chat-input.tsx:135-137` re-seed effect keys on `[conversationId, initialMessages]`. F1 sets both in
  one commit (same as `handleSelectConversation`); if they land in separate commits the effect can
  clobber an in-flight stream. Test: hydrate, send, confirm no mid-stream reset.
- `chat-shell.tsx:100-102` `isStreaming` derivation and `HeroEmptyState` vs `MessageList` switch
  (`:194-202`) — hydrated non-empty `messages` now suppresses the hero on load. Confirm the hero still
  appears for a genuinely new agent.
- `hero-empty-state.tsx` suggestion dispatch → `submittedSuggestion` one-shot (`chat-input.tsx:341-348`).

**History drawer**
- `conversation-list.tsx:101-114` — the equality-only query is load-bearing (quick-016). Any new
  hydration query MUST keep both `ownerUid` and `tenantId` filters or `sameTenant()`
  (`firestore.rules:117-119`) denies it.
- `conversation-list.tsx:127` — the `coach-*` filter. If F1 falls back to "most recent thread", make
  sure it applies the same filter, or the legacy primary thread reappears.
- `conversation-sort.ts` / `conversation-messages-map.ts` + their unit tests — null-`createdAt`
  handling (quick-010/018). Do not reintroduce a Firestore `orderBy('createdAt')`.

**Message subcollection readers (affected by F2's write-ordering change)**
- `src/memory/conversation.ts:237` `loadRecent` orders by `orderBy('__name__') + limitToLast(n)` — by
  **document id**, not `createdAt`. Auto-ids are not time-ordered, so its "last N" is already
  arbitrary; writing the user message earlier changes which docs exist and therefore which ones this
  returns. Consumers to re-check:
  - `app/[lang]/(admin)/conversations/actions.ts:145` (admin conversation viewer, audit drill-down)
  - `app/[lang]/(coach)/dashboard/actions.ts:278` (reads `coach-${agentUid}` — the legacy thread)
  - `src/jobs/runDueJobs.ts:122` (stall-detect / nudge; a user-only turn with no assistant reply now
    exists and could change stall classification)
- `src/pdpa/sweep.ts` — erasure iterates the messages subcollection. F2 can create an orphan
  user-message doc for a turn that then failed; it stays in the same subcollection, so the sweep
  covers it, but confirm the sweep's bounded read still terminates.

**Gate / accounting coupling inside `onFinish`**
- `src/ratelimit` (`route.ts:630`) — aborted turns are currently free. After F2 they are counted.
  Expect budget to be consumed sooner (interacts with RC-4).
- `src/audit` (`route.ts:635`) and `src/usage/record` (`route.ts:655`) — audit rows and usage events
  will start appearing for aborted turns. PDPA-positive, but it changes dashboard/rollup numbers.
- `writeLeadSlot` for `finderSlot` (`route.ts:566`) and `replySlot` (`:580`), plus
  `recordKnowledgeGap` (`:609`) — all inside `onFinish`; F2 changes when they run.

**Tests**
- `app/api/chat/route.test.ts` — asserts gate ordering and `onFinish` behaviour. Moving the user-message
  write and adding `consumeStream`/`onAbort` will require updates.
- `src/memory/memory.test.ts` — `appendMessage` / `loadRecent` / `ensurePrimaryThread` contracts.
- `app/[lang]/chat/decode-stream-chunk.test.ts` — add `parseStreamError` cases; keep `parseTextDelta`
  behaviour byte-identical.
- `app/[lang]/chat/conversation-messages-map.test.ts`, `conversation-sort.test.ts` — unchanged, but
  they are the guard against reintroducing the `orderBy` trap.
- **`e2e/persist.spec.ts:231` `SC2-C: message re-renders after page reload` is the pre-existing
  regression test for exactly this bug.** It is not in CI (needs live Firebase + Anthropic creds), which
  is why the regression shipped. Run it as the acceptance gate. Note its `goToChat` helper
  (`:86-91`) navigates to `/{lang}` and relies on the `new-agent` → `/chat` redirect at
  `app/[lang]/page.tsx:88-89`, which itself depends on a fresh `__session` (RC-6) — the helper may
  need a direct `/{lang}/chat` navigation to be reliable.
- `e2e/disclosure.spec.ts` also reloads the page; confirm the disclosure ack still short-circuits.

**Security rules** — `firestore.rules:116-126` (conversations) and `:129-144` (messages) need no change.
Any new client-side query must still satisfy `sameTenant()` by constraining `tenantId`.
