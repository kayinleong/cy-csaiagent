---
quick_id: quick-kayinleong-025
status: complete
date: 2026-06-16
---

# Summary — quick-kayinleong-025

The dashboard/console had **no logout button and no language switcher**. Added both to
the shared console sidebar footer, so every admin/coach surface (dashboard included) now
has them.

## What changed

- **`sign-out-button.tsx`** (new) — sidebar `LogOut` button. Two-step AUTH-05 teardown:
  `signOut(clientAuth)` (clears IndexedDB) + `DELETE /api/auth/session` (clears the
  httpOnly cookie) → redirect to `/[lang]/sign-in`. Client signOut failure is swallowed
  so the server cookie is still cleared.
- **`language-switcher.tsx`** (new) — sidebar `Languages` button → `DropdownMenu` of
  EN / Bahasa Melayu / 中文 (active one checked). Picking swaps the leading `/[lang]` URL
  segment and navigates; next-intl's proxy persists `NEXT_LOCALE`.
- **`app-sidebar.tsx`** — renders both in `<SidebarFooter>` above the existing
  "Signed in as {role}" line; they inherit icon-collapse + tooltip behavior.
- **i18n** — `nav.signOut` + `nav.language` added to en/ms/zh.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <3 files>` | 0 errors, 0 warnings |
| `vitest` i18n-parity + app-sidebar-nav | 14 passed |
| Dev server `/en/dashboard` | compiles, 307 → sign-in |

A transient `MISSING_MESSAGE: nav.language` appeared in the dev log *during* the edit
window (a live browser HMR re-render before the JSON keys were saved); the later compile
produced none, and the keys are confirmed present in all three catalogs. The
**authenticated** click-through (actually signing out / switching locale) couldn't be
exercised here — auth-gated; needs a real coach/admin session. Full regression report in
`CLAIM.md`.

## Commit

- `89d6eed` feat(quick-kayinleong-025): add logout + language switcher to the console sidebar

## Scope note

These live in the **console** sidebar (admin/coach). New agents use the separate chat
header — adding logout/locale there would be a separate follow-up.
