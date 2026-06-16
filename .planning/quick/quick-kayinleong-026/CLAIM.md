# Claim: quick-kayinleong-026

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: done
- summary: On /[lang]/dashboard show the agent's email instead of the raw UID in the downline ("your agents") table; and turn /[lang]/users into a full user directory — a read-only "All users" table (email + role + senior coach) above the existing add-user form. Email is resolved server-side (adminAuth.getUsers / listUsersWithRoles), truncated-UID fallback, never logged.

## What will change

(See "What has changed".)

## What has changed

**1) Dashboard "your agents" (downline) email — `/[lang]/dashboard`:**
- `dashboard/page.tsx`: after `getDownline`, resolve each downline agent's email via
  `adminAuth.getUsers` (chunked at 100, fail-soft → fallback to UID; same pattern as the
  /agents index in quick-024). Added `email` to the serialized `agentRows`.
- `_components/downline-table.tsx`: `AgentRow` gains `email: string | null`; the Agent
  cell renders `email ?? "{uid8}…"`. (`agentRows` is also passed to `MetricsPanel`, which
  only reads velocity/ramp fields — the extra `email` field is inert there.)

**2) All-users directory — `/[lang]/users`:**
- `users/page.tsx`: now also fetches `listUsersWithRoles` (admin-gated; resolves emails
  Auth-side) and renders a new `UserList` section above the existing `AddUserForm`. The
  page is retitled "Users" (was "Add User"); the form moves under an "Add a user"
  subheading. Container widened to `max-w-4xl` for the table.
- `users/user-list.tsx` (new): read-only client island — a table of every user
  (Email · Role · Senior coach). Email falls back to a truncated UID; the senior-coach
  column resolves the coach's email from the same roster (no extra read) and shows "—"
  when none. No mutations here — role changes stay on /roles, coach moves on
  /coach-assignment.
- Nav: `nav.users` label changed "Add user" → "Users" (the route/key are unchanged, so
  the sidebar entry just reads "Users" now).

**i18n:** retitled `adminUsers.pageTitle`/`pageSubtitle` and added `listTitle`, `addTitle`,
`colEmail`, `colRole`, `colCoach`, `emptyList` to **all three** catalogs (en/ms/zh). The
dashboard change reused existing `dashboard.colAgent` (display-only) — no new key needed.

**Commit (on `main`):** `5d49c49` feat(quick-kayinleong-026): dashboard downline shows email; /users becomes a user directory.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <4 changed files>` → **0 errors, 0 warnings**.
- `npx vitest run` on `i18n-parity` + `app-sidebar-nav` → **14 passed** (parity confirms
  the 6 new `adminUsers` keys exist in all three catalogs; the nav test is label-agnostic,
  so the "Add user"→"Users" rename does not affect it — the `users` key + admin-only role
  are unchanged).
- **Dev server (`:3000`, Next 16 Turbopack):** `/en/dashboard` and `/en/users` both
  compile and the gates fire (unauthenticated → 307 → /en/sign-in). Two transient dev
  errors appeared *during the edit window* and cleared on the final compile (00:31:04–06,
  with **no** errors after): a `MISSING_MESSAGE` while keys were mid-edit, and a
  `Module not found: './user-list'` logged before `user-list.tsx` was created (page.tsx
  referenced it first). Both are HMR ordering artifacts, not code defects — confirmed by
  tsc (resolves the import) + the clean post-compile log.

**Regression self-audit ("what existing feature could this break?"):**
- **Dashboard.** Net-additive `email` on `AgentRow`; the only visible change is the Agent
  cell (email vs UID) in the downline table. `MetricsPanel` consumes the same rows but
  reads other fields — unaffected. The `adminAuth.getUsers` call is fail-soft (caught →
  UID fallback), so a resolution outage degrades gracefully rather than breaking the
  dashboard. No gate/query change. (The stall-inbox still shows the agent UID — left as a
  possible follow-up; the request was specifically the "your agents" list.)
- **/users.** The add-user flow is untouched (same `AddUserForm`); the page just gained a
  read-only list above it and a retitle. `UserList` is a pure presentational island with
  no mutations, so it cannot affect role/coach state. The nav rename is label-only.
- **PII / secrets.** Emails are resolved **server-side** (Auth, via `adminAuth.getUsers` /
  `listUsersWithRoles`) and rendered in the admin/coach UI only — never logged, never in
  an audit `raw` map. The dashboard shows downline-agent emails to a coach (same posture
  as the /agents index in quick-024 — within the coach's existing downline scope). No
  secret introduced.

**NOT verified here (honest gaps):**
- The **authenticated** rendering — a coach/admin actually seeing emails in the downline
  table and the full /users directory — was **not exercised** (auth-gated; needs a live
  session + Admin SDK creds). The dashboard resolution reuses the proven quick-024 pattern
  and the /users list reuses `listUsersWithRoles` (already powering /roles +
  /coach-assignment). A logged-in user should smoke-test: open `/en/dashboard` (downline
  rows show emails) and `/en/users` (the All-users table lists everyone with role + coach,
  and Add a user still works).
