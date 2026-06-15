/**
 * src/llm/provider.ts — Real LLM provider for the Anthropic Claude model line.
 *
 * `modelFor(pillar)` resolves the model ID from Firestore at request time —
 * NEVER hard-coded. This satisfies:
 *   - TSD §2.3 C5 (model-agnostic constraint)
 *   - FND-02 / QUAL-01 (provider swap proven by 01-13 integration test)
 *
 * Model-ID resolution path (Firebase Admin Firestore SDK):
 *   appConfigRef().doc(MODEL_CONFIG_DOC_ID).get() → DocumentSnapshot<ModelConfigDoc>
 *   → snapshot.data()?.models?.[pillar]
 *
 * The source of truth is the singleton Firestore doc `appConfig/modelConfig`
 * (published by the admin model-config surface). This replaced Firebase Remote
 * Config as the model-config store (quick-kayinleong-017).
 *
 * If Firestore is unavailable (offline test or first-time setup) or a pillar is
 * unpublished, a compile-time constant fallback is used. The fallback is clearly
 * labeled and is the ONLY place a model-name string is allowed outside Firestore.
 *
 * IMPORTANT: This file is server-only.  Never import from app/ or browser code.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { anthropic } from '@ai-sdk/anthropic'
import { appConfigRef, MODEL_CONFIG_DOC_ID } from '@/src/firebase/collections'
import type { LanguageModel } from 'ai'

// ─── Supported pillar names ───────────────────────────────────────────────────

export type Pillar = 'coach' | 'finder' | 'reply' | 'router' | 'grader'

// ─── Fallback defaults (labeled — NOT production model IDs) ──────────────────

/**
 * Compile-time model fallback constants.
 * Used ONLY when the Firestore `appConfig/modelConfig` doc is unreachable
 * (offline dev / cold bootstrap) or a pillar has no published value.
 * The source of truth is always Firestore in production.
 * These values must mirror the published defaults set by Derek.
 */
const MODEL_FALLBACKS: Record<Pillar, string> = {
  coach: 'claude-sonnet-4-6',   // appConfig/modelConfig models.coach
  finder: 'claude-sonnet-4-6',  // appConfig/modelConfig models.finder
  reply: 'claude-sonnet-4-6',   // appConfig/modelConfig models.reply
  router: 'claude-haiku-4-5',   // appConfig/modelConfig models.router
  grader: 'claude-opus-4-7',    // appConfig/modelConfig models.grader
}

// ─── modelFor ────────────────────────────────────────────────────────────────

/**
 * Resolve the model ID for a pillar from the Firestore `appConfig/modelConfig`
 * doc and return an Anthropic language model handle for the AI SDK.
 *
 * Resolution:
 *   1. Read the singleton doc appConfig/modelConfig via the Admin SDK.
 *   2. Look up models[pillar] in the doc.
 *   3. Pass the resolved ID to anthropic(id) — caller sites are unchanged on swap.
 *
 * On any Firestore failure (network, unconfigured doc, unpublished pillar):
 *   Fall back to MODEL_FALLBACKS[pillar] to avoid a hard crash in local
 *   development before the doc is provisioned.
 *
 * QUAL-01 compliance: the route handler calls modelFor('coach') — publishing a
 * different model ID into appConfig/modelConfig is the entire model-swap surface.
 * Call sites never reference a model string directly.
 *
 * @param pillar  The agent pillar requesting a model handle.
 * @returns       An AI SDK LanguageModel ready for use in streamText().
 */
export async function modelFor(pillar: Pillar): Promise<LanguageModel> {
  let modelId: string = MODEL_FALLBACKS[pillar]

  try {
    const snap = await appConfigRef().doc(MODEL_CONFIG_DOC_ID).get()
    const resolved = snap.data()?.models?.[pillar]
    if (resolved) {
      modelId = resolved
    }
  } catch {
    // Firestore unavailable (offline dev, ADC not set up, etc.).
    // Fall through — modelId remains the labeled fallback above.
    // Production always has ADC available via App Hosting.
  }

  return anthropic(modelId)
}
