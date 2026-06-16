# Claim: quick-kayinleong-028

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-17
- status: claimed
- summary: On the agents surface (/[lang]/agents and the /[lang]/agents/[uid] profile drill-in), fix untranslated/hardcoded strings (trilingual EN/BM/中文) and show the user's email instead of the raw UID. The index list already shows email (quick-024); this targets the detail page + any missed copy.

## What will change

TBD after survey — read agents/page.tsx, agent-list.tsx, agents/[uid]/page.tsx and record-first-close.tsx; find hardcoded English strings + UID displays; resolve email server-side (adminAuth.getUsers, UID fallback) and route copy through next-intl (agentProfile/agentsIndex namespaces), adding any missing keys to all three catalogs.

## What has changed

(pending)

## Verification

(pending)
