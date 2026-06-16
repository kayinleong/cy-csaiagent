---
quick_id: quick-kayinleong-028
status: complete
date: 2026-06-17
---

# Summary — quick-kayinleong-028

Fix the untranslated copy on the agents surface and show email instead of UID on the
agent profile.

## What changed

- **New `app/[lang]/_components/journey-label.ts`** — maps journey **stage** ids
  (`onboarding`/`training`/`qualified`) and **checkpoint** ids (`day-one-pairing` …, +
  `start`) to localized labels via a new `journey` i18n namespace; unknown ids humanize
  as a fallback. Works client- and server-side.
- **`(coach)/agents/agent-list.tsx`** (index) — stage badge + checkpoint cell now
  render translated labels (were raw `onboarding` / `day-one-pairing` slugs).
- **`(coach)/agents/[uid]/page.tsx`** (detail) — header now shows the agent's **email**
  (server-resolved via `adminAuth.getUsers`, UID fallback) instead of the raw UID; stage
  + checkpoint translated. **Bug fix:** the cohort badge called `t('cohortBadge', { id })`
  but the string is `"Cohort: {cohort}"` — it threw a FORMATTING_ERROR at render; now
  passes `{ cohort }`.
- **i18n** — `journey` namespace (stages + checkpoints) added to en/ms/zh.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <3 files>` | 0 errors, 0 warnings |
| `vitest` i18n-parity + app-sidebar-nav | 14 passed |
| Dev server | **inconclusive** — the running :3000 instance 404s on ALL routes (incl. untouched `/en`); broken/stale server, not this change |

Display-only/additive: stage/checkpoint values, deep links, and gates are unchanged;
email is server-resolved and never logged. The cohort-badge fix is a strict correctness
improvement (the badge previously always errored). Live dev verification was blocked by a
broken dev-server instance — a logged-in coach/admin should smoke-test `/ms|zh/agents`
(localized columns) and an agent profile (email header + cohort badge renders). Full
regression report in `CLAIM.md`.

## Commit

- `be18d5b` feat(quick-kayinleong-028): translate journey stage/checkpoint + show email on agent profile

## Scope note

The dashboard downline table renders the same raw stage/checkpoint — same pattern, left
out to honor the `/agents` scope; the journey-label helper is reusable there as a follow-up.
