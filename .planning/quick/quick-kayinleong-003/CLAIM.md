# Claim: quick-kayinleong-003

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-04
- status: claimed
- summary: Fix runtime error "`Tooltip` must be used within `TooltipProvider`" thrown by `SidebarMenuButton` when the coach/admin console mounts — wrap `ConsoleShell` in `TooltipProvider`.

## What will change

`app/[lang]/_components/console-shell.tsx` — import `TooltipProvider` from `@/components/ui/tooltip` and wrap the `SidebarProvider` subtree. This is the minimal fix: the vendored shadcn `SidebarMenuButton` (`components/ui/sidebar.tsx:528`) renders a `<Tooltip>` for the collapsed/icon-mode label, but the vendored `SidebarProvider` does not include a `TooltipProvider`. Adding one inside `ConsoleShell` scopes the provider to exactly the surfaces that need it (dashboard / KB / inventory consoles) without polluting the chat surface or root layout.

No behavior change beyond fixing the throw. No new props, no API change.

## What has changed

(pending)

## Verification

(pending)
