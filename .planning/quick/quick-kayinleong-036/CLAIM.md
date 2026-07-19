# Claim: quick-kayinleong-036

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-036-cohort-membership
- started: 2026-07-19
- status: done
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

- `app/[lang]/(admin)/cohorts/actions.ts` — added `listAgentCohorts()` (admin-only bounded read of `agentProfiles` → uid→cohortId map) and `setAgentCohort(agentUid, cohortId|null)` (admin-only, audited: add sets `agentProfiles.cohortId` after a cohort-existence check; remove uses `FieldValue.delete()`; audit `cohort-member-add`/`cohort-member-remove` with uid+cohortId only). Imported `agentProfilesRef`.
- `app/[lang]/(admin)/cohorts/page.tsx` — also loads `listUsersWithRoles()` (roster) + `listAgentCohorts()` (map) in parallel; passes `agents` + `initialCohortMap` to the island (non-blocking on failure).
- `app/[lang]/(admin)/cohorts/cohort-management.tsx` — exported `CohortAgent`; added an agent-count column and a per-row **Manage agents** button opening a dialog with an add picker (agents with role `new-agent` not already in the cohort) + a members list with per-agent Remove; live `cohortMap` state; Edit/Delete compacted to icon buttons with aria-labels. All writes via `setAgentCohort` + `useTransition` + toast.
- `src/i18n/messages/{en,ms,zh}.json` — new `adminCohorts.*` keys (colMembers, manage*, add/remove/members copy, close) at parity.

## Verification

**Automated**
- `tsc --noEmit` clean; `eslint` on all 3 cohorts files clean (0 warnings after dropping the unused `lang` destructure).
- i18n parity test pass (en/ms/zh identical trees); Firestore rules test pass (agentProfiles admin-write + cohorts already covered, 171-case matrix green); ci-guards pass.
- Dev server: `/en/cohorts` compiles and runs; `requireRole` admin gate correctly 307-redirects an unauthenticated visit to sign-in (application-code 59ms, no errors) — RSC boundary + new server-action imports build cleanly.

**Regression Report**
- *Surface:* the cohorts admin page (added membership actions + dialog). Cohort CRUD (create/edit/delete) is unchanged behaviorally — same actions, same optimistic updates.
- *Data model:* membership uses the SAME canonical field + write shape as user-creation (`agentProfiles/{uid}.cohortId` via `set({tenantId,cohortId},{merge:true})`, `src/dashboard/queries.ts` reads `where('cohortId','==',…)`). No schema/index change needed (single-field equality; the map read is a bounded `limit(1000)` scan). One-cohort-per-agent preserved (adding an agent already in another cohort MOVES them — no member array).
- *Security:* both new actions are admin-only with role from the VERIFIED token (never args), read-only + coach denied (matches coach-assignment/roles). Every membership change audited with uid+cohortId only — no email/PII. Server actions use the Admin SDK (rules bypassed server-side); the agentProfiles rules already permit admin writes for any client path.
- *Testing note:* the cohorts surface has no action-level unit tests in the codebase (only rules tests) — this change follows that established pattern; the security boundary is covered by the rules matrix.
- *Not exercised (needs admin auth + live Firestore):* the Manage-agents dialog add/remove round-trip and the member count. When signed in as admin: open a cohort → Manage agents → add an agent (appears in Members, count increments) → Remove (disappears); verify a `cohort-member-add`/`-remove` audit row and that dashboard cohort filtering reflects the change.
