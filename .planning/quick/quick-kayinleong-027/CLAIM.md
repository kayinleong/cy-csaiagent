# Claim: quick-kayinleong-027

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: done
- summary: Paginate every growable index/list/table surface in the console with one shared client-side control. The list reads are already bounded server-side and handed whole to the client, so a reusable usePagination hook + Paginator slices them at pilot scale — no per-action cursor refactor. The audit-log viewer (already cursor-paginated) is left as-is; fixed sets / Select pickers are not candidates.

## What will change

(See "What has changed".)

## What has changed

**Shared primitive (new): `app/[lang]/_components/paginator.tsx`**
- `usePagination<T>(items, pageSize = 10)` → `{ page, setPage, pageCount, pageItems, total }`.
  Slices an in-memory array; the effective page is clamped to `[1, pageCount]` each render
  so a shrinking list (e.g. a filter) never strands the user on an empty page.
- `<Paginator page pageCount onPageChange />` → compact "Prev · Page X of Y · Next" control
  built on the vendored `components/ui/pagination` + `Button`. Renders nothing when
  `pageCount <= 1`, so it can be dropped under any list unconditionally.
- i18n: new `pagination` namespace (`previous`, `next`, `pageOf`) in en/ms/zh.

**Applied to 13 list/table surfaces** (each: paginate the displayed array via `pageItems`,
drop a `<Paginator>` below; for filtered lists, reset to page 1 on filter change):
- `(admin)/users/user-list.tsx` — All-users directory
- `(coach)/agents/agent-list.tsx` — agent index
- `(coach)/_components/downline-table.tsx` — dashboard "your agents"
- `(coach)/_components/stall-inbox.tsx` — dashboard stall queue
- `(coach)/_components/knowledge-gap-feed.tsx` — dashboard gap feed
- `(coach)/_components/kb-doc-explorer.tsx` — dashboard KB browser (resets page on search)
- `(admin)/cohorts/cohort-management.tsx` — cohort table
- `(admin)/inventory/project-list.tsx` — project inventory
- `(admin)/kb/kb-doc-list.tsx` — KB document library (resets page on pillar/superseded filter)
- `(admin)/flags`→`(coach)/flags/flag-queue.tsx` — flag triage queue
- `(admin)/erasure/erasure-status-list.tsx` — erasure request ledger
- `(admin)/usage/usage-dashboard.tsx` — per-agent token table
- `(admin)/conversations/conversation-viewer.tsx` — search-results table (resets page on new search)

**Deliberately NOT changed (with reason):**
- `(admin)/audit-log/audit-log-viewer.tsx` — already paginated (server cursor "Load more");
  migrating it would be a regression risk for no gain.
- `(admin)/roles/role-assignment.tsx` — the capability matrix is a fixed 9-row constant; the
  user picker is a `Select` dropdown, not a growable table.
- `(admin)/coach-assignment/coach-reassign.tsx` — two `Select` pickers, not a table.

**Commit (on `main`):** `b6e3c5a` feat(quick-kayinleong-027): paginate all index/list/table surfaces.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <14 changed files>` → **0 errors** (pre-existing `_lang`/`_isAdmin`/`remainingMs`
  unused-var warnings only — none introduced here). One real error was caught + fixed mid-work:
  `usePagination` was initially placed after an early `return` in `user-list.tsx`
  (`react-hooks/rules-of-hooks`) — moved above the early return. Every other surface calls the
  hook unconditionally before any early return.
- `npx vitest run` on `i18n-parity` + `app-sidebar-nav` → **14 passed** (parity confirms the new
  `pagination` namespace exists in all three catalogs with no drift).
- **Dev server (`:3000`, Next 16 Turbopack):** all paginated routes compile and gate
  (unauthenticated → 307 → sign-in): `/en/users`, `/en/agents`, `/en/dashboard`, `/en/cohorts`,
  `/en/inventory`, `/en/kb`, `/en/flags`, `/en/erasure`, `/en/usage`, `/en/conversations`. No
  errors in the dev log after the final compiles (the only `Module not found` entries are stale,
  from a prior task hours earlier).

**Regression self-audit ("what existing feature could this break?"):**
- **Display-only slicing.** The change is purely presentational: each list still receives the
  same whole array; only the rendered slice changes. No data fetch, server action, gate, or
  row content was modified. Row-level actions (resolve/dismiss/edit/delete/publish, correction
  dialogs, deep links) operate on the row object passed to the map — unchanged, and still work
  on whichever page the row is on.
- **Hooks safety.** `usePagination` is a hook; it is called unconditionally before any early
  return in every surface (verified — the one violation was fixed). `pageCount`-clamping makes
  the slice resilient to the array shrinking after a mutation (resolve removes a stall; a filter
  narrows results) — no empty-page dead end.
- **Filtered lists.** `kb-doc-list` (pillar + superseded), `kb-doc-explorer` (title search), and
  `conversation-viewer` (new search) reset to page 1 when their inputs change, so users aren't
  left on a stale page. The clamp covers the residual cases.
- **Stateful lists.** `cohort-management` / `flag-queue` / `stall-inbox` paginate their live
  state arrays; CRUD/resolve updates the array and the clamp keeps the page valid.
- **No new dependency, no secrets, no PII.** Pure UI; uses already-vendored primitives.

**NOT verified here (honest gaps):**
- **Authenticated interaction** — clicking Prev/Next, page counts, and filter→page-1 resets —
  was **not exercised** (every console surface is auth-gated; needs a live admin/coach session).
  The control is a thin wrapper over vendored components and all surfaces compile + typecheck. A
  logged-in user should smoke-test a long list (e.g. `/users` or `/inventory`): page through,
  apply a filter and confirm it jumps to page 1, and confirm row actions still work mid-list.
- **Scope choice:** pagination is client-side over the existing bounded reads (appropriate at
  pilot scale ≤200). If a collection later outgrows its `limit(N)` server read, that read — not
  this control — is the thing to convert to a server cursor (the audit-log pattern).
