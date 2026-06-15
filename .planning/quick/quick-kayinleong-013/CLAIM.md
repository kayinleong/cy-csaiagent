# Claim: quick-kayinleong-013

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: /en/model-config has two bugs — (1) the publish-confirm dialog renders the raw i18n key `adminModelConfig.confirmBody` instead of the translated copy, and (2) publishing/saving a model does not work. Fix both.

## What will change

_TBD after research + planning._

Known leads (pre-research):
- i18n: `model-config-form.tsx` passes `modelId` as the interpolation param, but the
  catalog placeholder is `{model}` (en/ms/zh `adminModelConfig.confirmBody`). next-intl
  falls back to rendering the key path when a required placeholder value is absent.
- save: `actions.ts` wraps `publishTemplate` in a blanket `catch {}` that coerces every
  error into `error:'conflict'`, masking the true publish failure.

## What has changed

Three atomic CODE commits on `main` (docs committed separately by the orchestrator):

1. **BUG 1 — `app/[lang]/(admin)/model-config/model-config-form.tsx`** (commit `414f90b`):
   renamed the confirm-body ICU argument key `modelId` → `model` (line ~196) so it matches
   the `{model}` placeholder in all three catalogs. Value expression unchanged. No catalog edited.
2. **BUG 2 — `app/[lang]/(admin)/model-config/actions.ts`** (commit `a26113c`):
   replaced the blanket `catch {}` in `publishModelConfig` with `catch (err)` that reads the
   thrown error's `.code` defensively and branches — `failed-precondition`/`aborted` → `'conflict'`,
   `permission-denied` → `'permission-denied'`, everything else → `'publish-failed'`. Details are
   fixed strings (no SA email, no raw `err.message`). `publishTemplate(template)` stays without
   `{ force:true }`; the `audit.log` call is unmoved (success-only).
3. **Tests — `app/[lang]/(admin)/model-config/actions.test.ts`** (commit `6a894d7`):
   updated the conflict test to reject with `code: 'remote-config/failed-precondition'`; added a
   permission-denied test (no audit row), an anti-masking publish-failed test (NOT conflict, no
   audit row), and a BUG-1 placeholder guard asserting `en.adminModelConfig.confirmBody` contains
   `{pillar}`+`{model}` and not `{modelId}`.

## Verification

**Automated checks (all green):**
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run app/[lang]/(admin)/model-config/actions.test.ts` → 9 passed.
- `npx vitest run` (full sweep) → 669 passed, 186 skipped, 0 failed.
- `npx eslint` on both changed source files → clean.
- `git diff --name-only` over the 3 commits → only the 3 `files_modified` files; **no `src/i18n/messages/*.json` touched.**

**Regression Report:**
- **BUG 1 surface:** every other `t(...)` call in `model-config-form.tsx` is placeholder-free
  (`confirmTitle`, `publishedToast`, `conflictError`, `conflictBody`, `reloadCta`, `genericError`,
  `currentLabel`, `unsetHint`, `inputPlaceholder`, `newValueLabel`, `publishCta`, `cancelCta`,
  `pillar.*`) — unaffected by the one-arg rename. `confirmTitle`/dialog structure untouched.
  Catalogs untouched (source of truth). Pinned by the placeholder-guard test.
- **BUG 2 — D-16 (ETag concurrency):** publish still has no `{ force:true }`; a genuine
  stale-ETag (`failed-precondition`/`aborted`) still maps to `error:'conflict'` → the form's
  amber reload banner still fires. Verified by the updated conflict test + `force` grep.
- **BUG 2 — D-17 (audit ordering):** the `audit.log` call is unmoved and runs only after the
  try/catch on the success path; each new error branch `return`s first. Three failure tests
  (conflict, permission-denied, publish-failed) confirm no audit row on failure.
- **PII / secrets:** `permission-denied` and `publish-failed` details are fixed strings; no SA
  email and no raw `err.message` reach the client or logs. Verified by code review of the catch.
- **Anti-masking:** a plain `Error` (no `.code`) now correctly returns `publish-failed`, NOT
  `conflict`. Pinned by the dedicated test asserting `not.toMatchObject({ error:'conflict' })`.

**Deferred non-code item (Derek owns — IAM, cannot be done from code):**
Grant the App Hosting runtime service account the **Firebase Remote Config Admin** role
(`roles/firebaseremoteconfig.admin`, includes `firebaseremoteconfig.remoteConfig.update` /
`cloudconfig.configs.update`) on the project, region `asia-southeast1`. This matches the
already-carried Phase-7 07-05 RC-publish IAM gate in STATE.md. Until granted, `publishModelConfig`
now correctly surfaces `permission-denied` instead of masking it as a stale-ETag conflict — the
code fix makes the failure honest; the IAM grant makes publish succeed. Within the Firebase SDK
surface (Remote Config is a Firebase product) — no GCP-beyond-Firebase violation.
