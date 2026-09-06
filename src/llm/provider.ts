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
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

  return providerFor(modelId)
}

/**
 * Build a model handle for whichever PROVIDER the id belongs to
 * (quick-kayinleong-089).
 *
 * This used to be `return anthropic(modelId)`, which quietly made the
 * "model-agnostic, ids live in Firestore" design Anthropic-only: publishing a Gemini id
 * into `appConfig/modelConfig` sent it to `anthropic()` and failed at runtime, so the one
 * swap surface the project has could not actually reach a second provider.
 *
 * WHY IT MATTERS NOW: the app runs on Netlify, whose function ceiling kills a request at
 * exactly 30s. A full `projectDetail` answer measured **39.9s on claude-sonnet-4-6** — over
 * budget, which is what truncated the unit-price tables. Measured alternatives on the same
 * prompt:
 *
 *   claude-sonnet-4-6   39.9s   1538 out tok   3858 chars   OVER
 *   gemini-3.5-flash    20.3s   1450 out tok   3819 chars   fits, same detail
 *   claude-haiku-4-5    15.5s    882 out tok   2401 chars   fits, less detail
 *
 * So the fix is a faster model at equal detail — which is precisely the change this
 * indirection was designed to make cheap, and it could not be made until now.
 *
 * Dispatch is on the id prefix rather than a config field so the Firestore document keeps
 * its existing shape and no admin surface has to change.
 */
function providerFor(modelId: string): LanguageModel {
  if (modelId.startsWith('gemini-') || modelId.startsWith('models/gemini-')) {
    // Gemini Developer API (NOT Vertex — CLAUDE.md hard constraint), using the same key
    // the app already uses for embeddings. Statically imported: `@ai-sdk/google` is already
    // in the graph via src/rag/embed.ts, so there is nothing to save by deferring it, and a
    // `require()` in an ESM module is a needless hazard under Next's bundler.
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
    return google(modelId)
  }
  return anthropic(modelId)
}
