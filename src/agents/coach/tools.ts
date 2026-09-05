/**
 * src/agents/coach/tools.ts — AI SDK tools for the D2 Onboarding Coach.
 *
 * Tools (all READ-ONLY — no Firestore writes inside a tool execute):
 *   1. retrieveKnowledge — Calls rag.retrieve(query, userLang) to fetch KB chunks.
 *   2. getCurrentCheckpoint — Returns the agent's current journey stage/checkpoint.
 *   3. getCheckpointContent — Retrieves KB content for a named checkpoint.
 *
 * Security (TSD §3.2, T-02-15):
 *   - Tools are READ-ONLY: no Firestore writes from within a tool execute().
 *   - Journey advances (commitAdvance) happen via a Server Action gated by a passing
 *     comprehension grade — never inside a tool call (T-02-15: model cannot self-advance).
 *   - Tools authenticate as the service account (admin path via the rag/memory facades);
 *     Phase 2 adds per-user auth scoping.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { retrieve, buildCitations, isRetrievalMiss } from '@/src/rag'
import type { RetrievalResult } from '@/src/rag'
import { getAgentProfile } from '@/src/memory/agentProfile'
import { D2_JOURNEY } from '@/src/coach/journey/config'

// ─── Tool result types ────────────────────────────────────────────────────────

/** Returned by retrieveKnowledge when chunks are found. */
export interface RetrieveHit {
  found: true
  citations: Array<{ chunkId: string; docId: string; snippet: string }>
  context: string
}

/** Returned by retrieveKnowledge when retrieval produces no results. */
export interface RetrieveMiss {
  found: false
  reason: 'kb_miss'
}

export type RetrieveResult = RetrieveHit | RetrieveMiss

/** Returned by getCurrentCheckpoint. */
export interface CheckpointState {
  journeyStage: string
  currentCheckpoint: string
  /** UID of the agent's assigned senior coach. */
  seniorCoachId: string
  /** Human-readable stage label from the journey config, or the raw stage id if not found. */
  stageLabel: string
}

/** Returned by getCheckpointContent when the checkpoint has KB content. */
export interface CheckpointContent {
  checkpointId: string
  /** KB doc IDs referenced by this checkpoint (from the journey config). */
  kbDocIds: string[]
  /** Retrieved KB chunk context for the model (concatenated chunk texts). */
  context: string
  citations: Array<{ chunkId: string; docId: string; snippet: string }>
  /** The comprehension gate prompt, if this checkpoint has one. */
  comprehensionGatePrompt?: string
}

/** Returned by getCheckpointContent when the checkpoint is unknown or has no content. */
export interface CheckpointContentMiss {
  checkpointId: string
  found: false
  reason: string
}

export type CheckpointContentResult = CheckpointContent | CheckpointContentMiss

// ─── 1. retrieveKnowledge tool ────────────────────────────────────────────────

/**
 * The `retrieveKnowledge` AI SDK tool for the Coach agent.
 *
 * The model calls this tool with a search query; the tool retrieves relevant KB
 * chunks via `rag.retrieve`, builds real chunk-ID citations, and returns them as
 * a structured object.
 *
 * On a retrieval miss the tool returns `{ found: false, reason: 'kb_miss' }` —
 * the coach run() function checks for this and emits the escalation handoff signal
 * instead of letting the model hallucinate (grounding mandate, D-09).
 *
 * @param userLang  The language of the current conversation turn.
 */
export function makeRetrieveKnowledgeTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Search the D2 knowledge base for training materials, SOPs, and onboarding content. ' +
      'Call this BEFORE answering any question to ground your response in real D2 content. ' +
      'Returns chunk IDs that you MUST cite in your answer.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'The search query — a natural-language description of what information you need. ' +
            'Be specific to D2 onboarding topics.',
        ),
    }),
    execute: async ({ query }): Promise<RetrieveResult> => {
      // pillar:'coach' is REQUIRED, not an optimisation (quick-kayinleong-088).
      //
      // This call passed no pillar. That was harmless only while every finder chunk was
      // unreachable — they were stored as plain number[] arrays that no vector index
      // covered, so an unfiltered query could physically only match coach chunks. Once
      // 25,153 finder chunks became reachable, the corpus went 99.8% finder and an
      // unfiltered onboarding query started answering from property sales kits:
      // "what is the D2 onboarding process for a new agent" returned 8 hits, 6 of them
      // finder chunks.
      //
      // It also silently broke the Coach outright. The similarity floor is per-pillar, and
      // a query with no pillar has to assume the finder corpus (0.65). Coach content scores
      // lower — "how do I get my REN tag" tops out at 0.5632 — so it fell under the finder
      // floor and returned NOTHING. Measured: 2 of 4 onboarding questions went to 0 hits
      // unfiltered, and to 1 and 8 hits respectively with the pillar passed.
      const results: RetrievalResult[] = await retrieve(query, userLang, { pillar: 'coach' })

      if (isRetrievalMiss(results)) {
        return { found: false, reason: 'kb_miss' }
      }

      const { citations } = buildCitations(results)

      // Build a context string for the model — chunk texts concatenated.
      // This goes into the tool result so the model can use the content.
      const context = results
        .slice(0, 5) // cap at 5 chunks to stay within prompt budget
        .map((r) => `[KB:${r.chunkId}]\n${r.text}`)
        .join('\n\n---\n\n')

      return {
        found: true,
        citations,
        context,
      }
    },
  })
}

// ─── 2. getCurrentCheckpoint tool (READ-ONLY) ────────────────────────────────

/**
 * Read-only tool that returns the agent's current journey stage + checkpoint.
 *
 * The model uses this to understand where the agent is in the onboarding journey
 * and to contextualize its guidance (e.g., "you're on the channel-playbooks step").
 *
 * READ-ONLY: never writes to Firestore.
 *
 * @param agentUid  The authenticated agent's UID — injected via closure at invocation time.
 */
export function makeGetCurrentCheckpointTool(agentUid: string) {
  return tool({
    description:
      'Get the agent\'s current position in the D2 onboarding journey. ' +
      'Returns the current stage and checkpoint so you can deliver the right content.',
    inputSchema: z.object({}),
    execute: async (): Promise<CheckpointState | { error: string }> => {
      const profile = await getAgentProfile(agentUid)
      if (!profile) {
        return { error: 'Agent profile not found — the agent may not be provisioned yet.' }
      }

      // Look up the human-readable label for the stage from the journey config.
      const stageConfig = D2_JOURNEY.stages.find((s) => s.id === profile.journeyStage)
      const stageLabel = stageConfig?.label ?? profile.journeyStage

      return {
        journeyStage: profile.journeyStage,
        currentCheckpoint: profile.currentCheckpoint,
        seniorCoachId: profile.seniorCoachId,
        stageLabel,
      }
    },
  })
}

// ─── 3. getCheckpointContent tool (READ-ONLY) ────────────────────────────────

/**
 * Read-only tool that retrieves KB content for a named checkpoint.
 *
 * The model uses this to deliver conversational, KB-grounded guidance for
 * channel playbooks and the first-Meta-ad walkthrough (D-07) — no bespoke UI.
 *
 * READ-ONLY: calls rag.retrieve for KB content; never writes to Firestore.
 *
 * @param userLang  Language of the current conversation turn.
 */
export function makeGetCheckpointContentTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Retrieve the KB content for a specific onboarding checkpoint. ' +
      'Use this to get the training material for the current step so you can ' +
      'walk through it conversationally with the agent.',
    inputSchema: z.object({
      checkpointId: z
        .string()
        .min(1)
        .describe(
          'The checkpoint ID (e.g. "channel-playbooks", "first-meta-ad"). ' +
            'Use getCurrentCheckpoint first if you are unsure of the current checkpoint.',
        ),
    }),
    execute: async ({ checkpointId }): Promise<CheckpointContentResult> => {
      // Look up the checkpoint in the D2 journey config.
      let checkpoint: import('@/src/coach/journey/config').JourneyCheckpoint | undefined
      for (const stage of D2_JOURNEY.stages) {
        const found = stage.checkpoints.find((cp) => cp.id === checkpointId)
        if (found) {
          checkpoint = found
          break
        }
      }

      if (!checkpoint) {
        return {
          checkpointId,
          found: false,
          reason: `Checkpoint '${checkpointId}' not found in the D2 journey config.`,
        }
      }

      if (checkpoint.kbDocIds.length === 0) {
        return {
          checkpointId,
          found: false,
          reason: `Checkpoint '${checkpointId}' has no KB doc IDs configured.`,
        }
      }

      // Retrieve KB content by querying the checkpoint's primary topic.
      // Build a query from the checkpoint ID to find relevant chunks.
      const query = `D2 onboarding ${checkpointId.replace(/-/g, ' ')}`
      // pillar:'coach' — same reasoning as retrieveKnowledge above. A checkpoint query is
      // onboarding content by definition and must never resolve against the property corpus.
      const results: RetrievalResult[] = await retrieve(query, userLang, { pillar: 'coach' })

      if (isRetrievalMiss(results)) {
        return {
          checkpointId,
          found: false,
          reason: `No KB content found for checkpoint '${checkpointId}'. The KB documents may not be ingested yet.`,
        }
      }

      const { citations } = buildCitations(results)
      const context = results
        .slice(0, 5)
        .map((r) => `[KB:${r.chunkId}]\n${r.text}`)
        .join('\n\n---\n\n')

      return {
        checkpointId,
        kbDocIds: checkpoint.kbDocIds,
        context,
        citations,
        comprehensionGatePrompt: checkpoint.comprehensionGate?.prompt,
      }
    },
  })
}
