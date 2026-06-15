# quick-kayinleong-012 — Research

**Researched:** 2026-06-15
**Domain:** Audit-log admin viewer — resolve staff `actorUid` → email (Next.js 16 RSC + Firebase Admin SDK)
**Confidence:** HIGH

## Summary

The audit-log viewer renders the **raw staff/actor UID** in the "Actor" column. This `actorUid`
is a separate, **plaintext** field on each `auditLogs` doc — it is NOT part of the one-way sha256
`hashes` map and it is NOT a client/lead identifier. It identifies the authenticated **D2 staff
member** who performed the action (e.g. an admin doing `role-assign`). Resolving it to that staff
member's email is **PDPA-safe** and does not touch the hash/PII guarantees the audit log protects.

The `users/{uid}` Firestore doc carries **no email field** (`UserDoc` = role / lang / voiceSamples /
uplineCoachId only), and the sibling roles page (`listUsersWithRoles`) only produces a truncated
`displayRef` — neither is an email source. The single authoritative email source is **Firebase
Auth**, reachable server-side via the already-exported `adminAuth.getUsers([...])`.

**Primary recommendation:** In `audit-log/actions.ts › listAuditLogs`, after building the 50 rows,
collect the unique `actorUid`s, batch-resolve them with `adminAuth.getUsers(identifiers)` (one call,
≤100 uids per page), build a `uid → email` map, and attach `actorEmail` to each row. Render
`row.actorEmail ?? row.actorUid` in the viewer. All resolution stays server-side; the client never
gets an admin lookup. ~15 lines in `actions.ts`, ~2 lines in the viewer, plus one field on the type.

## Findings (focused Q&A)

### Q1 — Where exactly is the UID rendered?

- **File:** `app/[lang]/(admin)/audit-log/audit-log-viewer.tsx`
- **Line 195:** `<TableCell className="font-mono text-sm">{row.actorUid}</TableCell>` — the "Actor" column.
- The field comes from `AuditLogRow.actorUid` (type at `actions.ts:74`), projected in
  `actions.ts:173` (`actorUid: data.actorUid ?? ''`).
- The filter input at lines 137–145 also takes a raw `actorUid` string (`where('actorUid','==',…)`,
  `actions.ts:144–146`). **Out of scope for this task** — leave the filter on UID (admins paste a UID
  to filter; changing the filter to email is a separate, larger change requiring a reverse lookup).
  Only the **display** column changes. [VERIFIED: codebase read]

### Q2 — What identifier does the audit log store? Is it safe to show email?

**Safe — it is a staff/actor UID, not client PII.** [VERIFIED: codebase read]

The `auditLogs` doc shape (`AuditLogDoc`, `collections.ts:385–393`; writer `src/audit/log.ts:81–87`):

```
{ tenantId, actorUid, action, targetRef?, hashes: Record<string,string>, ts }
```

- `actorUid` — stored **as-is, plaintext** (`log.ts:82: actorUid: entry.actorUid`). It is the UID of
  the **authenticated user taking the action** (`AuditEntry.actorUid` doc comment, `log.ts:28`). For
  every existing audit action (`role-assign`, `coach-assign`, `cohort-*`, `model_config_publish`,
  `coach_drilldown`, `chat`) the actor is an internal D2 staff/agent account — never a lead.
- `hashes` — the one-way sha256 map of PII-bearing raw values (`log.ts:78 hashAll`). This is what
  CLAUDE.md's *"audit log stores hashes only"* refers to: the **PII payload** is hash-only. The
  `actorUid` and `action`/`targetRef` metadata columns are intentionally plaintext so the admin
  viewer can show *who did what* (D-12: "metadata-only … hashes NEVER decoded").
- The viewer **never** surfaces `hashes` (`actions.ts:162` projects them out). This fix does not change that.

**PDPA boundary:** `src/audit/pdpa.ts` pseudonymizes **lead** PII (names/phones/IC/email/RM) at the
*model* boundary. A staff member's own corporate email displayed to an **admin** on an admin-gated
surface is **not** lead PII and is **not** a cross-border model call. Showing it is consistent with
the existing roles/coach-assignment admin surfaces that already operate on staff identity.
**Guardrail:** resolve **only** `actorUid` (staff). Never resolve any value out of `hashes`, and never
resolve a lead/`leadId`/`targetRef` — those can be client PII and must stay as-is.

### Q3 — How to resolve UID → email? Which mechanism, used where?

| Mechanism | Has email? | Already used in repo | Verdict |
|-----------|-----------|----------------------|---------|
| `adminAuth.getUsers([{uid}])` / `getUser(uid)` | **Yes** (`UserRecord.email`) | `adminAuth` exported `admin.ts:86`; used in `auth.ts` (`verifyIdToken`, `setCustomUserClaims`) | **USE THIS** |
| `users/{uid}` Firestore doc (`listUsersWithRoles`) | **No** — `UserDoc` has no email (`collections.ts:63–75`) | roles + coach-assignment pages | Not viable (no email field) |
| Custom claims (`role`,`tenantId`) | No email | `auth.ts:172` | Not viable |

- `adminAuth.getUsers(identifiers: UserIdentifier[])` exists and is **batch** (≤100 uids/call —
  Firebase Admin SDK limit). [VERIFIED: node_modules/firebase-admin/lib/auth/base-auth.d.ts:198]
- Returns `{ users: UserRecord[], notFound: UserIdentifier[] }` — `notFound` cleanly handles deleted
  accounts (fall back to UID for those).
- **Consistency note for sibling task 011:** the roles page also lacks email today (it shows
  `displayRef`). The same `adminAuth.getUsers` batch pattern should be the shared approach for both
  tasks. Consider extracting a tiny `resolveUidEmails(uids: string[]): Promise<Map<string,string>>`
  helper (e.g. in `src/firebase/auth.ts` or a new `src/firebase/users.ts`) so 011 and 012 reuse one
  implementation. For THIS minimal task, an inline implementation in `audit-log/actions.ts` is
  acceptable; flag the helper extraction to whoever picks up 011. [VERIFIED: codebase read]

### Q4 — Where should resolution happen?

**Server-side, inside `listAuditLogs` (`audit-log/actions.ts`), batch-resolving before returning rows.**
[recommended]

Rationale: the action is already admin-gated (verified-token `role === 'admin'`, `actions.ts:124`)
and already uses the Admin SDK (`adminDb`). Adding `adminAuth.getUsers` here keeps the admin lookup
fully server-side — the client island receives only `{ …, actorEmail }` strings, never an admin
capability. The RSC page (`page.tsx`) calls the same action, so first paint and "Load more" /
filtered fetches all get emails for free with no client change beyond rendering. Do **not** expose a
separate client-callable email-lookup action (that would leak an enumeration capability to the
browser).

### Recommended minimal change (ONE approach)

1. **`audit-log/actions.ts`**
   - Add `actorEmail: string | null` to `interface AuditLogRow` (line ~74).
   - After `const rows = snapshot.docs.map(...)` (line ~178), before `return`:
     ```ts
     // Resolve staff actor UIDs → emails (admin-gated, server-side, batched).
     // SAFE: actorUid is a staff/actor UID, never a lead/PII value. Never resolve hashes/targetRef.
     const uids = [...new Set(rows.map((r) => r.actorUid).filter(Boolean))]
     const emailByUid = new Map<string, string>()
     if (uids.length) {
       const { adminAuth } = await import('@/src/firebase/admin') // inline import — same idiom as adminDb (actions.ts:131)
       // getUsers caps at 100 identifiers; a page is ≤50 rows, so one call suffices.
       const { users } = await adminAuth.getUsers(uids.map((uid) => ({ uid })))
       for (const u of users) if (u.email) emailByUid.set(u.uid, u.email)
     }
     for (const r of rows) r.actorEmail = emailByUid.get(r.actorUid) ?? null
     ```
   - Keep the `try/catch` so an Auth failure degrades to `actorEmail: null` (still shows UID), never crashes.
2. **`audit-log/audit-log-viewer.tsx` line 195**
   - `{row.actorEmail ?? row.actorUid}` (keep `font-mono` if you want; or switch to non-mono for the
     email — minor). Optionally `title={row.actorUid}` so the raw UID is still inspectable on hover.
3. **Filter (lines 137–146): leave as-is** — still filters on raw `actorUid`. Out of scope.

## Common Pitfalls

- **Per-row N+1 lookups.** Do NOT call `getUser(uid)` inside `rows.map`. Use **one** batched
  `getUsers([...])` over the de-duped UID set. A page is ≤50 rows → 1 call. (If "Load more" ever
  unions >100 uids client-side, that's fine — each server fetch is its own ≤50-row page.)
- **Deleted / unknown users.** `getUsers` returns `notFound` and simply omits missing uids from
  `users`; the `?? null` → `?? row.actorUid` fallback shows the UID. No crash, no blank cell. Also
  guard `if (u.email)` — a UID can exist with no email (rare, e.g. phone-only — not expected here).
- **Don't break the PDPA/hash guarantee.** Resolve **only** `actorUid`. Never feed `hashes` values or
  `targetRef` (which can be `users/{uid}` or a lead path) into `getUsers`. The hashes projection-out
  at `actions.ts:162` must stay.
- **Next.js 16 async APIs.** `cookies()` is already correctly awaited in `getSessionUser`
  (`actions.ts:37`). No new `cookies()`/`headers()` calls needed — don't add any.
- **Admin-SDK boundary.** `adminAuth.getUsers` bypasses Firestore rules; that's acceptable **only**
  because the action already enforces `role === 'admin'` from the verified token *before* this code
  runs. Keep the lookup *after* the gate (it already is). Never expose this to a client-callable path.
- **Empty `actorUid`.** `actions.ts:173` defaults missing actorUid to `''`; the `.filter(Boolean)`
  drops it from the lookup set so `getUsers` is never asked for an empty uid.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `firebase-admin` Auth (`adminAuth.getUsers`) | UID→email resolution | ✓ | already a dep; `adminAuth` exported `src/firebase/admin.ts:86` | none needed |

No new packages. No new env/secrets. [VERIFIED: codebase read]

## Regression Surface (for the eventual CLAIM.md verification)

- `listAuditLogs` is also consumed by `audit-log/page.tsx` (initial rows) and by the viewer's
  `applyFilters`/`loadMore`. Adding a field + server lookup is additive — existing callers ignore the
  new `actorEmail` unless they read it. Verify: page still renders, filter still works (filters on UID),
  "Load more" still appends.
- `AuditLogRow` has an index signature (`[key: string]: unknown`, `actions.ts:80`) and a Wave-0
  contract test inspects rows as a property bag — adding `actorEmail` is compatible; check
  `audit-log` tests if any assert the exact row key set.
- No change to `src/audit/log.ts` (writer) or the doc shape — purely a read-time projection.

## Sources

### Primary (HIGH confidence)
- Codebase reads: `audit-log/{page,actions,audit-log-viewer}.tsx`, `src/audit/{log,index,pdpa}.ts`,
  `src/firebase/{admin,auth,collections}.ts`, `roles/actions.ts`, `quick-011/CLAIM.md`.
- `node_modules/firebase-admin/lib/auth/base-auth.d.ts:141,198` — `getUser` / `getUsers` signatures.

## Metadata

**Confidence breakdown:**
- Where UID renders: HIGH — exact line read.
- Safe to show email: HIGH — `actorUid` is plaintext staff UID separate from `hashes`; doc shape confirmed.
- Resolution mechanism: HIGH — `adminAuth.getUsers` confirmed in firebase-admin .d.ts; `adminAuth` already exported.
- No email in Firestore: HIGH — `UserDoc` fields enumerated in `collections.ts:63–75`.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable; depends only on firebase-admin Auth API + local doc shapes)
