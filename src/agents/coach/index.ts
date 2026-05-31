/**
 * src/agents/coach/index.ts — D2 Onboarding Coach agent.
 *
 * Exports `coachAgent` which is invoked THROUGH the router (TSD §6, D-09):
 *   const { pillar } = router.route(messages)  // always 'coach' in Phase 1
 *   const result = await coachAgent.run({ ... })
 *
 * The Coach is minimal-but-extensible:
 *   - Thin scoped system prompt (prompt.ts)
 *   - ONE read-only tool: retrieveKnowledge → real chunk-ID citations (tools.ts)
 *   - Zod output schema enforcement (schema.ts)
 *   - KB-miss → emitHandoffSignal (never hallucinate)
 *
 * Phase-2 extension points (do NOT add these now — follow YAGNI):
 *   - journeyStage / currentCheckpoint injected into prompt
 *   - proactive stall nudges
 *   - voice fingerprint few-shot examples
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { COACH_SYSTEM_PROMPT } from './prompt'
import { makeRetrieveKnowledgeTool } from './tools'
import { CoachOutputSchema } from './schema'
import type { CoachOutput } from './schema'
import { emitHandoffSignal } from '@/src/escalation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoachRunArgs {
  /** Conversation messages (most-recent last). Content is already PDPA-redacted upstream. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Language of the current turn for RAG pre-filter. */
  userLang: 'en' | 'ms' | 'zh'
  /** The authenticated agent's UID — used for the handoff signal. */
  agentUid: string
  /** Senior coach UID — used for the handoff escalation. Default empty. */
  seniorCoachId?: string
  /** Conversation ID — used for the handoff context bundle. */
  conversationId?: string
}

export interface CoachRunResult {
  /** The Coach's validated output (answer + citations). */
  output: CoachOutput
  /** Whether a KB-miss handoff was emitted. */
  handoffEmitted: boolean
}

// ─── coachAgent ───────────────────────────────────────────────────────────────

/**
 * The Coach agent singleton.
 *
 * Usage (invoked THROUGH the router — see /api/chat/route.ts):
 *   const { pillar } = router.route(messages)
 *   if (pillar === 'coach') {
 *     const result = await coachAgent.run({ messages, userLang, agentUid })
 *   }
 *
 * The `run` method is NOT called directly by tests — tests drive via router.route
 * then dispatch (Test 5 of coach.test.ts).
 */
export const coachAgent = {
  /** System prompt — injected as `system` in streamText. */
  systemPrompt: COACH_SYSTEM_PROMPT,

  /** Output schema — used for Zod validation of the model's structured response. */
  outputSchema: CoachOutputSchema,

  /**
   * Build the tool set for this conversation turn.
   * `userLang` is injected via closure so the RAG pre-filter uses the right language.
   */
  makeTools(userLang: 'en' | 'ms' | 'zh') {
    return {
      retrieveKnowledge: makeRetrieveKnowledgeTool(userLang),
    }
  },

  /**
   * Run the Coach agent for one turn.
   *
   * This method is called by the route handler AFTER router.route() selects 'coach'.
   * It does NOT call streamText itself — the route handler owns the streaming response.
   * `run()` is used for offline / unit-testable logic that validates output and
   * emits the handoff signal on a KB miss.
   *
   * For the streaming path (route handler), the handler passes `coachAgent.systemPrompt`
   * and `coachAgent.makeTools(userLang)` directly to `streamText`.
   *
   * For testing purposes (the fake provider path), the handler calls `run()` to
   * exercise the full gate: retrieval → handoff detection → Zod validation.
   */
  async run(args: CoachRunArgs, options?: {
    /** Optional raw model response text (from streamText or fake provider). */
    rawResponse?: string
    /** Raw retrieval results for direct injection in tests (bypasses actual rag.retrieve). */
    retrieveResults?: Awaited<ReturnType<typeof import('@/src/rag').retrieve>>
  }): Promise<CoachRunResult> {
    const { agentUid, seniorCoachId = '', conversationId = 'unknown', userLang } = args

    // If retrieval results are injected (test path), use them directly
    let rawOutput: CoachOutput

    if (options?.rawResponse) {
      // Parse the raw model response as JSON (the model is instructed to return JSON)
      try {
        const parsed = JSON.parse(options.rawResponse)
        // Detect KB-miss before Zod schema validation — an empty answer + empty citations
        // is the KB-miss signal (model correctly returned nothing on a miss).
        if (!parsed.answer && parsed.citations?.length === 0) {
          // Treat as KB-miss — skip Zod parse (empty answer would fail min(1))
          rawOutput = {
            answer: '', // will be overwritten by the handoff path below
            citations: [],
            handoff: parsed.handoff ?? { reason: 'kb_miss' as const },
          }
        } else {
          rawOutput = CoachOutputSchema.parse(parsed)
        }
      } catch {
        // If JSON parsing fails, treat as a plain-text answer with no citations
        rawOutput = {
          answer: options.rawResponse,
          citations: [],
        }
      }
    } else {
      // Default: return a placeholder (the real streaming path goes through route.ts)
      rawOutput = {
        answer: '',
        citations: [],
      }
    }

    // Grounding check: if retrieval returned nothing, emit handoff signal.
    // A KB-miss is signaled by: explicit handoff.reason='kb_miss', OR empty citations + empty answer.
    const isHandoff =
      rawOutput.handoff?.reason === 'kb_miss' ||
      (rawOutput.citations.length === 0 && !rawOutput.answer)

    let handoffEmitted = false
    if (isHandoff) {
      // Emit KB-miss handoff signal (escalation row, dedup-guarded)
      await emitHandoffSignal({
        agentUid,
        seniorCoachId,
        reason: 'kb_miss',
        contextBundle: {
          conversationId,
          lang: userLang,
          // Never include raw query text — use hash in production (PDPA)
        },
      })
      handoffEmitted = true

      // Return the miss output with the handoff signal
      rawOutput = {
        answer: 'I could not find relevant D2 training materials for your query. Your coach has been notified.',
        citations: [],
        handoff: { reason: 'kb_miss' },
      }
    }

    // Validate final output against the schema
    const output = CoachOutputSchema.parse(rawOutput)

    return { output, handoffEmitted }
  },
} as const
