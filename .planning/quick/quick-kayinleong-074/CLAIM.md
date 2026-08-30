# Claim: quick-kayinleong-074
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
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

## Verification

_(pending)_
