# quick-kayinleong-013 — Research: model-config publish bugs

**Researched:** 2026-06-15
**Surface:** `app/[lang]/(admin)/model-config/` (MODEL-01 / MODEL-02, D-15/16/17)
**Confidence:** BUG 1 = HIGH (root cause statically confirmed). BUG 2 = HIGH on the masking defect; root-cause of the *original* failure is MEDIUM (one likely cause requires a runtime/IAM check to confirm).

## Summary

Two independent bugs on the model-config admin surface.

- **BUG 1** is a pure ICU placeholder-name mismatch. All three catalogs define `adminModelConfig.confirmBody` with a `{model}` placeholder, but the call site passes `modelId`. next-intl has **no** custom `getMessageFallback`/`onError` configured (`src/i18n/request.ts` returns only `locale` + `messages`), so the library default fires on the missing-value error path and renders the full key path `adminModelConfig.confirmBody`. Confirmed verbatim across en/ms/zh.
- **BUG 2** has two layers. The **definite** defect: `publishModelConfig` wraps `rc.publishTemplate(template)` in a blanket `catch {}` that returns `error:'conflict'` for *any* thrown error (`actions.ts:187–191`). This masks the true failure and the form shows the "setting changed, reload" banner regardless of cause. The **most probable underlying cause** of publish actually failing in this environment is a **missing IAM permission** on the App Hosting service account — Remote Config *write* (`cloudconfig.configs.update`) is not granted by the default App Hosting SA, which is provisioned for read/runtime, not RC publishing. The error thrown in that case is a `FirebaseRemoteConfigError` with code `permission-denied` — currently swallowed and mislabeled `conflict`.

**Primary recommendation:** (1) For BUG 1, rename the call-site param `modelId` → `model` (single-line change, catalog stays source of truth). (2) For BUG 2, replace the blanket catch with code-aware branching: only `failed-precondition` (and legacy `aborted`) → `'conflict'`; surface everything else as a distinct error (no PII), and unblock the real cause by granting the SA the Firebase Remote Config Admin role.

---

## BUG 1 — untranslated `confirmBody` key

### Confirmed root cause
- Call site `model-config-form.tsx:194–197` passes ICU values `{ pillar, modelId }`.
- Catalog message uses `{pillar}` and **`{model}`** — `modelId` is never referenced, and `{model}` has no value supplied.
- Verified placeholder is `{model}` in **all three** catalogs:
  - `src/i18n/messages/en.json:596` — `"{pillar} will use {model} for new requests. You can change this again at any time."`
  - `src/i18n/messages/ms.json:598` — `"{pillar} akan menggunakan {model} untuk permintaan baharu. ..."`
  - `src/i18n/messages/zh.json:598` — `"{pillar} 的新请求将使用 {model}。..."`
- next-intl default fallback: `src/i18n/request.ts` defines **no** `getMessageFallback` and **no** `onError`. With ICU strict mode, a missing required argument triggers the error path; the default `getMessageFallback` returns the namespaced key (`adminModelConfig.confirmBody`) — exactly the screenshot string. `confirmTitle` (no placeholders, `en.json:595`) renders fine, corroborating the diagnosis.

### No other mismatched call sites
Every other `t(...)` in `model-config-form.tsx` is placeholder-free (`confirmTitle`, `publishedToast`, `conflictError`, `conflictBody`, `reloadCta`, `genericError`, `currentLabel`, `unsetHint`, `inputPlaceholder`, `newValueLabel`, `publishCta`, `cancelCta`, `pageTitle`, `pageSubtitle`, `pillar.*`). `page.tsx` uses only `pageTitle`/`pageSubtitle`. `confirmBody` is the sole offender.

### Recommended fix (ONE change)
**Rename the call-site param `modelId` → `model`** in `model-config-form.tsx:196`:

```ts
// model-config-form.tsx ~194-197
t('confirmBody', {
  pillar: t(`pillar.${confirmPillar}`),
  model: draft[confirmPillar]?.trim() ?? '',   // was: modelId
})
```

Rationale: the catalog wording is the source of truth (3 languages, already reviewed copy); `{model}` reads more naturally than `{modelId}`. Renaming one TS param is lower-risk and lower-churn than editing three translation files. Do **not** edit the catalogs.

---

## BUG 2 — publish "does not work"

### Definite defect: blanket catch masks the real error (`actions.ts:183–191`)
```ts
try {
  await rc.publishTemplate(template)
} catch {                                   // ← swallows EVERYTHING
  return { ok: false, error: 'conflict', detail: 'Template changed — reload and retry.' }
}
```
Any failure (permission, validation, network, not-found) is reported to the form as `conflict`. The form (`model-config-form.tsx:108–113`) then shows the amber "reload" banner — never the true error — which is exactly the "doesn't work, no useful feedback" symptom.

### Environment-grounded root-cause analysis
Evaluated each hypothesis against the codebase:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **(a) SA lacks RC write permission** | **MOST LIKELY** | `src/firebase/admin.ts:40–70` initializes via ADC (App Hosting metadata-server SA in prod, `FIREBASE_SERVICE_ACCOUNT_KEY` in dev). The App Hosting default compute SA is **not** granted `roles/firebaseremoteconfig.admin` (`cloudconfig.configs.update`) out of the box. `publishTemplate` then throws `FirebaseRemoteConfigError { code: 'permission-denied' }`. Confirmable only at runtime / in IAM console. |
| (b) `getTemplate`/`publishTemplate` missing on the RC instance | **RULED OUT** | `node_modules/firebase-admin/.../remote-config.d.ts` (v13.10.0): `getTemplate(): Promise<RemoteConfigTemplate>` (line 30) and `publishTemplate(template, options?: {force}): Promise<...>` (line 60) both exist. `remoteConfig()` returns the Admin `getRemoteConfig()` instance with full publish capability (`admin.ts:100–102`). |
| (c) Whole-template validation rejects the publish | **POSSIBLE, secondary** | `publishTemplate` validates the entire template. If the live RC template has parameters/conditions the mutation leaves inconsistent, the API returns `failed-precondition`/`invalid-argument`. Less likely than (a) but the masking catch would hide it identically. |
| (d) Mutation shape / creating a new key | **CORRECT as written** | `template.parameters[key] = { ...(existing ?? {}), defaultValue: { value: modelId } }` is the valid `ExplicitParameterValue` shape (`{ value: string }`). Spreading the existing entry preserves `valueType`/description; creating a brand-new key this way is valid. Caveat: a freshly-created param may default `valueType` to `JSON`/`STRING` — generally fine for string model IDs, but a strict project template could reject it (folds into (c)). |

**firebase-admin error shape (confirmed):** `RemoteConfigErrorCode` =
`'aborted' | 'already-exists' | 'failed-precondition' | 'internal-error' | 'invalid-argument' | 'not-found' | 'permission-denied' | 'resource-exhausted' | 'unauthenticated' | 'unknown-error'`
(`node_modules/firebase-admin/lib/remote-config/remote-config-api-client-internal.d.ts:18`). A stale-ETag/409 surfaces as **`failed-precondition`** (legacy SDKs also used `aborted`). The error is a `FirebaseRemoteConfigError extends PrefixedFirebaseError`, so it carries a `.code` property like `remote-config/failed-precondition`.

### Recommended fix (code, minimal + correct)
Replace the blanket catch with code-aware branching so a real 409 still maps to `conflict`, and everything else surfaces honestly:

```ts
import type { FirebaseError } from 'firebase-admin/app'  // has .code: string

try {
  await rc.publishTemplate(template)   // no { force:true } — keep ETag concurrency (D-16)
} catch (err) {
  const code = (err as Partial<FirebaseError>)?.code ?? ''
  // Stale-ETag / concurrent publish → genuine conflict (D-16): never blind-overwrite.
  if (code.includes('failed-precondition') || code.includes('aborted')) {
    return { ok: false, error: 'conflict', detail: 'Template changed — reload and retry.' }
  }
  if (code.includes('permission-denied')) {
    // Surface a distinct, actionable error WITHOUT leaking SA identity/PII.
    return { ok: false, error: 'permission-denied', detail: 'Service account lacks Remote Config publish permission.' }
  }
  // Any other failure: surface a generic error code; do NOT echo raw message (may contain identifiers).
  return { ok: false, error: 'publish-failed', detail: 'Remote Config publish failed.' }
}
```

The form already handles non-`conflict` errors: `model-config-form.tsx:112-113` does `toast.error(result.error ?? t('genericError'))`. To avoid showing a raw code string to admins, optionally map `permission-denied`/`publish-failed` to localized copy via a new catalog key, or keep `genericError` for the non-conflict branch. (Copy is a discretionary polish — the functional fix is the catch branching.)

### Required NON-code action (the actual unblock for (a))
Grant the App Hosting runtime service account the **Firebase Remote Config Admin** role (`roles/firebaseremoteconfig.admin`, includes `cloudconfig.configs.update`) on project, region `asia-southeast1`. This is an IAM/console change Derek owns — flag it. This is within the Firebase SDK surface (Remote Config is a Firebase product), so it does not violate the "no GCP beyond Firebase" constraint.

---

## Existing test coverage & gaps (`actions.test.ts`)

Current tests (all mock `@/src/firebase/admin`, so they exercise the action logic, not real RC):
- ✅ non-admin → `Forbidden`, no publish (D-17)
- ✅ uses `getTemplate()` not `getServerTemplate()`; mutates only the one key
- ✅ `publishTemplate` called without `{force:true}` (D-16)
- ✅ `publishTemplate` rejects → `{ok:false, error:'conflict'}` — **but the mock rejects with `new Error('VERSION_MISMATCH')` (line 130), a plain Error with no `.code`.** After the fix, this generic Error would fall through to `publish-failed`, not `conflict`. **This test must be updated** to reject with an error carrying `code: 'remote-config/failed-precondition'` (or `aborted`) to reflect the real stale-ETag shape.
- ✅ unknown pillar rejected (D-16)
- ✅ success writes `model_config_publish` audit row (D-17)

**Tests to add/update:**
1. **Update** the conflict test: reject with `Object.assign(new Error('...'), { code: 'remote-config/failed-precondition' })` → expect `error:'conflict'`.
2. **Add** a `permission-denied` test: reject with `code: 'remote-config/permission-denied'` → expect `error:'permission-denied'` (and `mockPublishTemplate` called once, no audit row written).
3. **Add** a generic-failure test: reject with a plain `new Error('network')` → expect `error:'publish-failed'` (NOT `conflict`) — this pins the anti-masking behavior.
4. **Add** a BUG-1 regression guard: a lightweight test (or i18n-parity assertion) that the `confirmBody` ICU args supplied by the form match the catalog placeholder set `{pillar, model}`. The existing `src/i18n/__tests__/i18n-parity.test.ts` is the natural home if it already checks placeholder parity; otherwise a small render test of `ModelConfigForm` asserting the dialog body does not equal the raw key.

No emulator needed — RC stays mocked.

---

## Project constraints the fix must respect

- **No PII / secret logging** (CLAUDE.md secrets hygiene): do not echo raw `publishTemplate` error messages or SA identity to the client or logs; use fixed error codes. The `permission-denied` detail must not name the SA email.
- **next-intl is the only string source** — fix BUG 1 in TS, leave catalogs as source of truth; do not hard-code English copy in the component.
- **Firebase-only / no GCP beyond Firebase SDK** — the IAM grant is on a Firebase product (Remote Config); no Cloud Functions, no Vertex. ✅
- **D-16 (ETag optimistic concurrency)** — keep publishing WITHOUT `{force:true}`; the fix must still map a genuine stale-ETag to `conflict` and never blind-overwrite.
- **D-15 (model-agnostic)** — no hard-coded model-id literal introduced; `modelId`/`model` stays free-form.
- **D-17 (audit)** — audit row is written only on success (after the try/catch); the fix preserves this ordering (failed publishes write no audit row, which the new permission-denied/publish-failed branches `return` before reaching `audit.log`).
- **Minimal-fix / regression rule** (global CLAUDE.md): two independent one-area changes; no refactor of the read path, page gate, or audit logic.

---

## RESEARCH COMPLETE
