# Claim: quick-kayinleong-037

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-037-users-coach-field
- started: 2026-07-19
- status: in-progress
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

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
