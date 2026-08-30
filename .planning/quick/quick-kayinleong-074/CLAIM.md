# Claim: quick-kayinleong-074
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: no way to sign out of the chat page — SignOutButton exists but is welded to the sidebar, which chat does not render

## What will change

User: "no sign out button in chat page".

Confirmed: `SignOutButton` is rendered in exactly one place, `app-sidebar.tsx:113`. The chat
surface is standalone — full-height, its own header, no sidebar — so an agent who signs in
and lands on /chat (the new-agent default) has no way out at all.

The component cannot simply be dropped into the header either: it returns
`<SidebarMenuItem><SidebarMenuButton>`, which requires the sidebar context.

Planned: extract the sign-out SEQUENCE into a shared hook and render it two ways. The
sequence — clear client auth, DELETE the server cookie, redirect — is security-relevant and
must not exist in two hand-maintained copies that can drift.

## What has changed

**`app/[lang]/_components/use-sign-out.ts`** — new hook holding the sequence, with the order
and the reasoning documented: clear client auth (failure swallowed), DELETE the server cookie
(failure swallowed — it is httpOnly and expires), then `push` + `refresh` so no RSC payload
for the signed-in view survives in the router cache. The Firebase SDK is still imported on
demand, so a surface that never signs out does not pay for auth + app in its bundle.

**`sign-out-button.tsx`** — same markup, now calling the hook. No behaviour change.

**`chat-header.tsx`** — an icon-only sign-out at the far right, after the coach pill.

Icon-only is a judgement call: that header already carries history, the pillar tabs, three
language chips and the coach pill, and has to survive a 375px phone. The meaning is carried
by `aria-label`, with `title` for a pointer tooltip. It reuses the existing `nav.signOut` key,
which is already translated in all three locales (EN "Sign out", BM "Log keluar",
中文 "退出登录") — no catalog change.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1118 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Clicked through in a real browser
Minted a session token, set it as `__session`, loaded `/en/chat` and drove it:

1. Page renders authenticated (200), sign-out icon visible at the far right of the header —
   `data-slot="sign-out-button"`, `aria-label="Sign out"`, positioned after
   `talk-to-coach-button` in the DOM.
2. Clicked it -> landed on the sign-in page.
3. Checked the result, rather than trusting the redirect:
   `document.cookie.includes('__session')` -> **false**, and `GET /en/chat` -> an opaque
   redirect (quick-073's gate turning it away).

So the session is genuinely ended, not just navigated away from.

### Regression surface
- **The sidebar button is unchanged** — same `SidebarMenuItem` / `SidebarMenuButton` markup,
  same disabled-while-pending behaviour; only the body of the handler moved.
- **The sequence exists once.** Copying it would have been the easy path and the wrong one:
  ending a privileged session is security-relevant, and two hand-maintained copies drift
  until one keeps signing people out halfway.
- No new i18n keys, so no untranslated string can reach a BM or 中文 agent.
- Header layout: the button is `shrink-0` in the existing flex row, alongside the coach pill.

## Honest gaps

1. **No automated test.** Both consumers are client components doing navigation and network
   calls in an event handler, and this area has no jsdom harness. Verified by driving a real
   browser instead, which is stronger evidence but not a regression guard.
2. **Icon-only has a discoverability cost.** An agent who does not recognise the glyph has
   to hover or use a screen reader. A label would not fit at 375px without dropping
   something else; if it proves confusing, the honest fix is an overflow menu, not a
   narrower coach pill.
3. **Only the chat header gained it.** Any other sidebar-less authenticated surface still
   has no sign-out — I did not audit for those.
