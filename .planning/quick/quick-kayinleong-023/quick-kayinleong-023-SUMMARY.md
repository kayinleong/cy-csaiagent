---
quick_id: quick-kayinleong-023
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-023

Two requests, one cohesive change.

**1) "There's no page to add a user as an admin."** A role *matrix* already exists at
`/[lang]/roles`, but it only RE-assigns a role to a user who already has a Firebase Auth
account — there was no way to *create* a brand-new account from the console (only the
`set-claims` CLI). Built that page.

**2) "What is a cohort for? It doesn't link to anything."** Accurate: the cohort registry
(`/[lang]/cohorts`) shipped and `AgentProfileDoc.cohortId` is *read* in three places, but
nothing ever *wrote* a cohortId onto an agent — so every reader was inert. A cohort is an
admin-managed **onboarding intake batch**: you group new agents so ramp/funnel/days-to-first-close
analytics can be sliced per batch. The new page closes that write-gap.

## What changed

- **`app/[lang]/(admin)/users/`** (new) — admin-only "Add User" surface:
  - `actions.ts`: `createUser` Server Action — admin gate (verified token) → `adminAuth.createUser`
    → `setUserClaims` (sole sanctioned claim path) → for a new-agent, optional `cohortId` written
    onto `agentProfiles/{uid}` → audited (role/cohortId only, **never the email/PII**). Stable
    non-PII error codes, no raw Firebase messages forwarded.
  - `page.tsx`: RSC, `requireRole({ allowed:['admin'] })`; server-fetches cohorts for the picker.
  - `add-user-form.tsx`: client island (useTransition + toast). Email / temp password / optional
    name / role; cohort picker appears only for new-agent. Trilingual copy.
- **`app-sidebar-nav.ts`** — new admin-only `users` nav item under System & Compliance.
- **i18n** — `nav.users` + `adminUsers` namespace added to en/ms/zh.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <4 files>` | 0 errors, 0 warnings |
| `vitest` nav + ci-guards | 14 passed |
| `vitest` i18n-parity | 6 passed (all 3 catalogs match) |
| Dev server `/en,/ms,/zh /users` | 307 → sign-in (compiles + gate works) |
| Dev server `/en/roles`, `/en/cohorts` | 307 → sign-in (no regression) |

Net-new route — modifies no existing action/gate/rule (only one admin-only sidebar link + i18n).
The **authenticated** create-user flow couldn't be exercised here (needs an admin session + live
Admin SDK creds) — a logged-in admin should smoke-test: create a new-agent with a cohort, confirm
the cohort badge appears and the agent shows in that cohort's analytics. Full regression report in
`CLAIM.md`.

## Commit

- `d332fe1` feat(quick-kayinleong-023): add admin add-user page + close cohort assignment gap

## Follow-up (out of scope)

Re-assigning an *existing* agent's cohort (natural home: the coach-assignment surface) was left
out to keep this minimal — candidate for a separate quick task.
