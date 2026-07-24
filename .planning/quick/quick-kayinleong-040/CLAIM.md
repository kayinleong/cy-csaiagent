# Claim: quick-kayinleong-040
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-040-finder-tool-errors
- started: 2026-07-24
- status: done
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

- `src/agents/finder/tools.ts`:
  - Added `ToolFailure` interface (`{ error: 'inventory_unavailable', message }`),
    exported for downstream typing.
  - Added `runReadOnly(toolName, body)` guard: runs the tool body, catches any thrown
    error, logs a secret-redacted category via `console.error`, and returns
    `ToolFailure`.
  - Added `redactedErrorLabel()` — strips `key=...` and `x-goog-api-key` before logging
    so a caught Gemini error can never leak the API key (URL/header).
  - Wrapped all three `execute()` bodies (searchProjects, queryInventory,
    fetchCollateral) in `runReadOnly`; return types widened to `T | ToolFailure`.
    Success paths unchanged.
- `src/agents/finder/prompt.ts`: added a "Tool Unavailable (infra failure — NOT a
  refusal)" section instructing the agent to surface a transient-unavailable message,
  keep captured lead details, and never invent a project or emit raw error /
  "contact IT" text.
- `src/agents/finder/finder.test.ts`: added Test 7 (2 cases) — searchProjects and
  fetchCollateral tools return `inventory_unavailable` (no throw, no leaked "oauth"
  text) when the underlying call rejects.

## Verification

**Regression surface:** the three Finder tools (searchProjects / queryInventory /
fetchCollateral), the Finder streaming path (route passes tools to `streamText`),
`finderAgent.run` offline path, and any static consumer of the tool return types.

**What was tested / ruled out:**
- `npx tsc --noEmit` → exit 0 (widened union types compile; no downstream break — tool
  outputs are consumed by the model as JSON, not statically typed in the route).
- `npx vitest run src/agents/finder` → 19 passed (17 existing + 2 new). Success paths
  (fetchCollateral array return, read-only assertions) unchanged.
- `npx vitest run src/inventory app/api/chat/route.test.ts tests/chat-route.test.ts`
  → 98 passed. Routing + inventory search behavior unaffected.
- `npx eslint src/agents/finder/{tools,prompt}.ts` → 0.
- Secrets gate `grep -rE "console\.(log|info).*GOOGLE|console.*api.?key" src/agents/finder/`
  → clean. New logging is `console.error` with a key-redacted label only.
- Read-only gate: no `.set(`/`.add(`/`.update(` introduced in tools.ts (only the
  pre-existing doc comment mentions them).

**Not in scope (owner action):** the root-cause credential fix — the deployed App
Hosting runtime's `GOOGLE_GENERATIVE_AI_API_KEY` Secret Manager binding must be
valid and granted to the backend service account. This claim only stops the tool from
surfacing that failure as a hallucinated "contact IT" reply. Not verifiable here
(no live App Hosting access).

- status: done

