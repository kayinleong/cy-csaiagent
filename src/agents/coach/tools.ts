/**
 * src/agents/coach/tools.ts — AI SDK tools for the D2 Onboarding Coach.
 *
 * ONE read-only tool: `retrieveKnowledge`
 *   - Calls `rag.retrieve(query, userLang)` to fetch KB chunks.
 *   - Returns real chunk-ID citations via `buildCitations(results)`.
 *   - On a retrieval miss, returns a miss signal that the coach index uses to
 *     emit a handoff instead of hallucinating (TSD §6, D-09, D-10).
 *
 * Security (TSD §3.2 agents row):
 *   - Tools are READ-ONLY: no Firestore writes from within a tool.
 *   - The tool authenticates as the USER — it does NOT use Admin SDK paths.
 *     In Phase 1 the RAG adapter uses Admin SDK internally (approved service account
 *     path for kbChunks retrieval); Phase 2 will add per-user auth scoping.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { retrieve, buildCitations, isRetrievalMiss } from '@/src/rag'
import type { RetrievalResult } from '@/src/rag'

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

// ─── retrieveKnowledge tool ───────────────────────────────────────────────────

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
 * @param userLang  The language of the current conversation turn — passed in at
 *                  agent invocation time via a closure.
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
      const results: RetrievalResult[] = await retrieve(query, userLang)

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
