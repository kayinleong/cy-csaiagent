# Claim: quick-kayinleong-019

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: in-progress
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

_(pending execution)_

## Verification

_(pending — Regression Report required before status: done)_
