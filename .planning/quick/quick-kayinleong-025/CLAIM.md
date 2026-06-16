# Claim: quick-kayinleong-025

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: done
- summary: The dashboard/console had no logout button and no language switcher. Added both to the console sidebar footer (shared by every admin/coach surface) so an authenticated user can sign out and switch between EN / BM / 中文.

## What will change

(See "What has changed".)

## What has changed

The console chrome is the shared `AppSidebar` (rendered by `ConsoleShell` on every
admin/coach surface, including `/dashboard`). Its footer previously held only a
"Signed in as {role}" line — no sign-out, no locale control. Added both there.

**New components (`app/[lang]/_components/`):**
- `sign-out-button.tsx` — a `SidebarMenuButton` (LogOut icon) that signs out of BOTH
  halves of the session (AUTH-05 defense-in-depth): `signOut(clientAuth)` clears the
  Firebase web-SDK LOCAL persistence (IndexedDB), then `DELETE /api/auth/session`
  clears the httpOnly server cookie, then `router.push('/${lang}/sign-in')` +
  `router.refresh()`. The client signOut failure is swallowed so the server cookie is
  still cleared (fail-safe). Never logs the token/cookie.
- `language-switcher.tsx` — a `SidebarMenuButton` (Languages icon) opening a
  `DropdownMenu` of the three locales (endonyms: English / Bahasa Melayu / 中文, with a
  check on the active one). Selecting swaps the leading `/[lang]` segment of the current
  `usePathname()` and `router.push`es; next-intl's proxy middleware persists the
  `NEXT_LOCALE` cookie on the resulting request (so the manual cookie write — which the
  React-Compiler lint rejected anyway — was unnecessary).

**Wiring (`app/[lang]/_components/app-sidebar.tsx`):**
- Imported both and rendered them in `<SidebarFooter>` inside a `<SidebarMenu>`, above
  the existing "Signed in as {role}" line. They inherit the sidebar's icon-collapse +
  tooltip behavior like the nav items.

**i18n (`src/i18n/messages/{en,ms,zh}.json`):**
- Added `nav.signOut` (Sign out / Log keluar / 退出登录) and `nav.language`
  (Language / Bahasa / 语言) to all three catalogs.

**Commit (on `main`):** `89d6eed` feat(quick-kayinleong-025): add logout + language switcher to the console sidebar.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <3 changed files>` → **0 errors, 0 warnings** (the first pass flagged a
  `document.cookie` write under `react-hooks/immutability`; removed it — next-intl sets
  the cookie on navigation, so the write was redundant).
- `npx vitest run` on `i18n-parity` + `app-sidebar-nav` → **14 passed**. Parity confirms
  `nav.signOut` + `nav.language` exist in all three catalogs with no drift.
- **Dev server (`:3000`, Next 16 Turbopack):** `/en/dashboard` compiles and the gate
  fires (unauthenticated → 307 → /en/sign-in). A transient `MISSING_MESSAGE: nav.language`
  appeared in the dev log at 00:20:56 — that was an HMR re-render of a live browser
  session during the edit window (components referenced the keys before the JSON was
  saved). The subsequent compile at 00:21:58 (after the keys were added) produced **no**
  further missing-message errors; the keys are confirmed present in all three files.

**Regression self-audit ("what existing feature could this break?"):**
- **Net-additive UI.** Two new components consumed only by the sidebar footer. The
  footer change replaced one static div with a `SidebarMenu` + the two controls + the
  retained "Signed in as" line. No nav model change — `app-sidebar-nav.test.ts` still
  passes (it tests `buildSections`/`visibleSectionsForRole`, untouched).
- **Scope of appearance.** The sidebar is shared, so logout + language switcher now show
  on *every* console surface (dashboard, KB, roles, etc.), not just `/dashboard` — the
  intended outcome. The chat surface (new-agent) uses its own header and is unchanged
  (a logout there would be a separate follow-up).
- **Sign-out correctness.** Uses the existing, documented two-step teardown
  (`signOut(clientAuth)` + `DELETE /api/auth/session`, both already implemented). The
  DELETE handler exists and clears `__session`. No auth/session code was modified.
- **Locale switch correctness.** Swaps only the leading locale segment of the current
  path (guarded: replaces it only when it is a known locale, else inserts), then
  navigates. No route or i18n routing config changed.
- **Secrets/PII.** No token/cookie/PII logged. No secret introduced.

**NOT verified here (honest gaps):**
- The **authenticated** interactions — actually clicking Sign out (and landing on
  sign-in fully logged out) and opening the language dropdown to switch locale — were
  **not exercised**, since the console is auth-gated and needs a real coach/admin
  session. The flows reuse in-repo patterns (the sign-in form's `signOut`/session
  calls; the vendored DropdownMenu + sidebar). A logged-in user should smoke-test:
  open `/en/dashboard`, switch to BM/中文 (URL + copy change, choice persists on
  reload), then Sign out (redirects to sign-in; back-button does not re-enter).
