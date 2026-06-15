# Claim: quick-kayinleong-013

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: in-progress
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

_TBD._

## Verification

_TBD._
