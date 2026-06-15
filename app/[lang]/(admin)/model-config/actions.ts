'use server'

/**
 * app/[lang]/(admin)/model-config/actions.ts — Model-config read + publish
 * Server Actions (MODEL-01 / MODEL-02 / D-15 / D-16 / D-17).
 *
 * The model-config store is the singleton Firestore doc `appConfig/modelConfig`
 * (quick-kayinleong-017 — replaced Firebase Remote Config). These actions are the
 * write/read half; the resolution half is src/llm/provider.ts modelFor, which
 * reads the same doc.
 *
 * Three-layer admin gate (mirrors roles/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: model-config/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-24).
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED token (never args, T-07-10).
 *
 * Security / correctness invariants:
 *   - READ + WRITE both go through appConfigRef() (Admin SDK; bypasses rules — the
 *     three-layer admin gate above is the authorization boundary).
 *   - publishModelConfig runs a Firestore transaction with an expected-current-value
 *     check: a stale read returns {ok:false,error:'conflict'}, never a blind
 *     overwrite of a concurrent publish (D-16).
 *   - ONLY the 5 pillars are editable; an unknown pillar is rejected (D-16). Model
 *     IDs stay free-form strings — NO hard-coded model id literal lives in this
 *     surface (D-15, ci-guard 1).
 *   - Every successful publish writes an audit row action:'model_config_publish'
 *     (hashed pillar + model id, D-17). A conflict or failure writes no audit row.
 *
 * References:
 *   - MODEL-01, MODEL-02, D-15, D-16, D-17
 *   - src/llm/provider.ts (modelFor READ path + the 5-pillar union)
 *   - src/firebase/collections.ts (appConfigRef + MODEL_CONFIG_DOC_ID, collection 23)
 *   - roles/actions.ts:43-56 (getSessionUser pattern, verbatim)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminDb } from '@/src/firebase/admin'
import { appConfigRef, MODEL_CONFIG_DOC_ID } from '@/src/firebase/collections'
import type { Pillar } from '@/src/llm/provider'
import * as audit from '@/src/audit'

// ─── The 5-pillar union (D-16 — the ONLY editable models.{pillar} keys) ────────

/**
 * The five model-config pillars. This is the SOLE allow-list of editable keys —
 * an unknown pillar is rejected before any Firestore write (D-16). Mirrors the
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
 * Admin-only read of the current model id per pillar (MODEL-01 / D-15) from the
 * singleton Firestore doc `appConfig/modelConfig` — the same doc modelFor() reads.
 *
 * A pillar with no published value returns modelId:null — the UI labels it as
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
    const snap = await appConfigRef().doc(MODEL_CONFIG_DOC_ID).get()
    const models = snap.data()?.models ?? {}

    const rows: ModelConfigRow[] = PILLARS.map((pillar) => ({
      pillar,
      modelId: models[pillar] ?? null,
    }))

    return { ok: true, rows }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read model config'
    return { ok: false, error: msg }
  }
}

// ─── publishModelConfig — the model-config Firestore WRITE round-trip ─────────

/**
 * Admin-only publish of ONE pillar's model id into `appConfig/modelConfig`
 * (MODEL-02 / D-15/16/17).
 *
 * Flow:
 *   1. Assert role === 'admin' from the verified token (never args).
 *   2. Validate pillar ∈ the 5-pillar union — reject unknown (D-16).
 *   3. Run a Firestore transaction: read the current models map; if the stored
 *      value for this pillar differs from `expectedCurrent` (what the admin saw
 *      when they opened the form), return {ok:false,error:'conflict'} and DO NOT
 *      write — never blind-overwrite a concurrent publish (D-16). Otherwise write
 *      the merged models map (tenantId stamped by the converter).
 *   4. audit.log({ action:'model_config_publish', raw:{ pillar, modelId } }) — hashed,
 *      success-only (a conflict or failure returns before this).
 *
 * @param pillar           The pillar key to update (must be one of the 5 pillars).
 * @param modelId          Free-form model id string (D-15 — never validated against a literal allow-list).
 * @param expectedCurrent  The published value the admin saw when opening the form
 *                         (null when the pillar was unpublished). Used for the D-16
 *                         optimistic-concurrency check.
 */
export async function publishModelConfig(
  pillar: string,
  modelId: string,
  expectedCurrent: string | null,
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

  // D-16: only the 5 pillars are editable; reject anything else.
  if (!isPillar(pillar)) {
    return { ok: false, error: 'invalid-pillar', detail: `Unknown pillar: ${pillar}` }
  }

  const docRef = appConfigRef().doc(MODEL_CONFIG_DOC_ID)
  let conflict = false

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(docRef)
      const currentModels: Partial<Record<Pillar, string>> = snap.data()?.models ?? {}
      const current = currentModels[pillar] ?? null

      // D-16 optimistic concurrency: the stored value changed since the admin
      // opened the form → surface a conflict, never blind-overwrite.
      if (current !== expectedCurrent) {
        conflict = true
        return
      }

      const nextModels: Partial<Record<Pillar, string>> = { ...currentModels, [pillar]: modelId }
      tx.set(docRef, {
        tenantId: 'd2' as const,
        models: nextModels,
        updatedBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  } catch {
    // Any Firestore failure (network, infra). Surface a generic code; do NOT echo
    // the raw error message (may carry identifiers — PII/secrets hygiene).
    return { ok: false, error: 'publish-failed', detail: 'Model config publish failed.' }
  }

  if (conflict) {
    return { ok: false, error: 'conflict', detail: 'This setting changed since you opened it. Reload and retry.' }
  }

  // Audit (hashes-only) — log() sha256-hashes every value in `raw` (D-17).
  await audit.log({
    actorUid: user.uid,
    action: 'model_config_publish',
    targetRef: `appConfig/${MODEL_CONFIG_DOC_ID}`,
    raw: { pillar, modelId },
  })

  return { ok: true }
}
