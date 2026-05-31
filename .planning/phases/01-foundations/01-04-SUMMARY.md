---
phase: 01-foundations
plan: "04"
subsystem: auth
tags: [firebase-auth, requireUser, setUserClaims, session-cookie, mobile-first, tdd, custom-claims, next-intl]

# Dependency graph
requires:
  - "01-03 (firebase: adminAuth, adminDb, usersRef/agentProfilesRef from collections.ts)"
  - "01-06 (i18n: app/[lang]/ segment, next-intl catalogs)"
provides:
  - "src/firebase/auth.ts — requireUser(req): HARD auth gate (verifyIdToken, fails closed) + setUserClaims(uid, role): Admin SDK claim-setting for all 3 roles"
  - "scripts/set-claims.ts — thin CLI provisioning for senior-coach/admin (D-11, no sign-in UI needed in Phase 1)"
  - "app/[lang]/(auth)/sign-in/page.tsx — RSC shell with localized copy via next-intl"
  - "app/[lang]/(auth)/sign-in/sign-in-form.tsx — 'use client' island: email+password, LOCAL persistence (AUTH-05), POST to /api/auth/session"
  - "app/api/auth/session/route.ts — Node-runtime Route Handler: POST verifies idToken + sets httpOnly __session cookie; DELETE clears it"
affects:
  - "01-11 (chat): requireUser() called at the start of /api/chat route"
  - "01-12 (chat route): requireUser() gate + session cookie auth pattern"
  - "All privileged Route Handlers: requireUser pattern is the canonical HARD gate"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireUser(req): extract Bearer token from Authorization header → adminAuth.verifyIdToken → return { uid, role, tenantId } from token claims (NEVER from request body)"
    - "setUserClaims: runtime role union validation → adminAuth.setCustomUserClaims(uid, { role, tenantId:'d2' }) → upsert users/{uid} + agentProfiles/{uid}"
    - "Session cookie: await cookies() (Next.js 16 async) → httpOnly, Secure, SameSite=strict — complements LOCAL persistence for AUTH-05"
    - "TDD flow: test first (RED) → implementation (GREEN) → 5/5 tests pass offline with mocked adminAuth"
    - "Mobile-first form: h-11 inputs, text-base md:text-sm, full-width button — vendored shadcn Field/Input/Button"

key-files:
  created:
    - "src/firebase/auth.ts — UnauthorizedError, InvalidRoleError, requireUser(), setUserClaims()"
    - "src/firebase/auth.test.ts — 5 unit tests (3 behaviors): requireUser valid/missing/invalid + setUserClaims all-roles/unknown-role"
    - "scripts/set-claims.ts — CLI: --uid --role --upline --senior; validates role union; calls setUserClaims → adminAuth.setCustomUserClaims"
    - "app/[lang]/(auth)/sign-in/page.tsx — RSC shell, generateMetadata, getTranslations, renders SignInForm"
    - "app/[lang]/(auth)/sign-in/sign-in-form.tsx — 'use client' island, signInWithEmailAndPassword, POST /api/auth/session, redirect to /[lang]/chat"
    - "app/api/auth/session/route.ts — POST: verifyIdToken + await cookies().set(httpOnly); DELETE: clear cookie"
  modified:
    - "src/firebase/auth.ts — removed unused adminDb import (lint clean)"

key-decisions:
  - "requireUser reads role/tenantId ONLY from verifyIdToken output — never from the request body (T-01-11 spoofing prevention)"
  - "UnauthorizedError is a named class export so Route Handlers can catch specifically and return 401"
  - "setUserClaims also upserts users/{uid} and agentProfiles/{uid} (for new-agent) via typed collection refs from 01-03 — single provisioning call does everything"
  - "scripts/set-claims.ts delegates to setUserClaims() rather than calling setCustomUserClaims directly — reuses the same validation + Firestore upsert logic"
  - "Session cookie uses the raw Firebase ID token (verified server-side on every request) — simpler than minting a separate session cookie and avoids a separate cookie-signing key"
  - "Mock for setUserClaims test: chainable withConverter() mock built manually (adminDb.collection().withConverter().doc().set()) — same pattern as 01-03 collections.test.ts hoisting fix"

# Metrics
duration: ~6min
completed: "2026-05-31"
---

# Phase 01 Plan 04: Authentication — requireUser Gate + Mobile Sign-in + Session Cookie Summary

**Server-side HARD auth gate (requireUser via verifyIdToken, fails closed) + setUserClaims Admin SDK provisioning for 3 roles + mobile-first new-agent sign-in form (LOCAL persistence, AUTH-05) + httpOnly session cookie via async cookies() (Next.js 16)**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-31T11:09:35Z
- **Completed:** 2026-05-31T11:15:20Z
- **Tasks:** 2 (Task 1: TDD auth gate + claim-setting; Task 2: sign-in form + session route)
- **Files created:** 6 | **Files modified:** 1

## Accomplishments

- `requireUser(req)` extracts Bearer token, calls `adminAuth.verifyIdToken`, returns `{ uid, role, tenantId }` from the VERIFIED token claims — role/tenantId never sourced from the request body (T-01-11).
- `requireUser` fails CLOSED: `UnauthorizedError` thrown on missing header, empty token, or any `verifyIdToken` rejection (T-01-10).
- `setUserClaims(uid, role)` validates the role union at runtime (rejects unknown roles — T-01-13), calls `adminAuth.setCustomUserClaims(uid, { role, tenantId:'d2' })`, and upserts `users/{uid}` + `agentProfiles/{uid}` via the typed refs from 01-03.
- `scripts/set-claims.ts`: CLI provisioning with `--uid`, `--role`, `--upline`, `--senior` flags; calls `setUserClaims`; references `setCustomUserClaims` in comment chain documentation.
- `app/[lang]/(auth)/sign-in/sign-in-form.tsx`: `"use client"` island; `signInWithEmailAndPassword(clientAuth, ...)` (clientAuth has LOCAL persistence from 01-03 — AUTH-05); POSTs ID token to `/api/auth/session`; redirects to `/${lang}/chat`.
- `app/api/auth/session/route.ts`: Node-runtime Route Handler; POST verifies idToken via `adminAuth.verifyIdToken`; sets httpOnly `__session` cookie via `await cookies()` (Next.js 16 async — critical gotcha); DELETE clears cookie.
- No token/claim logging anywhere in the auth surface (T-01-12, CLAUDE.md secrets hygiene) — grep verified.
- 5/5 vitest unit tests pass offline (mocked `adminAuth`).
- `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files).
- `npx tsc --noEmit`: 1 pre-existing error in `components/ui/calendar.tsx` (out of scope); 0 errors in new files.

## Task Commits

| Task | Type | Commit | Description |
|------|------|--------|-------------|
| 1 | test (RED) | `5503c7a` | TDD RED: failing auth.test.ts (5 behaviors) |
| 1 | feat (GREEN) | `a69ac56` | TDD GREEN: requireUser + setUserClaims + set-claims.ts |
| 2 | feat | `9b47666` | Sign-in form (mobile-first) + session cookie route |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock for adminDb.collection() missing withConverter() chain**
- **Found during:** Task 1, first vitest GREEN run
- **Issue:** `setUserClaims` calls `usersRef().doc(uid).set(...)` — `usersRef()` calls `adminDb.collection('users').withConverter(converter)`. The initial test mock provided `adminDb.collection: vi.fn(() => ({ doc: vi.fn(...) }))` without `withConverter`, causing `TypeError: adminDb.collection(...).withConverter is not a function`.
- **Fix:** Rebuilt the mock as a chainable object (`collection()` returns a ref with `withConverter()` which returns another ref with `doc()` which returns a ref with `set()`). Used the same `vi.hoisted()` pattern as 01-03 collections.test.ts.
- **Files modified:** `src/firebase/auth.test.ts`
- **Verification:** `npx vitest run src/firebase/auth.test.ts` exits 0, 5 tests pass.
- **Committed in:** `a69ac56` (GREEN commit)

**Total deviations:** 1 auto-fixed (Rule 1 bug in mock chain). All other implementation matched the plan exactly.

## Security Verification (Threat Register)

| Threat ID | Status | Verification |
|-----------|--------|--------------|
| T-01-10 | Mitigated | `requireUser` calls `adminAuth.verifyIdToken`; test asserts UnauthorizedError on invalid token; fail-closed on any verify error |
| T-01-11 | Mitigated | Role/tenantId read ONLY from `verifyIdToken` output; `grep -n "req.json\|request.body" src/firebase/auth.ts` → 0 code matches (only doc comments) |
| T-01-12 | Mitigated | `grep -nE "console\.(log|info|debug).*token\|console.*claims"` → 0 matches in auth.ts and session/route.ts |
| T-01-13 | Accepted | Role union validated at runtime (`VALID_ROLES.includes(role)` throws `InvalidRoleError`); script documented as controlled provisioning path |

## Known Stubs

- **Chat redirect target** — `sign-in-form.tsx` redirects to `/${lang}/chat` after successful sign-in. This route does not exist yet (01-11 will create it). Until then, successful sign-in will land on a Next.js 404. This is intentional scaffolding; the sign-in mechanism itself is complete and correct. 01-11 resolves this.

## Threat Flags

No new security surfaces beyond the plan's threat model. The `app/api/auth/session` route is already in the threat register (T-01-10, T-01-12) and fully mitigated.

---
*Phase: 01-foundations | Plan: 04*
*Completed: 2026-05-31*

## Self-Check: PASSED

**Files verified:**

- [x] `src/firebase/auth.ts` — exists, exports `requireUser`, `setUserClaims`, `UnauthorizedError`
- [x] `src/firebase/auth.test.ts` — exists, 5 tests pass
- [x] `scripts/set-claims.ts` — exists, contains `setCustomUserClaims` (comment chain), validates role union
- [x] `app/[lang]/(auth)/sign-in/page.tsx` — exists, RSC (no "use client"), uses `getTranslations`
- [x] `app/[lang]/(auth)/sign-in/sign-in-form.tsx` — exists, starts with `"use client"`, uses `signInWithEmailAndPassword`, POSTs to `/api/auth/session`
- [x] `app/api/auth/session/route.ts` — exists, `await cookies()` (async, Next.js 16), `adminAuth.verifyIdToken`, httpOnly cookie

**Acceptance criteria verified:**

- [x] `src/firebase/auth.ts` exports `requireUser` and `setUserClaims` — `grep -n "^export" src/firebase/auth.ts` confirms both
- [x] `grep -n "req.json\|request.body" src/firebase/auth.ts` → 0 code-level matches (role from token only)
- [x] `requireUser` calls `adminAuth.verifyIdToken` and fails closed — test Behavior 2a/2b asserts UnauthorizedError
- [x] `scripts/set-claims.ts` contains `setCustomUserClaims` — line 86 comment chain
- [x] `scripts/set-claims.ts` validates role union — line 56-62, rejects unknown role with exit 1
- [x] `grep -nE "console\.(log|info|debug).*token|console.*claims" src/firebase/auth.ts` → 0 matches
- [x] `npx vitest run src/firebase/auth.test.ts` exits 0 — 5/5 tests green
- [x] `sign-in-form.tsx` begins with `"use client"` — line 1
- [x] `session/route.ts` uses `await cookies()` — lines 64, 86
- [x] `grep -nE "console\.(log|info).*idToken|console.*token" app/api/auth/session/route.ts` → 0 matches
- [x] Sign-in form imports from `@/components/ui/*` — Field, Input, Button all imported
- [x] `npm run lint` passes — 0 errors (4 pre-existing warnings)
- [x] `npx tsc --noEmit` clean for new files — only pre-existing `calendar.tsx` error

**Commits verified:**

- [x] `5503c7a` — test(phase-kayinleong-01): 01-04 — TDD RED: failing auth.test.ts
- [x] `a69ac56` — feat(phase-kayinleong-01): 01-04 — TDD GREEN: requireUser + setUserClaims + set-claims.ts
- [x] `9b47666` — feat(phase-kayinleong-01): 01-04 — new-agent sign-in (mobile-first) + session cookie route
