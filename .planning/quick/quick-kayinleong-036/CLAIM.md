# Claim: quick-kayinleong-036

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-036-cohort-membership
- started: 2026-07-19
- status: in-progress
- summary: Add agent add/remove (membership management) to the /[lang]/cohorts admin surface. Today it only does cohort CRUD (create/edit/delete); there is no way to add or remove agents from a cohort after creation.

## Context

Cohort membership is the denormalized `agentProfiles/{uid}.cohortId` (one cohort per agent; no member-UID array — 1 MB trap). It's written today only at user-creation (`users/actions.ts` → `agentProfilesRef().doc(uid).set({tenantId, cohortId}, {merge:true})`). There's no post-creation membership UI. Dashboard cohort filtering already reads `where('cohortId','==',cid)` (`src/dashboard/queries.ts`).

## What will change

- `app/[lang]/(admin)/cohorts/actions.ts` — two new admin-only, audited Server Actions:
  - `listAgentCohorts()` → `{ uid: cohortId }` map (bounded read of agentProfiles) so the client can show members + who's available.
  - `setAgentCohort(agentUid, cohortId | null)` → add (set `agentProfiles.cohortId`, cohort-existence checked) / remove (`FieldValue.delete()`); audited `cohort-member-add` / `cohort-member-remove`. Role from the VERIFIED token (admin-only, T-07-10); read-only + coach denied.
- `app/[lang]/(admin)/cohorts/page.tsx` — also load `listUsersWithRoles()` (roster) + `listAgentCohorts()` (map); pass to the island.
- `app/[lang]/(admin)/cohorts/cohort-management.tsx` — per-row "Manage agents" button → dialog listing current members (Remove) + an add picker (agents not already in this cohort); member count in the table.
- `src/i18n/messages/{en,ms,zh}.json` — new `adminCohorts.*` keys (manage/members/add/remove/counts) at parity.

## Security / invariants (carried)

- Admin-only, role from verified token, never args (T-07-10 / D-24 read-only denied).
- Every membership mutation audited (D-03).
- One cohort per agent (denormalized `cohortId`; no member array). Adding an agent already in another cohort MOVES them.
- No PII in audit (uid + cohortId only, never email).

## What has changed

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
