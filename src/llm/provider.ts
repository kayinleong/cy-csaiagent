/**
 * src/llm/provider.ts — Real LLM provider for the Anthropic Claude model line.
 *
 * `modelFor(pillar)` resolves the model ID from Firebase Remote Config at
 * request time — NEVER hard-coded. This satisfies:
 *   - TSD §2.3 C5 (model-agnostic constraint)
 *   - FND-02 / QUAL-01 (provider swap proven by 01-13 integration test)
 *
 * Model-ID resolution path (Firebase Admin Server SDK):
 *   remoteConfig().getServerTemplate() → ServerTemplate
 *   → template.evaluate()              → ServerConfig
 *   → config.getString(`model.${pillar}.default`)
 *
 * If Remote Config is unavailable (offline test or first-time setup), a
 * compile-time constant fallback is used.  The fallback is clearly labeled
 * and is the ONLY place a model-name string is allowed outside Remote Config.
 *
 * IMPORTANT: This file is server-only.  Never import from app/ or browser code.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { anthropic } from '@ai-sdk/anthropic'
import { remoteConfig } from '@/src/firebase/admin'
import type { LanguageModel } from 'ai'

// ─── Supported pillar names ───────────────────────────────────────────────────

export type Pillar = 'coach' | 'finder' | 'reply' | 'router' | 'grader'

// ─── Fallback defaults (labeled — NOT production model IDs) ──────────────────

/**
 * Remote-Config default fallback constants.
 * Used ONLY when Remote Config is unreachable (offline dev / cold bootstrap).
 * The source of truth is always Remote Config in production.
 * These values must mirror the Remote Config defaults set by Derek.
 */
const REMOTE_CONFIG_FALLBACKS: Record<Pillar, string> = {
  coach: 'claude-sonnet-4-6',   // Remote Config key: model.coach.default
  finder: 'claude-sonnet-4-6',  // Remote Config key: model.finder.default
  reply: 'claude-sonnet-4-6',   // Remote Config key: model.reply.default
  router: 'claude-haiku-4-5',   // Remote Config key: model.router.default
  grader: 'claude-opus-4-7',    // Remote Config key: model.grader.default
}

// ─── modelFor ────────────────────────────────────────────────────────────────

/**
 * Resolve the model ID for a pillar from Firebase Remote Config and return
 * an Anthropic language model handle for the AI SDK.
 *
 * Resolution:
 *   1. Call remoteConfig().getServerTemplate() to fetch the current template.
 *   2. Evaluate the template (no client context → default values apply).
 *   3. Read the string value for `model.${pillar}.default`.
 *   4. Pass the resolved ID to anthropic(id) — caller sites are unchanged on swap.
 *
 * On any Remote Config failure (network, unconfigured key, etc.):
 *   Fall back to REMOTE_CONFIG_FALLBACKS[pillar] to avoid a hard crash in
 *   local development before Remote Config is provisioned.
 *
 * QUAL-01 compliance: the route handler calls modelFor('coach') — swapping the
 * Remote Config value to a different model ID is the entire model-swap surface.
 * Call sites never reference a model string directly.
 *
 * @param pillar  The agent pillar requesting a model handle.
 * @returns       An AI SDK LanguageModel ready for use in streamText().
 */
export async function modelFor(pillar: Pillar): Promise<LanguageModel> {
  let modelId: string = REMOTE_CONFIG_FALLBACKS[pillar]

  try {
    const rc = remoteConfig()
    const template = await rc.getServerTemplate()
    const config = template.evaluate()
    const resolved = config.getString(`model.${pillar}.default`)
    if (resolved) {
      modelId = resolved
    }
  } catch {
    // Remote Config unavailable (offline dev, ADC not set up, etc.).
    // Fall through — modelId remains the labeled fallback above.
    // Production always has ADC available via App Hosting.
  }

  return anthropic(modelId)
}
