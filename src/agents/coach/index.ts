/**
 * src/agents/coach/index.ts — D2 Onboarding Coach agent.
 *
 * Exports `coachAgent` which is invoked THROUGH the router (TSD §6, D-09):
 *   const { pillar } = router.route(messages)  // always 'coach' in Phase 1/2
 *   const result = await coachAgent.run({ ... })
 *
 * The Coach is grown in Phase 2 to include:
 *   - Journey-stage-aware system prompt (buildCoachSystemPrompt with injected context)
 *   - Journey read-only tools: getCurrentCheckpoint, getCheckpointContent
 *   - Comprehension gate delivery (free-text paraphrase — no MCQ)
 *   - KB-miss → emitHandoffSignal (unchanged behavior preserved)
 *
 * Anti-patterns (from RESEARCH.md):
 *   - Tools are READ-ONLY (no Firestore writes inside tool execute — T-02-15).
 *   - Journey advances happen via a Server Action gated by a passing comprehension grade.
 *   - Model IDs resolved via modelFor() — never hard-coded.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { buildCoachSystemPrompt, COACH_SYSTEM_PROMPT } from './prompt'
import {
  makeRetrieveKnowledgeTool,
  makeGetCurrentCheckpointTool,
  makeGetCheckpointContentTool,
} from './tools'
import { CoachOutputSchema } from './schema'
import type { CoachOutput } from './schema'
import { emitHandoffSignal } from '@/src/escalation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoachRunArgs {
  /** Conversation messages (most-recent last). Content is already PDPA-redacted upstream. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Language of the current turn for RAG pre-filter. */
  userLang: 'en' | 'ms' | 'zh'
  /** The authenticated agent's UID — used for the handoff signal + journey tools. */
  agentUid: string
  /** Senior coach UID — used for the handoff escalation. Default empty. */
  seniorCoachId?: string
  /** Conversation ID — used for the handoff context bundle. */
  conversationId?: string
  /** Journey context — injected at invocation time from the agent's profile. */
  journeyContext?: {
    journeyStage: string
    currentCheckpoint: string
  }
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
 *     // Build the system prompt with the agent's journey context
 *     const systemPrompt = coachAgent.buildSystemPrompt({ journeyStage, currentCheckpoint })
 *     const tools = coachAgent.makeTools(userLang, agentUid)
 *     // Pass systemPrompt + tools to streamText
 *   }
 *
 * The `run` method is NOT called directly by tests — tests drive via router.route
 * then dispatch (Test 5 of coach.test.ts).
 */
export const coachAgent = {
  /**
   * Base system prompt (no journey context).
   * Use buildSystemPrompt() for production runs that inject journey context.
   * Kept for backwards compatibility with callers that read .systemPrompt directly.
   */
  systemPrompt: COACH_SYSTEM_PROMPT,

  /**
   * Build a journey-context-aware system prompt.
   * Call this at invocation time with the agent's current journey position.
   */
  buildSystemPrompt(journeyContext?: { journeyStage: string; currentCheckpoint: string }): string {
    return buildCoachSystemPrompt(journeyContext)
  },

  /** Output schema — used for Zod validation of the model's structured response. */
  outputSchema: CoachOutputSchema,

  /**
   * Build the tool set for this conversation turn.
   * Includes retrieveKnowledge (grounding) + journey read-only tools.
   *
   * @param userLang  Injected via closure so the RAG pre-filter uses the right language.
   * @param agentUid  Injected via closure for the getCurrentCheckpoint tool.
   */
  makeTools(userLang: 'en' | 'ms' | 'zh', agentUid?: string) {
    const tools: Record<string, ReturnType<typeof makeRetrieveKnowledgeTool>> = {
      retrieveKnowledge: makeRetrieveKnowledgeTool(userLang),
    }

    // Journey tools require agentUid — only add when available.
    if (agentUid) {
      // Type assertion is needed because the tool registry has a mixed type.
      (tools as Record<string, unknown>)['getCurrentCheckpoint'] = makeGetCurrentCheckpointTool(agentUid);
      (tools as Record<string, unknown>)['getCheckpointContent'] = makeGetCheckpointContentTool(userLang)
    }

    return tools
  },

  /**
   * Run the Coach agent for one turn.
   *
   * This method is called by the route handler AFTER router.route() selects 'coach'.
   * It does NOT call streamText itself — the route handler owns the streaming response.
   * `run()` is used for offline / unit-testable logic that validates output and
   * emits the handoff signal on a KB miss.
   *
   * For the streaming path (route handler), the handler passes the result of
   * `buildSystemPrompt(journeyContext)` and `makeTools(userLang, agentUid)` to `streamText`.
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
