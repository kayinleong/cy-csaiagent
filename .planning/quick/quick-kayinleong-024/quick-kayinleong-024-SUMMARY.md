---
quick_id: quick-kayinleong-024
status: complete
date: 2026-06-16
---

# Summary — quick-kayinleong-024

Show user **email instead of raw UID** on three admin/coach surfaces, and add an
email-lookup dropdown to erasure. Email lives only in Firebase Auth (the `users`/
`agentProfiles` docs carry none), so it is resolved server-side and falls back to a
truncated UID when a user has none.

## What changed

- **`/[lang]/agents`** — `page.tsx` resolves each downline agent's email via
  `adminAuth.getUsers` (chunked, fail-soft; mirrors `roles/actions.ts`). `agent-list.tsx`
  renders `email ?? "{uid8}…"`; the `/agents/[uid]` deep-link is unchanged. (Resolved
  inline rather than via the admin-only `listUsersWithRoles`, since this page is also
  coach-accessible.)
- **`/[lang]/coach-assignment`** — option rows now carry `email` (already resolved by
  `listUsersWithRoles`); `coach-reassign.tsx` shows `email ?? "{ref}…"` in both pickers
  and the confirm dialog. SelectItem values stay UIDs, so `assignCoach` is untouched.
- **`/[lang]/erasure`** — agent subject type gains a cmdk `Command` email-lookup
  dropdown (the in-repo `lead-selector.tsx` pattern). Picking sets the subject id to the
  agent's **UID** and loads the blast-radius preview. The destructive type-to-confirm
  gate (HR-8/9/10) is **unchanged** — the dropdown is a finder only. Leads keep the id
  input. `page.tsx` feeds the roster via `listUsersWithRoles`.
- **i18n** — 4 new `adminErasure` lookup keys across en/ms/zh.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <6 files>` | 0 errors (4 pre-existing warnings) |
| `vitest` i18n-parity + 3 actions tests | 18 passed |
| Dev server `/en/agents`, `/en/coach-assignment`, `/en/erasure` | ✓ Compiled, 307 → sign-in |

Email is resolved server-side and shown in-UI only — never logged or audited. The
**authenticated** rendering (signed-in admin/coach actually seeing emails; the erasure
dropdown filtering as you type) couldn't be exercised here (auth-gated + needs live Admin
SDK creds) — a logged-in admin should smoke-test. Full regression report in `CLAIM.md`.

## Commit

- `6c5da7a` feat(quick-kayinleong-024): show user email on agents/coach-assignment + email lookup on erasure

## Product note

Senior-coaches now see their own-downline agents' emails on `/agents` — an intended
consequence of the request. It does not widen a coach's scope beyond their existing
downline. Email is PII but displayed only to authorized staff, never logged.
