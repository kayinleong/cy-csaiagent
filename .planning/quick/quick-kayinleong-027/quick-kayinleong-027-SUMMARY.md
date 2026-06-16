---
quick_id: quick-kayinleong-027
status: complete
date: 2026-06-16
---

# Summary — quick-kayinleong-027

Paginate every growable index/list/table surface in the console with one shared
client-side control. The list reads are already bounded server-side and handed whole to
the client, so slicing client-side at pilot scale gives consistent pagination everywhere
without a per-action cursor refactor.

## What changed

**New: `app/[lang]/_components/paginator.tsx`**
- `usePagination(items, pageSize = 10)` — slices an array; clamps the page to a valid
  range so a shrinking list never strands the user.
- `<Paginator>` — compact "Prev · Page X of Y · Next" built on the vendored
  `components/ui/pagination`; renders nothing for a single page.
- New `pagination` i18n namespace (previous/next/pageOf) in en/ms/zh.

**Applied to 13 surfaces:** users directory, agent index, dashboard downline /
stall-inbox / knowledge-gap-feed / kb-explorer, cohorts, inventory projects, KB docs,
flag queue, erasure ledger, usage per-agent table, conversation results. Filtered lists
(KB docs, KB explorer, conversations) reset to page 1 on filter/search change.

**Left as-is:** audit-log (already cursor-paginated), the roles capability matrix + the
role/coach `Select` pickers (fixed sets / not tables).

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <14 files>` | 0 errors (pre-existing unused-var warnings only) |
| `vitest` i18n-parity + app-sidebar-nav | 14 passed |
| Dev server (10 routes) | all compile, 307 → sign-in, no post-compile errors |

One real lint error was caught + fixed: a `usePagination` call placed after an early
return in `user-list.tsx` (hooks rule) — moved above it. The change is display-only
slicing (no data/gate/action change); row actions still work mid-list. The
**authenticated** click-through (paging, filter→page-1) couldn't be exercised here
(auth-gated) — a logged-in user should smoke-test a long list. Full regression report in
`CLAIM.md`.

## Commit

- `b6e3c5a` feat(quick-kayinleong-027): paginate all index/list/table surfaces

## Scope note

Pagination is client-side over the existing bounded reads (right at pilot scale ≤200). If
a collection later outgrows its `limit(N)` read, convert that server read to a cursor
(the audit-log pattern) — not this control.
