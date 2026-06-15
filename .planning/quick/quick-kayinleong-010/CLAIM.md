# Claim: quick-kayinleong-010

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Conversation started on /en/chat did not appear in the chat-history sidebar drawer after reload. The conversation WAS persisted server-side; the bug was in the client read path — a `orderBy('createdAt','desc')` that depended on an undeployed composite index and silently dropped null-`createdAt` docs, behind an empty `catch {}` that masked every read failure as an empty drawer.

## What will change

**Symptom (UAT):** Open `/en/chat`, send messages (a conversation exists), navigate away / reload,
open the history drawer (the left Sheet) → the conversation just had is missing; the drawer shows
`historyEmpty`.

**Root cause (RESEARCH, HIGH confidence — read path, not persistence):** The conversation doc
`conversations/coach-${uid}` IS written server-side by `ensurePrimaryThread` (Admin SDK, before
streaming) with `ownerUid`, `tenantId:'d2'`, `createdAt: serverTimestamp()`. The failure is in the
client-side sidebar read (`conversation-list.tsx`), where three modes all rendered identically as an
empty drawer because the `catch {}` swallowed everything:
- **H1** — `orderBy('createdAt','desc')` drops any doc whose `createdAt` is null/unresolved
  (serverTimestamp() race, or a doc that came to exist without `createdAt`).
- **H3 (likely in dev)** — the composite index `(ownerUid ASC, createdAt DESC)` is only deployed at a
  rollout checkpoint; until then the query throws `FAILED_PRECONDITION`.
- **H2** — a client token missing the `tenantId` claim → the `sameTenant()` read rule denies the list.

**Planned edits (minimal, behavior-preserving — no redesign of the `coach-${uid}` single-thread model, D-01):**
- NEW `app/[lang]/chat/conversation-sort.ts` — pure shell-side sort, null `createdAt` = newest.
- `app/[lang]/chat/conversation-list.tsx` — drop `orderBy` (equality-only query → no composite-index
  dependency, no null-drop), sort client-side, and log read errors instead of swallowing them.
- `src/memory/conversation.ts` — backfill `createdAt`/`ownerUid`/`tenantId` on an existing doc that
  lacks `createdAt`, preserving the rolling `summary`.
- Tests for both the sort helper and the backfill.

## What has changed

- **NEW** `app/[lang]/chat/conversation-sort.ts` — `sortConversationsByCreatedAtDesc<T extends { createdAt: Date | null }>(items): T[]`.
  Returns a NEW array (no mutation) sorted `createdAt` DESC; a null/unresolved `createdAt` ranks ahead
  of any dated doc (treated as newest), two nulls → 0. No React/firebase imports → clean node import
  for the unit test (shell-side, honors the core/shell split).
- `app/[lang]/chat/conversation-list.tsx` — removed `orderBy` from the `firebase/firestore` import; the
  query is now equality-only `where('ownerUid','==',uid)` + `limit(50)` (uses the automatic
  single-field index — no composite index needed; no longer drops null-`createdAt` docs). Results pass
  through `sortConversationsByCreatedAtDesc` before `setThreads`. The `.map` (incl.
  `createdAt: data.createdAt?.toDate?.() ?? null`) is unchanged. The empty `catch {}` →
  `catch (err) { console.error('[conversation-list] failed to load history', err) }` — error object
  ONLY (no PII), non-fatal. Doc-comments updated to describe the new behavior.
- `src/memory/conversation.ts` — `ensurePrimaryThread`: first-create branch unchanged (still the ONLY
  writer of `summary:''`). Added `else if (snap.data()?.createdAt == null)` that merges
  `{ createdAt: serverTimestamp(), ownerUid, tenantId:'d2' }` — repairs H1 subcase 2 WITHOUT writing
  `summary`/`pillar`/`lang` (rolling summary preserved, D-01). Existing-with-`createdAt` stays a no-op.
- **NEW** `app/[lang]/chat/conversation-sort.test.ts` — null sorts first and is not dropped; dated
  threads sort newest-first; mixed null+dated → null first then desc; input array not mutated.
- `src/memory/memory.test.ts` — added: backfill sets `createdAt`/`ownerUid`/`tenantId` and NOT
  `summary`; existing-`createdAt` → no write; the prior idempotency test now seeds `createdAt` so it
  still proves the no-write path.

**Commits (on `main`):**
- `145a534` feat(quick-kayinleong-010): robust history query + non-silent catch
- `a43ec8e` fix(quick-kayinleong-010): backfill createdAt in ensurePrimaryThread
- `7ad71e5` test(quick-kayinleong-010): cover history sort + createdAt backfill

## Verification

**Automated gates (all green):**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint app/[lang]/chat/conversation-list.tsx app/[lang]/chat/conversation-sort.ts src/memory/conversation.ts` → **0 errors**.
- `npx vitest run src/memory/memory.test.ts "app/[lang]/chat/conversation-sort.test.ts"` → **36 passed / 0 failed**.
- `npx vitest run` (full suite) → **663 passed | 186 skipped | 0 failed** (+13 over the prior 650 baseline; no regressions).

**Self-audit of the diff (regression-prevention):**
- *`ensurePrimaryThread` create branch + rolling summary* — the `if (!snap.exists)` create branch is
  byte-for-byte unchanged and remains the only writer of `summary`. The new path is an `else if` that
  fires only when the doc exists AND `createdAt` is null, and it never writes `summary`/`pillar`/`lang`.
  Covered by the new "preserves summary" test and the updated idempotency test.
- *`route.ts onFinish` cid contract* — `ensurePrimaryThread` still returns `coach-${uid}` on every path;
  message-append ordering untouched.
- *`listConversations` (conversation.ts:100-108)* — UNTOUCHED. It is a server-side path not used by the
  sidebar and legitimately backs other reads via the composite index; its tests pass.
- *chat-shell select/new conversation* — thread ids unchanged; no signature changes. Selecting the
  now-visible thread still sets `activeCid`.
- *Firestore conversations read rule* — NOT weakened. Dropping the client-side `orderBy` does not relax
  rules (still owner-only + `sameTenant()`). A residual H2 token-claim denial now logs a Firestore error
  code instead of silently emptying the drawer.
- *PII* — the new `console.error` logs only the Firestore error object (a code like `permission-denied`
  / `failed-precondition`), never conversation data, uid, summaries, or query args.

**Regression surface ruled out:** null-`createdAt` drop (H1) fixed by client-side sort; composite-index
dependency (H3) removed by dropping `orderBy`; rules-denial (H2) now diagnosable via the logged error
(this component cannot fix a missing token claim — a residual H2 is a separate follow-up).

**Not verified here:** the live browser render (no auth'd dev-server session this run). The sort-helper
unit test reproduces the exact failing condition (a thread with `createdAt: null` would be dropped by
`orderBy`) and proves it is now first and retained; the backfill tests prove the repair preserves
`summary`. Remaining human confirmation: open `/en/chat` → chat → reload → open the drawer → the thread
is listed. If it is ever empty, the console now shows `[conversation-list] failed to load history` with
a Firestore error code, turning the silent failure into a diagnosable one.
