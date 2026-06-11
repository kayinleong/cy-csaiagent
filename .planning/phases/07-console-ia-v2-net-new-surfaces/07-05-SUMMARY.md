---
phase: 07-console-ia-v2-net-new-surfaces
plan: 05
subsystem: api
tags: [remote-config, firebase-admin, audit-log, pdpa, next.js, server-actions, model-agnostic]

# Dependency graph
requires:
  - phase: 07-02
    provides: "auditLogs (action,ts)/(actorUid,ts) composite indexes; deny-by-default collection rules baseline"
  - phase: 01-llm
    provides: "src/llm/provider.ts modelFor() getServerTemplate read path + the 5-pillar Pillar union + REMOTE_CONFIG_FALLBACKS"
  - phase: 01-audit
    provides: "src/audit log() hashes-only writer"
  - phase: 06
    provides: "requireRole() server-side gate + (admin) route group + read-only least-privilege lock"
provides:
  - "readModelConfig() — admin-only read of the 5 model.{pillar}.default keys"
  - "publishModelConfig() — admin-only ETag-safe Remote Config WRITE (the ONE net-new mechanism of Phase 7)"
  - "listAuditLogs() — admin-only bounded cursor read over auditLogs (metadata-only, no self-audit)"
  - "src/pdpa/policy-constants.ts — single source for the static PDPA display"
  - "Routes: /[lang]/model-config, /[lang]/audit-log, /[lang]/pdpa-settings (admin group)"
affects: [07-06, rollout, phase-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Remote Config WRITE round-trip: getTemplate() (writable ETag) → mutate ONE parameter → publishTemplate() WITHOUT {force:true}; stale-ETag rejection → conflict (never blind-overwrite)"
    - "Audit-viewer no-self-audit: a metadata-only read intentionally omits any auditDrilldown call (avoids audit-of-audit recursion); the server gate is the control"
    - "Static policy-constants module (mirrors the REMOTE_CONFIG_FALLBACKS labeled-constant idiom) as the single source for a read-only display with zero editable knobs"

key-files:
  created:
    - "app/[lang]/(admin)/model-config/actions.ts"
    - "app/[lang]/(admin)/model-config/page.tsx"
    - "app/[lang]/(admin)/model-config/model-config-form.tsx"
    - "app/[lang]/(admin)/audit-log/actions.ts"
    - "app/[lang]/(admin)/audit-log/page.tsx"
    - "app/[lang]/(admin)/audit-log/audit-log-viewer.tsx"
    - "app/[lang]/(admin)/pdpa-settings/page.tsx"
    - "src/pdpa/policy-constants.ts"
  modified: []

key-decisions:
  - "readModelConfig returns modelId:null for an unpublished key (UI labels it 'unset — fallback in effect') rather than naming a model string — keeps ci-guard 1 (no hard-coded model id) GREEN without exporting REMOTE_CONFIG_FALLBACKS into the surface."
  - "audit-log action normalizes ts to epoch ms (serializable RSC→client) and the AuditLogRow carries an index signature so it is assignable to Record<string,unknown> (satisfies the Wave-0 contract's property-bag cast — no test edit)."
  - "audit-log/actions.ts deliberately does NOT import auditDrilldown — guarantees the no-self-audit invariant (D-14) structurally, matching the Wave-0 mock that asserts auditDrilldown is never called."

patterns-established:
  - "ETag optimistic-concurrency Remote Config publish (the only net-new code path in Phase 7)"
  - "Bounded cursor read + filter toolbar over an admin-only collection, metadata-only projection"

requirements-completed: [AUDIT-01, MODEL-01, MODEL-02, PDPA-01]

# Metrics
duration: ~30min
completed: 2026-06-11
---

# Phase 7 Plan 05: System & Compliance Cluster Summary

**Admin-only model-config (Remote Config 5-pillar read + ETag-safe `publishTemplate`-without-force, audited), a bounded no-self-audit audit-log viewer (hashes never decoded), and a static zero-knob PDPA-settings display — the System & Compliance cluster (D-25), with the RC-publish IAM grant carried to the rollout gate.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-11T14:32:00Z (approx)
- **Completed:** 2026-06-11T14:40:00Z
- **Tasks:** 3 code tasks complete (Task 4 = blocking RC-publish IAM checkpoint — live-gated, not executable here)
- **Files created:** 8

## Accomplishments

- **MODEL-02 (the ONE net-new mechanism):** `publishModelConfig(pillar, modelId)` — asserts admin from the verified token, validates `pillar ∈ {coach,finder,reply,router,grader}` (rejects unknown), reads the writable project template via `getTemplate()`, mutates ONLY `parameters['model.{pillar}.default'].defaultValue`, and calls `publishTemplate(template)` **WITHOUT** `{force:true}`. A stale-ETag rejection returns `{ok:false,error:'conflict'}` (never blind-overwrite). Every publish writes an `audit.log({action:'model_config_publish', raw:{pillar, modelId}})` (hashed). Model ids stay free-form strings; `REMOTE_CONFIG_FALLBACKS` untouched.
- **MODEL-01:** `readModelConfig()` reads the 5 pillar values via `modelFor`'s `getServerTemplate().evaluate().getString()` path; an unpublished key returns `null` and the UI shows an "unset — fallback in effect" hint (no model-id literal in the surface).
- **AUDIT-01:** `listAuditLogs({action?, actorUid?, fromTs?, toTs?, cursorTs?})` — admin-only, `orderBy('ts','desc').limit(50)` + `startAfter` cursor, optional filters (07-02 composite indexes), returns metadata-only `{id, actorUid, action, targetRef, ts}` (hashes NEVER decoded, D-12), and does NOT call `auditDrilldown` (no self-audit, D-14).
- **PDPA-01:** `src/pdpa/policy-constants.ts` (residency `asia-southeast1`, boundary pseudonymization, `usageEvents` 90d TTL, audit hashes-only, <72h erasure SLA) drives a static admin-only `dl` display + an "Open erasure flow" link to the existing Phase-5 erasure route. Zero editable inputs.
- **Three reachable admin-only surfaces** (`/model-config`, `/audit-log`, `/pdpa-settings`) — every page gates `requireRole({ allowed: ['admin'] })`; `'read-only'` is NOT in any allow-list (D-19/D-24). No send/connect/WABA affordance anywhere. Model-config publish confirm is **neutral-primary** (reversible, D-16), surfaces the ETag-conflict + "may take a moment to take effect" propagation copy.
- **Gates GREEN:** Wave-0 MODEL-02 contract (6/6), Wave-0 AUDIT-01 contract (5/5), ci-guard 1 (no hard-coded model id) + ci-guard 4 (no `{force:true}` publish). `npx tsc --noEmit` clean; i18n parity GREEN.

## Task Commits

1. **Task 1: Remote Config read + publish (MODEL-01/02)** — `f12ccf7` (feat)
2. **Task 2: Audit-log viewer read + PDPA policy constants (AUDIT-01/PDPA-01)** — `4cefb34` (feat)
3. **Task 3: System & Compliance pages/components** — `5ee8206` (feat)

**Plan metadata:** _(final docs commit — this SUMMARY + STATE/ROADMAP/REQUIREMENTS)_

_Note: Task 1 & 2 are TDD tasks turning Wave-0 RED contracts GREEN; the contract tests existed before the implementation, so each is a single GREEN-landing `feat` commit (no separate RED commit — RED was authored in 07-01)._

## Files Created/Modified

- `app/[lang]/(admin)/model-config/actions.ts` — `readModelConfig` (5-pillar read) + `publishModelConfig` (ETag-safe WRITE, audited).
- `app/[lang]/(admin)/model-config/page.tsx` — RSC admin gate; calls `readModelConfig`.
- `app/[lang]/(admin)/model-config/model-config-form.tsx` — per-pillar cards, free-form input, neutral-primary publish confirm, ETag-conflict + propagation copy.
- `app/[lang]/(admin)/audit-log/actions.ts` — `listAuditLogs` bounded cursor read (metadata-only, no self-audit; `ts`→epoch ms).
- `app/[lang]/(admin)/audit-log/page.tsx` — RSC admin gate; calls `listAuditLogs`.
- `app/[lang]/(admin)/audit-log/audit-log-viewer.tsx` — table + filter toolbar + "Load more"; `actorUid`/`targetRef` in `font-mono`.
- `app/[lang]/(admin)/pdpa-settings/page.tsx` — static RSC admin gate; renders policy-constants + erasure link; zero knobs.
- `src/pdpa/policy-constants.ts` — single source for the static PDPA display.

## Decisions Made

- **Unpublished-key display returns `null`, not a fallback model string.** Exporting `REMOTE_CONFIG_FALLBACKS` into the model-config surface would either trip ci-guard 1 (model-id literal) or couple the surface to provider internals. Showing "unset — fallback in effect" is honest and guard-clean.
- **`ts` normalized to epoch ms in the action.** Firestore Timestamps aren't serializable across the RSC→client boundary; the action projects `ts` to a number (Date/`toMillis()`/`toDate()` handled).
- **`AuditLogRow` carries an index signature.** The Wave-0 contract test casts the action result to a `Record<string,unknown>` property bag; the index signature makes that cast type-valid without editing the fixed Wave-0 test (see Deviations Rule 3).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `AuditLogRow` needed an index signature for the Wave-0 contract cast**
- **Found during:** Task 2 (Audit-log viewer read)
- **Issue:** `npx tsc --noEmit` failed in the fixed Wave-0 stub `audit-log/actions.test.ts:126`: it casts `ListAuditLogsResult | ListAuditLogsError` to `{ ok: true; rows: Record<string, unknown>[] }`, and TS rejected the cast because `AuditLogRow` (with `targetRef: string|null`, `ts: …`) had no index signature, so neither union member overlapped the target.
- **Fix:** Added `[key: string]: unknown` to `AuditLogRow` (the viewer renders rows generically; an index signature is a reasonable type design). Also normalized `ts` to `number | null` (epoch ms) for RSC→client serializability.
- **Files modified:** `app/[lang]/(admin)/audit-log/actions.ts`
- **Verification:** `npx tsc --noEmit` clean; Wave-0 AUDIT-01 contract 5/5 GREEN.
- **Committed in:** `4cefb34` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep — the change is confined to the action's own return type to satisfy the pre-authored Wave-0 contract.
**Impact on plan:** Minimal; the Wave-0 RED contract was honored without modification.

## Issues Encountered

- The Wave-0 contracts mock audit imports at **different module paths** — `model-config/actions.test.ts` mocks `@/src/audit` (exposing `log`), while `audit-log/actions.test.ts` mocks `@/src/audit/log` (exposing `log` + `auditDrilldown`) and asserts `auditDrilldown` is never called. Resolved by importing `audit` from `@/src/audit` in model-config and **not importing `auditDrilldown` at all** in the audit-log action — the no-self-audit invariant is structural, not just behavioral.

## User Setup Required

**One external configuration is required before the model-config publish path can run in production** (carried to the rollout/phase gate — consistent with the live-gated checkpoints of Phases 1–6 and 07-02):

- **RC-publish IAM (Open Q5 / A2):** The App Hosting service account must have `firebaseremoteconfig.remoteConfig.update` (Remote Config **publish**, not just read). `modelFor()` read already works in production; the new WRITE path needs this scope. If absent, grant Remote Config Admin (or a custom role with the publish permission) to the SA.
- **5 RC keys (Open Q2 / A1):** Confirm `model.{coach,finder,reply,router,grader}.default` exist in the published template — or accept that the first publish CREATES a missing key (the write path handles create-or-update).
- **End-to-end (carried):** Publish a `model.coach.default` change via the UI; confirm the next chat turn resolves the new id through `modelFor('coach')` (allow for propagation latency).

The 07-02 deploy of the `auditLogs (action,ts)/(actorUid,ts)` composite indexes must also be **Enabled** (not Building) before the filtered `listAuditLogs(action/actorUid)` queries run in production (single-field `orderBy('ts','desc')` needs no composite).

## Next Phase Readiness

- **07-06 (cross-cutting):** This plan introduces three new admin surfaces needing nav entries + trilingual catalog keys (namespaces `adminModelConfig`, `adminAuditLog`, `adminPdpa`) — both deferred to 07-06 per the established convention. The new nav items must list `['admin']` only (read-only sees none — D-24). The PDPA-settings page links to the existing `/[lang]/erasure` route via `PDPA_ERASURE_ROUTE`.
- **Blocker:** none for 07-06 code; the RC-publish IAM grant + RC-key provisioning are the only open live-gated items, surfaced as the structured checkpoint below.

## Self-Check: PASSED

- Files: all 8 created files verified present on disk.
- Commits: `f12ccf7`, `4cefb34`, `5ee8206` verified in `git log`.

---
*Phase: 07-console-ia-v2-net-new-surfaces*
*Completed: 2026-06-11*
