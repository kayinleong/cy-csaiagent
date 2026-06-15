# Claim: quick-kayinleong-017

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
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

Six atomic commits on `main` (docs artifacts committed separately by the orchestrator):

1. **`src/firebase/collections.ts`** (`6828a17`): added collection 23 — `ModelConfigDoc`
   (tenantId + `models` pillar→modelId map + `updatedBy` + `updatedAt`), `modelConfigConverter`,
   `appConfigRef()`, and `MODEL_CONFIG_DOC_ID = 'modelConfig'`.
2. **`src/llm/provider.ts` + `src/agents/coach/coach.test.ts`** (`4d547f2`): `modelFor()` reads
   `appConfigRef().doc(MODEL_CONFIG_DOC_ID).get()` → `models[pillar]`, falling back to the renamed
   compile-time `MODEL_FALLBACKS`. Dropped the `remoteConfig` import. Coach Test 1 rewritten to stub
   the Firestore doc read.
3. **`app/[lang]/(admin)/model-config/{actions.ts,model-config-form.tsx,actions.test.ts}`** (`f259e01`):
   `publishModelConfig(pillar, modelId, expectedCurrent)` runs a Firestore transaction — reads the
   current models map, returns `conflict` if `models[pillar] !== expectedCurrent` (D-16, no blind
   overwrite), else writes the merged map (tenantId via converter, `updatedBy`, `serverTimestamp`).
   `readModelConfig` reads the same doc. Form passes `published[pillar] ?? null`. Tests re-targeted
   from Remote Config mocks to Firestore (`adminDb.runTransaction` + `appConfigRef`).
4. **`firestore.rules`** (`649b193`): added `match /appConfig/{configId} { allow read, write: if false }`
   — server/Admin-SDK only.
5. **`CLAUDE.md` + `.planning/TSD.md`** (`3e7c678`): model-config source of truth documented as the
   Firestore `appConfig/modelConfig` doc, not Remote Config (stack line, Model-agnostic constraint,
   TSD C5 / model bullet / component table / model-swap).
6. **`src/firebase/admin.ts`** (`3adf493`): corrected the now-stale `remoteConfig()` jsdoc (model IDs
   live in Firestore; RC kept as an available surface but unused for model resolution).

## Verification

**Automated checks (all green):**
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run app/[lang]/(admin)/model-config/actions.test.ts src/agents/coach/coach.test.ts` → 38 passed.
- `npx vitest run` (full sweep) → 670 passed, 188 skipped, 0 failed.
- `npx eslint` on the 6 changed source/test files → clean.
- ci-guards.test.ts green: Guard 1 (no hard-coded model id in the model-config surface) still holds;
  Guard 4 (no `{force:true}` publishTemplate) trivially holds — `publishTemplate` was removed entirely.

**Regression Report:**
- **modelFor read path (every chat turn):** route/classifier tests mock `@/src/llm/provider` modelFor
  directly (unaffected); finder.test does not call modelFor; swap.test (QUAL-01) uses fake providers.
  Coach Test 1 rewritten + green. Full suite 0 failures confirms no read-path regression.
- **D-16 (no blind overwrite):** preserved via the transactional expected-current-value check — a stale
  read returns `error:'conflict'` and never writes. Two tests pin it (conflict → no tx.set, no audit).
- **D-17 (audit success-only):** `audit.log` runs after the transaction only on the success path; the
  conflict and publish-failed branches `return` first. Tests assert no audit row on conflict/failure.
- **tenantId mandate:** the write goes through `appConfigRef()`'s converter (stamps `tenantId:'d2'`);
  the success test asserts `setData.tenantId === 'd2'`.
- **PII / secrets:** `conflict` / `publish-failed` details are fixed strings — no raw `err.message`,
  no SA identity. (The 013 `permission-denied` branch was dropped: Admin-SDK Firestore writes bypass
  rules, so an IAM permission error is no longer the failure mode — `publish-failed` covers infra errors.)
- **Client exposure:** `appConfig` is deny-all in firestore.rules; `modelFor` + the Server Actions reach
  it via the Admin SDK only. No client reads/writes the doc.
- **Scope:** the read path, page/role gate, pillar allow-list, and audit module are unchanged in behavior.

**No live verification of the publish round-trip** (no deployed Firestore writing under the App Hosting
SA) — covered by unit tests + type/lint. Note: the App Hosting SA already has Firestore read/write
(the app is Firestore-backed throughout), so unlike the old Remote Config path this no longer needs a
separate IAM grant — the Phase-7 07-05 RC-publish IAM gate is now MOOT for model config.

## Follow-up
- The old **07-05 RC-publish IAM gate** in STATE.md (grant the App Hosting SA the Firebase Remote Config
  Admin role) is now obsolete for model config — model config lives in Firestore, which the SA can already
  write. No IAM action needed to make publish work.
