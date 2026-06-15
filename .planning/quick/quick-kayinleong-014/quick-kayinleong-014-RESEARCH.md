# quick-kayinleong-014 — Research

**Researched:** 2026-06-15
**Domain:** Admin Conversation Log (`/[lang]/conversations`) — three bugs: email search, Agent-column email, dialog responsiveness
**Confidence:** HIGH (all root causes + fixes are code-grounded; every file:line verified this session; the email-resolution pattern and the Firestore index already exist in-repo)

## Summary

Three independent bugs on the admin Conversation Log surface, all fixable in **two files** (`actions.ts` server-side, `conversation-viewer.tsx` client) plus **three i18n catalogs** for the search-placeholder copy. No schema, no security-rules, and — critically — **no new Firestore index** is required (the needed composite index already exists).

- **Bug 1 (email search):** `searchConversations` only does a `__name__` prefix scan. Add an `@`-detection branch that resolves email → uid via `adminAuth.getUserByEmail`, then queries `conversations` by `ownerUid == uid` using the **already-declared** `(ownerUid ASC, createdAt DESC)` composite index. User-not-found returns empty, not an error.
- **Bug 2 (Agent column shows uid):** Port the exact chunked `adminAuth.getUsers` pattern from quick-kayinleong-011. Add `agentEmail: string | null` to `ConversationRef`, resolve it server-side in `searchConversations`, render `agentEmail ?? `${agentRef.slice(0,8)}…`` in the cell.
- **Bug 3 (modal overflow):** The per-message pillar Badge renders `m.pillar`, which is actually the full `routeDecision` string (`coach:classifier:User is asking…`). The shadcn Badge cva hard-codes `whitespace-nowrap overflow-hidden`, so the long string forces `DialogContent` wider than the viewport. Fix = make `DialogContent` responsive AND stop the badge from forcing width (wrap/break the long badge, plus a `min-w-0` flex guard).

**Primary recommendation:** Do all three in one quick task. Server changes in `actions.ts` (email branch + `agentEmail` resolution); client changes in `conversation-viewer.tsx` (cell label + `DialogContent` width + badge wrapping); update `searchPlaceholder` in `en/ms/zh.json`.

---

## Root Causes (per bug)

### Bug 1 — Search only matches conversation ID
`actions.ts:189-198`: when `query` is truthy it builds **only** a `__name__` (document-ID) prefix range query. There is no path that interprets the query as an email. Firebase Auth has no prefix/substring email index — only exact `getUserByEmail(email)` — so an email string never matches a conversation doc ID and returns nothing.

### Bug 2 — Agent column renders raw uid
`actions.ts:206`: `agentRef: data.ownerUid` carries the raw Firebase uid to the client. `conversation-viewer.tsx:205-207` renders `${conv.agentRef.slice(0, 8)}…` (e.g. `NigKjwg1…`). `ConversationDoc` (`collections.ts:103-113`) stores `ownerUid` but **no email** — email lives only in Firebase Auth, identical to the quick-011 situation. `ConversationRef` (`actions.ts:81-87`) carries no email field.

### Bug 3 — Dialog overflows horizontally
Chain of causes:
1. `app/api/chat/route.ts:387` writes `routeDecision = `${pillar}:${decision.reason}``, and for the classifier tier `decision.reason = `classifier:${classification.reason}`` (`src/router/index.ts:98`) — a full LLM rationale sentence. So a stored `routeDecision` looks like `coach:classifier:User is asking for information about D2, which is a playbook/training module…`.
2. `actions.ts:148` maps the message's `pillar` field from `r.data.routeDecision` — so the per-message `m.pillar` IS that long string (not the clean `coach`/`finder`/`reply` enum).
3. `conversation-viewer.tsx:277-281` renders `m.pillar` inside a `<Badge>`. The shadcn Badge cva (`components/ui/badge.tsx:8`) hard-codes `whitespace-nowrap` **and** `w-fit shrink-0 overflow-hidden` — so the badge refuses to wrap and grows to fit the long sentence, pushing `DialogContent` past the viewport.
4. `DialogContent className="max-w-lg"` (`conversation-viewer.tsx:232`) **overrides** the base responsive cap. The base (`components/ui/dialog.tsx:64`) is already responsive (`w-full max-w-[calc(100%-2rem)] … sm:max-w-sm`), but `max-w-lg` (32rem) replaces `sm:max-w-sm` AND there is no longer a small-screen-safe cap once the badge forces intrinsic width. Even with a responsive width, an unwrappable child still blows the box out — so the badge must be fixed too.

> Note: the **table-row** pillar badge (`conversation-viewer.tsx:201-203`) renders `conv.pillar`, which falls back to the clean `ConversationDoc.pillar` enum (`actions.ts:204`) — that one is short and is not the overflow source. The overflow is specifically the **per-message dialog badge**.

---

## Recommended Approach (per bug)

### Bug 1 — Email-aware search in `searchConversations` (`actions.ts:167-222`)

Detect an email by `query.includes('@')`. Resolve to a uid via `adminAuth.getUserByEmail`, catching `auth/user-not-found` → return empty. Then reuse the **existing** `(ownerUid, createdAt DESC)` query shape (precedent: `src/memory/conversation.ts:118-126`). Keep the `__name__` prefix branch for non-email queries.

```ts
// inside searchConversations, after the admin gate, replacing the snapshot logic
const { adminDb } = await import('@/src/firebase/admin')
const { adminAuth } = await import('@/src/firebase/admin')

let snapshot
if (query && query.includes('@')) {
  // Email search: exact resolve email -> uid (Firebase Auth has no prefix email search).
  let uid: string | null = null
  try {
    const rec = await adminAuth.getUserByEmail(query.trim())
    uid = rec.uid
  } catch {
    // auth/user-not-found (or malformed) -> no matching conversations, NOT an error.
    return { ok: true, conversations: [] }
  }
  snapshot = await adminDb
    .collection('conversations')
    .where('ownerUid', '==', uid)
    .orderBy('createdAt', 'desc')   // uses existing (ownerUid, createdAt DESC) index
    .limit(50)
    .get()
} else if (query) {
  snapshot = await adminDb.collection('conversations')
    .orderBy('__name__').startAt(query).endAt(query + '').limit(50).get()
} else {
  snapshot = await adminDb.collection('conversations').limit(50).get()
}
```

- **Index:** none needed. `firestore.indexes.json` already declares `conversations (ownerUid ASC, createdAt DESC)` — verified this session; `src/memory/conversation.ts` uses the identical query.
- **Error handling:** `getUserByEmail` throws `FirebaseAuthError` with code `auth/user-not-found` for an unknown email — catch broadly and return `{ ok: true, conversations: [] }` (empty result, not an error toast).
- **Bounded:** stays at `limit(50)`.
- **PII:** the email string is only used to look up a uid server-side; do **not** log it. Do not put it in any `audit.log` call (this action has none today — keep it that way).

### Bug 2 — Resolve `agentEmail` for the table (`actions.ts`)

Port quick-011 verbatim. Two edits:

1. `ConversationRef` (`actions.ts:81-87`): add `agentEmail: string | null`.
2. In `searchConversations`, after building `snapshot`, resolve emails for the distinct `ownerUid` set via chunked `adminAuth.getUsers` (≤100/call), then map onto each row:

```ts
const uids = [...new Set(snapshot.docs.map(d => d.data().ownerUid).filter(Boolean) as string[])]
const emailByUid = new Map<string, string | null>()
try {
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100).map(uid => ({ uid }))
    const res = await adminAuth.getUsers(chunk)
    for (const u of res.users) emailByUid.set(u.uid, u.email ?? null)
  }
} catch {
  // resolution failure must not break the listing — every row falls back to uid.
}
// in the .map(...) projection, add:
//   agentEmail: emailByUid.get(data.ownerUid as string) ?? null
```

3. Client cell (`conversation-viewer.tsx:205-207`): render the email with uid fallback, and drop `font-mono` for the email branch (cosmetic). Keep it bounded/safe:

```tsx
<TableCell className="text-xs text-muted-foreground">
  {conv.agentEmail ?? (conv.agentRef ? `${conv.agentRef.slice(0, 8)}…` : '—')}
</TableCell>
```

- **Note:** `getUsers` returns `notFound` for uids deleted from Auth — they simply get no email and fall back to uid (no crash). `UserRecord.email` is optional (phone/anon users) → `?? null` handles it.
- **PII:** resolved server-side; only the email string crosses to the client. Never logged/audited.

### Bug 3 — Make the dialog responsive + stop the badge blowout (`conversation-viewer.tsx`)

Two targeted class changes (no component-library edits):

1. **`DialogContent`** (`conversation-viewer.tsx:232`): replace `className="max-w-lg"` with a responsive width that stays inside the viewport on phones:
   ```tsx
   <DialogContent className="w-[calc(100%-2rem)] max-w-lg sm:max-w-lg">
   ```
   (`w-[calc(100%-2rem)]` guarantees a 1rem gutter on small screens; `max-w-lg` caps it on larger screens. The base component already supplies `max-w-[calc(100%-2rem)]` but the `max-w-lg` override removed that safety — restoring an explicit small-screen width fixes it.)

2. **Per-message pillar Badge** (`conversation-viewer.tsx:277-281`): the long `routeDecision` must not force width. Two complementary guards:
   - Add `min-w-0` to the row's flex container (`conversation-viewer.tsx:273`, the `<div className="mb-1 flex items-center gap-2">`) so flex children may shrink below content size.
   - On the badge, override the cva defaults so it wraps/breaks and is bounded:
     ```tsx
     <Badge
       variant={pillarBadgeVariant(m.pillar)}
       className="h-auto max-w-full whitespace-normal break-words text-xs px-1 py-0"
     >
       {m.pillar}
     </Badge>
     ```
     (`whitespace-normal break-words max-w-full` overrides the cva's `whitespace-nowrap`; `h-auto` lets a wrapped badge grow vertically instead of clipping under the fixed `h-5`.)

**UX decision — wrap vs. truncate vs. shorten:** This is a **compliance log**, so the full `routeDecision` is auditable signal and should not be silently destroyed. Two acceptable options; recommend (A):

- **(A) Recommended — show the clean pillar, keep the rationale accessible.** Display only the leading pillar token in the badge and surface the full string elsewhere. Cheapest correct form: derive the short token client-side, e.g. `m.pillar?.split(':')[0]` for the badge text, and put the full `m.pillar` on a `title={m.pillar ?? undefined}` attribute (hover tooltip) — or render the full string as small muted text under the bubble. This keeps badges short (no overflow) **and** preserves the rationale for compliance. The wrapping guards above are still worth adding as defense-in-depth.
- **(B) Pure wrap.** Apply only the wrapping classes above and let the long badge wrap across lines. Simpler, but a multi-line "badge" reads poorly for a sentence-length rationale.

Either way the wrapping/`min-w-0`/responsive-width changes are required; (A) additionally improves readability. Pick (A) unless the planner wants the absolute minimal diff.

---

## i18n Impact

The current `searchPlaceholder` already says "Search by conversation ID, **agent ref**, or lead ref" — but it does not mention email, and "agent ref" implied uid. Update the placeholder in **all three** catalogs (`src/i18n/messages/{en,ms,zh}.json`, key `adminConversations.searchPlaceholder`) to mention email, e.g.:

- en: `"Search by conversation ID or agent email…"`
- ms: `"Cari mengikut ID perbualan atau emel ejen…"`
- zh: `"按对话ID或代理邮箱搜索…"`

No other keys change. (`colAgent` = "Agent"/"Ejen"/"代理" already fits an email value.) Optional: also adjust the `idle` hint copy if desired, but the placeholder is the only required change.

---

## Pitfalls / Constraints

1. **PII (CLAUDE.md, hard constraint).** Email is PII. It may be resolved and compared **server-side only**; only the resolved email **string** may cross to the client cell. Never `console.*` it, never write it to `audit.log`. `searchConversations` has no audit call today — do not add one that includes the email/query. (Contrast: `getConversationForReview` audits before returning content — that path is unchanged here.)
2. **`getUserByEmail` throws on not-found.** Code is `auth/user-not-found`. Must be caught and converted to an **empty result**, never an error toast (the admin typing a not-yet-seen email should see "No conversations found", not a failure).
3. **`getUsers` 100-identifier cap.** Chunk the uid array by ≤100 (`limit(50)` rows means ≤50 distinct uids in practice, so realistically one chunk — but keep the loop for correctness, matching quick-011).
4. **Don't break the dialog vertical scroll.** The thread already uses `ScrollArea className="max-h-[60vh]"` (line 262). Keep that; the width fix is independent of the existing height cap.
5. **`h-5` badge clipping.** The cva fixes badge height at `h-5` with `overflow-hidden`; if you wrap text you MUST also add `h-auto` or the wrapped second line is clipped. (This is why option (A) — short token — is cleaner.)
6. **Next.js 16.** No new `cookies()/headers()` needed — the existing async `getSessionUser` is untouched. `adminAuth`/`adminDb` are server-only Admin SDK instances already imported inline inside the `'use server'` action (line 184) — safe; no Cloud Functions, constraint satisfied.
7. **Inline import pattern.** `searchConversations` imports `adminDb` inline (`await import('@/src/firebase/admin')`, line 184) specifically to avoid loading the Admin SDK at module-eval time in tests. Resolve `adminAuth` the **same way** (inline `await import`), not a top-level import, to preserve the test-friendly module shape.

---

## Test & Index Impact

- **Firestore index:** **No new index.** `(conversations: ownerUid ASC, createdAt DESC)` already exists in `firestore.indexes.json` (verified). The email-search query reuses it; the `__name__` prefix branch needs no index.
- **Existing tests:** `app/[lang]/(admin)/conversations/actions.test.ts` mocks only `@/src/firebase/auth`, `@/src/audit/log`, `@/src/memory/conversation`, and `next/headers`. It exercises **only `getConversationForReview`** (Forbidden path, audit-before-read order, success, read-only export check) — it does **not** import or test `searchConversations`, and does **not** mock `@/src/firebase/admin` or `@/src/firebase/collections`. Therefore:
  - Adding the email branch + `agentEmail` resolution to `searchConversations` does **not** break any existing test.
  - Adding `agentEmail` to `ConversationRef` is additive (no existing test asserts the `ConversationRef` shape).
- **Optional new coverage:** a success-path test for `searchConversations` would need to mock `@/src/firebase/admin` (`adminDb` query chain + `adminAuth.getUserByEmail`/`getUsers`). Not required to ship; matches the quick-011 precedent (optional).
- **Client (`conversation-viewer.tsx`) changes** are class-string + a label expression — covered by `tsc --noEmit` (the new `agentEmail` field type-checks once added to `ConversationRef`); no unit test touches this island.

**Suggested gate (matches prior quick tasks):**
```bash
cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent"
npx tsc --noEmit
npx eslint "app/[lang]/(admin)/conversations/"
npx vitest run "app/[lang]/(admin)/conversations/actions.test.ts"
npx next build
# PII gate: grep -rn "email" app/[lang]/(admin)/conversations/  → email only in data projection + cell render, never in console/audit
```
Manual spot check: load `/en/conversations`; type an agent email → that agent's conversations appear; Agent column shows emails (uid fallback when absent); open a conversation with a classifier-routed message → dialog stays within the viewport on a narrow window and the long pillar rationale wraps/shortens instead of overflowing.

---

## Sources (HIGH confidence — verified this session)

- `app/[lang]/(admin)/conversations/actions.ts` — `searchConversations` (L167-222), `__name__` query (L189-198), `agentRef`/`ownerUid` (L206), `ConversationRef` (L81-87), inline `adminDb` import (L184), per-message `pillar` from `routeDecision` (L148)
- `app/[lang]/(admin)/conversations/conversation-viewer.tsx` — search input (L162-169), Agent cell (L205-207), `DialogContent max-w-lg` (L232), per-message Badge (L277-281), flex row (L273), ScrollArea (L262)
- `app/[lang]/(admin)/conversations/actions.test.ts` — mock surface (only auth/audit/memory/next-headers; only `getConversationForReview` tested)
- `app/[lang]/(admin)/conversations/page.tsx` — admin gate (unchanged)
- `components/ui/badge.tsx` — cva `whitespace-nowrap … w-fit shrink-0 overflow-hidden h-5` (L8)
- `components/ui/dialog.tsx` — `DialogContent` base `w-full max-w-[calc(100%-2rem)] … sm:max-w-sm` (L64)
- `src/firebase/collections.ts` — `ConversationDoc` (L103-113, `ownerUid`/`pillar` enum, no email), `MessageDoc.routeDecision` (L126), `conversationsRef` (L782-784)
- `src/firebase/admin.ts` — `adminAuth`/`adminDb` exports (L79/L86)
- `src/router/index.ts` — `reason: classifier:${…}` (L98) → confirms long routeDecision content
- `app/api/chat/route.ts` — `routeDecision = `${pillar}:${decision.reason}`` (L387)
- `src/memory/conversation.ts` — precedent `where('ownerUid','==',uid).orderBy('createdAt','desc').limit(n)` (L118-126) using the existing composite index
- `firestore.indexes.json` — existing `conversations (ownerUid ASC, createdAt DESC)` index (verified — no new index needed)
- `src/i18n/messages/{en,ms,zh}.json` — `adminConversations.searchPlaceholder` (current copy printed this session)
- `.planning/quick/quick-kayinleong-011/{PLAN,RESEARCH}.md` — canonical uid→email pattern (chunked `adminAuth.getUsers`, `email: string|null`, uid fallback, no-log PII rule)

## RESEARCH COMPLETE

`.planning/quick/quick-kayinleong-014/quick-kayinleong-014-RESEARCH.md`
