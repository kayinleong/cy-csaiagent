---
quick_id: quick-kayinleong-016
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-016

**Fix:** the chat-history sidebar threw `FirebaseError: Missing or insufficient permissions.` and showed
an empty drawer. This was the residual H2 surfaced by quick-010's non-silent catch.

**Root cause:** the conversations `list` rule requires `sameTenant()`, but the client query constrained
only `ownerUid`. Firestore rules are not filters — a `list` query must constrain every `resource.data`
field the rule references, or the whole query is denied. The token claim was fine (the user can chat, and
the chat route's `requireUser` throws without a `tenantId` claim); the query was the problem. Pre-existing
bug — the rules tests only covered single-doc `getDoc`, never a `list` query.

## What changed (per file)

- **`app/[lang]/chat/conversation-list.tsx`** — added `where('tenantId','==','d2')` alongside the existing
  `where('ownerUid','==',uid)` (still no `orderBy`; client-side sort + non-silent catch from quick-010
  unchanged). `'d2'` is inlined (the `TENANT_ID` constant is server-only in `collections.ts`). Two
  equality filters need no composite index. Doc-comments updated.
- **`src/firebase/__tests__/rules.test.ts`** — added the missing conversations `list`-rule tests:
  ownerUid-only query → `assertFails`; ownerUid+tenantId query → `assertSucceeds`. Imported
  `query/where/limit/getDocs`; removed the pre-existing unused `addDoc`.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <2 changed files>` | 0 errors / 0 warnings |
| Rules emulator: `npx vitest run src/firebase/__tests__/rules.test.ts` (FIRESTORE_EMULATOR_HOST set) | **173 passed / 0 failed** — incl. the 2 new list tests against the real firestore.rules |
| `npx vitest run` (full suite, no emulator) | 669 passed / 188 skipped / 0 failed |

The emulator run is the authoritative proof: it confirms the ownerUid-only query is denied and the
ownerUid+tenantId query is allowed by the actual security rules. Full regression report in `CLAIM.md`.

## Commit

- `3ac7909` fix(quick-kayinleong-016): add tenantId filter so conversations list rule is satisfiable

## Relationship to quick-010

quick-010 fixed the null-`createdAt` drop (H1) and the composite-index dependency (H3) and added the
logging that surfaced this rules denial (H2). quick-016 completes the user-facing bug: the drawer now
actually lists the conversation after reload.
