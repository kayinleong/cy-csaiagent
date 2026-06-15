---
quick_id: quick-kayinleong-017
status: complete
date: 2026-06-15
---

# Quick Task quick-kayinleong-017 — Move model config from Remote Config to Firestore

## Goal

Follow-up to quick-kayinleong-013. Rather than depend on an App Hosting service-account
IAM grant to publish to Firebase Remote Config, store model IDs in a Firestore doc so
publishing "just works" (the SA already has Firestore write). Firestore becomes the sole
source of truth for both model-resolution and the admin publish surface.

## Decisions (locked with user)

- **Storage shape:** single doc `appConfig/modelConfig` with a `models: { coach, finder, reply,
  router, grader }` map (+ tenantId, updatedBy, updatedAt).
- **Remote Config:** replaced fully — removed from `modelFor()` and `publishModelConfig()`;
  compile-time fallback retained for cold-start/offline. Docs updated.
- **Concurrency (D-16):** preserved via a Firestore transaction with an expected-current-value
  conflict check — no blind overwrite.

## What changed

| File | Change |
|------|--------|
| `src/firebase/collections.ts` | + Collection 23: `ModelConfigDoc`, `modelConfigConverter`, `appConfigRef()`, `MODEL_CONFIG_DOC_ID`. |
| `src/llm/provider.ts` | `modelFor()` reads `appConfig/modelConfig` (Firestore) instead of Remote Config; `REMOTE_CONFIG_FALLBACKS` → `MODEL_FALLBACKS`. |
| `app/[lang]/(admin)/model-config/actions.ts` | `readModelConfig` reads the doc; `publishModelConfig(pillar, modelId, expectedCurrent)` writes via a transaction with a D-16 conflict check; audit success-only; admin gate + pillar allow-list unchanged. |
| `app/[lang]/(admin)/model-config/model-config-form.tsx` | Passes `published[pillar] ?? null` as `expectedCurrent`. |
| `app/[lang]/(admin)/model-config/actions.test.ts` | Re-targeted mocks from Remote Config → Firestore; added conflict / publish-failed / unpublished / readModelConfig tests. |
| `src/agents/coach/coach.test.ts` | Test 1 (modelFor) stubs the Firestore doc read. |
| `firestore.rules` | `appConfig/{configId}` → deny-all client access (server/Admin-SDK only). |
| `CLAUDE.md`, `.planning/TSD.md` | Model-config source of truth = Firestore, not Remote Config. |
| `src/firebase/admin.ts` | Corrected stale `remoteConfig()` jsdoc. |

## Commits

- `6828a17` feat: add appConfig/modelConfig Firestore collection
- `4d547f2` feat: modelFor() resolves model IDs from Firestore
- `f259e01` feat: model-config Server Actions write to Firestore
- `649b193` feat: deny all client access to appConfig (server-only)
- `3e7c678` docs: model-config source of truth is Firestore
- `3adf493` docs: correct remoteConfig() jsdoc

## Verification

- `tsc --noEmit`: 0 errors
- targeted vitest (model-config + coach): 38 passed
- full vitest: 670 passed, 188 skipped, 0 failed
- eslint on the 6 changed files: clean
- ci-guards green (no hard-coded model id; no `{force:true}` — publishTemplate removed)

Regression surface, D-16/D-17/tenantId/PII analysis: see CLAIM.md `## Verification`.

## Follow-up (non-code)

The Phase-7 **07-05 RC-publish IAM gate** (grant the App Hosting SA the Firebase Remote Config
Admin role) is now **obsolete for model config** — config lives in Firestore, which the SA can
already write. No IAM action is needed for publish to work.

Not done: live browser verification of the publish round-trip against a deployed Firestore
(covered by unit tests + type/lint only).
