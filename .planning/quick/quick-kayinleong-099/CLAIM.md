# Claim: quick-kayinleong-099
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-099
- started: 2026-10-27
- status: claimed
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
