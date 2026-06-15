---
quick_id: quick-kayinleong-019
status: complete
date: 2026-06-15
commit: feac4e3
---

# Quick Task quick-kayinleong-019 — Summary

**Goal:** A hidden, admin-only "debug sidebar" unlocked by pressing **"e" 5 times**, exposing a
destructive **"Clear all data"** action that wipes every Firestore collection **except `users` and the
model config (`appConfig/modelConfig`)**.

## Locked decisions (clarified before building)

1. **Clear scope:** Firestore (server) — an Admin-SDK Server Action deletes documents from every
   collection except `users` and `appConfig`.
2. **"modal config" = model config** — preserve the `appConfig` collection (holds `modelConfig`).
3. **Access:** admin-role only — visible/unlockable only for admins; the Server Action re-verifies the
   admin claim from the verified token.

## What shipped

- **`debug-collections.ts`** — `CLEAR_COLLECTIONS` (20 collections) + `PRESERVE_COLLECTIONS`
  (`users`, `appConfig`). Shared by the action and its test.
- **`debug-trigger.ts`** — pure `isUnlockKeypress(key, target)` + `DEBUG_UNLOCK_KEY/COUNT/WINDOW_MS`.
  Ignores "e" typed into form fields.
- **`debug-actions.ts`** (`'use server'`) — `clearAllData()`: cookie→`requireUser`→admin gate →
  `adminDb.recursiveDelete` over the clear-list → `audit.log('debug-clear-all-data')` → `{ok,cleared}`.
- **`debug-sidebar.tsx`** (`'use client'`) — window keydown burst counter opens a right-side `Sheet`;
  destructive `AlertDialog` confirm + `sonner` toast. Hardcoded English (no i18n keys).
- **`console-shell.tsx`** — mounts `<DebugSidebar />` only when `role === 'admin'`.
- **Tests** — `debug-actions.test.ts` (6) + `debug-trigger.test.ts` (9).

## Verification

- tsc **0**, eslint **0**, vitest **691 passed / 188 skipped / 0 failed** (+15 new), `next build` **OK**.
- Regression self-audit in `CLAIM.md`: non-admins never mount the listener/panel; the global keydown
  handler doesn't `preventDefault` and only reacts to plain "e" outside inputs; `users`/`appConfig`
  exclusion is test-asserted; no i18n keys added; no PII/secrets logged.
- **Not verified:** live admin browser click-through + a real recursiveDelete (Admin SDK mocked in tests).

## Flag for Derek

`clearAllData` wipes `auditLogs` (the audit trail) per the "everything except users + model config"
requirement. If audit history must survive, add `'auditLogs'` to `PRESERVE_COLLECTIONS` in
`debug-collections.ts`.

## Scope note

The egg is live on the admin/coach **console** surfaces (where the verified role is a prop), gated to
admin — not on the standalone `/[lang]/chat` page. Extending it there would be a separate claim.
