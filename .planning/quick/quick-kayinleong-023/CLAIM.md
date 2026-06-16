# Claim: quick-kayinleong-023

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Add an admin UI page for creating a new user + granting a role (the existing /roles page can only RE-assign roles to users who already have an account); and close the orphaned cohort-assignment gap by letting that page assign a new-agent to a cohort, which answers "what is a cohort for" — it groups new agents into an intake batch for downline/funnel/days-to-first-close analytics.

## What will change

(See "What has changed" — research confirmed two needs hiding in the request.)

## What has changed

**The request had two parts; research (`quick-kayinleong-023-RESEARCH.md`) showed:**

1. **"No page to add a user as admin."** A role *matrix* page already exists at `/[lang]/roles`, but it can only RE-assign a role to a user who already has a Firebase Auth account (signed in once, or created out-of-band via the `set-claims` CLI). There was **no console surface to create a brand-new account.** That is the real gap — now filled.
2. **"What is the purpose of a cohort? It doesn't link to anything."** Correct: the cohort *registry* (`/[lang]/cohorts` CRUD) shipped, and `AgentProfileDoc.cohortId` is **read** in 3 places (the coach agent-profile badge, the dashboard projection, and `getOrgDaysToFirstClose`'s cohort filter) — but **nothing ever wrote `cohortId` onto an agent profile.** Every reader was therefore inert. A cohort is meant to be an admin-managed **onboarding intake batch** (COH-01/02, CLOSE-02, PROF-01): you group new agents so ramp-time / funnel analytics can be sliced per batch.

**New files (`app/[lang]/(admin)/users/`):**
- `actions.ts` — `createUser` Server Action. Three-layer admin gate (group layout → page `requireRole` → action re-checks `role==='admin'` from the **verified token**, never args). Flow: validate email/password/role → `adminAuth.createUser` → `setUserClaims(uid, role)` (the SOLE sanctioned claim path; for new-agent it also seeds `agentProfiles/{uid}`) → for a new-agent with a chosen cohort, `agentProfiles/{uid}.set({ tenantId, cohortId }, {merge:true})` → `audit.log('user-create', raw:{role, cohortId?})`. **Email (PII) is never logged and never placed in the audit `raw` map.** Returns stable non-PII error codes (`email-exists`, `invalid-email`, `weak-password`, `invalid-role`, …); raw Firebase messages are never forwarded (they can echo the submitted email).
- `page.tsx` — RSC, `requireRole({ allowed:['admin'], fallback:'/${lang}' })` (read-only denied → Home). Server-fetches the cohort list (reusing the admin-gated `listCohorts` from `../cohorts/actions`) for the new-agent picker; non-blocking empty fallback.
- `add-user-form.tsx` — client island (`useTransition` + sonner toast, matching `role-assignment.tsx`). Email / temp-password / optional display name / role select. The **cohort picker shows only when role = new-agent** (the only role with an agent profile). All copy trilingual.

**Sidebar nav (`app/[lang]/_components/app-sidebar-nav.ts`):**
- Added `users` to `NavItemKey`, imported the `UserPlus` icon, and added an **admin-only** nav item (`{ key:'users', href:'/${lang}/users', roles:['admin'] }`) under **System & Compliance**, next to Roles. No other role gains a surface (preserves the locked least-privilege nav).

**i18n (`src/i18n/messages/{en,ms,zh}.json`):**
- Added `nav.users` and a full `adminUsers` namespace (labels, hints, role names, cohort copy, and a stable-code → message `errors` map) to **all three** catalogs (EN/BM/中文 — multilingual is a hard constraint).

**Commit (on `main`):** `d332fe1` feat(quick-kayinleong-023): add admin add-user page + close cohort assignment gap.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <4 changed source files>` → **0 errors, 0 warnings**.
- `npx vitest run` on `app-sidebar-nav.test.ts` + `ci-guards.test.ts` → **14 passed** (nav model unchanged for non-admin roles; CI grep-guards green — the new files live under `(admin)/users/**`, outside the cohorts/model-config globs, and carry no model-id literal).
- `npx vitest run i18n-parity.test.ts` → **6 passed** (all three catalogs have identical key sets after the additions — no missing/extra keys).
- **Dev server (`:3000`, Next 16 Turbopack):** the new route compiles and the gate works — unauthenticated GET returns **307 → sign-in** in every locale: `/en/users`, `/ms/users`, `/zh/users`. Existing `/en/roles` and `/en/cohorts` still **307 → sign-in** (no regression).

**Regression self-audit (per global rule — "what existing feature could this break?"):**
- **Net-new route.** `app/[lang]/(admin)/users/` is entirely new; it modifies no existing route, action, gate, or rule. The only change to existing code is one admin-only sidebar link + the i18n additions.
- **Sidebar nav.** Added a single admin-only item and a union member. The read-only "least-privilege blindness" test and the senior-coach visibility test still pass — neither role sees `users`. Section keys are unchanged, so the "admin sees all six sections" test passes. (Nav filtering is UX-only and never the security gate; the server-side `requireRole` + the `(admin)/layout` redirect are the real boundary, both exercised by the 307 probes above.)
- **Claims path.** Provisioning goes exclusively through `setUserClaims` (the sole sanctioned writer) — `createUser` does not touch custom claims directly. The "no admin from a user-facing path" rule targets **agent tools** (chat retrieval, which must auth as the user); an admin-gated provisioning Server Action using the Admin SDK is the sanctioned pattern (same as `roles/actions.ts` / `scripts/set-claims.ts`).
- **Cohort write.** The new `agentProfiles/{uid}.set({...cohortId}, {merge:true})` runs only for a new-agent with an explicit cohort selection, *after* `setUserClaims` has seeded the profile doc — `merge:true` preserves the seeded fields. This lights up the 3 existing readers without changing their logic. Cohort deletion still does not cascade (unchanged, by design) and a dangling cohortId renders nothing (unchanged).
- **PII / secrets.** Re-scanned the diff: the submitted email is validated + passed to the Admin SDK server-side only; it is never logged, never returned to the client, and never put in the audit `raw` map (only `role` and optional `cohortId`). No secrets introduced.

**NOT verified here (honest gaps):**
- The **authenticated** create-user flow (admin signs in → submits → account created → claims set → cohort assigned) was **not exercised end-to-end** — it requires an admin session and live Admin SDK credentials, which aren't available in this environment. The route compiles, gates correctly, and the action mirrors the proven `roles`/`cohorts` action triad; a logged-in admin should smoke-test once: create a new-agent with a cohort, confirm the new agent shows the cohort badge on the agent-profile page and appears in the cohort's days-to-first-close slice.
- **Scope note (follow-up):** this assigns a cohort only at *new-agent creation* time. Re-assigning an *existing* agent's cohort (the natural home is the coach-assignment surface) was intentionally left out of this claim to keep the change minimal — a candidate for a separate quick task.
