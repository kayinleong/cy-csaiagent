---
id: quick-kayinleong-011
type: execute
wave: 1
depends_on: []
files_modified:
  - app/[lang]/(admin)/roles/actions.ts
  - app/[lang]/(admin)/roles/role-assignment.tsx
autonomous: true
requirements: [ADMIN-07]

must_haves:
  truths:
    - "The Agent dropdown in /en/roles 'Assign Role' shows each user's email instead of a truncated uid."
    - "A user with no email (phone/anonymous auth) still renders the truncated uid fallback — never a blank option."
    - "Selecting a user still assigns by uid (assignRole(uid, role) unchanged); the role Badge still renders next to the label."
    - "Email is resolved server-side only; no email is logged, audited, or shipped via the Admin SDK to the client bundle."
  artifacts:
    - path: "app/[lang]/(admin)/roles/actions.ts"
      provides: "UserWithRole.email field + batch email resolution via adminAuth.getUsers (chunked by 100)"
      contains: "adminAuth.getUsers"
    - path: "app/[lang]/(admin)/roles/role-assignment.tsx"
      provides: "Dropdown label rendering email with displayRef fallback"
      contains: "u.email"
  key_links:
    - from: "app/[lang]/(admin)/roles/actions.ts"
      to: "@/src/firebase/admin (adminAuth)"
      via: "adminAuth.getUsers(snap.docs.map(d => ({ uid: d.id })))"
      pattern: "adminAuth\\.getUsers"
    - from: "app/[lang]/(admin)/roles/role-assignment.tsx"
      to: "UserWithRole.email"
      via: "SelectItem label renders u.email ?? `${u.displayRef}…`"
      pattern: "u\\.email"
---

<objective>
Fix the Agent dropdown in the `/[lang]/roles` admin Role & Permission Matrix ("Assign Role" section) so it shows each user's **email** instead of a truncated raw Firebase uid (`NigKjwg1…`).

Root cause (RESEARCH.md): the dropdown label is hard-wired to `displayRef = doc.id.slice(0, 8)`, and the Firestore `users/{uid}` doc has **no email field** — email lives only in Firebase Auth. The fix resolves email server-side via `adminAuth.getUsers(...)`, carries it on `UserWithRole`, and renders it in the label with a uid fallback for users that have no email.

Purpose: Admins can identify agents by a human-readable email in the role-assignment picker (ADMIN-07), not by an opaque uid prefix.
Output: Two edited files — `actions.ts` (server-side email resolution + new `email` field) and `role-assignment.tsx` (label swap). No schema, i18n, rules, index, or `page.tsx` changes.
</objective>

<context>
@.planning/STATE.md
@.planning/quick/quick-kayinleong-011/quick-kayinleong-011-RESEARCH.md
@app/[lang]/(admin)/roles/actions.ts
@app/[lang]/(admin)/roles/role-assignment.tsx
@app/[lang]/(admin)/roles/actions.test.ts
@src/firebase/admin.ts

# Project conventions that MUST be honored (see CLAUDE.md / AGENTS.md):
# - Email is PII. Resolve and use it server-side only; do NOT log/console/audit it.
#   The existing audit.log call records only { targetUid, role } — leave it unchanged.
# - Next.js 16: no new cookies()/headers() needed; the existing async getSessionUser is untouched.
# - adminAuth (Admin SDK) is server-only; it is already imported inside src/firebase and is safe
#   to import in this 'use server' action. Only the resolved email STRING crosses to the client.
# - No Cloud Functions; this is a Server Action read (constraint satisfied).
</context>

<grounding>
Verified facts the executor should rely on (do NOT re-explore to confirm):

**`adminAuth` (`@/src/firebase/admin`, line 86):** `export const adminAuth: Auth = getAuth()` — a `firebase-admin/auth` `Auth` instance.
- `adminAuth.getUsers(identifiers: { uid: string }[])` returns `{ users: UserRecord[], notFound: [...] }`.
- Each `UserRecord` has `.uid: string` and `.email?: string` (email is OPTIONAL — undefined for phone/anonymous users).
- `getUsers` caps at **100 identifiers per call**. The Firestore read is bounded to `limit(200)`, so up to 2 chunks are possible — chunk the uid array by 100.
- `GetUsersResult.notFound` lists uids present in Firestore but deleted from Auth — they simply get no email and fall back to uid (no crash).

**`actions.ts`:**
- `UserWithRole` (L74-82): `{ id, role, displayRef, seniorCoachId }` — NO email today.
- `listUsersWithRoles()` (L164-197): admin-gated; reads `usersRef().limit(200).get()` and maps each doc → `UserWithRole`. The Forbidden/Unauthorized gates return BEFORE the Firestore read.
- `assignRole` and the `audit.log({ ... raw: { targetUid, role } })` call (L136-141) are OUT OF SCOPE — do not touch.

**`role-assignment.tsx`:**
- The Agent `<Select>` maps `users` → `<SelectItem key={u.id} value={u.id}>` (L221-228).
- Label currently: `<span className="font-mono text-xs">{u.displayRef}…</span>` then `&nbsp;` then a role `<Badge>`.
- `value={u.id}` (the uid) MUST stay — `assignRole(uid, role)` depends on it. The `<Badge>` MUST stay.

**Tests:** `actions.test.ts` mocks only `@/src/firebase/auth`, `@/src/audit`, `next/headers`. Its `listUsersWithRoles` test only exercises the **Forbidden** (read-only caller) path, which returns before any `usersRef`/`adminAuth` call. Adding `adminAuth.getUsers` therefore does NOT break existing tests. A success-path test is OPTIONAL (would require mocking `@/src/firebase/admin` + `@/src/firebase/collections`).
</grounding>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Resolve user emails server-side in listUsersWithRoles</name>
  <files>app/[lang]/(admin)/roles/actions.ts</files>
  <behavior>
    - Given a Firestore users snapshot of N docs (N ≤ 200), listUsersWithRoles returns one UserWithRole per doc, in the same order, each with id/role/displayRef/seniorCoachId preserved AND a new `email: string | null`.
    - For a uid whose Firebase Auth record has an email, the row's `email` equals that email string.
    - For a uid whose Auth record has no email (phone/anon) OR is in getUsers `notFound`, the row's `email` is `null`.
    - With more than 100 docs, emails are resolved across multiple getUsers calls (chunks of ≤100) and all rows are still populated correctly.
    - The admin gate is unchanged: Unauthorized → {ok:false,'Unauthorized'}, non-admin → {ok:false,'Forbidden'}, both returning before any Firestore/Auth read.
  </behavior>
  <action>
Implement the ADMIN-07 server-side email resolution.

1. Add `email: string | null` to the `UserWithRole` interface (the block at L74-82), documented as the resolved Firebase Auth email, null when the user has no email (phone/anon) or was not found in Auth.

2. Import `adminAuth` from `@/src/firebase/admin` at the top of the file alongside the other imports (it is a server-only Admin SDK instance; this file is already `'use server'`).

3. Inside the existing `try` block of `listUsersWithRoles`, after `const snap = await usersRef().limit(200).get()` and BEFORE the `.map(...)` projection:
   - Build the uid list: `const uids = snap.docs.map((d) => d.id)`.
   - Chunk `uids` into batches of at most 100 (a small local loop or helper) because `adminAuth.getUsers` caps at 100 identifiers per call.
   - For each chunk call `adminAuth.getUsers(chunk.map((uid) => ({ uid })))` and accumulate the returned `users` records.
   - Build `const emailByUid = new Map<string, string | null>()` mapping each returned record's `.uid` to `.email ?? null`.
   - Wrap the getUsers resolution so a failure to resolve emails does NOT break the whole listing: on error, leave `emailByUid` empty so every row falls back to `email: null` (the listing must still return the rows). Keep the outer try/catch behavior intact.

4. In the `.map(...)` projection, add `email: emailByUid.get(doc.id) ?? null`. Keep `id`, `role`, `displayRef`, and `seniorCoachId` exactly as they are today.

PII rule (CLAUDE.md): do NOT console.log / log / audit any email. Do not touch the `audit.log` call or `assignRole`. Only the projected `email` string crosses to the client.
  </action>
  <verify>
    <automated>cd "$REPO" && npx tsc --noEmit 2>&1 | grep -v '^#' | grep -c "roles/actions" | grep -qx 0 && npx vitest run "app/[lang]/(admin)/roles/actions.test.ts" 2>&1 | tail -20</automated>
  </verify>
  <done>`UserWithRole` has `email: string | null`; `listUsersWithRoles` resolves emails via chunked `adminAuth.getUsers` and maps `email` onto every row (null fallback for missing/notFound); `tsc --noEmit` reports no errors in `roles/actions.ts`; existing `actions.test.ts` still passes; no email is logged/audited.</done>
</task>

<task type="auto">
  <name>Task 2: Render email (with uid fallback) as the Agent dropdown label</name>
  <files>app/[lang]/(admin)/roles/role-assignment.tsx</files>
  <action>
Change the Agent `<SelectItem>` label (L221-228) to display the email.

1. Replace the label span content so it renders the email when present and falls back to the truncated uid when not:
   - Render `{u.email ?? `${u.displayRef}…`}` as the primary label text.
   - Keep it readable: drop the `font-mono` class for the email branch (email is not a monospace ref). The simplest robust form is a single `<span className="text-xs">` containing `u.email ?? `${u.displayRef}…``. Monospace-vs-not is cosmetic; either is acceptable as long as a non-empty label always renders.
2. PRESERVE: `key={u.id}`, `value={u.id}` (the uid — required by `assignRole`), the `&nbsp;`, and the role `<Badge variant={roleBadgeVariant(u.role)} ...>{u.role}</Badge>` exactly as today.

No other regions of the file change. `UserWithRole` now carries `email` (from Task 1), so `u.email` type-checks.
  </action>
  <verify>
    <automated>cd "$REPO" && npx tsc --noEmit 2>&1 | grep -v '^#' | grep -c "role-assignment" | grep -qx 0 && grep -c "u.email" "app/[lang]/(admin)/roles/role-assignment.tsx" | grep -qx 1 && grep -c 'value={u.id}' "app/[lang]/(admin)/roles/role-assignment.tsx" | grep -qx 1</automated>
  </verify>
  <done>Dropdown label renders `u.email ?? `${u.displayRef}…``; `value={u.id}` and the role `<Badge>` are preserved; `tsc --noEmit` clean for `role-assignment.tsx`.</done>
</task>

</tasks>

<verification>
Run the project gate (match how prior quick tasks verified — see STATE last_activity):

```bash
cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent"
npx tsc --noEmit            # expect 0 errors
npx eslint app/[lang]/(admin)/roles/   # expect 0 errors
npx vitest run "app/[lang]/(admin)/roles/actions.test.ts"   # existing tests pass
npx next build              # expect success (routes unchanged)
```

Manual spot check (admin-only surface): load `/en/roles`, open the Agent dropdown in "Assign Role" — options show emails (e.g. `agent@example.com`) with the role badge; any user with no email shows the `XXXXXXXX…` uid fallback; selecting + assigning a role still works (assignRole receives the uid).

PII gate: `grep -rn "email" app/[lang]/(admin)/roles/` shows email only in data projection + label render — NOT in any `console.*`, `audit.log`, or logger call.
</verification>

<success_criteria>
- [ ] `UserWithRole.email: string | null` added; `listUsersWithRoles` resolves emails via chunked `adminAuth.getUsers` (≤100/call) and maps `email` (null fallback) onto every row.
- [ ] Agent dropdown label shows `u.email ?? `${u.displayRef}…``; `value={u.id}` and role `<Badge>` preserved.
- [ ] No email is logged, console'd, or audited; `audit.log` and `assignRole` untouched.
- [ ] `tsc --noEmit` clean; existing `actions.test.ts` passes; `next build` succeeds.
- [ ] No changes to schema, i18n, security rules, Firestore indexes, or `page.tsx`.
</success_criteria>

<output>
Create `.planning/quick/quick-kayinleong-011/SUMMARY.md` when done.

IMPORTANT — this repo's quick-task file conventions (match exactly):
- Plan file is `quick-kayinleong-011-PLAN.md` (id-prefixed).
- Summary file is `SUMMARY.md` — **plain, NOT id-prefixed**.
- Update `CLAIM.md` Verification section with a Regression Report (per global CLAUDE.md) before marking done.
- Append a row to the STATE.md quick-task table: `| quick-kayinleong-011 | Agent dropdown shows user email instead of truncated uid (admin roles) | 2026-06-15 | <commit> | [quick-kayinleong-011](./quick/quick-kayinleong-011/) |`.
- Commit with the owner-scoped prefix: `fix(quick-kayinleong-011): ...`.
</output>
