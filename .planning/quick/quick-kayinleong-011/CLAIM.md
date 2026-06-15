# Claim: quick-kayinleong-011

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: The Agent dropdown on /en/roles (Assign Role) shows raw Firebase user IDs (e.g. `NigKjwg1…`) instead of user emails. Show user email instead.

## What will change

- `app/[lang]/(admin)/roles/actions.ts` — add `email: string | null` to `UserWithRole`; resolve emails server-side in `listUsersWithRoles` via chunked `adminAuth.getUsers` (≤100 uids/call), with a null fallback for no-email/notFound users and a resilient try/catch so an Auth failure never breaks the listing.
- `app/[lang]/(admin)/roles/role-assignment.tsx` — Agent `<SelectItem>` label renders `u.email ?? `${u.displayRef}…`` (truncated-uid fallback), preserving `value={u.id}` and the role `<Badge>`.

## What has changed

- `actions.ts` (commit `d4d42d9`): `UserWithRole.email: string | null` added; `adminAuth` imported from `@/src/firebase/admin`; emails resolved via chunked `adminAuth.getUsers` and mapped onto every row via `emailByUid`; `assignRole` + `audit.log` untouched.
- `role-assignment.tsx` (commit `62789cd`): dropdown label swapped from `font-mono` `displayRef` to `u.email ?? `${u.displayRef}…``; `key={u.id}`, `value={u.id}`, `&nbsp;`, and the role `<Badge>` preserved.

## Verification

**What was tested**
- `npx tsc --noEmit` — 0 errors (whole project).
- `npx eslint "app/[lang]/(admin)/roles/"` — 0 errors (1 pre-existing `_lang` unused-var warning, unrelated to this change, left untouched per minimal-diff rule).
- `npx vitest run "app/[lang]/(admin)/roles/actions.test.ts"` — 7/7 pass.
- `npx next build` — success (route map unchanged).
- PII gate: `grep -rn "email" app/[lang]/(admin)/roles/ | grep -iE "console\.|audit\.|logger|log\("` → no matches. Email appears only in the data projection and the label render.

**Regression surface considered**
- `assignRole(uid, role)` — UNCHANGED; the dropdown still passes `value={u.id}` (the uid), so assignment by uid is intact. Existing tests assert `setUserClaims(targetUid, role)` and the `role-assign` audit event still fire (7/7 GREEN).
- `audit.log({ raw: { targetUid, role } })` — UNCHANGED; no email field added, so the no-PII audit posture holds.
- Admin gate (`Unauthorized` / `Forbidden`) — UNCHANGED; both return before the Firestore/Auth read. The read-only-caller `listUsersWithRoles` Forbidden test still passes (returns before `adminAuth.getUsers`).
- `adminAuth.getUsers` failure — wrapped in a local try/catch that leaves `emailByUid` empty, so every row falls back to `email: null` and the listing still returns; the outer try/catch behavior is intact.
- Users with no email (phone/anon) or in Auth `notFound` — render the `${displayRef}…` uid fallback, never a blank option.
- Out of scope (ruled out): schema, i18n catalogs, security rules, Firestore indexes, and `page.tsx` — none touched.

**What was ruled out and why**
- No new success-path unit test added: it would require mocking `@/src/firebase/admin` + `@/src/firebase/collections` (the existing suite only exercises the pre-read Forbidden path). The behavior is verified by tsc + the preserved 7/7 suite + `next build`; live email rendering is an admin-only manual spot check (carried, below). Minimal-diff: no test-infra change introduced.

**Manual spot check (admin-only, carried — requires a deployed/seeded stack)**
- Load `/en/roles` → open the Agent dropdown in "Assign Role": options show emails with the role badge; a no-email user shows the `XXXXXXXX…` uid fallback; selecting + assigning a role still works (assignRole receives the uid).
