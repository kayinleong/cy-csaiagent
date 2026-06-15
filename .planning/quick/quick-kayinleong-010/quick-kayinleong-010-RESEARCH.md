# quick-kayinleong-010 — Research: Chat conversation missing from history sidebar

**Researched:** 2026-06-15
**Domain:** Chat conversation persistence + history-drawer listing (Next.js 16 client island ↔ Firestore)
**Confidence:** HIGH (all evidence is in-repo, traced end-to-end)

## Symptom

On `/en/chat`, a user starts a chat (sends messages, gets replies), navigates away / reloads, opens the history drawer, and the conversation they just had is **not** in the list. The drawer shows "history empty" (or only older threads).

## Investigation (per-area, file:line evidence)

### 1. How the sidebar lists conversations

`app/[lang]/chat/conversation-list.tsx` (client island, `'use client'`):

- Reads **live from Firestore via the client SDK** on drawer open. [VERIFIED: code]
  - Query (`:83-88`): `collection(clientDb,'conversations')` → `where('ownerUid','==', currentUser.uid)` → `orderBy('createdAt','desc')` → `limit(50)`.
  - Guarded by `clientAuth.currentUser` (`:78-79`) — returns early if not signed in.
  - `getDocs(q)` one-shot, fired in a `useEffect` only when `open` flips true (`:110-115`).
- Errors are **swallowed silently** (`:100-101` empty `catch`): a rules denial, a missing composite index, or any throw renders as an empty/"historyEmpty" list with **no console output and no toast**. This is why the bug presents as "just not there."
- Read rule it depends on (`firestore.rules :117-119`): `resource.data.ownerUid == request.auth.uid && sameTenant()`. `sameTenant()` (`:34-37`) requires the token to carry a `tenantId` custom claim.

### 2. How a conversation is created / persisted

There is **no client-side conversation create**. Creation happens server-side in the chat route.

`app/api/chat/route.ts`:
- `cid` defaults to `''` from the body (`:306`); if empty, `cid = await ensurePrimaryThread(uid, userLang)` runs **before** streaming (`:328-330`). [VERIFIED: code]
- Messages (user + assistant) are written in `onFinish` **after** the stream completes (`:496-527`) via `appendMessage(cid, …)`.

`src/memory/conversation.ts` → `ensurePrimaryThread(uid, lang)` (`:63-88`):
- Deterministic cid = **`coach-${uid}`** — by design there is exactly **ONE** primary thread per agent (D-01). [VERIFIED: code]
- `get()` then, only `if (!snap.exists)`, `docRef.set({ ownerUid: uid, pillar:'coach', lang, createdAt: serverTimestamp(), summary:'', tenantId:'d2' }, { merge:true })` (`:71-85`).
- Written via the Admin SDK (`conversationsRef()` → `adminDb`, `collections.ts :782-784`) — Admin writes **bypass Firestore rules**, so the create itself never fails on rules.

So a conversation doc **is** created, with `ownerUid` and `createdAt` set, the first time a signed-in user sends a message with no cid. Field names match the sidebar query exactly (`ownerUid`, `createdAt`).

### 3. Field-match cross-check (rules out the "written but filtered out" class)

| Field sidebar filters/orders on | Value written by `ensurePrimaryThread` | Match? |
|---|---|---|
| `ownerUid == currentUser.uid` | `ownerUid: uid` (verified token uid) | ✅ |
| `orderBy('createdAt','desc')` | `createdAt: serverTimestamp()` (first create only) | ✅ *if present* |
| `sameTenant()` (rule) | `tenantId:'d2'` on doc + `tenantId` token claim from `setUserClaims` (`auth.ts :172`) | ✅ *if claim present* |

Composite index `(ownerUid ASC, createdAt DESC)` exists (`firestore.indexes.json` top entry) and the listing query needs it. [VERIFIED: code]

## Root Cause Hypotheses (ranked)

### H1 — `createdAt` is null at read time, so `orderBy('createdAt','desc')` silently drops the doc (MOST LIKELY)

`orderBy('createdAt', …)` in Firestore **excludes any document whose `createdAt` field is missing or null**. Two ways the freshly-created thread has no usable `createdAt` when the user reopens the drawer:

1. **serverTimestamp() resolution race.** `createdAt` is written as `FieldValue.serverTimestamp()`. There is a brief window where a client read sees the field as `null` (pending). The sidebar's `data.createdAt?.toDate?.() ?? null` (`:96`) already anticipates null — but a doc with null `createdAt` is **dropped entirely by the `orderBy`**, not just shown without a date. On a fast reload this can hide the only thread.
2. **`merge:true` create that never set `createdAt`.** `set(..., { merge:true })` only runs inside `if (!snap.exists)`. If a `coach-${uid}` doc ever came to exist *without* `createdAt` (e.g. an earlier code path, a partial/aborted first turn, or a doc seeded by another writer), the merge-guard means `createdAt` is **never backfilled** — and the doc is permanently invisible to the `orderBy('createdAt','desc')` listing while still "existing." This is the classic merge-create + orderBy-on-missing-field trap.

Evidence: `conversation.ts :71-85` (createdAt only on first create, guarded by `!snap.exists`); `conversation-list.tsx :87` (orderBy createdAt desc); the swallowed catch (`:100-101`) hides any related throw.

### H2 — Silent rules denial: missing/empty `tenantId` claim → `sameTenant()` fails → empty list

The list read requires `sameTenant()` (`rules :118, :34-37`), i.e. `resource.data.tenantId == request.auth.token.tenantId`. The chat **route** uses the Admin SDK (rules-exempt), so chatting works even if the client token lacks a fresh `tenantId` claim. But the **sidebar** uses the client SDK and is fully rules-gated. If the signed-in client's ID token doesn't yet carry the `tenantId` claim (claim set after sign-in via `setUserClaims` but token not refreshed, or a user provisioned without claims), every conversation read is **denied** → the swallowed catch (`:100-101`) → empty drawer. This reproduces as "chat works, history is empty." Lower-ranked than H1 because field-write matches and the user *can* chat; but the silent-catch makes it indistinguishable from H1 without instrumentation.

### H3 — Missing composite index in the target environment

`(ownerUid, createdAt DESC)` is declared in `firestore.indexes.json`, but STATE.md shows several indexes are only deployed at a live rollout checkpoint and Firestore throws `FAILED_PRECONDITION` until built (STATE.md :38, Pitfall 6). If this index is not yet **Enabled** in the running project, the client query throws → swallowed → empty list. Verify in Firebase console before code changes.

### Ruled out
- **"Only in React state, never persisted"** — RULED OUT. The doc is written server-side in `ensurePrimaryThread` before streaming (`route.ts :328-330`).
- **"Written with a non-matching ownerUid/tenantId/status"** — RULED OUT for field names; `ownerUid`/`tenantId` match and there is no `status` filter on conversations.
- **"Locale/[lang] segment ties conversation to a different path"** — RULED OUT. cid is `coach-${uid}` (lang-independent); `lang` is only a stored field, not part of the doc path or the query filter.

## Recommended Fix Direction (smallest correct fix)

Primary (addresses H1, the most likely):
1. **Make the thread listable regardless of `createdAt` resolution.** Either:
   - Switch the sidebar listing to `orderBy('createdAt','desc')` **with a fallback** that also surfaces docs missing `createdAt` (e.g. order by `__name__` / document id, or query without the orderBy and sort client-side), **or**
   - Guarantee `createdAt` is always present and non-null: in `ensurePrimaryThread`, backfill `createdAt` on the merge path when the existing doc lacks it (drop the `!snap.exists` guard for the `createdAt`/`ownerUid` fields specifically, keeping `summary` preserved). This repairs any already-broken `coach-${uid}` docs.
2. **Stop swallowing the error.** In `conversation-list.tsx :100-101`, at minimum log the error (no PII — conversation list carries none beyond ids/summaries) and/or surface a non-fatal toast, so H2/H3 stop masquerading as "empty."

Secondary diagnostics (to confirm H2/H3 before/after the fix, no behavior change):
- Confirm the signed-in client token carries `tenantId` (force `getIdToken(true)` once after sign-in if claims were set post-creation).
- Confirm `(ownerUid, createdAt DESC)` index is **Enabled** in the target Firebase project.

Keep the fix minimal and behavior-preserving per the project regression rule: do **not** redesign the single-thread (`coach-${uid}`) model in this claim — only make the existing single thread reliably visible.

## Regression Surface (what touches the same code paths)

| Area | File | Why it shares the path |
|---|---|---|
| Conversation create / idempotency | `src/memory/conversation.ts` `ensurePrimaryThread` (`:63-88`) | Any change to the merge guard or `createdAt` affects the rolling `summary` preservation contract (must NOT clobber `summary`) and all chat turns (route `:329`). |
| Message persistence ordering | `app/api/chat/route.ts` `onFinish` (`:496-527`) | Uses the same `cid`; relies on the conversation doc existing first. |
| History select / new-conversation | `chat-shell.tsx` `handleSelectConversation` / `handleNewConversation` (`:81-89`); `chat-input.tsx` `cidRef` sync (`:92-102`) | Selecting a thread sets `activeCid`; an empty cid re-triggers `ensurePrimaryThread`. Verify selecting the (now-visible) thread still loads it. |
| Firestore rules — conversations read | `firestore.rules :116-126` | A listing fix must not weaken `ownerUid`/`sameTenant` owner-only isolation. |
| Coach memory / summary | `src/memory/index.ts`, summary writers | `summary` is the field the merge-create intentionally preserves; do not reset it. |
| Other client conversation reads | `loadRecent` (`conversation.ts :142-149`), admin conversation review (`(admin)/conversations/*`) | Server-side; not directly affected but confirm no shared helper signature changes. |

## Sources

- In-repo code (HIGH): `app/[lang]/chat/conversation-list.tsx`, `app/[lang]/chat/chat-shell.tsx`, `app/[lang]/chat/chat-input.tsx`, `app/api/chat/route.ts`, `src/memory/conversation.ts`, `src/firebase/collections.ts`, `src/firebase/auth.ts`, `firestore.rules`, `firestore.indexes.json`, `.planning/STATE.md`.
