# Claim: quick-kayinleong-040
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-040-finder-tool-errors
- started: 2026-07-24
- status: in-progress
- summary: Finder tools swallow infra errors and return a grounded "inventory unavailable" signal instead of leaking a raw Google auth error the model hallucinates over.

## Context / Symptom

A Property Finder query ("Find me a 2-bedroom in Cheras, budget 800k / stay / malaysian")
streamed a `tool-output-error` from `searchProjects`:

    "Request had invalid authentication credentials. Expected OAuth 2 access token,
     login cookie or other valid authentication credential.
     See https://developers.google.com/identity/sign-in/web/devconsole-project."

The model then improvised a misleading "flag this to D2 IT / check API authentication
credentials" reply.

Two separate problems:

1. **Root cause (config — NOT in scope, owner to fix):** the error string is the
   canonical `generativelanguage.googleapis.com` (Gemini Developer API) 401. It is
   thrown by the Stage-B `embedText(criteria.freeText, {inputType:'query'})` call
   (`src/inventory/search.ts:331` → `src/rag/embed.ts:75`) when the request reaches
   Gemini without a valid API key. Environment: **deployed App Hosting** — so the
   `GOOGLE_GENERATIVE_AI_API_KEY` Secret Manager binding in `apphosting.yaml` is
   missing/invalid/not granted to the runtime SA. The `embed.ts:69` guard only checks
   the var is *present*, not that it authenticates. Fix is env-only, done by the owner.

2. **Code smell (THIS claim):** `src/agents/finder/tools.ts` tool `execute()` bodies
   have no `try/catch`, so any infra error (Gemini auth, Firestore, network) bubbles
   out as a raw `tool-output-error` and the LLM narrates nonsense. Read-only tools
   should catch infra failures and return a structured, grounded "temporarily
   unavailable" signal instead.

## What will change

- `src/agents/finder/tools.ts`: wrap all three tool `execute()` bodies
  (searchProjects, queryInventory, fetchCollateral) in a shared read-only guard that
  catches errors, logs a secret-redacted category (never the key/URL), and returns a
  `{ error: 'inventory_unavailable', message }` object. Widen return types with a
  `ToolFailure` union.
- `src/agents/finder/prompt.ts`: add guidance so the agent, on an
  `inventory_unavailable` tool result, tells the user the inventory system is
  temporarily unavailable and to retry shortly — never invents a project, never emits
  raw technical / "contact IT" jargon.

## What has changed

_(filled during execution)_

## Verification

_(filled before done)_
