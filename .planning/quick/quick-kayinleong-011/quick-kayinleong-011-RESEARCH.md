# quick-kayinleong-011 — Research

**Researched:** 2026-06-15
**Domain:** Admin Role & Permission Matrix — Agent picker label (Firebase Auth identity)
**Confidence:** HIGH (root cause + fix fully code-grounded; all file:line references verified this session)

## Summary

The `/[lang]/roles` Agent dropdown shows a truncated raw uid (`NigKjwg1…`) because the label is hard-wired to `displayRef`, which is computed as `doc.id.slice(0, 8)` (the first 8 chars of the Firebase Auth uid). The user list comes from the **Firestore `users` collection** (`usersRef()`), **not** from Firebase Auth `listUsers()`. Critically, the `UserDoc` schema **has no `email` field** — so email is *not* currently available in the data path and must be fetched separately.

The cleanest minimal fix: in `listUsersWithRoles()` (the Server Action), after the bounded Firestore read, batch-fetch the matching Firebase Auth records via `adminAuth.getUsers([{uid}, …])` to resolve each uid → email, add an `email` (or `displayLabel`) field to `UserWithRole`, and switch the dropdown label from `u.displayRef` to email (falling back to the truncated uid when a user has no email). The option **value stays `u.id` (the uid)** — `assignRole` needs the uid, so the value must not change.

**Primary recommendation:** Extend `listUsersWithRoles()` to resolve emails via `adminAuth.getUsers()` and add `email` to `UserWithRole`; change `role-assignment.tsx:223` to render `u.email ?? \`${u.displayRef}…\``. Keep `value={u.id}` unchanged.

## Root Cause (file:line)

| Location | What it does | Why it's the bug |
|----------|--------------|------------------|
| `app/[lang]/(admin)/roles/actions.ts:187` | `displayRef: doc.id.slice(0, 8)` | Builds the only human-facing string from the uid — truncates it, no email. |
| `app/[lang]/(admin)/roles/role-assignment.tsx:222-224` | `<SelectItem value={u.id}>` → `<span className="font-mono text-xs">{u.displayRef}…</span>` | Renders the truncated uid as the label. Value (`u.id`=uid) is correct; **label is the defect**. |
| `app/[lang]/(admin)/roles/actions.ts:74-82` | `interface UserWithRole { id; role; displayRef; seniorCoachId }` | No `email` field carried to the client. |
| `src/firebase/collections.ts:63-75` | `interface UserDoc` | **No `email` field stored** — confirms email cannot be read from Firestore alone. |
| `src/firebase/auth.ts:174-182` (`setUserClaims`) | Upserts `users/{uid}` with `tenantId, role, lang, voiceSamples` | Confirms email is never written to the Firestore doc. Email lives only in Firebase Auth. |

**Data source verdict:** Firestore `users` collection (keyed by uid), populated by `setUserClaims`. The uid IS the Firebase Auth uid, so it is a valid identifier for `adminAuth.getUser/getUsers`.

## Minimal Fix Approach

Email is **NOT** already available — it must be fetched from Firebase Auth. The smallest correct change:

1. **`actions.ts` — `listUsersWithRoles()` (lines 177-192):** after building the uid list from the Firestore snapshot, call
   ```ts
   import { adminAuth } from '@/src/firebase/admin'
   const records = await adminAuth.getUsers(snap.docs.map((d) => ({ uid: d.id })))
   const emailByUid = new Map(records.users.map((u) => [u.uid, u.email]))
   ```
   `adminAuth.getUsers(identifiers: UserIdentifier[])` is **VERIFIED** present in this project's `firebase-admin` (`node_modules/firebase-admin/lib/auth/base-auth.d.ts:198`); `UserRecord.email?: string` confirmed (`user-record.d.ts:32`). It is a single batched call (≤100 uids per call; the read is already bounded to `limit(200)`, so for >100 users either chunk into two `getUsers` calls or accept that the existing 200-bound is a pilot ceiling — see Pitfall 2).
2. **`actions.ts` — `UserWithRole` (lines 74-82):** add `email: string | null`. Map it in the projection (lines 182-190): `email: emailByUid.get(doc.id) ?? null`. Keep `displayRef` as the fallback.
3. **`role-assignment.tsx:223`:** change the label span to `{u.email ?? \`${u.displayRef}…\`}`. The font-mono styling can stay for the uid-fallback branch or be dropped for email; cosmetic.

`value={u.id}` (line 222) is unchanged — the uid remains the assignment key. No change to `assignRole`, `page.tsx`, or the i18n catalogs is required (no new copy needed; email is data, not a translated string).

## Pitfalls / Gotchas

1. **Users without email (phone/anonymous auth).** `UserRecord.email` is optional. The label MUST fall back to the truncated uid (`${u.displayRef}…`) when email is absent — never render an empty/blank option. The proposed `?? ` fallback handles this.
2. **`getUsers` 100-identifier cap.** The Firestore read is bounded to `limit(200)` (actions.ts:180). `adminAuth.getUsers` accepts max 100 identifiers per call. At current pilot scale (≤200 agents, realistically far fewer admin-provisioned users) chunk the uid array into batches of 100 if you want to be safe, or rely on the practical pilot count being <100. Note `GetUsersResult` also returns `notFound` for uids that exist in Firestore but were deleted from Auth — those simply won't get an email and fall back to uid (no crash).
3. **PII / audit (CLAUDE.md).** Email IS PII, but this is an **admin-only** surface (three-layer admin gate: `page.tsx:60`, `actions.ts:125/173`) displaying user identity to an admin — a legitimate use. The constraint to honor: **do NOT log the email**. The existing `audit.log` call (actions.ts:136-141) records only `{targetUid, role}` — no email — so the audit posture is already clean. Do not add email to any log/audit/console output. (Note the unrelated `do NOT store raw name/email` comment at collections.ts:421 is about the `auditLogs` pseudonymization boundary, not the admin roles screen.)
4. **Server/client boundary (Next.js 16, core/shell).** `adminAuth` is server-only (Admin SDK) and is already imported inside the `'use server'` action and within `src/firebase/`. The fetch happens entirely server-side in `listUsersWithRoles`; only the resolved `email` string crosses to the client island — no Admin SDK leaks to the bundle. No `cookies()/headers()` change needed (the existing async `getSessionUser` is untouched). No Cloud Functions involved (constraint satisfied).
5. **Tests.** `actions.test.ts` mocks only `@/src/firebase/auth`, `@/src/audit`, `next/headers` — it does **not** exercise the `listUsersWithRoles` data-mapping/success path (no `collections` or `admin` mock). Adding the `getUsers` call therefore does not break any existing test. If the planner wants coverage for the new email mapping, a new test would need to mock `@/src/firebase/admin` (`adminAuth.getUsers`) and `@/src/firebase/collections` (`usersRef`) — optional, not required to ship.

## Integration Points (files the planner edits)

| File | Edit |
|------|------|
| `app/[lang]/(admin)/roles/actions.ts` | Add `email` to `UserWithRole` (L74-82); in `listUsersWithRoles` (L177-192) batch-resolve emails via `adminAuth.getUsers` and map `email` into each row. Import `adminAuth` from `@/src/firebase/admin`. |
| `app/[lang]/(admin)/roles/role-assignment.tsx` | L223: render `{u.email ?? \`${u.displayRef}…\`}` as the option label. Value (L222 `value={u.id}`) unchanged. |
| *(optional)* `app/[lang]/(admin)/roles/actions.test.ts` | Add a success-path test mocking `adminAuth.getUsers` + `usersRef` if email-mapping coverage is desired. |

No i18n, schema, rules, index, or `page.tsx` changes required.

## Sources

### Primary (HIGH confidence — verified this session)
- `app/[lang]/(admin)/roles/role-assignment.tsx` (label at L222-224)
- `app/[lang]/(admin)/roles/actions.ts` (`listUsersWithRoles` L164-197, `displayRef` L187, `UserWithRole` L74-82, audit L136-141)
- `src/firebase/collections.ts` (`UserDoc` L63-75 — no email field)
- `src/firebase/auth.ts` (`setUserClaims` upsert L174-182 — email never stored)
- `src/firebase/admin.ts` (`adminAuth` export L86)
- `node_modules/firebase-admin/lib/auth/base-auth.d.ts:198` (`getUsers(identifiers)`), `:141` (`getUser`); `user-record.d.ts:32` (`email?: string`)
- `app/[lang]/(admin)/roles/page.tsx` (admin gate + wiring), `actions.test.ts` (mock surface)
