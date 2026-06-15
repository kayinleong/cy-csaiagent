# quick-kayinleong-013 — Summary

**Completed:** 2026-06-15
**Surface:** `app/[lang]/(admin)/model-config/` (MODEL-01 / MODEL-02, D-15/16/17)
**One-liner:** Fixed two independent model-config admin bugs — the publish-confirm dialog now renders translated copy (ICU arg `modelId`→`model`), and the publish action reports honest, code-aware errors (conflict / permission-denied / publish-failed) instead of masking every failure as a stale-ETag conflict.

## Bugs fixed

- **BUG 1 (i18n):** the publish-confirm `AlertDialog` rendered the raw key `adminModelConfig.confirmBody` because the call site supplied ICU arg `modelId` while all three catalogs use the `{model}` placeholder. With no custom next-intl fallback configured, the missing-value path emitted the namespaced key.
- **BUG 2 (save masking):** `publishModelConfig` wrapped `rc.publishTemplate(template)` in a blanket `catch {}` returning `error:'conflict'` for EVERY failure — masking the true cause (most likely a missing Remote Config publish IAM permission on the App Hosting SA) and always showing the amber "reload" banner.

## What changed (per file)

| File | Change | Commit |
|------|--------|--------|
| `app/[lang]/(admin)/model-config/model-config-form.tsx` | Renamed the confirm-body ICU argument key `modelId` → `model` (line ~196) to match the `{model}` catalog placeholder. Value expression (`draft[confirmPillar]?.trim() ?? ''`) unchanged; call now supplies exactly `{ pillar, model }`. One line. | `414f90b` |
| `app/[lang]/(admin)/model-config/actions.ts` | Replaced the blanket `catch {}` in `publishModelConfig` with `catch (err)` that reads `(err as { code?: string })?.code ?? ''` and branches: `failed-precondition`/`aborted` → `error:'conflict'`; `permission-denied` → `error:'permission-denied'`; else → `error:'publish-failed'`. Details are fixed strings (no SA email, no raw `err.message`). `publishTemplate(template)` stays without `{ force:true }`; `audit.log` unmoved (success-only). +25/-4. | `a26113c` |
| `app/[lang]/(admin)/model-config/actions.test.ts` | Updated the conflict test to reject with `code:'remote-config/failed-precondition'`; added permission-denied test (no audit row), anti-masking publish-failed test (NOT conflict, no audit row), and a BUG-1 placeholder guard on `en.adminModelConfig.confirmBody` (`{pillar}`+`{model}`, no `{modelId}`). +41/-2. | `6a894d7` |

No catalog file (`src/i18n/messages/{en,ms,zh}.json`) was edited — they are the source of truth and the `{model}` placeholder was already correct in all three.

## Verification results

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npx tsc --noEmit` | 0 errors |
| Targeted tests | `npx vitest run app/[lang]/(admin)/model-config/actions.test.ts` | 9 passed |
| Full regression sweep | `npx vitest run` | 669 passed, 186 skipped, 0 failed |
| Lint (2 changed source files) | `npx eslint model-config-form.tsx actions.ts` | clean |
| Catalog-untouched | `git diff --name-only` over the 3 commits | only the 3 `files_modified` files; no `src/i18n/messages/*.json` |

Targeted test composition: the pre-existing suite (admin-only Forbidden, getTemplate-not-getServerTemplate, no-force, conflict, pillar allow-list, success-audit) plus the 3 new behavior tests and the 1 placeholder guard = 9.

## Regression surface confirmed

- **D-16 ETag conflict still maps correctly:** publish has no `{ force:true }`; a genuine stale-ETag (`failed-precondition`/`aborted`) still returns `error:'conflict'` → the form's amber reload banner still fires. Pinned by the updated conflict test + `force` grep (the only `force` mentions are in comments; the call is `await rc.publishTemplate(template)`).
- **D-17 audit success-only:** the `audit.log` call is unmoved and runs only on the success path after the try/catch; each new error branch `return`s first. Three failure tests assert no audit row.
- **No PII in error details:** `permission-denied` and `publish-failed` carry fixed strings — no SA email, no raw `err.message`.
- **Anti-masking:** a plain `Error` (no `.code`) now correctly returns `publish-failed`, NOT `conflict`. Pinned by the dedicated test.
- **BUG 1 isolation:** all other `t(...)` calls in the form are placeholder-free and unaffected; catalogs untouched.

## Deferred (non-code — Derek owns)

Grant the App Hosting runtime service account the **Firebase Remote Config Admin** role (`roles/firebaseremoteconfig.admin`, includes `firebaseremoteconfig.remoteConfig.update` / `cloudconfig.configs.update`) on the project, region `asia-southeast1`. This matches the already-carried Phase-7 07-05 RC-publish IAM gate in STATE.md. Until granted, `publishModelConfig` now correctly surfaces `permission-denied` instead of masking it as a conflict — the code fix makes the failure honest; the IAM grant makes publish succeed. After the grant: publish a `model.coach.default` change via the admin UI and confirm the next chat turn resolves the new model id through `modelFor('coach')` (allow for propagation latency). Within the Firebase SDK surface (Remote Config is a Firebase product) — no GCP-beyond-Firebase violation.

## Commits (CODE only)

- `414f90b` fix(quick-kayinleong-013): rename confirm-dialog ICU arg modelId -> model
- `a26113c` fix(quick-kayinleong-013): code-aware publish catch (conflict/permission-denied/publish-failed)
- `6a894d7` test(quick-kayinleong-013): pin code-aware publish error paths + BUG-1 placeholder guard

## Self-Check: PASSED

- Files exist: model-config-form.tsx, actions.ts, actions.test.ts (all modified, verified by git diff stat).
- Commits exist: 414f90b, a26113c, 6a894d7 (verified via git rev-parse).
- All success criteria met; no catalog edited; minimal-fix scope honored.
