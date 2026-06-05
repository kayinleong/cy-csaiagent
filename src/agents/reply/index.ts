/**
 * src/agents/reply/index.ts — D2 Reply Assistant agent.
 *
 * Exports `replyAgent` which is invoked THROUGH the router (D-01/D-02, Plan 06):
 *   const { pillar } = await routeAsync(messages, { override })
 *   if (pillar === 'reply') {
 *     const systemPrompt = replyAgent.buildSystemPrompt({ replySlot, incoming, voiceSamples, leadId })
 *     const tools = replyAgent.makeTools(userLang, agentUid, leadId)
 *     // Pass systemPrompt + tools to streamText (route handler owns streaming + model resolution)
 *   }
 *
 * Mirrors finderAgent (src/agents/finder/index.ts) exactly:
 *   - buildSystemPrompt(options?) → system prompt with optional lead/voice context
 *   - makeTools(userLang, agentUid?, leadId?) → read-only tool set
 *   - outputSchema → ReplyOutputSchema (for route streamText experimental_output)
 *   - run(args) → offline/test path with an injected SOP-retrieval result
 *
 * Three load-bearing behaviors:
 *   1. Tools are READ-ONLY — no Firestore writes inside tool execute (T-04-TOOLWRITE).
 *      The replySlot write happens in the route's onFinish (Plan 06), NOT in a tool.
 *      The replyEdits write happens in a Server Action (Plan 07), NOT in a tool.
 *   2. Grounded refusal — when retrieveReplySop returns no_sop_match, run() emits a
 *      ReplyOutput with `noSopMatch` and NO draft. Never a fabricated SOP (D-11).
 *   3. Model IDs resolved via modelFor('reply') in the ROUTE (Plan 06) — this core
 *      file never calls modelFor. Never hard-coded.
 *
 * The `run()` method handles the offline/test path (injected SOP result). The streaming
 * path (route) reuses buildSystemPrompt + makeTools and passes them to streamText.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { buildReplySystemPrompt, REPLY_SYSTEM_PROMPT } from './prompt'
import {
  makeRetrieveReplySopTool,
  makeFetchVoiceSamplesTool,
  makeFetchLeadContextTool,
} from './tools'
import { ReplyOutputSchema } from './schema'
import type { ReplyOutput } from './schema'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Reply inbound classification (REPLY-05/06/07; D-06). */
export type ReplyClassification = 'cold-prospect' | 'objection' | 'financing' | 'other'

/**
 * The retrieveReplySop tool-result shape injected for the offline/test path.
 *
 * Accepts the structural shape the tool returns (and the Wave-0 reply.test.ts fixtures
 * use): a hit carries `citations[].docId` (the SOP grounding trail) + `context`; a miss
 * carries `found:false` + a `no_sop_match` reason. `found` is intentionally a plain
 * boolean here (not a literal discriminant) so plain test fixtures type-check; run()
 * narrows on `found` at runtime.
 */
export interface InjectedSopResult {
  found: boolean
  citations?: Array<{ docId: string; snippet?: string; chunkId?: string }>
  context?: string
  reason?: string
}

export interface ReplyRunArgs {
  /** Conversation messages (most-recent last). Content is already PDPA-redacted upstream. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Language of the current turn. */
  userLang: 'en' | 'ms' | 'zh'
  /** The authenticated agent's UID. */
  agentUid: string
  /** Lead ID — used for the replySlot write in onFinish (route). Required for Reply turns (D-07). */
  leadId?: string
  /** The inbound classification (cold-prospect / objection / financing / other). */
  classification?: ReplyClassification
  /** Injected retrieveReplySop result for the offline/test path (bypasses the live tool call). */
  injectedSopResult?: InjectedSopResult
  /** When true, the inbound is ambiguous/empty → emit a clarifyingQuestion instead of a draft. */
  ambiguous?: boolean
}

export interface ReplyRunResult {
  /** The Reply Assistant's validated output (draft / noSopMatch / clarifyingQuestion). */
  output: ReplyOutput
}

// ─── replyAgent ────────────────────────────────────────────────────────────────

/**
 * The Reply Assistant agent singleton.
 *
 * Mirrors finderAgent shape exactly:
 *   - buildSystemPrompt(options?) → system prompt with optional lead/voice context
 *   - makeTools(userLang, agentUid?, leadId?) → read-only tool set
 *   - outputSchema → ReplyOutputSchema
 *   - run(args) → offline/test path with an injected SOP-retrieval result
 *
 * The streaming path (Plan 06) uses buildSystemPrompt + makeTools + modelFor('reply').
 * run() is used for offline testing of the grounding/refusal gate (no Firestore, no Anthropic).
 */
export const replyAgent = {
  /**
   * Base system prompt (no lead/voice context).
   * Use buildSystemPrompt() in production to inject replySlot + voice context.
   */
  systemPrompt: REPLY_SYSTEM_PROMPT,

  /**
   * Build a lead-context- and voice-aware system prompt.
   * Call this at invocation time with the stored replySlot + curated voice text.
   *
   * @param options  Optional runtime context (replySlot, incoming, voiceSamples, leadId).
   */
  buildSystemPrompt(options?: {
    replySlot?: Record<string, unknown>
    incoming?: string
    voiceSamples?: string
    leadId?: string
  }): string {
    return buildReplySystemPrompt(options)
  },

  /** Output schema — used for Zod validation + streamText experimental_output. */
  outputSchema: ReplyOutputSchema,

  /**
   * Build the tool set for this conversation turn.
   *
   * @param userLang  Injected via closure so tools can localise descriptions.
   * @param agentUid  The authenticated agent's UID (for audit / future tool needs).
   * @param leadId    The current lead ID (scopes fetchLeadContext to this lead — REPLY-03).
   */
  makeTools(userLang: 'en' | 'ms' | 'zh', agentUid?: string, leadId?: string) {
    // agentUid is available for future tool needs.
    void agentUid

    return {
      retrieveReplySop: makeRetrieveReplySopTool(userLang),
      fetchVoiceSamples: makeFetchVoiceSamplesTool(),
      fetchLeadContext: makeFetchLeadContextTool(leadId),
    }
  },

  /**
   * Run the Reply Assistant for one turn (offline / test path).
   *
   * Exercises the full gate without Firestore or Anthropic:
   *   - ambiguous inbound          → clarifyingQuestion (ask, don't guess)
   *   - injectedSopResult miss     → grounded noSopMatch refusal (never a draft — D-11)
   *   - injectedSopResult hit      → grounded draft citing the SOP doc IDs from the result
   *
   * The XOR invariant (exactly one of draft / noSopMatch / clarifyingQuestion) is enforced
   * here at the app level, then ReplyOutputSchema.parse validates the result.
   *
   * For the streaming path (route), the handler passes buildSystemPrompt + makeTools +
   * modelFor('reply') to streamText. The streaming path does NOT call run() directly.
   */
  async run(args: ReplyRunArgs): Promise<ReplyRunResult> {
    const output = buildOutputFromSopResult(args)
    const validated = ReplyOutputSchema.parse(output)
    return { output: validated }
  },
} as const

// ─── Output builder ───────────────────────────────────────────────────────────

/**
 * Build a ReplyOutput from an injected SOP-retrieval result (offline/test path).
 *
 * Grounding rules (D-11):
 *   - ambiguous            → clarifyingQuestion (no draft)
 *   - SOP miss (found:false)→ grounded noSopMatch refusal (no draft, never invents)
 *   - SOP hit (found:true) → a draft grounded in the returned SOP doc IDs
 *
 * Per-lead isolation (REPLY-03 / SC2): the draft is built ONLY from the current turn's
 * messages + injected SOP result — it never references another lead's content.
 */
function buildOutputFromSopResult(args: ReplyRunArgs): ReplyOutput {
  const { injectedSopResult, ambiguous, classification, messages } = args

  // ── Ambiguous inbound → ask, don't guess ──────────────────────────────────
  if (ambiguous) {
    return {
      clarifyingQuestion:
        'Could you paste the full message from the lead? The current text is too short to draft a grounded reply.',
    }
  }

  // ── No injected result (no live streaming context) → ask for the inbound ──
  if (injectedSopResult === undefined) {
    return {
      clarifyingQuestion: 'Could you paste the incoming message you want me to draft a reply to?',
    }
  }

  // ── SOP miss → grounded refusal, NEVER a fabricated draft (D-11) ──────────
  if (!injectedSopResult.found) {
    return {
      noSopMatch: {
        reason: 'no_sop_match',
        message:
          'I don\'t have a D2 reply SOP for this — please draft manually, or check with your senior coach.',
      },
    }
  }

  // ── SOP hit → grounded draft citing the real SOP doc IDs ──────────────────
  // sopDocIds come from the tool result's citations — never fabricated.
  const sopDocIds = (injectedSopResult.citations ?? [])
    .map((c) => c.docId)
    .filter((id) => id.length > 0)

  // Defensive: a "hit" with no citable SOP doc ID cannot ground a draft → refuse.
  if (sopDocIds.length === 0) {
    return {
      noSopMatch: {
        reason: 'no_sop_match',
        message:
          'I don\'t have a citable D2 reply SOP for this — please draft manually, or check with your senior coach.',
      },
    }
  }

  const text = buildDraftText(classification ?? 'other', messages, sopDocIds)

  return {
    draft: { text, sopDocIds },
  }
}

// ─── Draft text builder ─────────────────────────────────────────────────────

/**
 * Build a grounded draft body for the offline/test path.
 *
 * Cites the SOP doc IDs as [SOP:doc-id]. The cold-prospect branch (REPLY-05) uses
 * qualifying questions (never an auto-pitch). The objection/financing branches frame
 * the reply per the SOP. The live streaming path produces the real model-authored draft;
 * this offline builder produces a deterministic, grounded, classification-correct stand-in.
 *
 * Per-lead isolation: built only from THIS turn's inputs.
 */
function buildDraftText(
  classification: ReplyClassification,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  sopDocIds: string[],
): string {
  void messages // available for future i18n / per-message tailoring
  const citation = sopDocIds.map((id) => `[SOP:${id}]`).join(' ')

  switch (classification) {
    case 'cold-prospect':
      // REPLY-05: qualifying questions, NEVER an auto-pitch. Must contain a '?'.
      return (
        `Thanks for reaching out. To point you to the right options, could I ask a few quick questions: ` +
        `What is your budget range? When are you looking to move or invest? Which areas are you considering? ` +
        `Grounded in D2 SOP ${citation}.`
      )
    case 'objection':
      return (
        `I hear you on that, and it is a fair point. Let me put it in context so the value is clearer, ` +
        `and we can look at what fits your priorities best. Grounded in D2 SOP ${citation}.`
      )
    case 'financing':
      return (
        `Good question on the financing side. Here is how it generally works at a high level; ` +
        `for the exact rate and approval we would confirm with the bank. Grounded in D2 SOP ${citation}.`
      )
    default:
      return `Thanks for your message. Here is a grounded reply based on D2 SOP ${citation}.`
  }
}
