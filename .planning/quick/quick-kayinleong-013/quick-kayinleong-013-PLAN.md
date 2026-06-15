---
phase: quick-kayinleong-013
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/[lang]/(admin)/model-config/model-config-form.tsx
  - app/[lang]/(admin)/model-config/actions.ts
  - app/[lang]/(admin)/model-config/actions.test.ts
autonomous: true
requirements: [MODEL-01, MODEL-02]
must_haves:
  truths:
    - "Publish-confirm dialog shows translated copy (e.g. 'Coach will use <model> for new requests…'), never the raw key adminModelConfig.confirmBody"
    - "A genuine stale-ETag publish failure still surfaces as error:'conflict' (D-16 — no blind overwrite)"
    - "A permission-denied publish failure surfaces error:'permission-denied' (no SA email / PII in detail)"
    - "Any other publish failure surfaces error:'publish-failed', NOT 'conflict' (anti-masking)"
    - "An audit row is written ONLY on successful publish (D-17 ordering preserved)"
  artifacts:
    - path: "app/[lang]/(admin)/model-config/model-config-form.tsx"
      provides: "Confirm-dialog ICU arg renamed modelId → model to match catalog {model} placeholder"
      contains: "model: draft"
    - path: "app/[lang]/(admin)/model-config/actions.ts"
      provides: "Code-aware publish catch branching (conflict / permission-denied / publish-failed)"
      contains: "publish-failed"
    - path: "app/[lang]/(admin)/model-config/actions.test.ts"
      provides: "Updated conflict test + new permission-denied + generic publish-failed tests + confirmBody placeholder guard"
      contains: "permission-denied"
  key_links:
    - from: "model-config-form.tsx t('confirmBody', …)"
      to: "src/i18n/messages/{en,ms,zh}.json adminModelConfig.confirmBody"
      via: "ICU placeholder {model}"
      pattern: "model:\\s*draft"
    - from: "actions.ts publishModelConfig catch"
      to: "model-config-form.tsx handlePublishConfirm result.error branch"
      via: "PublishModelConfigResult.error code"
      pattern: "error:\\s*'(conflict|permission-denied|publish-failed)'"
---

<objective>
Fix two independent, already-diagnosed bugs on the `/[lang]/model-config` admin surface (MODEL-01 / MODEL-02; D-15/16/17):

1. **BUG 1 (i18n):** The publish-confirm dialog renders the raw key `adminModelConfig.confirmBody` because the call site supplies ICU arg `modelId` while all three catalogs use the `{model}` placeholder. next-intl has no custom fallback configured, so the missing-value error path renders the namespaced key.
2. **BUG 2 (save masking):** `publishModelConfig` wraps `rc.publishTemplate(template)` in a blanket `catch {}` that returns `error:'conflict'` for EVERY failure. This masks the true cause (most likely a missing Remote Config publish IAM permission on the App Hosting SA) and the form always shows the amber "reload" banner — the "doesn't work, no useful feedback" symptom.

Purpose: Restore correct confirm-dialog copy and honest, code-aware publish error reporting without blind-overwriting concurrent publishes (D-16) and without leaking PII.

Output: One-line ICU arg rename, code-aware catch branching in the publish action, and updated/added tests pinning all four error paths plus the BUG-1 placeholder regression guard.

This is a minimal-fix quick task: two independent one-area code changes plus test updates. Do NOT refactor the read path (`readModelConfig`), the page/role gate, the template-mutation shape, or the audit logic. The RESEARCH.md in this directory is the authoritative diagnosis — implement it, do not re-investigate.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/quick/quick-kayinleong-013/quick-kayinleong-013-RESEARCH.md
@CLAUDE.md
@AGENTS.md
@app/[lang]/(admin)/model-config/model-config-form.tsx
@app/[lang]/(admin)/model-config/actions.ts
@app/[lang]/(admin)/model-config/actions.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: BUG 1 — rename confirm-dialog ICU arg modelId → model</name>
  <files>app/[lang]/(admin)/model-config/model-config-form.tsx</files>
  <action>
    In the `AlertDialogDescription` confirm-body call (around line 194-197), rename the ICU argument key passed to `t('confirmBody', { … })` from `modelId` to `model` so it matches the `{model}` placeholder defined in all three catalogs (`adminModelConfig.confirmBody` in en/ms/zh.json). The value expression is unchanged: `draft[confirmPillar]?.trim() ?? ''`. After the change the call supplies exactly `{ pillar, model }`, matching the catalog placeholder set `{pillar, model}`.

    Scope discipline: change ONLY this one argument key. Do NOT edit any catalog file (en/ms/zh.json are the source of truth, per RESEARCH.md — the `{model}` placeholder is correct in all three). Do NOT touch any other `t(...)` call in this component (all others are placeholder-free per RESEARCH.md). Do NOT change `confirmTitle`, the dialog structure, or the publish handler.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && grep -n "model: draft\[confirmPillar\]" "app/[lang]/(admin)/model-config/model-config-form.tsx" && ! grep -n "modelId: draft\[confirmPillar\]" "app/[lang]/(admin)/model-config/model-config-form.tsx" && npx tsc --noEmit</automated>
  </verify>
  <done>The confirm-body call passes `{ pillar, model }` (not `modelId`); no catalog file was modified; `tsc --noEmit` passes clean.</done>
</task>

<task type="auto">
  <name>Task 2: BUG 2 — replace blanket publish catch with code-aware branching</name>
  <files>app/[lang]/(admin)/model-config/actions.ts</files>
  <action>
    In `publishModelConfig`, replace the blanket `catch {}` around `await rc.publishTemplate(template)` (around lines 183-191) with a `catch (err)` that reads the thrown error's `.code` string (firebase-admin throws `FirebaseRemoteConfigError extends PrefixedFirebaseError`, whose `.code` is a prefixed string like `remote-config/failed-precondition`). Branch on the code:
    - If the code includes `failed-precondition` OR `aborted` → return `{ ok: false, error: 'conflict', detail: 'Template changed — reload and retry.' }` (the genuine stale-ETag / concurrent-publish case; D-16 — never blind-overwrite).
    - Else if the code includes `permission-denied` → return `{ ok: false, error: 'permission-denied', detail: 'Service account lacks Remote Config publish permission.' }`. The detail MUST NOT name the service-account email or echo the raw error message (CLAUDE.md secrets/PII hygiene).
    - Else (any other failure: validation, network, not-found, plain Error with no code) → return `{ ok: false, error: 'publish-failed', detail: 'Remote Config publish failed.' }`. Do NOT echo `err.message` (may carry identifiers).

    Read the code defensively: treat a missing/undefined `.code` as the empty string so a plain `Error` falls through to `publish-failed` (anti-masking). Use a narrow inline type for the caught value (e.g. the firebase-admin `FirebaseError`-style shape with `code?: string`) rather than `any`, so `tsc` stays clean.

    Scope discipline (D-16/D-17): keep `rc.publishTemplate(template)` WITHOUT `{ force:true }` (ETag optimistic concurrency stays intact). Do NOT move, duplicate, or guard the `audit.log({ action:'model_config_publish', … })` call — it already runs AFTER the try/catch only on the success path, and each new error branch `return`s before reaching it (failed publishes write no audit row). Do NOT touch the role gate, the pillar allow-list, `getTemplate()`, the template mutation, or `readModelConfig`.

    Note: the form (`model-config-form.tsx` handlePublishConfirm) already routes `error === 'conflict'` to the reload banner and every other error to `toast.error(result.error ?? t('genericError'))`, so the new `permission-denied` / `publish-failed` codes surface to the admin without any form change. Localized copy for these codes is discretionary polish and is OUT OF SCOPE for this minimal fix.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && grep -nE "error: 'permission-denied'|error: 'publish-failed'" "app/[lang]/(admin)/model-config/actions.ts" && grep -nE "failed-precondition|aborted" "app/[lang]/(admin)/model-config/actions.ts" && ! grep -n "force: true\|force:true" "app/[lang]/(admin)/model-config/actions.ts" && npx tsc --noEmit</automated>
  </verify>
  <done>The publish catch branches into conflict (failed-precondition/aborted), permission-denied, and publish-failed; no `{ force:true }`; the audit call is unmoved and still success-only; permission-denied/publish-failed details carry no SA email or raw error message; `tsc --noEmit` passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tests — fix conflict test shape, add permission-denied + publish-failed guards + confirmBody placeholder guard</name>
  <files>app/[lang]/(admin)/model-config/actions.test.ts</files>
  <behavior>
    - Conflict test (UPDATED): `publishTemplate` rejects with an error carrying code `remote-config/failed-precondition` → `publishModelConfig` returns `{ ok:false, error:'conflict' }`. (The current test rejects with a plain `new Error('VERSION_MISMATCH')` which, after Task 2, would correctly fall through to `publish-failed` — so it MUST be changed to the real stale-ETag shape, otherwise it would fail.)
    - permission-denied test (NEW): `publishTemplate` rejects with code `remote-config/permission-denied` → returns `{ ok:false, error:'permission-denied' }`; `publishTemplate` was called once; the audit log was NOT written (no `model_config_publish` row on failure, D-17).
    - generic publish-failed test (NEW, anti-masking guard): `publishTemplate` rejects with a plain `new Error('network')` (no `.code`) → returns `{ ok:false, error:'publish-failed' }` (explicitly NOT `'conflict'`); audit log NOT written.
    - confirmBody placeholder guard (NEW, BUG-1 regression): the `adminModelConfig.confirmBody` string in `src/i18n/messages/en.json` contains the ICU placeholders `{pillar}` and `{model}` and does NOT contain `{modelId}` — pinning that the catalog placeholder set matches the `{ pillar, model }` args the form now supplies.
  </behavior>
  <action>
    Update `app/[lang]/(admin)/model-config/actions.test.ts`:

    1. Replace the conflict test's rejection (currently `mockPublishTemplate.mockRejectedValueOnce(new Error('VERSION_MISMATCH'))` near line 130) with an error that carries a prefixed code, e.g. `Object.assign(new Error('VERSION_MISMATCH'), { code: 'remote-config/failed-precondition' })`. Assertion stays `{ ok:false, error:'conflict' }`.

    2. Add a permission-denied test inside the existing `describe` block: mock `requireUser` → `adminUser`; `mockPublishTemplate.mockRejectedValueOnce(Object.assign(new Error('insufficient permission'), { code: 'remote-config/permission-denied' }))`; assert result `toMatchObject({ ok:false, error:'permission-denied' })`, `mockPublishTemplate` called once, and `audit.log` NOT called (`expect(vi.mocked(audit.log)).not.toHaveBeenCalled()` — import audit via `await import('@/src/audit')` as the success test does).

    3. Add a generic publish-failed test: mock `requireUser` → `adminUser`; `mockPublishTemplate.mockRejectedValueOnce(new Error('network'))` (a plain Error, no code); assert `toMatchObject({ ok:false, error:'publish-failed' })`, and `expect(result).not.toMatchObject({ error:'conflict' })`, and `audit.log` NOT called.

    4. Add the BUG-1 placeholder guard. Keep it LIGHT and dependency-free (no React render — `@testing-library`/render infra is not installed): import the en catalog JSON (`import en from '@/src/i18n/messages/en.json'`) and assert `en.adminModelConfig.confirmBody` includes `'{pillar}'` and `'{model}'` and does NOT include `'{modelId}'`. Place it in this test file (it pins the form-vs-catalog contract for this surface); do NOT modify `src/i18n/__tests__/i18n-parity.test.ts` (it only checks key-set parity, not placeholders — adding placeholder logic there is out of scope). If the JSON import path needs a typed-access cast to satisfy `tsc`, use a narrow cast (e.g. `(en.adminModelConfig as { confirmBody: string }).confirmBody`); do not add `// @ts-ignore`.

    Do NOT delete or weaken any existing passing assertion (non-admin Forbidden, getTemplate-not-getServerTemplate, no-force, pillar allow-list, success-audit). Only the conflict test's reject shape changes.
  </action>
  <verify>
    <automated>cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent" && npx vitest run "app/[lang]/(admin)/model-config/actions.test.ts" && npx tsc --noEmit</automated>
  </verify>
  <done>`vitest run` on actions.test.ts is green with: the updated conflict test (failed-precondition code), a new permission-denied test (no audit row), a new publish-failed test asserting NOT conflict (no audit row), and the en-catalog confirmBody placeholder guard ({pillar}+{model}, no {modelId}); all pre-existing tests still pass; `tsc --noEmit` clean.</done>
</task>

</tasks>

<verification>
After all three tasks:

1. Full type check: `npx tsc --noEmit` (0 errors).
2. Targeted test run: `npx vitest run "app/[lang]/(admin)/model-config/actions.test.ts"` — all tests green (6 pre-existing minus the changed conflict shape, + 3 new behavior tests + 1 placeholder guard).
3. Regression sweep (run the full suite to confirm no collateral breakage from the ICU arg rename or the catch change): `npx vitest run`.
4. Lint clean on the two changed source files: `npx eslint "app/[lang]/(admin)/model-config/model-config-form.tsx" "app/[lang]/(admin)/model-config/actions.ts"`.
5. Manual/static confirmation no catalog file was touched: `git diff --name-only` shows only the three files in `files_modified` (no `src/i18n/messages/*.json`).

Record the Regression Report in CLAIM.md per the global CLAUDE.md gate before marking done:
- BUG 1 regression surface: other `t(...)` calls in the form (all placeholder-free — unaffected); catalog files (untouched); confirmTitle (untouched). Verified by grep + placeholder guard test.
- BUG 2 regression surface: D-16 ETag concurrency (still no `{force:true}`; failed-precondition/aborted still → conflict); D-17 audit ordering (audit call unmoved, success-only — three failure tests assert no audit row); PII (permission-denied/publish-failed details carry fixed strings, no SA email / raw message). Verified by the three new tests + grep for `force`.
</verification>

<success_criteria>
- [ ] Confirm dialog renders translated copy with the model id interpolated, never the raw key `adminModelConfig.confirmBody` (BUG 1 fixed).
- [ ] Genuine stale-ETag publish failure still returns `error:'conflict'` (D-16 preserved — no blind overwrite).
- [ ] Permission-denied publish failure returns `error:'permission-denied'` with no SA email / PII in detail.
- [ ] Any other publish failure returns `error:'publish-failed'` (NOT masked as conflict).
- [ ] Audit row written only on success (D-17 ordering intact); all three failure tests assert no audit row.
- [ ] No catalog file edited; no read path / page gate / template-mutation / audit-logic refactor (minimal-fix rule honored).
- [ ] `tsc --noEmit`, targeted + full `vitest run`, and eslint on changed files all clean.
</success_criteria>

<deferred>
## Non-code follow-up (IAM — Derek owns; cannot be done from code)

The actual production unblock for the `permission-denied` case is an IAM/console action the engineer cannot perform from code:

- **Grant the App Hosting runtime service account the Firebase Remote Config Admin role** (`roles/firebaseremoteconfig.admin`, which includes `cloudconfig.configs.update` / `firebaseremoteconfig.remoteConfig.update`) on the project, region `asia-southeast1`. Remote Config is a Firebase product, so this stays within the "no GCP beyond the Firebase SDK surface" constraint.
- This matches the already-carried Phase-7 open gate (07-05 RC-publish IAM) in STATE.md. Until granted, `publishModelConfig` will now correctly surface `permission-denied` instead of masking it as a stale-ETag conflict — the code fix makes the failure honest; the IAM grant makes publish succeed.
- After the grant: publish a `model.coach.default` change via the admin UI and confirm the next chat turn resolves the new model id through `modelFor('coach')` (allow for Remote Config propagation latency).

This is recorded here as a deferred, human-owned item — NOT an executable code task in this plan.
</deferred>

<output>
Create `.planning/quick/quick-kayinleong-013/quick-kayinleong-013-SUMMARY.md` when done.
Update `.planning/quick/quick-kayinleong-013/CLAIM.md` with the What-changed + Verification (Regression Report) sections and set status to `done` per the global CLAIM.md lifecycle gate.
</output>
