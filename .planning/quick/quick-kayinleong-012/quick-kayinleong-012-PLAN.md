---
quick_id: quick-kayinleong-012
slug: audit-log-show-actor-email
status: complete
date: 2026-06-15
---

# Quick Task quick-kayinleong-012 — Show actor email in /en/audit-log

## Problem

The audit-log admin viewer (`/en/audit-log`) renders the raw Firebase staff
UID in the "Actor" column (`audit-log-viewer.tsx:195` → `row.actorUid`). Admins
want to see the staff member's email instead.

## Approach (from RESEARCH.md — HIGH confidence)

Resolve `actorUid → email` **server-side**, inside the already-admin-gated
`listAuditLogs` Server Action, via the Admin SDK `adminAuth.getUsers([...])`
(batched, one call per ≤50-row page). The client island receives `actorEmail`
strings only — never an admin lookup capability.

**PDPA safety:** `actorUid` is a plaintext *staff/actor* UID, stored separate
from the one-way sha256 `hashes` map (which is never decoded). Resolving it to a
staff email is not lead PII and does not breach D-12. Only `actorUid` is
resolved — never `hashes` or `targetRef`.

## Tasks

1. **`audit-log/actions.ts`**
   - Add `actorEmail: string | null` to `AuditLogRow`.
   - Destructure `adminAuth` from the existing inline `@/src/firebase/admin` import.
   - After projecting rows, batch-resolve de-duped `actorUid`s → emails and
     attach `actorEmail`. Own try/catch → degrades to `null` (UID still shows)
     on Auth failure; never fails the listing.
2. **`audit-log/audit-log-viewer.tsx`**
   - Render `row.actorEmail ?? <span className="font-mono">{row.actorUid}</span>`,
     with `title={row.actorUid}` so the raw UID stays inspectable on hover.
3. **`audit-log/actions.test.ts`**
   - Mock `adminAuth.getUsers`; add tests for batched resolution + graceful
     degradation; existing 5 contract tests stay green.

## Out of scope

- The actor **filter** input still filters on raw UID (email→UID reverse lookup
  is a larger change).
- Column header copy unchanged (no i18n catalog edits).
- Sibling task **quick-kayinleong-011** (`/en/roles` dropdown, same UID→email
  problem) — flagged for a shared `resolveUidEmails` helper when picked up.

## Verify

- `npx vitest run app/[lang]/(admin)/audit-log/actions.test.ts` → green
- `npx tsc --noEmit` → clean
- `npx eslint` on the 3 changed files → clean
