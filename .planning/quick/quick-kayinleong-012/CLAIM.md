# Claim: quick-kayinleong-012

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: The audit log page (/en/audit-log) shows raw Firebase user IDs instead of user emails. Show user email instead.

## What will change

Resolve the staff `actorUid` → email server-side inside the admin-gated
`listAuditLogs` Server Action (Admin SDK `adminAuth.getUsers`, batched) and
render the email (UID fallback) in the audit-log viewer's Actor column.

## What has changed

- `app/[lang]/(admin)/audit-log/actions.ts`
  - Added `actorEmail: string | null` to `AuditLogRow`.
  - `listAuditLogs` batch-resolves de-duped `actorUid`s → emails via
    `adminAuth.getUsers([...])` (one call per ≤50-row page), in its own
    try/catch so an Auth failure degrades to `actorEmail: null` (UID still
    shown) without failing the listing. Runs after the `role === 'admin'` gate;
    fully server-side.
  - Updated the METADATA-ONLY header doc comment to include `actorEmail`.
- `app/[lang]/(admin)/audit-log/audit-log-viewer.tsx`
  - Actor cell renders `row.actorEmail ?? <UID font-mono>`, `title={actorUid}`.
- `app/[lang]/(admin)/audit-log/actions.test.ts`
  - Added `adminAuth.getUsers` mock + 2 tests (batched resolution, graceful
    degradation).

## Verification

### Tests run
- `npx vitest run "app/[lang]/(admin)/audit-log/actions.test.ts"` → **7/7 pass**
  (5 pre-existing contract tests + 2 new).
- `npx tsc --noEmit` → **clean (exit 0)**.
- `npx eslint` on the 3 changed files → **clean (exit 0)**.

### Regression surface examined
- **`listAuditLogs` callers** — `page.tsx` (initial RSC render) and the viewer's
  `applyFilters`/`loadMore`. Change is additive (one new field + a post-projection
  lookup); all callers get `actorEmail` for free. Filter still filters on raw
  `actorUid`; "Load more" still appends. No behavioral break.
- **`AuditLogRow` made `actorEmail` required** — only other consumer is
  `page.tsx` (`AuditLogRow[] = []`, no object construction). `tsc` clean confirms
  no type breakage anywhere.
- **D-12 / PDPA (hashes-only)** — `hashes` still never decoded or surfaced
  (projection-out unchanged). Only the plaintext **staff** `actorUid` is resolved;
  `hashes`/`targetRef`/lead IDs are never passed to `getUsers`. Resolving a staff
  email for an admin on an admin-gated surface is staff identity, not lead PII.
- **D-13 admin gate** — resolution runs *after* the verified-token
  `role === 'admin'` check; the Admin SDK lookup stays server-side and is never
  exposed to a client-callable path.
- **N+1 / batching** — single `getUsers` over the de-duped UID set per page
  (≤50 rows ≪ 100-id cap); asserted by the new test.
- **Failure modes** — deleted/unknown UID → `notFound` → `?? null` → UID renders;
  Auth outage → inner try/catch → `actorEmail: null` → UID renders, listing still
  `ok:true` (asserted by the new degradation test).
- **Next.js 16** — no new `cookies()`/`headers()` calls; existing async `cookies()`
  in `getSessionUser` untouched.

### Ruled out
- No change to `src/audit/log.ts` (writer) or the `auditLogs` doc shape —
  purely a read-time projection.
- No i18n catalog edits (column header copy unchanged → no EN/BM/中文 drift).
