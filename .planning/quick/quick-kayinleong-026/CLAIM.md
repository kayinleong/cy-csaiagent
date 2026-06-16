# Claim: quick-kayinleong-026

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: claimed
- summary: On /[lang]/dashboard show the agent's email instead of the raw UID in the "your agents" / downline view (continuation of quick-024); and add a page that lists all users (email + role) — likely by extending the existing /[lang]/users surface into a full user directory + the add-user form.

## What will change

TBD after research — locate the dashboard downline/agents component(s) that render UIDs and how they fetch rows, and decide where the all-users listing lives (extend /users vs. new page) before implementing. Reuse the server-side email resolution from quick-024 (adminAuth.getUsers / listUsersWithRoles), truncated-UID fallback, never log PII.

## What has changed

(pending)

## Verification

(pending)
