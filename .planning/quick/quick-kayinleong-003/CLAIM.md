# Claim: quick-kayinleong-003

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-04
- status: done
- summary: Fix runtime error "`Tooltip` must be used within `TooltipProvider`" thrown by `SidebarMenuButton` when the coach/admin console mounts — wrap `ConsoleShell` in `TooltipProvider`.

## What will change

`app/[lang]/_components/console-shell.tsx` — import `TooltipProvider` from `@/components/ui/tooltip` and wrap the `SidebarProvider` subtree. This is the minimal fix: the vendored shadcn `SidebarMenuButton` (`components/ui/sidebar.tsx:528`) renders a `<Tooltip>` for the collapsed/icon-mode label, but the vendored `SidebarProvider` does not include a `TooltipProvider`. Adding one inside `ConsoleShell` scopes the provider to exactly the surfaces that need it (dashboard / KB / inventory consoles) without polluting the chat surface or root layout.

No behavior change beyond fixing the throw. No new props, no API change.

## What has changed

- `app/[lang]/_components/console-shell.tsx` — added `import { TooltipProvider } from '@/components/ui/tooltip'` and wrapped the `SidebarProvider` subtree in `<TooltipProvider>`. No other changes.

## Verification

**Reproduction:** signing in as a senior-coach (or admin) routed to `/[lang]/dashboard` → `CoachLayout` → `ConsoleShell` → `AppSidebar` → `SidebarMenuButton` (vendored shadcn `components/ui/sidebar.tsx:528`) renders a `<Tooltip>` for the icon-mode label. Radix `Tooltip.Root` requires an ancestor `Tooltip.Provider` and throws `"Tooltip must be used within TooltipProvider"` when none is found. Stack trace in the runtime error confirms the chain: `CoachLayout → ConsoleShell → AppSidebar.map → SidebarMenuButton → Tooltip`.

**Root cause:** vendored `SidebarProvider` does not include a `TooltipProvider` (older shadcn variant). Wrapping inside `ConsoleShell` scopes the fix to the exact surfaces affected (dashboard / KB / inventory consoles); the chat surface and root layout are untouched.

**Gates:**
- `npx tsc --noEmit` → exit 0 (clean).
- `npx eslint app/[lang]/_components/console-shell.tsx` → 0 errors / 0 warnings.
- `npx vitest run` → 455 passed / 97 skipped / 0 failed — identical to pre-change baseline (quick-002 close).

**Regression surface — ruled out:**
- `TooltipProvider` is a Radix `Provider` only; it injects context, no DOM, no styling, no event handlers. No layout shift, no interactivity change.
- Scope is `ConsoleShell` only → cannot affect chat (`(chat)` route group, no ConsoleShell), `/kb` admin tree (already wrapped via the `(admin)` ConsoleShell, same provider), sign-in, or any test harness.
- No other component in the repo relies on the absence of a `TooltipProvider` (Radix `Tooltip.Provider` is additive; nested providers are safe).
- Existing Tooltip consumers in the codebase already work because they either run outside ConsoleShell or were never previously rendered together with `SidebarMenuButton`. No double-provider risk: this is the first one in the console subtree.
- Core/shell rule intact: no `src/ → app/` imports introduced.

**NOT verified (stated honestly):** I did not exercise the live browser flow (no Firebase creds in this shell). User should sign in as senior-coach and admin, land on the dashboard, hover a collapsed-mode sidebar item to confirm the tooltip renders without throwing, and re-run the quick-002 verification checklist (KB explorer correction, stall-alert "View chat") which is now unblocked. NOT pushed (standing user hold).
