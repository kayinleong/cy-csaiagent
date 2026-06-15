'use server'

/**
 * app/[lang]/(admin)/model-config/actions.ts — Model-config Remote Config
 * read + publish Server Actions (MODEL-01 / MODEL-02 / D-15 / D-16 / D-17).
 *
 * THE ONE NET-NEW MECHANISM of Phase 7: the Remote Config WRITE round-trip.
 * Everything else in this phase copies a verbatim-proven pattern; this adds the
 * write half of Remote Config to the existing read half (src/llm/provider.ts
 * modelFor).
 *
 * Three-layer admin gate (mirrors roles/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: model-config/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-24).
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED token (never args, T-07-10).
 *
 * Security / correctness invariants:
 *   - READ reuses modelFor's server-template path (getServerTemplate → evaluate →
 *     getString) for display; the WRITE MUST use getTemplate() (it carries the
 *     writable ETag — getServerTemplate does not).
 *   - publishModelConfig publishes WITHOUT { force:true } — the ETag provides
 *     optimistic concurrency. A stale-ETag rejection returns {ok:false,error:'conflict'},
 *     never a blind overwrite (D-16, ci-guard 4).
 *   - ONLY the 5 model.{pillar}.default keys are editable; an unknown pillar is
 *     rejected (D-16). Model IDs stay free-form strings — NO hard-coded model id
 *     literal lives in this surface (D-15, ci-guard 1).
 *   - Every publish writes an audit row action:'model_config_publish' (hashed
 *     pillar + model id, D-17). REMOTE_CONFIG_FALLBACKS constants are NOT mutated.
 *
 * References:
 *   - MODEL-01, MODEL-02, D-15, D-16, D-17
 *   - src/llm/provider.ts (modelFor READ path + the 5-pillar union)
 *   - roles/actions.ts:43-56 (getSessionUser pattern, verbatim)
 *   - 07-PATTERNS.md §model-config/actions.ts (the WRITE example)
 *   - 07-RESEARCH.md §Code Examples "Remote Config WRITE with ETag concurrency"
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { remoteConfig } from '@/src/firebase/admin'
import type { Pillar } from '@/src/llm/provider'
import * as audit from '@/src/audit'

// ─── The 5-pillar union (D-16 — the ONLY editable model.{pillar}.default keys) ──

/**
 * The five model-config pillars. This is the SOLE allow-list of editable keys —
 * an unknown pillar is rejected before any template mutation (D-16). Mirrors the
 * Pillar union in src/llm/provider.ts (single source of pillar names).
 */
const PILLARS: readonly Pillar[] = ['coach', 'finder', 'reply', 'router', 'grader'] as const

function isPillar(value: string): value is Pillar {
  return (PILLARS as readonly string[]).includes(value)
}

// ─── Session helper (verbatim copy of roles/actions.ts:43-56) ─────────────────

async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/model-config', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelConfigRow {
  /** One of the 5 pillars. */
  pillar: Pillar
  /** The published model id for this pillar, or null when the key is unpublished. */
  modelId: string | null
}

export interface ReadModelConfigResult {
  ok: true
  rows: ModelConfigRow[]
}

export type PublishModelConfigResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string }

// ─── readModelConfig ──────────────────────────────────────────────────────────

/**
 * Admin-only read of the current model.{pillar}.default value for the 5 pillars
 * (MODEL-01 / D-15). Reuses modelFor's server-template read path for display.
 *
 * A key with no published value returns modelId:null — the UI labels it as
 * "unset (cold-bootstrap fallback in effect)" rather than naming a model string,
 * so no hard-coded model id literal ever lives in this surface (ci-guard 1).
 */
export async function readModelConfig(): Promise<ReadModelConfigResult | { ok: false; error: string }> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    const rc = remoteConfig()
    const template = await rc.getServerTemplate()
    const config = template.evaluate()

    const rows: ModelConfigRow[] = PILLARS.map((pillar) => {
      const resolved = config.getString(`model.${pillar}.default`)
      return { pillar, modelId: resolved ? resolved : null }
    })

    return { ok: true, rows }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read model config'
    return { ok: false, error: msg }
  }
}

// ─── publishModelConfig — the net-new Remote Config WRITE round-trip ──────────

/**
 * Admin-only publish of ONE model.{pillar}.default key (MODEL-02 / D-15/16/17).
 *
 * Flow:
 *   1. Assert role === 'admin' from the verified token (never args).
 *   2. Validate pillar ∈ the 5-pillar union — reject unknown (D-16).
 *   3. getTemplate() — carries the writable ETag (NOT getServerTemplate).
 *   4. Mutate ONLY parameters['model.{pillar}.default'].defaultValue = {value: modelId}.
 *   5. publishTemplate(template) WITHOUT { force:true } — ETag optimistic concurrency.
 *      A rejection (stale ETag) → {ok:false,error:'conflict'}, never blind-overwrite.
 *   6. audit.log({ action:'model_config_publish', raw:{ pillar, modelId } }) — hashed.
 *
 * @param pillar   The pillar key to update (must be one of the 5 pillars).
 * @param modelId  Free-form model id string (D-15 — never validated against a literal allow-list).
 */
export async function publishModelConfig(
  pillar: string,
  modelId: string,
): Promise<PublishModelConfigResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Admin-only gate (D-17) — role from the verified token, never from args.
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  // D-16: only the 5 model.{pillar}.default keys are editable; reject anything else.
  if (!isPillar(pillar)) {
    return { ok: false, error: 'invalid-pillar', detail: `Unknown pillar: ${pillar}` }
  }

  const rc = remoteConfig()

  // getTemplate() (NOT getServerTemplate) — the project template carries the
  // writable ETag the SDK sends back on publish for optimistic concurrency.
  const template = await rc.getTemplate()
  const key = `model.${pillar}.default`

  // Mutate (or create) ONLY this one parameter's default value. Other keys and
  // REMOTE_CONFIG_FALLBACKS are untouched. ExplicitParameterValue = { value: string }.
  template.parameters[key] = {
    ...(template.parameters[key] ?? {}),
    defaultValue: { value: modelId },
  }

  try {
    // Publish WITHOUT { force:true } — the SDK sends the template's ETag (D-16).
    // A concurrent publish since our read → stale-ETag rejection below.
    await rc.publishTemplate(template)
  } catch (err) {
    // firebase-admin throws FirebaseRemoteConfigError (PrefixedFirebaseError),
    // whose `.code` is a prefixed string like `remote-config/failed-precondition`.
    // Read defensively: a plain Error with no `.code` falls through to publish-failed
    // (anti-masking — we must NOT report every failure as a conflict).
    const code = (err as { code?: string })?.code ?? ''

    // Stale ETag / concurrent publish → genuine conflict; never blind-overwrite (D-16).
    if (code.includes('failed-precondition') || code.includes('aborted')) {
      return { ok: false, error: 'conflict', detail: 'Template changed — reload and retry.' }
    }

    // SA lacks Remote Config publish permission. Surface a distinct, actionable
    // error WITHOUT naming the SA email or echoing the raw message (PII/secrets hygiene).
    if (code.includes('permission-denied')) {
      return {
        ok: false,
        error: 'permission-denied',
        detail: 'Service account lacks Remote Config publish permission.',
      }
    }

    // Any other failure (validation, network, not-found, plain Error): surface a
    // generic code; do NOT echo err.message (may carry identifiers).
    return { ok: false, error: 'publish-failed', detail: 'Remote Config publish failed.' }
  }

  // Audit (hashes-only) — log() sha256-hashes every value in `raw` (D-17).
  await audit.log({
    actorUid: user.uid,
    action: 'model_config_publish',
    targetRef: `remoteConfig/${key}`,
    raw: { pillar, modelId },
  })

  return { ok: true }
}
