---
quick_id: quick-kayinleong-012
slug: audit-log-show-actor-email
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-012

/ en/audit-log now shows the staff member's **email** in the "Actor" column
instead of the raw Firebase UID, falling back to the UID when no email can be
resolved.

## What changed

- **`app/[lang]/(admin)/audit-log/actions.ts`**
  - `AuditLogRow` gained `actorEmail: string | null`.
  - `listAuditLogs` now batch-resolves de-duped staff `actorUid`s → emails via
    `adminAuth.getUsers([...])` (one call per ≤50-row page) and attaches
    `actorEmail`. Wrapped in its own try/catch so an Auth failure degrades to
    `actorEmail: null` (UID still rendered) rather than failing the listing.
    Resolution runs **after** the existing `role === 'admin'` gate and stays
    fully server-side.
- **`app/[lang]/(admin)/audit-log/audit-log-viewer.tsx`**
  - Actor cell renders `row.actorEmail ?? <UID in font-mono>`, with
    `title={row.actorUid}` for hover inspection of the raw UID.
- **`app/[lang]/(admin)/audit-log/actions.test.ts`**
  - Added `adminAuth.getUsers` mock + 2 new tests (batched resolution, graceful
    degradation). Existing 5 contract tests unchanged and green.

## Not changed (scope guard)

- Actor **filter** still filters on raw UID (D-12 hashes never decoded;
  `targetRef` untouched). Column header i18n unchanged.

## Verification

- `vitest run` (audit-log actions): **7/7 pass**.
- `tsc --noEmit`: clean (exit 0).
- `eslint` on the 3 changed files: clean (exit 0).
- Regression self-audit: see CLAIM.md § Verification.
