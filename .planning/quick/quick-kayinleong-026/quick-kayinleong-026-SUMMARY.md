---
quick_id: quick-kayinleong-026
status: complete
date: 2026-06-16
---

# Summary — quick-kayinleong-026

Two requests: show email instead of UID in the dashboard's "your agents" list, and add a
page that lists all users.

## What changed

**1) Dashboard downline ("your agents") — `/[lang]/dashboard`:**
- `dashboard/page.tsx` resolves each downline agent's email server-side via
  `adminAuth.getUsers` (chunked, fail-soft → UID fallback; same pattern as the /agents
  index). Added `email` to `agentRows`.
- `downline-table.tsx` `AgentRow` gains `email`; the Agent cell renders `email ?? "{uid8}…"`.
  (`MetricsPanel` shares these rows but reads other fields — the extra field is inert.)

**2) All-users directory — `/[lang]/users`:**
- The page (previously just "Add User") now fetches `listUsersWithRoles` and renders a new
  read-only **All users** table (Email · Role · Senior coach) above the add-user form. The
  senior-coach column resolves the coach's email from the same roster; "—" when none.
- New `user-list.tsx` client island. Page + nav retitled "Add user" → **Users**.
- i18n: retitled `adminUsers` + 6 new keys (listTitle/addTitle/colEmail/colRole/colCoach/
  emptyList) across en/ms/zh.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <4 files>` | 0 errors, 0 warnings |
| `vitest` i18n-parity + app-sidebar-nav | 14 passed |
| Dev server `/en/dashboard`, `/en/users` | compile, 307 → sign-in |

Two transient dev errors (a `MISSING_MESSAGE` mid-edit and a `Module not found: './user-list'`
logged before that file was created) cleared on the final compile — confirmed by tsc + a
clean post-compile log. Email is resolved server-side, rendered in-UI only, never logged.
The **authenticated** rendering couldn't be exercised here (auth-gated) — a logged-in
admin/coach should smoke-test. Full regression report in `CLAIM.md`.

## Commit

- `5d49c49` feat(quick-kayinleong-026): dashboard downline shows email; /users becomes a user directory

## Scope note

The dashboard stall-inbox still shows the agent UID (the request was the "your agents"
list specifically) — a possible follow-up.
