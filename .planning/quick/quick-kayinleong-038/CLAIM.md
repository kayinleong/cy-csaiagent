# Claim: quick-kayinleong-038

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-038-agent-profile-polish
- started: 2026-07-19
- status: done
- summary: Agent surfaces polish — (1) the agent-email link on /[lang]/agents is low-contrast lime (`text-primary`); make it dark/readable. (2) The agent profile shows the raw cohort id ("Cohort: pwGUS2Eb"); show the cohort NAME.

## Cause

1. `agent-list.tsx:77` colours the email link `text-primary`. The whole-app redesign (quick-032) set `--primary` to lime, so `text-primary` TEXT is now very low contrast on the warm background.
2. `agents/[uid]/page.tsx:119` renders `t('cohortBadge', { cohort: profile.cohortId.slice(0,8) })` — the truncated cohort **id**, never resolved to the cohort's name.

## What will change

- `app/[lang]/(coach)/agents/agent-list.tsx` — email link `text-primary` → `text-foreground` (dark, underlined = readable link).
- `app/[lang]/(coach)/agents/[uid]/page.tsx` — resolve `profile.cohortId` → the cohort name via `cohortsRef().doc(cohortId).get()`; badge shows the name (falls back to the truncated id if the cohort was deleted — dangling pointer).

## What has changed

- `app/[lang]/(coach)/agents/agent-list.tsx` — agent-email link: `text-primary` → `font-medium text-foreground underline underline-offset-4 hover:opacity-70` (dark, readable, still a clear link).
- `app/[lang]/(coach)/agents/[uid]/page.tsx` — resolve `profile.cohortId` → the cohort **name** via `cohortsRef().doc(cohortId).get()` (try/catch; falls back to the truncated id if the cohort was deleted). Badge now shows the name.

## Verification

**Automated**
- `tsc --noEmit` clean; `eslint` on both changed files clean.

**Dev-server compile smoke**
- `/en/agents` (index) compiles + runs; the coach/admin gate 307-redirects the unauthenticated visit (application-code 57ms, no error) — the agent-list change builds.
- A profile route `/en/agents/{uid}` rendered 200 with no error — the new server-side `cohortsRef` fetch runs cleanly (the RSC/server-only import is fine; the page already imports the admin SDK).

**Regression Report**
- *Surface:* two agent read-only surfaces. Email-link change is a pure className swap (`text-foreground` is near-black — high contrast on the warm bg; WCAG-safe). Cohort-name change is an additive server read wrapped in try/catch with a truncated-id fallback (dangling cohort → still renders). No write path, schema, or i18n change (the existing `cohortBadge` key already interpolates `{cohort}` — now the name instead of the id).
- *Scope note:* other `hover:text-primary` link usages (markdown-message, flag-queue) and accent icons (reply-draft Check) were left — they only tint on hover / are decorative accents, not the reported low-contrast base text.
- *Not exercised (needs coach/admin auth):* the visual result — dark email link on /agents; the cohort name in the profile badge. The unit-free changes are className + a doc-name read; both verified to compile + run.

## Out-of-scope observation (NOT this claim)

During the smoke, `GET /en` (root page) returned **500 "Unexpected end of JSON input"** — the root page appears to JSON.parse a malformed/partial `__session` cookie and throw instead of redirecting to sign-in. This is unrelated to the agent surfaces (I didn't touch `/en`; earlier smokes showed `/en` cleanly 307-redirecting with no cookie). Likely a stale-cookie artifact in the preview browser, but possibly a real robustness gap (root page should gracefully redirect on a bad session cookie, not 500). Flagged for a separate claim if reproducible in a real session.
