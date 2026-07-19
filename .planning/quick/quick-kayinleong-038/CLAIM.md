# Claim: quick-kayinleong-038

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-038-agent-profile-polish
- started: 2026-07-19
- status: in-progress
- summary: Agent surfaces polish — (1) the agent-email link on /[lang]/agents is low-contrast lime (`text-primary`); make it dark/readable. (2) The agent profile shows the raw cohort id ("Cohort: pwGUS2Eb"); show the cohort NAME.

## Cause

1. `agent-list.tsx:77` colours the email link `text-primary`. The whole-app redesign (quick-032) set `--primary` to lime, so `text-primary` TEXT is now very low contrast on the warm background.
2. `agents/[uid]/page.tsx:119` renders `t('cohortBadge', { cohort: profile.cohortId.slice(0,8) })` — the truncated cohort **id**, never resolved to the cohort's name.

## What will change

- `app/[lang]/(coach)/agents/agent-list.tsx` — email link `text-primary` → `text-foreground` (dark, underlined = readable link).
- `app/[lang]/(coach)/agents/[uid]/page.tsx` — resolve `profile.cohortId` → the cohort name via `cohortsRef().doc(cohortId).get()`; badge shows the name (falls back to the truncated id if the cohort was deleted — dangling pointer).

## What has changed

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
