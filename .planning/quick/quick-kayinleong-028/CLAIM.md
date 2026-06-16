# Claim: quick-kayinleong-028

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-17
- status: done
- summary: Fix untranslated journey copy on the agents surface and show email instead of UID on the agent profile. The index/detail rendered the raw journey STAGE (`onboarding`…) and CHECKPOINT (`day-one-pairing`…) ids untranslated, the detail header showed the raw UID, and the detail cohort badge had a placeholder-name bug that threw a FORMATTING_ERROR.

## What will change

(See "What has changed".)

## What has changed

The agents copy was already routed through next-intl, but two things rendered raw
**data enum values** (not translated), and the detail header showed the UID:

**New: `app/[lang]/_components/journey-label.ts`** — a pure helper that maps a journey
stage id (`onboarding`/`training`/`qualified`) and checkpoint id (`day-one-pairing` …,
plus the `start` sentinel — 9 + 1) to a localized label via the new `journey` i18n
namespace. Unknown/future ids fall back to a humanized (Title Case) form instead of
surfacing a MISSING_MESSAGE. Works with both `useTranslations` (client) and
`getTranslations` (server) via a minimal `(key) => string` translator cast.

**i18n:** new `journey` namespace (`stages.*` + `checkpoints.*`) in **all three** catalogs
(en/ms/中文).

**`(coach)/agents/agent-list.tsx` (index):** the stage Badge and the checkpoint cell now
render `journeyStageLabel(tj, …)` / `journeyCheckpointLabel(tj, …)` instead of the raw id.
(Email was already shown here — quick-024.)

**`(coach)/agents/[uid]/page.tsx` (detail):**
- Header now shows the agent's **email** (resolved server-side via `adminAuth.getUsers`,
  Auth-only PII, never logged; truncated-UID fallback) instead of `profile.id.slice(0,8)…`.
- Stage Badge + checkpoint now use the journey-label helper (translated).
- **Bug fix:** the cohort Badge called `t('cohortBadge', { id })` but the string is
  `"Cohort: {cohort}"` — the mismatched placeholder threw `FORMATTING_ERROR` at render
  (seen in the dev log). Now passes `{ cohort }`.

**Commit (on `main`):** `be18d5b` feat(quick-kayinleong-028): translate journey stage/checkpoint + show email on agent profile.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <3 changed source files>` → **0 errors, 0 warnings**.
- `npx vitest run` on `i18n-parity` + `app-sidebar-nav` → **14 passed** (parity confirms the
  new `journey.stages.*` + `journey.checkpoints.*` keys exist in all three catalogs with no
  drift).

**Regression self-audit ("what existing feature could this break?"):**
- **Display-only / additive.** The journey helper only changes how an id renders (label vs
  raw); the underlying `journeyStage` / `currentCheckpoint` values, the row data, the
  `/agents/[uid]` deep-link, and the gate are all unchanged. The `start` sentinel and all 9
  checkpoint ids have keys; anything else humanizes (no crash).
- **Email resolution.** `adminAuth.getUsers([uid])` is wrapped in try/catch → UID fallback,
  so a resolution outage degrades gracefully. Email is resolved server-side and rendered in
  the coach/admin UI only — never logged. Same posture as the index (quick-024) and
  dashboard (quick-026).
- **Cohort badge fix** is a strict correctness improvement: the prior call always threw a
  formatting error (the badge never rendered its label); now it renders the truncated cohort
  ref. No behavior beyond fixing the broken format.
- **No new dependency, no secret, no PII logged.**

**NOT verified here (honest gaps):**
- **Live dev-server runtime check was inconclusive.** The dev server instance bound to
  `:3000` in this environment returned **404 for every route — including untouched ones like
  `/en` and `/en/dashboard`** — and its log was frozen (a broken/stale instance, with two
  PIDs on the port; unrelated to this change, since `/en` does not import any file I
  touched). I did not kill the user's processes. Verification therefore rests on tsc +
  eslint + i18n-parity (all green). A logged-in coach/admin should smoke-test once the dev
  server is healthy: open `/ms/agents` or `/zh/agents` and confirm the stage/checkpoint
  columns are localized; open an agent profile and confirm the header shows the email (UID
  fallback only when none) and the cohort badge renders without error.
- **Scope:** the dashboard downline table (`/dashboard`) renders the same raw stage/checkpoint
  and is the same pattern — left out to honor the explicit `/agents` scope; the journey-label
  helper is reusable there as a follow-up if wanted.
