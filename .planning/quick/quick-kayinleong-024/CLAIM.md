# Claim: quick-kayinleong-024

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: claimed
- summary: Show user email instead of raw UID on /[lang]/agents and /[lang]/coach-assignment, and on /[lang]/erasure allow lookup by email with a suggestion dropdown. Emails live only in Firebase Auth (resolved server-side via adminAuth.getUsers) — reuse the roles/actions.ts chunked-resolution pattern; fall back to a truncated UID when no email exists. PII stays server-resolved, never logged.

## What will change

TBD after research — map the three pages (page.tsx + actions + client islands), confirm where UID is rendered today and how each fetches its rows, before planning the minimal edit.

## What has changed

(pending)

## Verification

(pending)
