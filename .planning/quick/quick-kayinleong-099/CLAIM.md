# Claim: quick-kayinleong-099
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-099
- started: 2026-10-27
- status: done
- summary: dev-only LOCAL_MODEL_OVERRIDE so the local server can run every pillar on Gemini for UAT re-testing, without touching the production model config

## What will change

The 2026-10-27 UAT re-run on the local dev server failed on the first Finder turn:
"Your credit balance is too low to access the Anthropic API" (AI_APICallError). The only
model switch is the live Firestore doc `appConfig/modelConfig`, which production also reads.

- `src/llm/provider.ts` `modelFor`: when `NODE_ENV !== 'production'` and
  `LOCAL_MODEL_OVERRIDE` is set, every pillar uses that id (dispatched by the existing
  `providerFor`). Production (App Hosting, `next start`) ignores the variable, so
  `appConfig/modelConfig` stays the only production swap surface (QUAL-01).
- `src/llm/provider-dispatch.test.ts`: override used in dev, ignored in production.
- `.claude/launch.json`: a `d2-dev-gemini` configuration that starts `next dev` with
  `LOCAL_MODEL_OVERRIDE=gemini-3.5-flash` (the Gemini model claim 089 measured on Finder).

## What has changed (48c353b)

- `src/llm/provider.ts` `modelFor`: `LOCAL_MODEL_OVERRIDE` wins for every pillar when
  `NODE_ENV !== 'production'`; ignored in production.
- `src/llm/provider-dispatch.test.ts`: 3 tests (dev override applies to every pillar and skips
  Firestore; production ignores it; a blank value is unset).
- `.claude/launch.json`: `d2-dev-gemini` (`env LOCAL_MODEL_OVERRIDE=gemini-3.5-flash npm run dev`).

## Verification

- `npx vitest run src/llm`: 26 passed. `npm run typecheck`: clean.
- Live use, 2026-10-27: the local server on `d2-dev-gemini` answered all 89 UAT re-test prompts
  (83 field checks + 6 search cases) through the chat UI with 0 backend failures, where the
  Anthropic key had failed on the first prompt ("credit balance is too low").

### Regression report

| Surface | Checked | Result |
|---|---|---|
| Production model resolution | Test with NODE_ENV=production + override set | Firestore decides; override ignored |
| Dev without the override | Existing dispatch tests | Unchanged, pass |
| `d2-dev` launch config | Left untouched | Still runs Anthropic via Firestore |

Not verified: App Hosting itself (no deploy). The guard is `NODE_ENV`, which `next start`
sets to `production`.
