# Claim: quick-kayinleong-017

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: in-progress
- summary: Move model-config persistence from Firebase Remote Config to Firestore. Follow-up to quick-kayinleong-013 — rather than depend on an App Hosting SA IAM grant for Remote Config publish, store model IDs in a Firestore doc (`appConfig/modelConfig`). Firestore becomes the sole source of truth for `modelFor()` resolution and the admin publish surface; Remote Config is removed from both paths (compile-time fallback retained for cold-start/offline).

## Decisions (locked with user)
- Storage shape: SINGLE doc `appConfig/modelConfig` holding `models: { coach, finder, reply, router, grader }` map + `tenantId`, `updatedAt`, `updatedBy`.
- Remote Config: REPLACE FULLY. Drop the RC read in `modelFor()` and the RC write in `publishModelConfig()`. Keep the compile-time fallback constants for cold-start/offline. Update CLAUDE.md + TSD.md to match.
- Concurrency (D-16 preserved): `publishModelConfig` runs a Firestore transaction with an expected-current-value check → returns `error:'conflict'` on a stale read rather than blind-overwriting; the form passes the value it currently shows.

## What will change

- `src/firebase/collections.ts` — add collection 23 `appConfig/{configId}` (ModelConfigDoc + converter + `appConfigRef()` + `MODEL_CONFIG_DOC_ID`).
- `src/llm/provider.ts` — `modelFor()` reads `appConfig/modelConfig.models[pillar]` (Firestore) instead of Remote Config; rename `REMOTE_CONFIG_FALLBACKS` → `MODEL_FALLBACKS`; drop `remoteConfig` import; update header.
- `app/[lang]/(admin)/model-config/actions.ts` — `readModelConfig` reads the single doc; `publishModelConfig` writes via merge inside a transaction (expected-value conflict check); audit + admin gate + pillar allow-list preserved; targetRef → `appConfig/modelConfig`.
- `app/[lang]/(admin)/model-config/model-config-form.tsx` — pass the current published value to `publishModelConfig` for the conflict check.
- `app/[lang]/(admin)/model-config/actions.test.ts` — re-target mocks from Remote Config to Firestore.
- `firestore.rules` — add `appConfig/{configId}` deny-all client block (server/Admin-SDK only).
- `CLAUDE.md`, `.planning/TSD.md` — model-config source of truth is now Firestore, not Remote Config.

## What has changed

_TBD._

## Verification

_TBD._
