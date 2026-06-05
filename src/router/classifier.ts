/**
 * src/router/classifier.ts — LLM intent classifier (ACTIVATED in Phase 3).
 *
 * Classifies a conversation's intent into a pillar using structured output
 * (generateObject via AI SDK v5). Model is resolved from Firebase Remote Config
 * via modelFor('router') — NEVER hard-coded.
 *
 * Phase 3 activation: removed the NotActivatedError stub; implemented real
 * generateObject call with RouteSchema (coach | finder).
 * Phase 4 (REPLY-10): widened RouteSchema binary→ternary — 'reply' is now classifiable.
 *
 * Design reference: TSD §3.2 router row + D-01 (classifier activation) + D-06.
 * Research reference: 03-RESEARCH.md Pattern 1 + Pitfall 2.
 *
 * NEVER import from app/ or next — this is a core module (CLAUDE.md core/shell rule).
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { modelFor } from '@/src/llm/provider'
import type { MessageTurn } from './heuristic'

// ─── Route schema ─────────────────────────────────────────────────────────────

/**
 * Zod schema for the structured routing decision returned by the classifier.
 * Ternary as of Phase 4 (REPLY-10): the third pillar 'reply' is now classifiable.
 */
const RouteSchema = z.object({
  pillar: z.enum(['coach', 'finder', 'reply']),   // 'reply' added Phase 4 (REPLY-10)
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * System prompt for the router model. Describes pillar scope in clear terms
 * so the model can classify ambiguous conversation intents.
 *
 * Kept concise — this runs on every ambiguous turn (cost/latency matters).
 */
const ROUTER_SYSTEM_PROMPT = `You are an intent classification system for a real-estate agency training platform.

Classify the user's conversation intent into one of three pillars:

- "coach": onboarding, training, career journey, D2 playbooks, comprehension checkpoints, Meta ads setup, knowledge questions about D2 processes, escalation, and mentorship.
- "finder": property matching, lead criteria, project recommendations, budget/RM amounts, bedroom count, location preferences, investment vs own-stay, eligibility, collateral requests, and inventory queries.
- "reply": the agent pastes an INCOMING WhatsApp message from a lead/client and wants a drafted reply (cold-prospect qualifying / objection-handling / financing). Choose "reply" when the message contains a quoted inbound or asks to draft/answer a reply (e.g. "draft a reply to this", "the lead said …, what should I reply?").

Return:
- pillar: "coach", "finder", or "reply"
- confidence: 0.0 to 1.0 (how certain you are)
- reason: one short sentence explaining the classification

When in doubt, prefer "coach" (the safer, established pillar). Only return "finder" when the message is clearly about property matching or lead criteria, and "reply" when the agent is drafting a response to a quoted inbound message.`

// ─── Compact summary ──────────────────────────────────────────────────────────

/**
 * Build a compact text prompt from the last few message turns.
 * Keeps the classifier prompt short — we only need enough context to classify intent.
 * Messages are already PDPA-redacted upstream before reaching this function.
 */
function compactSummary(messages: MessageTurn[], maxTurns = 4): string {
  const relevant = messages.slice(-maxTurns)
  return relevant
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')
}

// ─── classifyIntent ───────────────────────────────────────────────────────────

/**
 * Classify the intent of a conversation and return the appropriate pillar.
 *
 * Called only for ambiguous messages (after the heuristic fast-path and override chip).
 * Model resolved from Remote Config via modelFor('router') — key: model.router.default;
 * fallback: claude-haiku-4-5.
 *
 * @param messages  The conversation history (PDPA-redacted; most-recent last).
 * @returns         { pillar: 'coach'|'finder'|'reply', confidence: number, reason: string }
 */
export async function classifyIntent(
  messages: MessageTurn[]
): Promise<{ pillar: 'coach' | 'finder' | 'reply'; confidence: number; reason: string }> {
  const model = await modelFor('router')  // Remote Config; NEVER hard-code the model ID

  const { object } = await generateObject({
    model,
    schema: RouteSchema,
    system: ROUTER_SYSTEM_PROMPT,
    prompt: compactSummary(messages),
  })

  return object
}
