---
id: quick-kayinleong-011
type: execute
status: done
completed: 2026-06-15
requirements: [ADMIN-07]
files_modified:
  - app/[lang]/(admin)/roles/actions.ts
  - app/[lang]/(admin)/roles/role-assignment.tsx
commits:
  - d4d42d9 feat(quick-kayinleong-011): resolve user emails server-side in listUsersWithRoles
  - 62789cd feat(quick-kayinleong-011): render user email (uid fallback) as Agent dropdown label
---

# Quick Task quick-kayinleong-011: Agent dropdown shows user email instead of truncated uid (admin roles) — Summary

The `/[lang]/roles` admin "Assign Role" Agent dropdown now renders each user's **email** (resolved server-side from Firebase Auth) instead of an opaque truncated uid (`NigKjwg1…`), with a uid fallback for users that have no email — satisfying ADMIN-07's "identify agents by a human-readable label" intent.

## What changed

### Task 1 — Server-side email resolution (`actions.ts`, commit `d4d42d9`)
- Added `email: string | null` to the `UserWithRole` interface (resolved Firebase Auth email; `null` for no-email/`notFound` users).
- Imported the server-only `adminAuth` (`@/src/firebase/admin`) into the existing `'use server'` action.
- In `listUsersWithRoles`, after the bounded `usersRef().limit(200).get()` read: collect uids, chunk by ≤100 (the `adminAuth.getUsers` cap), accumulate returned records into `emailByUid` (`rec.email ?? null`), and project `email: emailByUid.get(doc.id) ?? null` onto each row. Email resolution is wrapped in a local try/catch so an Auth failure leaves `emailByUid` empty and every row falls back to `email: null` — the listing always returns.
- `assignRole`, the `audit.log({ raw: { targetUid, role } })` call, and the admin gate are untouched.

### Task 2 — Dropdown label (`role-assignment.tsx`, commit `62789cd`)
- Agent `<SelectItem>` label changed from `<span className="font-mono text-xs">{u.displayRef}…</span>` to `<span className="text-xs">{u.email ?? \`${u.displayRef}…\`}</span>`.
- Preserved `key={u.id}`, `value={u.id}` (assignRole depends on the uid), the `&nbsp;`, and the role `<Badge>`.

## Verification (project gate)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint "app/[lang]/(admin)/roles/"` | 0 errors (1 pre-existing `_lang` unused-var warning, out of scope) |
| `npx vitest run "app/[lang]/(admin)/roles/actions.test.ts"` | 7/7 pass |
| `npx next build` | success (route map unchanged) |
| PII gate (`grep email … console/audit/log`) | clean — email only in projection + label render |

Manual spot check (admin-only, carried — needs a deployed/seeded stack): load `/en/roles`, open the Agent dropdown in "Assign Role" — options show emails with the role badge; a no-email user shows the `XXXXXXXX…` uid fallback; selecting + assigning still works (assignRole receives the uid).

## Deviations from Plan

None — plan executed exactly as written. The optional success-path unit test was not added (it would require new admin/collections mocks); the change is covered by tsc, the preserved 7/7 suite, and `next build`.

## PII / constraints honored
- Email resolved and used server-side only; no email logged, console'd, or audited (`audit.log` left as `{ targetUid, role }`).
- No Cloud Functions (Server Action read). No schema, i18n, security-rules, Firestore-index, or `page.tsx` changes.

## Self-Check: PASSED
- FOUND: `app/[lang]/(admin)/roles/actions.ts` (contains `adminAuth.getUsers`, `email: string | null`)
- FOUND: `app/[lang]/(admin)/roles/role-assignment.tsx` (contains `u.email`)
- FOUND: commit `d4d42d9`
- FOUND: commit `62789cd`
