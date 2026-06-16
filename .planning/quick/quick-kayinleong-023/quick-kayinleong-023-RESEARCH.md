# quick-kayinleong-023 — Research: Add-user-as-admin page + cohort linkage audit

**Researched:** 2026-06-15
**Domain:** Admin user management (Firebase custom claims) + cohort membership data model
**Confidence:** HIGH (all findings grep-verified against source with file:line refs)

---

## Executive summary

1. **An admin role-assignment page ALREADY exists** at `/[lang]/roles` — it lists existing users and lets an admin assign any role including `admin`, via the sanctioned `setUserClaims` path. What is **missing is a way to add a brand-new user** (create the Firebase Auth account); today the only provisioning path for a never-signed-in user is the CLI `scripts/set-claims.ts`.
2. **Custom claims are the source of truth** (`role` + `tenantId` on the verified ID token); a mirrored `users/{uid}` Firestore doc carries `role`/`tenantId`/`lang`. Both are written together, exclusively, by `setUserClaims` in `src/firebase/auth.ts:161`.
3. **Cohorts are genuinely half-built (orphaned on the write side).** `cohorts/{cohortId}` CRUD works; `AgentProfileDoc.cohortId?` is defined and **read** in 3 places — but **NO surface ever WRITES `cohortId` onto an agent profile.** There is no "assign agent to cohort" action anywhere. So every agent's `cohortId` is `undefined`, the cohort badge never renders, and the cohort filter is never exercised.
4. The user's complaint is **correct**: cohorts link to nothing *today* because the membership-assignment UI (the write half of COH-02) was never built. The intended link is documented (COH-02/PROF-01/CLOSE-02): a cohort is "an admin-managed onboarding intake batch" and agents reference it via `AgentProfileDoc.cohortId` for downline/funnel/days-to-first-close grouping.
5. **Recommended split:** (a) build an "Add user" surface as a new admin Server Action that calls `adminAuth.createUser` + `setUserClaims` (Admin SDK on the server — fully compliant; the "auth as the user" rule applies to *agent tools*, not admin Server Actions), reusing the `roles/` page's 3-layer gate; and (b) close the cohort loop with an "assign cohort" control (write `cohortId` to `agentProfiles/{uid}`) so the existing readers light up.

---

## Admin / roles: how it works today

### Role representation (HIGH)
- **Canonical role union:** `Role = 'new-agent' | 'senior-coach' | 'admin' | 'read-only'` — `src/firebase/auth.ts:36` and `VALID_ROLES` at `:56`.
- **Source of truth = Firebase custom claims.** `requireUser` reads `role` + `tenantId` from the **verified ID token** (`adminAuth.verifyIdToken`), never from the request body — `src/firebase/auth.ts:106-136`. Missing claims → `UnauthorizedError`.
- **Mirror copy in Firestore:** `users/{uid}` doc carries `{ tenantId, role, lang, voiceSamples, uplineCoachId? }` — `src/firebase/collections.ts:65-77`. There is **no `email` field** on the user doc; email lives only in Firebase Auth (resolved server-side via `adminAuth.getUsers` — `roles/actions.ts:190-207`).

### Where the role is SET (HIGH)
- **Sole sanctioned writer:** `setUserClaims(uid, role, opts?)` — `src/firebase/auth.ts:161-196`. It does three things atomically-ish:
  1. `adminAuth.setCustomUserClaims(uid, { role, tenantId: 'd2' })` (`:172`)
  2. upserts `users/{uid}` (`:182`)
  3. for `new-agent` only, upserts `agentProfiles/{uid}` with `journeyStage:'onboarding'`, `seniorCoachId` (`:185-195`).
- **Callers:** `scripts/set-claims.ts` (CLI, service-account creds) and the admin `assignRole` Server Action (`roles/actions.ts:141`).
- **Note (gap):** `setUserClaims` and `set-claims.ts` do **NOT** create the Firebase Auth user — they assume the UID already exists (i.e. the person has signed in at least once, or was created out-of-band). `createUser` is never called anywhere in app code (only `getUserByEmail` is used, in `conversations/actions.ts:205`).

### Where the role is CHECKED (HIGH) — defence-in-depth, 3 layers
1. **Route-group layout:** `app/[lang]/(admin)/layout.tsx:67` admits only `admin` + `read-only` into the group (others redirected).
2. **Per-page gate:** either the verbatim cookie→`requireUser`→`role!=='admin'` block (`roles/page.tsx:40-63`) **or** the centralized helper `requireRole({ lang, allowed:['admin'], fallback })` (`app/[lang]/_lib/require-role.ts`; used by `cohorts/page.tsx:36`). The helper is the newer, tested seam — prefer it.
3. **Server Action gate:** each action re-reads the verified token via `getSessionUser()` and asserts `user.role === 'admin'` (`roles/actions.ts:133`, `cohorts/actions.ts:84`). Role is **never** taken from action args (T-02-31 / T-07-10).
- **Firestore rules** are the final boundary: `users/{uid}` allow write `if (isSelf && !readOnly) || (admin && incomingTenant)` — `firestore.rules:96-98`; `agentProfiles/{uid}` similar at `:110-112`.
- **Nav filtering is UX-only, never the gate** — `app-sidebar-nav.ts:18-22`.

### Existing admin pages (route list) (HIGH)
All under `app/[lang]/(admin)/` (the `(admin)` group never appears in the URL):
`kb`, `inventory`, `roles`, `usage`, `audit-log`, `cohorts`, `integrations`, `model-config`, `conversations`, `erasure`, `pdpa-settings`, `coach-assignment`. The `roles` page is the role matrix + guarded assignment.

---

## Existing admin pages: the pattern to follow

The **`roles/`** and **`cohorts/`** surfaces are the canonical templates. New admin write-surfaces follow this exact triad:

| File | Role | Pattern |
|------|------|---------|
| `page.tsx` (RSC) | gate + server-fetch | `requireRole({lang,allowed:['admin'],fallback:\`/${lang}\`})` → fetch list via an admin-gated action → pass plain rows to client island. `getTranslations('adminX')`. Container: `<div className="container mx-auto max-w-4xl px-4 py-8">`. |
| `actions.ts` (`'use server'`) | mutations | `getSessionUser()` (verbatim cookie→`requireUser`) → assert `role==='admin'` → mutate via typed ref → `audit.log({ actorUid, action, targetRef, raw })` → return `{ok:true}` or `{ok:false,error}`. Never throws to the client. |
| `*-management.tsx` / `*-assignment.tsx` (`'use client'`) | UI island | `useTransition` + `sonner` `toast`; shadcn `Table`/`Dialog`/`Select`/`AlertDialog`/`Input`/`Textarea`/`Button`/`Empty`/`Badge` (all vendored in `components/ui/`); destructive confirm via `AlertDialog variant="destructive"` (no bare `confirm()`); all strings via `useTranslations('adminX')`. |

**i18n:** namespaces `adminRoles` and `adminCohorts` already exist in `src/i18n/messages/{en,ms,zh}.json` (confirmed present in en.json). A new "Add user" surface needs a new namespace (e.g. `adminAddUser`) added to **all three** catalogs (trilingual is a hard constraint — CLAUDE.md).

---

## Recommended approach: the "add user as admin" page

**Reframe for the planner — there are two distinct user needs hiding in the request:**

- **Need A — assign admin to an existing user:** *already shipped* at `/[lang]/roles`. If the user just wants to grant admin to someone who has already signed in, point them there (they may simply not have found it in the nav: System & Compliance → Roles). No build needed.
- **Need B — create a brand-new user account and grant a role in one step:** **not built.** This is the real gap. Today a never-signed-in person must be created out-of-band (Firebase console) then `npm run set-claims`.

**Recommended build for Need B:**

- **Route:** new surface `app/[lang]/(admin)/users/` (or extend `roles/` with an "Add user" dialog — lower-surface-area, reuses the existing gate + i18n). The standalone `users/` route is cleaner if you also want a future user-list/management view.
- **Server Action (`createUser`/`addUser`), `'use server'`:** copy the `roles/actions.ts` triad. Steps inside the action:
  1. `getSessionUser()` → assert `role === 'admin'` (verified token, not args).
  2. `adminAuth.createUser({ email, password? , displayName? })` — or `createUser` with a generated password + send a reset link. **This is server-side Admin SDK and is fully compliant** — the "never admin from a user-facing path" rule (CLAUDE.md) targets **agent tools / chat retrieval**, which must auth *as the user*; admin Server Actions provisioning users are explicitly the sanctioned Admin-SDK path (cf. `roles/actions.ts`, `set-claims.ts`).
  3. `setUserClaims(newUid, role, opts)` — reuse the existing sole-sanctioned claim writer (sets claims + `users/{uid}` + `agentProfiles` for new-agent).
  4. `audit.log({ actorUid, action:'user-create', targetRef:\`users/${newUid}\`, raw:{ role } })` — **never log email/PII** (CLAUDE.md secrets hygiene; emails are PII — keep them out of `raw`).
  5. Return `{ok:true}` / `{ok:false,error}`.
- **Validation:** validate email shape + role ∈ `VALID_ROLES` server-side. `setUserClaims` already throws `InvalidRoleError` for bad roles — surface as `{ok:false}`.
- **UI island:** `Dialog` (or page form) with `Input` (email), optional `Input` (display name), `Select` (role), `Button` → action via `useTransition`+`toast`. Trilingual strings.
- **Duplicate handling:** `adminAuth.createUser` throws `auth/email-already-exists` — catch and return a friendly `{ok:false,error}`; suggest using the Roles page to re-assign the existing user instead.

---

## Cohorts: defined where, created where, consumed where (or NOT)

### Defined (HIGH)
- **Collection:** `cohorts/{cohortId}` (Collection 21) — `CohortDoc { tenantId, name, description, createdAt, createdBy }` at `src/firebase/collections.ts:652-673`; ref factory `cohortsRef()` at `:998`. Rules block `firestore.rules:304` (admin-write, coach/admin-read, read-only DENIED).
- **Membership field:** `AgentProfileDoc.cohortId?: string` (OPTIONAL, denormalized, one-per-agent, no UID array) — `src/firebase/collections.ts:94`.

### Created / written (HIGH)
- **Cohort docs:** full admin CRUD — `createCohort`/`updateCohort`/`deleteCohort` in `app/[lang]/(admin)/cohorts/actions.ts`, UI in `cohort-management.tsx`, page at `cohorts/page.tsx`. This is what the user used. ✅ Works.
- **Membership (`AgentProfileDoc.cohortId`): NEVER WRITTEN.** Grep for any `.set`/`.update`/`add` touching `cohortId` returns **only the cohort-doc CRUD** (writing the cohort's own id in audit `raw`), never a write of `cohortId` onto an agent profile. `setUserClaims` does not accept or write `cohortId`. **This is the missing link.**

### Consumed / read (HIGH) — readers exist but are starved
1. `app/[lang]/(coach)/agents/[uid]/page.tsx:97-99` — renders a cohort `Badge` `if (profile.cohortId)`. Always falsy today → badge never shows.
2. `src/dashboard/queries.ts:259,340,387` — `computeForAgent` projects `cohortId` into the agent row (always `null`).
3. `src/dashboard/queries.ts:446-461` — `getOrgDaysToFirstClose({ cohortId })` filters `where('cohortId','==',cid)` — but its **only caller passes no arg**: `usage/page.tsx:274` calls `getOrgDaysToFirstClose()` with no cohort. So the cohort filter path is dead.

### What cohorts were INTENDED to link to (CITED — planning docs)
- **REQUIREMENTS.md:166-168 (COH-01/02/03)** + **collections.ts:652-656**: "A cohort is an admin-managed onboarding **intake batch**. Agents reference their cohort via the denormalized `AgentProfileDoc.cohortId` (one-cohort-per-agent, D-02)." Filtering "reuses `where('cohortId','==',cid)`."
- **CLOSE-02 (REQUIREMENTS.md:202)**: days-to-first-close is meant to be computed "as an **org/cohort aggregate**" — i.e. cohort is the grouping dimension for ramp-time analytics.
- **PROF-01 (REQUIREMENTS.md:172)**: the agent profile drill-in composes `cohortId` into the per-agent view.
- **Verdict:** cohorts were designed to group new agents into intake batches so the dashboard/funnel/days-to-first-close can be sliced per cohort. The cohort registry shipped; **the assignment (write) half of COH-02 was never built**, so all readers are inert. The user's instinct ("I don't see it link to anything") is accurate.

### Closing the loop (recommendation)
To make cohorts non-orphaned, add an admin action that writes `cohortId` onto `agentProfiles/{uid}` — the natural home is the **coach-assignment** surface (`app/[lang]/(admin)/coach-assignment/`) or the **agent profile** page, as an "Assign to cohort" `Select` populated from `listCohorts()`. The action mirrors the `roles/actions.ts` triad: admin gate → `agentProfilesRef().doc(uid).update({ cohortId })` → audit. Then wire `getOrgDaysToFirstClose({ cohortId })` to a cohort picker on `usage`. (Scope note: this is arguably a second concern from "add a user" — the planner may split into two claims or two waves.)

---

## Pitfalls / gotchas

- **Custom-claim propagation needs a token refresh (HIGH).** After `setUserClaims`/`createUser`+claims, the user's client must call `await user.getIdToken(true)` before the new role takes effect — documented in `scripts/set-claims.ts:39-41` and `:99-101`. A freshly-created user signing in for the first time gets correct claims on initial token; an *existing* signed-in user whose role you change won't see it until refresh/re-login.
- **Next.js 16 (HARD constraints):** `cookies()`/`headers()` are **async** — `await` them (already done everywhere; `require-role.ts:69`). It's `proxy.ts` not `middleware.ts`. **No Cloud Functions / no Admin SDK from the client** — all provisioning is Server Actions / Route Handlers. Read `node_modules/next/dist/docs/` before writing Next code (AGENTS.md).
- **Admin SDK is server-only.** `src/firebase/auth.ts` and `adminAuth` must never be imported into a client component. The action file is `'use server'`; the UI island is `'use client'` and only imports the action's *function*, not `adminAuth`.
- **PII / secrets (HARD).** Email is PII — resolve server-side, never log it, never put it in `audit.log` `raw`, never ship more than a projected string to the client (see `roles/actions.ts:190-207` precedent). Every Firestore doc must carry `tenantId:'d2'`.
- **`createUser` is new surface area** — no existing call uses `adminAuth.createUser`; verify the Admin SDK signature against the installed `firebase-admin` version and add a rules-unit / action test (project rule: security rules covered in CI for every collection; the `users` write rule already exists at `firestore.rules:96-98`).
- **Cohort delete does not cascade** — `deleteCohort` leaves dangling `cohortId` on agent profiles by design (`cohorts/actions.ts:158-165`); any new assignment UI should tolerate a dangling/absent cohort gracefully (the agent page already does — renders nothing).
- **CI grep guards (`scripts/ci-guards.test.ts`)** assert no `claude-*`/`gemini-*` model literals in `(admin)/cohorts/**` and no `read-only` grant in the cohorts rules block — a new cohort-assignment file under `(admin)/` must stay clean of model-id literals and must not grant read-only.
- **Don't rebuild the role page.** The biggest risk is duplicating `/roles`. Confirm with the user whether Need A (assign existing) suffices before building Need B (create new).

---

## Sources

**Primary (HIGH — read this session):**
- `src/firebase/auth.ts` (requireUser, setUserClaims, Role union)
- `app/[lang]/(admin)/roles/{page,actions,role-assignment}.tsx` (admin assignment pattern)
- `app/[lang]/(admin)/cohorts/{page,actions,cohort-management}.tsx` (cohort CRUD)
- `app/[lang]/(admin)/layout.tsx`, `app/[lang]/_lib/require-role.ts` (gate)
- `app/[lang]/_components/app-sidebar-nav.ts` (nav model)
- `src/firebase/collections.ts` (UserDoc, AgentProfileDoc.cohortId, CohortDoc)
- `src/dashboard/queries.ts` (cohortId readers), `app/[lang]/(coach)/agents/[uid]/page.tsx` (cohort badge)
- `firestore.rules:81-113,304`, `scripts/set-claims.ts`, `scripts/ci-guards.test.ts`

**Secondary (CITED — planning docs):**
- `.planning/REQUIREMENTS.md:162-206` (COH-01/02/03, PROF-01, CLOSE-02, NAV-01)
- `.planning/ROADMAP.md:200-221` (Phase 7 cohort intent)
