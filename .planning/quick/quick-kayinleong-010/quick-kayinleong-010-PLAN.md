---
quick_id: quick-kayinleong-010
type: execute
mode: quick
autonomous: true
files_modified:
  - app/[lang]/chat/conversation-list.tsx
  - app/[lang]/chat/conversation-sort.ts
  - app/[lang]/chat/conversation-sort.test.ts
  - src/memory/conversation.ts
  - src/memory/memory.test.ts
requirements: [CHAT-07, D-01]
must_haves:
  truths:
    - "A freshly-created coach-{uid} thread appears in the history drawer after reload, even before serverTimestamp() resolves (null createdAt sorts to top, not dropped)."
    - "The sidebar list no longer depends on the (ownerUid, createdAt DESC) composite index — an undeployed index can no longer present as an empty drawer."
    - "A Firestore read failure (rules denial / failed-precondition) is logged to the console (error object only, no PII) instead of being silently swallowed."
    - "ensurePrimaryThread backfills createdAt/ownerUid/tenantId on an existing doc that lacks createdAt, WITHOUT clobbering the existing rolling summary."
  artifacts:
    - path: "app/[lang]/chat/conversation-sort.ts"
      provides: "Pure client-side createdAt-desc sort (null = newest), shell-side, node-testable"
    - path: "app/[lang]/chat/conversation-list.tsx"
      provides: "Equality-only Firestore query + client-side sort + non-silent catch"
    - path: "src/memory/conversation.ts"
      provides: "ensurePrimaryThread backfill of createdAt on existing-but-incomplete docs, summary-preserving"
  key_links:
    - from: "app/[lang]/chat/conversation-list.tsx"
      to: "conversations collection"
      via: "where(ownerUid==uid) + limit(50), no orderBy"
      pattern: "where\\('ownerUid'"
    - from: "src/memory/conversation.ts ensurePrimaryThread"
      to: "conversations/coach-{uid}"
      via: "set(merge:true) backfill when createdAt missing"
      pattern: "createdAt"
---

<objective>
Fix the bug where a conversation started on `/en/chat` does not appear in the chat-history sidebar drawer after the user revisits/reloads the page.

Root cause (per RESEARCH): the conversation IS persisted server-side (`ensurePrimaryThread` writes `conversations/coach-${uid}` before streaming), but the client-side sidebar READ path silently fails in three ways that all render as an empty "historyEmpty" drawer:
- H1 — `orderBy('createdAt','desc')` drops any doc whose `createdAt` is null/unresolved (serverTimestamp() race, or a doc that came to exist without createdAt).
- H3 — the composite index `(ownerUid ASC, createdAt DESC)` is only deployed at a rollout checkpoint; until then the query throws `FAILED_PRECONDITION`.
- H2 — a client token missing the `tenantId` claim → `sameTenant()` read rule denies the list.
The empty `catch {}` at conversation-list.tsx:100-101 swallows all three.

Purpose: make the single existing coach thread reliably visible after reload, and stop masking read failures, without redesigning the single-thread (`coach-${uid}`) model (D-01).

Output: a robust equality-only sidebar query with client-side sort (fixes H1+H3), a non-silent catch that logs the error object (surfaces H2 + anything else, no PII), and a defensive `createdAt` backfill in `ensurePrimaryThread` (repairs already-broken docs, H1 subcase 2) — all behavior-preserving and test-covered.
</objective>

<context>
@.planning/quick/quick-kayinleong-010/quick-kayinleong-010-RESEARCH.md
@.planning/STATE.md
@./CLAUDE.md
@./AGENTS.md
@app/[lang]/chat/conversation-list.tsx
@src/memory/conversation.ts
@src/memory/memory.test.ts
@firestore.indexes.json
@firestore.rules
</context>

<constraints>
- NEVER log PII. The non-silent catch logs the error OBJECT only (Firestore error carries a code like `permission-denied`/`failed-precondition`), never the conversation data, query args, uid, or summaries.
- Core/shell split: `src/` must NEVER import from `app/`. Any extracted sort/mapping helper used by the sidebar lives in `app/[lang]/chat/` (the shell), never in `src/`.
- Do NOT redesign the single-thread `coach-${uid}` model (D-01). Visibility + read-robustness fix only.
- Minimal: no user-facing toast in this claim (logging is enough to diagnose); do NOT change `listConversations` (conversation.ts:100-108) — RESEARCH confirms it is a server-side path not used by the sidebar and legitimately backs other reads.
- The `createdAt: data.createdAt?.toDate?.() ?? null` mapping stays. `summary:''` is written ONLY on the first-create path; the backfill path must NOT write `summary`.
- vitest `environment: 'node'` (no jsdom) — do not render the React component; test the extracted pure sort helper and `ensurePrimaryThread` directly.
- Next.js 16 awareness (not directly exercised here): `proxy.ts` not `middleware.ts`; `cookies()/headers()` async.
</constraints>

<tasks>

<task type="auto">
  <name>Task 1: Make the sidebar query robust (remove orderBy, sort client-side) + stop swallowing the read error</name>
  <files>app/[lang]/chat/conversation-sort.ts, app/[lang]/chat/conversation-list.tsx</files>
  <action>
1. Create `app/[lang]/chat/conversation-sort.ts` (shell-side pure module, no React/firebase imports — clean node import for the test). Re-export the `ConversationItem` shape it needs (or accept a minimal `{ id: string; createdAt: Date | null }`-compatible generic) and export `sortConversationsByCreatedAtDesc<T extends { createdAt: Date | null }>(items: T[]): T[]`. It returns a NEW array (do not mutate input) sorted by `createdAt` descending, treating a missing/null `createdAt` as the NEWEST (sorted to the top) so a freshly-created thread is always visible. Comparator: both dates → `b.createdAt.getTime() - a.createdAt.getTime()`; a null ranks ahead of a non-null; two nulls → 0. Add a short doc-comment explaining why null = newest (serverTimestamp() not yet resolved).

2. In `conversation-list.tsx`: remove `orderBy` from the `firebase/firestore` import (line 24); keep `collection, query, where, limit, getDocs`. Import `sortConversationsByCreatedAtDesc` from `./conversation-sort`.

3. In `loadConversations` (query at :83-88) DROP `orderBy('createdAt','desc')`; keep `where('ownerUid','==',currentUser.uid)` and `limit(50)`. Equality-only uses the automatic single-field index (kills the H3 composite-index dependency) and no longer drops null-`createdAt` docs (H1).

4. Keep the `.map` at :90-98 (including `createdAt: data.createdAt?.toDate?.() ?? null`) UNCHANGED, then `setThreads(sortConversationsByCreatedAtDesc(items))`.

5. Change the empty `catch {}` at :100-101 to `catch (err) { console.error('[conversation-list] failed to load history', err) }` — error object ONLY (no PII), non-fatal, no re-throw, existing `finally setIsLoading(false)` unchanged. No toast.

6. Update the file's top doc-comment (:9-13) and the component JSDoc (:60-63) so any "ordered by createdAt DESC" wording becomes: equality-only query on `ownerUid` + `limit 50`, sorted client-side by `createdAt` desc with null/unresolved `createdAt` treated as newest.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx tsc --noEmit && npx eslint "app/[lang]/chat/conversation-list.tsx" "app/[lang]/chat/conversation-sort.ts"</automated>
  </verify>
  <done>tsc 0 errors; eslint 0 errors. Query has no `orderBy`; `sortConversationsByCreatedAtDesc` lives in `conversation-sort.ts` and is used before `setThreads`; the catch logs the error object (not PII); doc-comments describe the new behavior.</done>
</task>

<task type="auto">
  <name>Task 2: Defensive createdAt backfill in ensurePrimaryThread (summary-preserving)</name>
  <files>src/memory/conversation.ts</files>
  <action>
In `ensurePrimaryThread` (:63-88):

1. Keep the existing `if (!snap.exists)` first-create branch EXACTLY (sets `ownerUid, pillar, lang, createdAt: serverTimestamp(), summary:'', tenantId:'d2'`, `{ merge: true }`). `summary:''` stays ONLY here.

2. Add an `else if` for when the doc exists but is missing `createdAt` (H1 subcase 2). Read `snap.data()`; if `createdAt` is absent/null, backfill `docRef.set({ createdAt: FieldValue.serverTimestamp(), ownerUid: uid, tenantId: 'd2' as const }, { merge: true })`. Do NOT include `summary` (preserve the rolling summary — D-01 contract). Do NOT write `pillar`/`lang` either; backfill only the three visibility/ownership/tenant fields.

3. Existing-with-`createdAt` → no write (unchanged idempotency). Always return `coach-${uid}`.

4. Update the function JSDoc (:51-62) to note: an existing doc missing `createdAt` is repaired via merge of `createdAt/ownerUid/tenantId` WITHOUT touching `summary`.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx tsc --noEmit && npx eslint "src/memory/conversation.ts"</automated>
  </verify>
  <done>tsc 0 errors; eslint 0 errors. Three paths exist: create (sets summary:''), backfill-existing-without-createdAt (does NOT set summary), no-op (existing with createdAt). The `FieldValue` import is reused.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tests — null-createdAt not dropped + sorts to top + desc order; backfill preserves summary</name>
  <files>app/[lang]/chat/conversation-sort.test.ts, src/memory/memory.test.ts</files>
  <behavior>
    sortConversationsByCreatedAtDesc (conversation-sort.ts):
    - A thread with createdAt=null is NOT dropped and is sorted to the FIRST position.
    - Two dated threads order createdAt DESC (newer first).
    - Mixed (null + dated): null first, then dated desc.
    - Input array is not mutated; a new array is returned.

    ensurePrimaryThread backfill (conversation.ts):
    - Doc exists, NO createdAt → set(merge:true) called with createdAt+ownerUid+tenantId, NOT summary.
    - Doc exists WITH createdAt → set NOT called (idempotent no-op).
    - First-create (doc missing) → still sets summary:'' (unchanged).
  </behavior>
  <action>
Write tests FIRST (RED), then confirm Tasks 1+2 make them GREEN.

A. Create `app/[lang]/chat/conversation-sort.test.ts` (matches vitest include `app/**/*.test.ts`, node env). Import `sortConversationsByCreatedAtDesc` from `./conversation-sort` (pure module — no React/firebase pull-in). Assert: input `[{id:'a',createdAt:null},{id:'b',createdAt:new Date('2026-01-02')},{id:'c',createdAt:new Date('2026-01-01')}]` → ids `['a','b','c']`; two dated-only items sort newer-first; the returned array is a new reference and the input order is unchanged after the call.

B. Extend the existing `describe('ensurePrimaryThread ...')` block in `src/memory/memory.test.ts` (harness `mockConversationsDocGet`/`mockConversationsDocSet` at :169-234). Add:
  - "backfills createdAt on an existing doc missing createdAt WITHOUT clobbering summary": `mockConversationsDocGet.mockResolvedValue({ exists: true, data: () => ({ summary: 'Existing summary', ownerUid: 'uid-x', pillar: 'coach', lang: 'en', tenantId: 'd2' }) })` (no createdAt). Call `ensurePrimaryThread('uid-x','en')`. Assert `mockConversationsDocSet` called once with an object having `createdAt`, `ownerUid:'uid-x'`, `tenantId:'d2'`, `{ merge: true }`, and `expect(setArg).not.toHaveProperty('summary')`.
  - "does NOT write when an existing doc already has createdAt": `mockConversationsDocGet.mockResolvedValue({ exists: true, data: () => ({ summary: 'X', createdAt: new Date('2026-01-01') }) })`; assert `mockConversationsDocSet` NOT called.
  - The existing ":267 idempotent" test's `data()` has no createdAt, so under the new behavior it WOULD trigger a backfill. Add `createdAt: new Date('2026-01-01')` to that test's `data()` so it still proves the no-write idempotency path. Minimal edit only; do not weaken the summary-preservation guarantee.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx vitest run src/memory/memory.test.ts "app/[lang]/chat/conversation-sort.test.ts"</automated>
  </verify>
  <done>All tests in both files pass. The sort helper test proves null-createdAt is first and not dropped, desc order holds, and the input is not mutated. The backfill tests prove createdAt is set without `summary`, the existing-createdAt path is a no-op, and the updated idempotency test still passes. No existing memory.test.ts assertions regress.</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` → 0 errors across the repo.
- `npx eslint app/[lang]/chat/conversation-list.tsx app/[lang]/chat/conversation-sort.ts src/memory/conversation.ts` → 0 errors.
- `npx vitest run src/memory/memory.test.ts app/[lang]/chat/conversation-sort.test.ts` → all pass, no prior assertions regress.
- Manual (carried to verification, not a blocking gate): on `/en/chat`, start a chat, reload, open the history drawer → the thread is listed; if it is ever empty, the browser console now shows `[conversation-list] failed to load history` with a Firestore error code (no PII), turning a silent failure into a diagnosable one (surfaces residual H2 token-claim issues).
</verification>

<success_criteria>
- The history drawer lists a freshly-created `coach-${uid}` thread after reload, regardless of whether `createdAt` has resolved and regardless of whether the composite index is deployed.
- A null/missing `createdAt` thread sorts to the top (newest) and is never dropped.
- Read failures are logged (error object only, no PII), no longer silently swallowed; load failure stays non-fatal (chat still works).
- `ensurePrimaryThread` repairs an existing doc missing `createdAt` without clobbering the rolling `summary`; the existing single-thread (`coach-${uid}`) model is unchanged (D-01).
- `listConversations` and all server-side / admin reads are untouched.
- Regression Report written in CLAIM.md (per project rules) before the claim is marked done.
</success_criteria>

<output>
Update `.planning/quick/quick-kayinleong-010/CLAIM.md` (What changed + Verification/Regression Report) when done. No separate SUMMARY file required for quick mode.
</output>
