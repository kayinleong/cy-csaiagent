---
quick_id: quick-kayinleong-010
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-010

**Fix:** a conversation started on `/en/chat` did not appear in the chat-history sidebar drawer after
reload. Root cause was the client read path, not persistence: a `orderBy('createdAt','desc')` that
depended on an undeployed composite index and silently dropped null-`createdAt` docs, all masked by an
empty `catch {}`.

## What changed (per file)

- **NEW `app/[lang]/chat/conversation-sort.ts`** — pure shell-side `sortConversationsByCreatedAtDesc`;
  null/unresolved `createdAt` sorts to the top (newest), returns a new array, no React/firebase imports.
- **`app/[lang]/chat/conversation-list.tsx`** — equality-only query `where('ownerUid','==',uid)` +
  `limit(50)` (dropped `orderBy` → no composite-index dependency, no null-drop), client-side sort before
  `setThreads`, and `catch (err) { console.error('[conversation-list] failed to load history', err) }`
  (error object only, no PII, non-fatal). Doc-comments updated.
- **`src/memory/conversation.ts`** — `ensurePrimaryThread` backfills `createdAt`/`ownerUid`/`tenantId`
  on an existing doc that lacks `createdAt`, preserving the rolling `summary` (D-01). First-create and
  existing-with-`createdAt` paths unchanged.
- **Tests** — `conversation-sort.test.ts` (null not dropped, sorts first, desc order, no mutation);
  `memory.test.ts` (backfill sets createdAt without clobbering summary; existing-createdAt no-op;
  updated idempotency test).

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <3 changed source files>` | 0 errors |
| `npx vitest run src/memory/memory.test.ts app/[lang]/chat/conversation-sort.test.ts` | 36 passed / 0 failed |
| `npx vitest run` (full suite) | 663 passed / 186 skipped / 0 failed (+13 over baseline) |

Full regression report and self-audit in `CLAIM.md`.

## Commits

- `145a534` feat(quick-kayinleong-010): robust history query + non-silent catch
- `a43ec8e` fix(quick-kayinleong-010): backfill createdAt in ensurePrimaryThread
- `7ad71e5` test(quick-kayinleong-010): cover history sort + createdAt backfill

## Residual / follow-up

H2 (a client token missing the `tenantId` claim → `sameTenant()` read denial) cannot be fixed in the
sidebar component. It is now diagnosable: a residual empty drawer logs a Firestore `permission-denied`
in the console. If observed, a follow-up claim should force `getIdToken(true)` after claims are set.
