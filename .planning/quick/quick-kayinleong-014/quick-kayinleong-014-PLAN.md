---
id: quick-kayinleong-014
type: execute
wave: 1
depends_on: []
files_modified:
  - app/[lang]/(admin)/conversations/actions.ts
  - app/[lang]/(admin)/conversations/conversation-viewer.tsx
  - src/i18n/messages/en.json
  - src/i18n/messages/ms.json
  - src/i18n/messages/zh.json
autonomous: true
requirements: [ADMIN-02]

must_haves:
  truths:
    - "Typing an agent's email into the /[lang]/conversations search bar returns that agent's conversations (most-recent 50); an unknown email returns an empty list, NOT an error toast."
    - "A non-email query still matches by conversation-ID prefix; an empty query still returns the 50 most-recent conversations."
    - "The Agent column shows each conversation owner's email; a uid with no Auth email (or deleted from Auth) falls back to the truncated uid; email resolution failure never breaks the listing."
    - "The conversation-detail modal stays within the viewport on a narrow window — a long classifier routeDecision no longer blows out DialogContent width; the badge shows the clean pillar token with the full rationale preserved on hover (title)."
    - "Email is resolved/compared server-side only; only the resolved email STRING reaches the client cell — no email is logged, console'd, or audited."
    - "The search placeholder copy mentions email in all three catalogs (en/ms/zh)."
  artifacts:
    - path: "app/[lang]/(admin)/conversations/actions.ts"
      provides: "Email-aware searchConversations (@-detection → getUserByEmail → ownerUid query) + agentEmail resolution via chunked adminAuth.getUsers; agentEmail added to ConversationRef"
      contains: "getUserByEmail"
    - path: "app/[lang]/(admin)/conversations/conversation-viewer.tsx"
      provides: "Agent cell renders agentEmail with uid fallback; responsive DialogContent width; min-w-0 flex guard + clean pillar-token badge with full-rationale title"
      contains: "conv.agentEmail"
    - path: "src/i18n/messages/en.json"
      provides: "adminConversations.searchPlaceholder mentions agent email"
      contains: "agent email"
  key_links:
    - from: "app/[lang]/(admin)/conversations/actions.ts"
      to: "@/src/firebase/admin (adminAuth.getUserByEmail)"
      via: "email branch resolves query → uid, then where('ownerUid','==',uid).orderBy('createdAt','desc')"
      pattern: "getUserByEmail"
    - from: "app/[lang]/(admin)/conversations/actions.ts"
      to: "@/src/firebase/admin (adminAuth.getUsers)"
      via: "chunked uid→email resolution (≤100/call) into a Map, mapped onto ConversationRef.agentEmail"
      pattern: "adminAuth\\.getUsers"
    - from: "app/[lang]/(admin)/conversations/conversation-viewer.tsx"
      to: "ConversationRef.agentEmail"
      via: "Agent cell renders conv.agentEmail ?? (conv.agentRef ? `${conv.agentRef.slice(0,8)}…` : '—')"
      pattern: "conv\\.agentEmail"
---

<objective>
Fix three independent bugs on the admin Conversation Log (`/[lang]/conversations`, ADMIN-02):

1. **Search by email** — `searchConversations` only does a `__name__` conversation-ID prefix scan; an agent email never matches. Add an `@`-detection branch that resolves email → uid via `adminAuth.getUserByEmail` then queries `conversations where ownerUid == uid orderBy createdAt desc`.
2. **Agent column shows uid, not email** — the cell renders the raw `ownerUid` (`NigKjwg1…`). Resolve uid → email server-side via chunked `adminAuth.getUsers` (the quick-kayinleong-011 pattern), carry it on `ConversationRef.agentEmail`, render it with a uid fallback.
3. **Modal not responsive** — the per-message pillar `Badge` renders the full `routeDecision` string (e.g. `coach:classifier:<long rationale>`); the shadcn Badge cva hard-codes `whitespace-nowrap … overflow-hidden`, forcing `DialogContent max-w-lg` past the viewport. Make `DialogContent` responsive, add a `min-w-0` flex guard, and show only the clean leading pillar token in the badge (full rationale preserved on a `title` for compliance).

Root cause (RESEARCH.md): all three are code-grounded; the email-resolution pattern (quick-011) and the required `(ownerUid ASC, createdAt DESC)` composite index already exist in-repo. No schema, security-rules, or Firestore-index work.

Purpose: An admin can find a conversation by agent email, read the owning agent at a glance, and review any thread on a phone-width window without horizontal overflow (ADMIN-02).
Output: Two edited source files (`actions.ts` server, `conversation-viewer.tsx` client) + the `searchPlaceholder` copy in all three i18n catalogs. No schema, rules, index, test-infra, or `page.tsx` changes.
</objective>

<context>
@.planning/STATE.md
@.planning/quick/quick-kayinleong-014/quick-kayinleong-014-RESEARCH.md
@.planning/quick/quick-kayinleong-011/quick-kayinleong-011-PLAN.md
@app/[lang]/(admin)/conversations/actions.ts
@app/[lang]/(admin)/conversations/conversation-viewer.tsx
@app/[lang]/(admin)/conversations/actions.test.ts
@src/firebase/admin.ts
@src/i18n/messages/en.json
@src/i18n/messages/ms.json
@src/i18n/messages/zh.json

# Project conventions that MUST be honored (see CLAUDE.md / AGENTS.md):
# - Email is PII. Resolve and compare it server-side ONLY; never console.*, never log,
#   never audit it. searchConversations has NO audit.log call today — KEEP IT THAT WAY.
#   (Contrast: getConversationForReview audits before returning content — that path is unchanged.)
# - Only the resolved email STRING may cross to the client cell.
# - Next.js 16: no new cookies()/headers(); the existing async getSessionUser is untouched.
#   adminAuth/adminDb are server-only Admin SDK; resolved via inline `await import('@/src/firebase/admin')`
#   inside this 'use server' action (matches the existing inline adminDb import — test-friendly module shape).
#   No Cloud Functions (constraint satisfied — this is a Server Action read).
# - Reads stay bounded (limit(50)).
</context>

<grounding>
Verified facts the executor should rely on (do NOT re-explore to confirm):

**`actions.ts` (server, 'use server'):**
- `searchConversations` (L167-222): admin-gated (returns `Unauthorized`/`Forbidden` BEFORE any read). Inside the `try`, it imports `adminDb` inline (`const { adminDb } = await import('@/src/firebase/admin')`, L184) specifically to avoid loading the Admin SDK at module-eval time in tests — resolve `adminAuth` the **same inline way**, NOT a top-level import.
- Current query logic (L187-198): a bare `limit(50)` recent query when `query` is empty, else a `__name__` prefix range (`orderBy('__name__').startAt(query).endAt(query + '￿').limit(50)`).
- `ConversationRef` (L81-87): `{ cid, pillar, agentRef, leadRef, lastMessageAt }` — NO `agentEmail` today. `agentRef` is `data.ownerUid` (L205).
- The `.map(...)` projection (L200-215) builds each `ConversationRef`.

**`@/src/firebase/admin`:** exports `adminDb` and `adminAuth` (server-only Admin SDK instances).
- `adminAuth.getUserByEmail(email)` returns a `UserRecord` or THROWS `FirebaseAuthError` code `auth/user-not-found` for an unknown/malformed email — must be caught and converted to `{ ok: true, conversations: [] }` (empty result, NOT an error toast).
- `adminAuth.getUsers(identifiers: { uid: string }[])` returns `{ users: UserRecord[], notFound: [...] }`; each `UserRecord` has `.uid` and optional `.email`. Caps at **100 identifiers/call** — chunk by 100 (≤50 distinct uids in practice at `limit(50)`, but loop for correctness, matching quick-011). `notFound` uids simply get no email and fall back to uid.

**Firestore index:** `(conversations: ownerUid ASC, createdAt DESC)` ALREADY EXISTS in `firestore.indexes.json` (verified — it backs `src/memory/conversation.ts`'s identical `where('ownerUid','==',uid).orderBy('createdAt','desc')`). NO new index.

**`conversation-viewer.tsx` (client):**
- Agent cell (L205-207): `<TableCell className="font-mono text-xs text-muted-foreground">{conv.agentRef ? `${conv.agentRef.slice(0, 8)}…` : '—'}</TableCell>`.
- `DialogContent` (L232): `className="max-w-lg"` (the thread-viewer dialog — NOT the flag dialog at L313 which stays `max-w-md`, untouched).
- Per-message flex row (L273): `<div className="mb-1 flex items-center gap-2">`.
- Per-message pillar Badge (L277-281): renders `m.pillar` (the full `routeDecision` string) inside `<Badge variant={pillarBadgeVariant(m.pillar)} className="text-xs px-1 py-0">`.
- `pillarBadgeVariant(pillar)` (L78-83) maps `'coach'`→secondary, `'finder'`→default, else outline — feeding it the split token (`'coach'`/`'finder'`/`'reply'`) makes the variant mapping work correctly too (today it gets the long string and always falls through to outline).
- ScrollArea `max-h-[60vh]` (L262) — the vertical scroll; the width fix is independent, KEEP it.

**shadcn Badge cva (`components/ui/badge.tsx`):** hard-codes `whitespace-nowrap w-fit shrink-0 overflow-hidden h-5`. If you wrap badge text you MUST add `h-auto` (the fixed `h-5` + `overflow-hidden` clips wrapped lines).

**i18n:** `adminConversations.searchPlaceholder` lives at en.json:357, ms.json:359, zh.json:359 (the `adminConversations` block, key `searchPlaceholder` — NOT the `agentConversations`/customer-search placeholders earlier in each file). Current EN copy: `"Search by conversation ID, agent ref, or lead ref…"`. Only this one key changes per catalog; no other keys.

**Tests:** `actions.test.ts` mocks only `@/src/firebase/auth`, `@/src/audit/log`, `@/src/memory/conversation`, `next/headers`, and exercises ONLY `getConversationForReview`. It does NOT import/test `searchConversations` and does NOT mock `@/src/firebase/admin` or `@/src/firebase/collections`. Adding the email branch + `agentEmail` to `searchConversations`/`ConversationRef` is additive — it breaks NO existing test. A success-path test for `searchConversations` is OPTIONAL (would require mocking `@/src/firebase/admin`) — matches the quick-011 precedent; not required to ship.
</grounding>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Email-aware search + agentEmail resolution in searchConversations (server)</name>
  <files>app/[lang]/(admin)/conversations/actions.ts</files>
  <behavior>
    - Given an empty `query`, searchConversations returns the 50 most-recent conversations (unchanged recent branch).
    - Given a non-email `query` (no `@`), it returns conversations whose doc ID prefix-matches the query (unchanged `__name__` branch).
    - Given a `query` containing `@` that resolves to a known uid, it returns that owner's conversations: `where('ownerUid','==',uid).orderBy('createdAt','desc').limit(50)`.
    - Given a `query` containing `@` for an UNKNOWN/malformed email (getUserByEmail throws auth/user-not-found), it returns `{ ok: true, conversations: [] }` — NOT an error.
    - Each returned ConversationRef carries `agentEmail`: the owner's resolved Auth email, or `null` when the uid has no email / is notFound in Auth.
    - If batch email resolution (getUsers) throws, the listing still returns with every row's `agentEmail` falling back to `null` (resolution failure never breaks the listing).
    - The admin gate is unchanged: Unauthorized / Forbidden return BEFORE any Firestore/Auth read.
    - No email is logged, console'd, or audited; searchConversations adds NO audit.log call.
  </behavior>
  <action>
Implement the ADMIN-02 email-aware search + server-side agent-email resolution.

1. Add `agentEmail: string | null` to the `ConversationRef` interface (L81-87), documented as the resolved Firebase Auth email of the conversation owner (`ownerUid`), null when the owner has no email (phone/anon) or was not found in Auth.

2. Inside the existing `try` block of `searchConversations`, resolve BOTH admin SDK handles inline (matching the existing `adminDb` inline import at L184): add `adminAuth` to the same `await import('@/src/firebase/admin')` destructure (so `const { adminDb, adminAuth } = await import('@/src/firebase/admin')`). Do NOT add a top-level import — preserve the test-friendly module shape.

3. Replace the snapshot-building logic (currently the `q`/ternary at L187-198) with a three-branch selection on `query`:
   - **Email branch** — `if (query && query.includes('@'))`: resolve the email to a uid with `await adminAuth.getUserByEmail(query.trim())`, reading `.uid`. Wrap in try/catch; on ANY throw (notably `auth/user-not-found`), `return { ok: true, conversations: [] }` immediately (empty result, not an error). With the resolved uid, build the snapshot via `adminDb.collection('conversations').where('ownerUid','==',uid).orderBy('createdAt','desc').limit(50).get()` — this reuses the EXISTING `(ownerUid ASC, createdAt DESC)` composite index (no new index).
   - **Prefix branch** — `else if (query)`: keep the existing `__name__` prefix query verbatim (`orderBy('__name__').startAt(query).endAt(query + '￿').limit(50).get()`).
   - **Recent branch** — `else`: keep the existing bare `limit(50)` recent query.

4. After the snapshot is built and BEFORE the `.map(...)` projection, resolve owner emails for the table (port the quick-011 chunked pattern):
   - Build the distinct uid set: `const uids = [...new Set(snapshot.docs.map((d) => d.data().ownerUid).filter(Boolean) as string[])]`.
   - Build `const emailByUid = new Map<string, string | null>()`.
   - In a try/catch (so resolution failure does NOT break the listing — on error leave the map empty so every row falls back to null), loop the uids in chunks of ≤100: for each chunk call `adminAuth.getUsers(chunk.map((uid) => ({ uid })))` and for each returned record set `emailByUid.set(u.uid, u.email ?? null)`.

5. In the `.map(...)` projection, add `agentEmail: emailByUid.get(data.ownerUid as string) ?? null`. Keep `cid`, `pillar`, `agentRef`, `leadRef`, and `lastMessageAt` exactly as they are today.

PII rule (CLAUDE.md, hard constraint): do NOT `console.*` / log / audit the email or the raw query. Do NOT add an `audit.log` call to searchConversations (it has none today — contrast getConversationForReview, which is unchanged). Only the projected `agentEmail` string crosses to the client.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx tsc --noEmit 2>&1 | grep -v '^#' | grep -c "conversations/actions" | grep -qx 0 && grep -c "getUserByEmail" "app/[lang]/(admin)/conversations/actions.ts" | grep -qx 1 && grep -c "adminAuth.getUsers" "app/[lang]/(admin)/conversations/actions.ts" | grep -qx 1 && grep -c "agentEmail" "app/[lang]/(admin)/conversations/actions.ts" | grep -q -v 0 && npx vitest run "app/[lang]/(admin)/conversations/actions.test.ts" 2>&1 | tail -20</automated>
  </verify>
  <done>`ConversationRef` has `agentEmail: string | null`; `searchConversations` has the three-branch query (email `@`-detection → `getUserByEmail` → `ownerUid` query reusing the existing composite index; unknown email → empty result; prefix + recent branches preserved) and resolves emails via chunked `adminAuth.getUsers` into every row (null fallback for missing/notFound/resolution-failure); `adminAuth` is imported INLINE alongside `adminDb`; `tsc --noEmit` reports no errors in `conversations/actions.ts`; existing `actions.test.ts` still passes; no email/query is logged or audited and no audit.log call was added.</done>
</task>

<task type="auto">
  <name>Task 2: Agent-email cell + responsive dialog + clean pillar badge (client)</name>
  <files>app/[lang]/(admin)/conversations/conversation-viewer.tsx</files>
  <action>
Three targeted client edits (no component-library edits). `ConversationRef` now carries `agentEmail` (from Task 1), so `conv.agentEmail` type-checks.

1. **Agent cell (L205-207):** render the resolved email with the existing uid fallback:
   - Content: `{conv.agentEmail ?? (conv.agentRef ? `${conv.agentRef.slice(0, 8)}…` : '—')}`.
   - Drop `font-mono` from the cell's className for the email branch (email is not a monospace ref) — keep `text-xs text-muted-foreground`. (Cosmetic; the email branch reads better without monospace.)

2. **Thread-viewer DialogContent (L232):** replace `className="max-w-lg"` with a responsive width that stays inside a narrow viewport: `className="w-[calc(100%-2rem)] max-w-lg"`. (`w-[calc(100%-2rem)]` guarantees a ~1rem gutter on small screens; `max-w-lg` caps it on larger screens — restoring the small-screen safety the bare `max-w-lg` override removed.) Do NOT touch the OTHER dialog (the flag-reason `DialogContent className="max-w-md"` at L313) and do NOT touch the `ScrollArea max-h-[60vh]` (L262) vertical cap.

3. **Per-message pillar Badge + flex guard (L273-281):** stop the long `routeDecision` from forcing dialog width (research option A — recommended for a compliance log: show the clean pillar token, keep the full rationale accessible):
   - Add `min-w-0` to the row's flex container at L273 (`<div className="mb-1 flex items-center gap-2 min-w-0">`) so flex children may shrink below content size.
   - Change the badge to display ONLY the leading pillar token and preserve the full rationale on hover:
     - Badge text: `{m.pillar?.split(':')[0]}` (e.g. `coach` from `coach:classifier:<rationale>`).
     - Add `title={m.pillar ?? undefined}` so the full auditable routeDecision string stays accessible (compliance).
     - Pass the split token to the variant too so the badge color is correct: `variant={pillarBadgeVariant(m.pillar?.split(':')[0] ?? null)}`.
     - Add defensive wrapping/bounding classes (defense-in-depth): `className="h-auto max-w-full whitespace-normal break-words text-xs px-1 py-0"`. (`whitespace-normal break-words max-w-full` overrides the cva's `whitespace-nowrap`; `h-auto` is REQUIRED — the cva's fixed `h-5` + `overflow-hidden` clips any wrapped line.)
   - Keep the surrounding `{m.pillar && ( … )}` guard and the adjacent `redacted` Badge (L282-286) unchanged.

No other regions change. The full `m.pillar` rationale is NOT discarded — it remains in the `title` attribute for auditable access (PDPA/compliance posture preserved).
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx tsc --noEmit 2>&1 | grep -v '^#' | grep -c "conversation-viewer" | grep -qx 0 && grep -c "conv.agentEmail" "app/[lang]/(admin)/conversations/conversation-viewer.tsx" | grep -qx 1 && grep -c "w-\[calc(100%-2rem)\] max-w-lg" "app/[lang]/(admin)/conversations/conversation-viewer.tsx" | grep -qx 1 && grep -c "split(':')\[0\]" "app/[lang]/(admin)/conversations/conversation-viewer.tsx" | grep -q -v 0 && grep -c "h-auto" "app/[lang]/(admin)/conversations/conversation-viewer.tsx" | grep -q -v 0</automated>
  </verify>
  <done>Agent cell renders `conv.agentEmail` with the uid fallback (no `font-mono`); thread `DialogContent` is `w-[calc(100%-2rem)] max-w-lg` (flag dialog + ScrollArea cap untouched); the message-row flex container has `min-w-0`; the pillar badge shows `m.pillar?.split(':')[0]` with the full string on `title` and `h-auto max-w-full whitespace-normal break-words` classes (variant fed the split token); `tsc --noEmit` clean for `conversation-viewer.tsx`.</done>
</task>

<task type="auto">
  <name>Task 3: Mention agent email in the search placeholder (trilingual)</name>
  <files>src/i18n/messages/en.json, src/i18n/messages/ms.json, src/i18n/messages/zh.json</files>
  <action>
Update the `adminConversations.searchPlaceholder` value in ALL THREE catalogs so the search bar advertises email search. This is the only key that changes; do not add/remove/reorder any other keys (i18n key-set parity is a live GREEN gate).

- `src/i18n/messages/en.json` (the `adminConversations` block, ~L357): set `searchPlaceholder` to `"Search by conversation ID or agent email…"`.
- `src/i18n/messages/ms.json` (~L359): set to `"Cari mengikut ID perbualan atau emel ejen…"`.
- `src/i18n/messages/zh.json` (~L359): set to `"按对话ID或代理邮箱搜索…"`.

Be precise about WHICH `searchPlaceholder`: each catalog has several (`agentConversations`/customer-search keys earlier). Edit ONLY the one inside the top-level `adminConversations` block. Use the ellipsis character `…` (matching the existing copy), not three dots. (BM/中文 are machine-assisted per the project's D-08 convention; native sign-off is a carried gate.)
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && node -e "for (const l of ['en','ms','zh']) { const m = require('./src/i18n/messages/'+l+'.json'); const p = m.adminConversations.searchPlaceholder; if (!/email|emel|邮箱/.test(p)) { console.error(l+' placeholder missing email mention: '+p); process.exit(1); } } console.log('all three catalogs mention email')"</automated>
  </verify>
  <done>`adminConversations.searchPlaceholder` mentions email in en (`agent email`), ms (`emel ejen`), and zh (`邮箱`); all three JSON files remain valid and key-set parity is unchanged (only the one value edited per catalog).</done>
</task>

</tasks>

<verification>
Run the project gate (matches prior quick tasks — see STATE last_activity):

```bash
cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent"
npx tsc --noEmit                                                    # expect 0 errors
npx eslint "app/[lang]/(admin)/conversations/"                      # expect 0 errors
npx vitest run "app/[lang]/(admin)/conversations/actions.test.ts"   # existing tests pass (additive change)
npx next build                                                      # expect success (routes unchanged)
```

**PII gate (hard constraint — CLAUDE.md):**
```bash
grep -rn "email" "app/[lang]/(admin)/conversations/"
```
Every `email` hit must be in the server-side data projection (`getUserByEmail`, `getUsers`, `emailByUid`, `agentEmail` field) or the client cell render (`conv.agentEmail`) — and the i18n placeholder copy. It MUST NOT appear in any `console.*`, `auditLog`/`audit.log`, or logger call. Confirm `searchConversations` still has NO `audit.log` call (it had none before).

**Manual spot check** (admin-only surface): load `/en/conversations` on a narrow browser window:
1. Type an agent email → that agent's conversations appear (most-recent 50); type an unknown email → "No conversations found", NOT an error toast; type a conversation-ID prefix → ID-prefix matches still work; clear the box + search → 50 most-recent.
2. Agent column shows emails; a uid with no Auth email shows the `XXXXXXXX…` fallback.
3. Open a conversation with a classifier-routed message → the dialog stays within the viewport (no horizontal overflow); the pillar badge reads a short token (e.g. `coach`); hover the badge → the full routeDecision rationale shows in the tooltip.
</verification>

<success_criteria>
- [ ] `ConversationRef.agentEmail: string | null` added; `searchConversations` has the three-branch query (email `@`-detection → `getUserByEmail` → `ownerUid` query on the existing composite index; unknown email → empty result; prefix + recent branches preserved) and resolves emails via chunked `adminAuth.getUsers` (≤100/call) into every row with null fallback.
- [ ] `adminAuth` resolved INLINE alongside `adminDb` (no top-level import); reads stay bounded at `limit(50)`.
- [ ] Agent cell renders `conv.agentEmail ?? (uid… | '—')` (no `font-mono`); thread `DialogContent` is `w-[calc(100%-2rem)] max-w-lg`; message-row flex has `min-w-0`; pillar badge shows the split token with full rationale on `title` and `h-auto max-w-full whitespace-normal break-words`.
- [ ] `adminConversations.searchPlaceholder` mentions email in en/ms/zh; key-set parity unchanged.
- [ ] No email/query is logged, console'd, or audited; `searchConversations` adds NO `audit.log` call; `getConversationForReview` + `flagConversation` untouched.
- [ ] `tsc --noEmit` clean; `eslint` clean; existing `actions.test.ts` passes; `next build` succeeds.
- [ ] No changes to schema, security rules, Firestore indexes (the `(ownerUid, createdAt DESC)` composite already exists), test infra, or `page.tsx`.
</success_criteria>

<output>
Create `.planning/quick/quick-kayinleong-014/SUMMARY.md` when done.

IMPORTANT — this repo's quick-task file conventions (match exactly):
- Plan file is `quick-kayinleong-014-PLAN.md` (id-prefixed).
- Summary file is `SUMMARY.md` — **plain, NOT id-prefixed**.
- Update `CLAIM.md` (status `in-progress` → `done`): fill the "What has changed" section and write a Regression Report in the `## Verification` section (per global CLAUDE.md) BEFORE marking done. Regression surface to cover: `getConversationForReview` + `flagConversation` (same file, must be unaffected); the `__name__` prefix + recent search branches (must still work); the flag-reason dialog (`max-w-md`) + ScrollArea vertical cap (must be untouched); i18n key-set parity across the three catalogs.
- Append a row to the STATE.md "Quick Tasks Completed" table: `| quick-kayinleong-014 | Conversation Log: search by agent email + Agent column shows email (not uid) + responsive detail modal (clean pillar badge, full rationale on hover) | 2026-06-15 | <commit> | [quick-kayinleong-014](./quick/quick-kayinleong-014/) |`.
- Commit with the owner-scoped prefix: `fix(quick-kayinleong-014): ...`.
- Do NOT push to any remote without explicit confirmation (user standing instruction in STATE.md).
</output>
