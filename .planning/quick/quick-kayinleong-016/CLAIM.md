# Claim: quick-kayinleong-016

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Chat-history sidebar threw "FirebaseError: Missing or insufficient permissions." (the residual H2 surfaced by quick-kayinleong-010's non-silent catch). The conversations `list` rule grants reads only when `sameTenant()` holds, but the client query constrained only `ownerUid` — and Firestore rules are not filters, so a query that does not constrain every `resource.data` field the rule references is denied wholesale. Added `where('tenantId','==','d2')` to the query (two equality filters need no composite index) + the missing list-rule emulator tests.

## What will change

**Symptom (console, after quick-010 made it diagnosable):**
`[conversation-list] failed to load history FirebaseError: Missing or insufficient permissions.`
The history drawer is empty on every open.

**Root cause (definitive — NOT a missing token claim):**
- The conversations read rule (`firestore.rules:117-119`) is
  `(resource.data.ownerUid == request.auth.uid && sameTenant()) || (hasRole('admin') && sameTenant())`,
  where `sameTenant()` = `resource.data.tenantId == request.auth.token.tenantId`.
- Firestore evaluates a **list/query** against the rule by checking the query's *constraints*, not the
  stored docs. For the rule to be satisfiable, the query must constrain EVERY `resource.data` field the
  rule references. The drawer query constrained `ownerUid` but **not** `tenantId`, so Firestore could not
  prove the result set satisfies `sameTenant()` → it rejected the whole query with `permission-denied`.
- The token claim is present, not the problem: provisioning sets `setCustomUserClaims(uid, { role, tenantId })`
  (`auth.ts:172`), and the chat route's `requireUser` (`auth.ts:132`) THROWS if a verified token lacks
  `tenantId`. Since the user can chat, their token carries `tenantId:'d2'`. So the fix is purely the
  query constraint, not a claim/token-refresh change.
- This was pre-existing (not introduced by quick-010); the drawer list never worked. The existing rules
  tests only covered single-doc `getDoc` reads (the `get` rule path), never a `list`/query — which is
  exactly why it slipped through. quick-010 removed the OTHER latent failures (H1 null-drop, H3 composite
  index) and added the logging that surfaced this one.

**Planned edits (minimal — do NOT weaken the rule):**
- `app/[lang]/chat/conversation-list.tsx` — add `where('tenantId','==','d2')` to the history query.
- `src/firebase/__tests__/rules.test.ts` — add the missing conversations `list`-rule tests.

## What has changed

- `app/[lang]/chat/conversation-list.tsx` — the `loadConversations` query now has TWO equality filters:
  `where('ownerUid','==',currentUser.uid)` AND `where('tenantId','==','d2')`, plus `limit(50)` (still no
  `orderBy`; client-side sort unchanged). A block comment explains that `tenantId` is mandatory for the
  `list` rule's `sameTenant()` and that rules are not filters. `'d2'` is inlined as a literal because
  `TENANT_ID` lives in `src/firebase/collections.ts`, which is server-only (imports `firebase-admin`) and
  must not be imported into a `'use client'` component. The two doc-comment blocks were updated to
  describe the owner+tenant query.
- `src/firebase/__tests__/rules.test.ts` — added `query, where, limit, getDocs` to the `firebase/firestore`
  import (and removed the pre-existing unused `addDoc` from that line). Added two tests to the
  `conversations collection` suite:
  - "new-agent list query WITHOUT a tenantId filter is DENIED" → `assertFails` (locks the root cause).
  - "new-agent list query WITH ownerUid + tenantId filters SUCCEEDS" → `assertSucceeds` (mirrors the
    production drawer query exactly; locks the fix).

**Commit (on `main`):** `3ac7909` fix(quick-kayinleong-016): add tenantId filter so conversations list rule is satisfiable.

## Verification

**Automated gates (all green):**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint app/[lang]/chat/conversation-list.tsx src/firebase/__tests__/rules.test.ts` → **0 errors, 0 warnings**.
- **Firestore rules emulator** (`firebase emulators:start --only firestore` + `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run src/firebase/__tests__/rules.test.ts`) → **173 passed / 0 failed**, including the two new `list` tests. This is the authoritative proof: it exercises the ACTUAL `firestore.rules` and confirms the ownerUid-only query is denied while the ownerUid+tenantId query is allowed.
- `npx vitest run` (full suite, no emulator) → **669 passed | 188 skipped | 0 failed** (the 2 new rules tests skip without the emulator, as designed; no regressions).

**Self-audit of the diff (regression-prevention):**
- *Security posture* — the fix ADDS a constraint to the client query; it does NOT touch `firestore.rules`
  and does NOT weaken `sameTenant()` / owner isolation. Cross-tenant and cross-owner reads remain denied
  (existing rules tests still pass). The change can only make the query MORE restrictive, never broader.
- *Composite index* — two equality filters (`ownerUid` + `tenantId`) are served by Firestore's automatic
  single-field indexes via zigzag merge; no composite index is required, so the H3 fix from quick-010 is
  preserved (the drawer still does not depend on `(ownerUid, createdAt)`).
- *quick-010 behavior* — `orderBy` is still absent, the client-side `sortConversationsByCreatedAtDesc`
  (null = newest) is unchanged, and the non-silent `catch` is unchanged. The result set is now non-empty
  for a tenant-'d2' owner, so the sort path is actually exercised.
- *Other reads* — `listConversations` (server-side, Admin SDK, rules-exempt) and the admin
  `/conversations` review path are untouched. `messages` subcollection rules unaffected.
- *PII* — no logging change; the query adds a tenant literal only. No PII introduced.

**Residual:** none for this symptom. If a future user is provisioned WITHOUT the `tenantId` claim, the
chat route's `requireUser` would 401 them before they could chat at all, so the drawer-vs-chat split that
produced this bug cannot recur silently.
