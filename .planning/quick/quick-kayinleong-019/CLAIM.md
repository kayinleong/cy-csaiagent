# Claim: quick-kayinleong-019

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Add a hidden admin-only "debug sidebar" unlocked by pressing "e" 5 times, with a destructive "clear data" action that deletes every Firestore collection EXCEPT `users` and `appConfig/modelConfig` (server-side via an Admin-SDK Server Action, admin-claim gated).

## Locked decisions (clarified with user before planning)

1. **Clear scope:** Firestore (server). An Admin-SDK Server Action deletes documents from every
   Firestore collection EXCEPT `users` and `appConfig` (the `modelConfig` doc). Persistent data wipe.
2. **"modal config" = model config:** preserve `appConfig/modelConfig` and the `users` collection.
   Everything else is cleared.
3. **Access:** Admin role only. The sidebar is only visible/unlockable for users with the admin custom
   claim, and the Server Action re-verifies the admin claim server-side before deleting anything.

## What will change

- Hidden trigger: pressing the `e` key 5 times (global keydown listener) reveals a debug sidebar.
  Only mounted/active for admin users.
- Debug sidebar UI: a panel (reusing the project's sidebar/sheet primitives) with a guarded
  "Clear all data" action (confirm step) that preserves users + model config.
- Server Action: `clearAllDataExceptUsersAndModelConfig` (Admin SDK) — enumerates collections,
  batch-deletes all except `users` + `appConfig`, re-checks admin claim, writes an audit entry.

(Detailed file list filled in after research + planning.)

## What has changed

**NEW** `app/[lang]/_components/debug-collections.ts` — plain (non-`'use server'`) module exporting
`CLEAR_COLLECTIONS` (the 20 top-level collections to wipe) and `PRESERVE_COLLECTIONS` (`users`,
`appConfig`). Kept separate from the action so the action AND the test import the same authoritative
list. `conversations` covers its `messages` subcollection via recursiveDelete (no separate entry).

**NEW** `app/[lang]/_components/debug-trigger.ts` — pure, node-testable unlock logic:
`DEBUG_UNLOCK_KEY='e'`, `DEBUG_UNLOCK_COUNT=5`, `DEBUG_UNLOCK_WINDOW_MS=1500`, and
`isUnlockKeypress(key, target)` — true only for a case-insensitive "e" pressed while NOT focused in an
`input`/`textarea`/`select`/`contenteditable` (so typing "e" in a KB/search field never triggers it).

**NEW** `app/[lang]/_components/debug-actions.ts` (`'use server'`) — `clearAllData()`. Reuses the
`getSessionUser()` cookie pattern from `roles/actions.ts` → `requireUser` (verified token) → Layer-3
`if (user.role !== 'admin') return {ok:false,'Forbidden'}`. Loops `adminDb.recursiveDelete(adminDb.collection(name))`
over `CLEAR_COLLECTIONS`, then `audit.log({ action:'debug-clear-all-data', raw:{op,cleared} })` AFTER the
wipe (so the row survives the auditLogs delete). Returns `{ok:true,cleared}|{ok:false,error}`.

**NEW** `app/[lang]/_components/debug-sidebar.tsx` (`'use client'`) — window `keydown` listener (cleaned
up on unmount) that counts e-presses via `isUnlockKeypress` within rolling 1.5s windows; on 5 it opens a
right-side `Sheet`. The Sheet holds a destructive "Clear all data" button → `AlertDialog` confirm →
`clearAllData()` inside `useTransition` → `sonner` toast. All copy is hardcoded English (adds no
next-intl keys → i18n-parity gate stays green).

`app/[lang]/_components/console-shell.tsx` — import `DebugSidebar`; render `{role === 'admin' && <DebugSidebar />}`
inside `SidebarProvider`. Non-admin roles never mount it (no listener, no panel).

**NEW** `app/[lang]/_components/debug-actions.test.ts` — 6 cases (admin gate, read-only deny, no-session
Unauthorized, per-collection recursiveDelete, never users/appConfig, audit label).
**NEW** `app/[lang]/_components/debug-trigger.test.ts` — 9 cases for `isUnlockKeypress` + constants.

**Commits (on `main`):**
- `4eb0c8a` feat(quick-kayinleong-019): hidden admin debug sidebar with clear-all-data
- `feac4e3` test(quick-kayinleong-019): cover clear-all-data admin gate + unlock predicate

**Scope note:** Mounted in `console-shell.tsx`, so the easter egg is live on the admin/coach console
surfaces (where the verified role is available as a prop) — gated to `admin`. It is NOT on the standalone
`/[lang]/chat` page (that surface has no server-resolved role prop). This matches the admin-only access
decision; extending to chat would be a separate claim.

## Verification

**Automated gates (all green):**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <7 changed files>` → **0 errors / 0 warnings**.
- `npx vitest run app/[lang]/_components/debug-actions.test.ts app/[lang]/_components/debug-trigger.test.ts`
  → **15 passed**.
- `npx vitest run` (full suite) → **691 passed | 188 skipped | 0 failed** (was 676 pre-claim; +15 new, no
  regressions).
- `npx next build` → **Compiled successfully** (all 26 routes incl. the console layouts that render
  `console-shell.tsx`) — proves the new `'use server'` action + client Sheet resolve cleanly and no
  server-only module leaked into the client bundle.

**Self-audit of the diff (regression-prevention):**
- *Regression surface* = `console-shell.tsx` (rendered by BOTH `(admin)/layout.tsx` and
  `(coach)/layout.tsx`). For senior-coach / read-only the `role === 'admin'` guard means `DebugSidebar`
  is **never mounted** → no keydown listener, no Sheet, byte-for-byte identical behavior. Verified by full
  suite + build.
- *Global keydown listener* — added on `window` for admins only. It does **not** `preventDefault` /
  `stopPropagation`, reacts only to plain "e" outside form fields, and never fires on Cmd/Ctrl+B (the
  shadcn sidebar shortcut uses `metaKey`/`ctrlKey`, a different code path) → no conflict with existing
  shortcuts or typing. Cleaned up on unmount (no leak).
- *Sheet/AlertDialog* — both default `open=false` and portal to `<body>`, so there is no visual/layout
  change to the console until the egg is unlocked. Placed as a sibling of `SidebarInset` inside
  `SidebarProvider`; `next build` confirms no render error.
- *`clearAllData` blast radius* — the ONLY caller of `recursiveDelete` in the app; admin-gated server-side
  (verified token, not client role) and behind a two-step UI confirm. `users` + `appConfig` are excluded
  by the hardcoded list and asserted by a dedicated test (`never deletes preserved collections`). No
  existing Server Action / route was modified.
- *PDPA / secrets* — audit `raw` carries only `{op,cleared}` (counts, no PII; every value is sha256-hashed
  by `audit.log` anyway). No token/PII logged. No secrets introduced.
- *i18n* — zero next-intl keys added (hardcoded EN) → the live EN/BM/中文 parity gate is untouched
  (confirmed by the full suite staying green).
- *core/shell split* — the `'use server'` action and client components live under `app/` and import
  `adminDb`/`requireUser`/`audit` from `src/`; nothing in `src/` imports from `app/`. `next build`
  confirms no server-only leak into the client.

**Not verified here (no auth'd dev session this run):** the live browser click-through — sign in as an
admin, press "e" ×5 on a console page → the Debug sheet slides in; "Clear all data" → confirm → toast
"Cleared 20 collections…". And the destructive Firestore wipe against a real/emulator project (the unit
test proves the call shape + preserve-set with the Admin SDK fully mocked; it does not exercise a real
recursiveDelete). **Flag for Derek:** this wipes `auditLogs` (the audit trail) — intended by the "all
except users + model config" requirement, but confirm history loss is acceptable; if not, move
`auditLogs` to `PRESERVE_COLLECTIONS`.
