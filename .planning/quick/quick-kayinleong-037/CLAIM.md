# Claim: quick-kayinleong-037

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-037-users-coach-field
- started: 2026-07-19
- status: done
- summary: A coach reassignment on /[lang]/coach-assignment doesn't reflect on /[lang]/users. Root cause: `listUsersWithRoles` reads a non-existent `users.seniorCoachId` field; the canonical field on the users doc is `uplineCoachId`.

## Cause (field-name mismatch)

- `UserDoc` (collections.ts) has only `uplineCoachId?` — there is NO `seniorCoachId` field on the users doc.
- Provisioning (`src/firebase/auth.ts:180`) writes `users.uplineCoachId`; reassignment (`coach-assignment/actions.ts:103`) writes `users.uplineCoachId` (+ `agentProfiles.seniorCoachId`).
- BUT `listUsersWithRoles` (`roles/actions.ts:216`) reads `data.seniorCoachId` from the users doc — a field that never exists → always `null`. The Users page "Senior coach" column therefore never shows the coach and never reflects a reassignment.

## Fix

- `app/[lang]/(admin)/roles/actions.ts` — read `data.uplineCoachId` (the actual users-doc field) into `UserWithRole.seniorCoachId` (property name kept; consumers unchanged).
- Add an isolated regression test (`roles/list-users-coach.test.ts`) asserting the mapping, so a future write/read field drift is caught.

## What will change

- `app/[lang]/(admin)/roles/actions.ts` — one-line read-field fix.
- `app/[lang]/(admin)/roles/list-users-coach.test.ts` (new) — regression test.

## What has changed

- `app/[lang]/(admin)/roles/actions.ts` — `listUsersWithRoles` now reads `data.uplineCoachId` (the real users-doc coach field) into `UserWithRole.seniorCoachId`, instead of the non-existent `data.seniorCoachId`. Property name kept, so the Users page + coach-assignment page (both read `u.seniorCoachId`) need no change.
- `app/[lang]/(admin)/roles/list-users-coach.test.ts` (new) — isolated regression test asserting `users.uplineCoachId` → `UserWithRole.seniorCoachId` (and null when absent).

## Verification

**Automated**
- New regression test passes; it FAILS against the old code (which read the phantom `data.seniorCoachId` → always null), so it genuinely pins the fix.
- Existing `roles/actions.test.ts` still passes (8 tests total across both files).
- `tsc --noEmit` clean; `eslint` on the changed action + new test clean.

**Regression Report**
- *Root cause:* write/read field drift. `UserDoc` carries only `uplineCoachId`; provisioning (`auth.ts:180`) and reassignment (`coach-assignment/actions.ts:103`) write `users.uplineCoachId`, but the roster read used `users.seniorCoachId` (never written) → the /users "Senior coach" column was always empty and never reflected a reassignment.
- *Fix scope:* one read field in `listUsersWithRoles`. No write path changed (the coach-assignment dual-write is correct and untouched — `agentProfiles.seniorCoachId` canonical + `users.uplineCoachId` mirror). The `UserWithRole.seniorCoachId` property name is unchanged, so `user-list.tsx` and `coach-assignment/page.tsx` consumers are unaffected.
- *No caching involved:* the Users page is dynamic (reads cookies via `requireRole`), so it re-fetches per navigation — the field-name mismatch was the sole cause.
- *Not exercised (needs admin auth + live data):* the end-to-end click-through — reassign on /coach-assignment, then see the new coach on /users. The unit test proves the mapping that drives that column.
