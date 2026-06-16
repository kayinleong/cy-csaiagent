# Claim: quick-kayinleong-024

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: done
- summary: Show user email instead of raw UID on /[lang]/agents and /[lang]/coach-assignment, and on /[lang]/erasure add an email-lookup suggestion dropdown for the agent subject type. Emails live only in Firebase Auth (resolved server-side via adminAuth.getUsers / listUsersWithRoles); fall back to a truncated UID when none. PII stays server-resolved, never logged.

## What will change

(See "What has changed".)

## What has changed

**Background:** the `users/{uid}` and `agentProfiles/{uid}` docs carry **no email** — email lives only in Firebase Auth. The roles page already resolves it server-side via `adminAuth.getUsers` (chunked at 100) and exposes it on `UserWithRole.email`. These edits reuse that, with a truncated-UID fallback when a user has no email.

**1) `/[lang]/agents` (agent index — coach + admin):**
- `page.tsx`: after `getDownline`, resolve each agent's email via `adminAuth.getUsers` (chunked, fail-soft → fallback to UID; mirrors `roles/actions.ts`). Added `email` to the serialized rows. (Done inline here rather than via `listUsersWithRoles` because that action is admin-only and this page is also coach-accessible.)
- `agent-list.tsx`: row label now renders `email ?? "{uid8}…"`; the deep-link href to `/agents/[uid]` is unchanged.

**2) `/[lang]/coach-assignment` (admin only):**
- `page.tsx`: `agents` / `coaches` option rows now carry `email` (already resolved by `listUsersWithRoles` — no new resolution call).
- `coach-reassign.tsx`: a `userLabel()` helper renders `email ?? "{displayRef}…"` in both Select pickers and in the reassign-confirm dialog. The SelectItem `value` is still the UID, so selection + the atomic `assignCoach` write are unchanged.

**3) `/[lang]/erasure` (admin only) — email lookup + suggestion dropdown:**
- `page.tsx`: fetches the roster via `listUsersWithRoles` and passes `agentOptions` ({id, email, displayRef}) to the form. Non-blocking (empty roster just hides the dropdown).
- `erasure-request-form.tsx`: when subject type = **agent**, shows a cmdk `Command` email-lookup dropdown (the proven `lead-selector.tsx` pattern). Typing filters by email/UID; picking sets the subject id to that agent's **UID** and loads the blast-radius preview. `handleSearch` now accepts an optional explicit id (so a pick can search in the same tick). Switching subject type clears the subject id (prevents a stale id leaking across lead↔agent). Leads keep the plain id input (leads have no email).
  - **Safety gates preserved (HR-8/9/10):** the subject id passed to `getBlastRadius` / `eraseDataSubjectAction` is still the UID, and the type-to-confirm gate still requires typing that exact UID (`typedToken === subjectRef`) before the destructive action enables. The email dropdown is a *finder* only — it never changes what gets erased or how it is confirmed.

**i18n:** added 4 `adminErasure` keys (`agentLookupLabel`, `agentLookupPlaceholder`, `agentLookupEmpty`, `agentLookupSelected`) to **all three** catalogs (en/ms/zh). The agents + coach-assignment changes are display-only and needed no new keys.

**Commit (on `main`):** `6c5da7a` feat(quick-kayinleong-024): show user email on agents/coach-assignment + email lookup on erasure.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint <6 changed files>` → **0 errors** (4 warnings, all **pre-existing**: unused `_lang` in coach-reassign + erasure-form, and unused `CardHeader`/`CardTitle` imports in erasure-form — none introduced by this change).
- `npx vitest run` on `i18n-parity` + `agents/actions` + `coach-assignment/actions` + `erasure/actions` → **18 passed**. i18n parity confirms the 4 new keys exist in all three catalogs with no drift.
- **Dev server (`:3000`, Next 16 Turbopack):** `/en/agents`, `/en/coach-assignment`, `/en/erasure` all compile (`✓ Compiled`, no error in the dev log) and the gates still fire — unauthenticated GET → **307 → /en/sign-in** for all three.

**Regression self-audit ("what existing feature could this break?"):**
- **Erasure safety (highest risk).** The destructive flow is unchanged: subject id stays the UID, blast-radius + erase actions receive the same `{subjectType, id}`, and the type-to-confirm gate still disables the destructive button until the typed token equals the UID. The email dropdown only *populates* the subject id; it cannot bypass the confirm gate. `handleSearch()` (no arg) preserves the lead path's exact prior behavior. The new "clear subject id on type switch" only removes a stale-id footgun.
- **Coach-assignment.** `assignCoach` action untouched; SelectItem values remain UIDs, so the dual-write target is unchanged. Only the visible label changed (email vs UID).
- **Agents index.** Net-additive `email` field; the `[uid]` deep-link is byte-identical. `adminAuth.getUsers` failure is caught and falls back to the UID, so a resolution outage degrades gracefully rather than breaking the list. `recordFirstClose` action untouched.
- **PII / secrets.** Email is resolved **server-side** (Auth, via `adminAuth.getUsers` / `listUsersWithRoles`) and rendered in the admin/coach UI only — it is never logged, never written to an audit `raw` map, and never sent beyond the projected row. No secret introduced. (Product note: senior-coaches now see their *own-downline* agents' emails on `/agents` — an intended consequence of this request; it does not widen scope beyond a coach's existing downline.)

**NOT verified here (honest gaps):**
- The **authenticated** rendering (a signed-in admin/coach actually seeing emails, and the erasure email dropdown filtering as you type) was **not exercised** — these pages are auth-gated and need an admin/coach session + live Admin SDK creds, unavailable in this environment. The dropdown reuses the in-repo `lead-selector.tsx` cmdk pattern and compiles cleanly. A logged-in admin should smoke-test: open `/agents` (emails render), `/coach-assignment` (pickers show emails), and `/erasure` → Agent → type part of an email → pick → confirm the blast-radius loads and the type-to-confirm shows the UID.
