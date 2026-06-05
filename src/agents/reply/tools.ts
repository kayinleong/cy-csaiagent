/**
 * src/agents/reply/tools.ts — AI SDK tools for the D2 Reply Assistant agent.
 *
 * Tools (all READ-ONLY — no Firestore writes inside any tool execute):
 *   1. makeRetrieveReplySopTool  — wraps rag.retrieve({ pillar:'reply' }) → SOP context + [SOP:] citations
 *   2. makeFetchVoiceSamplesTool — reads the curated org-voice KB doc (D-12) — whole-doc, no vector search
 *   3. makeFetchLeadContextTool  — wraps readReplySlot(leadId) → recent reply context for the lead
 *
 * Security (TSD §3.3, T-04-TOOLWRITE, Pitfall 23/36):
 *   - Tools are READ-ONLY: no Firestore mutations (no set/add/update) inside execute().
 *   - replySlot write happens in the route onFinish (Plan 06) — NEVER inside a tool.
 *   - replyEdits write happens in a Server Action (Plan 07) — NEVER inside a tool.
 *   - Tools authenticate as the service account via adminDb (kbDocs/kbChunks: signed-in tenant read).
 *
 * Grounding (T-04-INVENT, D-11):
 *   - retrieveReplySop returns { found:false, reason:'no_sop_match' } on a miss — never a fabricated SOP.
 *   - The model MUST cite [SOP:doc-id]s returned by retrieveReplySop; it cannot invent SOP content.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { retrieve, buildCitations, isRetrievalMiss } from '@/src/rag'
import type { RetrievalResult } from '@/src/rag'
import { kbDocsRef, kbChunksRef } from '@/src/firebase/collections'
import { readReplySlot } from '@/src/memory/leadContext'
import type { ReplySlot } from '@/src/memory/leadContext'

// ─── Tool result types ────────────────────────────────────────────────────────

/** Returned by retrieveReplySop when SOP chunks are found. */
export interface ReplySopHit {
  found: true
  citations: Array<{ chunkId: string; docId: string; snippet: string }>
  context: string
}

/** Returned by retrieveReplySop when retrieval produces no usable SOP (D-11). */
export interface ReplySopMiss {
  found: false
  reason: 'no_sop_match'
}

export type ReplySopResult = ReplySopHit | ReplySopMiss

/** Returned by fetchVoiceSamples. */
export interface VoiceSamplesResult {
  /** The curated org-voice doc ID, or null when none is published. */
  voiceDocId: string | null
  /** Concatenated voice-doc chunk text (empty when no voice doc is published). */
  voiceText: string
}

/** Returned by fetchLeadContext. */
export interface LeadContextResult {
  /** The stored ReplySlot for this lead, or null on first touch. */
  replySlot: ReplySlot | null
}

// ─── 1. makeRetrieveReplySopTool ──────────────────────────────────────────────

/**
 * AI SDK tool wrapping `rag.retrieve({ pillar:'reply' })` — the Reply-SOP analog of
 * the Coach's retrieveKnowledge (coach/tools.ts:89-127).
 *
 * READ-ONLY: only calls retrieve() — no Firestore writes.
 * On a retrieval miss the tool returns { found:false, reason:'no_sop_match' } — the
 * reply agent emits the grounded refusal instead of letting the model hallucinate SOP
 * content (grounding mandate, D-11). `[KB:` becomes `[SOP:`; `kb_miss` becomes `no_sop_match`.
 *
 * `category` (cold-prospect / objection-handling / financing) is narrowed IN MEMORY
 * after retrieval (the rag facade applies it; we forward it via opts).
 *
 * @param userLang  The language of the current conversation turn.
 */
export function makeRetrieveReplySopTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Search D2 reply SOPs (cold-prospect, objection-handling, financing). ' +
      'Call this BEFORE drafting any reply to ground it in real D2 SOPs. ' +
      'Returns SOP doc IDs you MUST cite as [SOP:doc-id] in the draft. ' +
      'If nothing matches, returns no_sop_match — never invent an SOP.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('A natural-language description of the reply situation. Be specific to the inbound message.'),
      category: z
        .enum(['cold-prospect', 'objection-handling', 'financing'])
        .nullable()
        .describe('Optional SOP category filter. Use null when the category is not yet known.'),
    }),
    execute: async ({ query, category }): Promise<ReplySopResult> => {
      // READ-ONLY: pillar-filtered vector retrieval, no Firestore writes.
      const results: RetrievalResult[] = await retrieve(query, userLang, { pillar: 'reply' })

      // Narrow by category in memory (the rag facade also supports this; we keep it
      // here too so the tool contract holds even if the facade opts change).
      const filtered = category ? results.filter((r) => r.category === category) : results

      if (isRetrievalMiss(filtered)) {
        return { found: false, reason: 'no_sop_match' }
      }

      const { citations } = buildCitations(filtered)

      // Build the SOP context string for the model — chunk texts concatenated, [SOP:] tagged.
      const context = filtered
        .slice(0, 5)
        .map((r) => `[SOP:${r.docId}]\n${r.text}`)
        .join('\n\n---\n\n')

      return { found: true, citations, context }
    },
  })
}

// ─── 2. makeFetchVoiceSamplesTool ─────────────────────────────────────────────

/**
 * AI SDK tool that fetches the curated org-voice KB doc (D-12 / Q6).
 *
 * READ-ONLY: a whole-doc lookup (NOT a vector search) —
 *   kbDocs.where(pillar=reply, category=voice, status=published).limit(1)
 *   → kbChunks.where(docId == voiceDocId) → concatenated chunk text.
 *
 * Returns the curated D2 org voice (Derek's anonymized samples + tone rules). This is
 * the v1 source of voice — NOT per-user users.voiceSamples[] (deferred post-pilot, D-12).
 * Returns empty voiceText (and null voiceDocId) when no voice doc is published.
 */
export function makeFetchVoiceSamplesTool() {
  return tool({
    description:
      'Fetch the curated D2 org-voice guide (tone rules + example exchanges). ' +
      'Call this to calibrate the draft to D2\'s voice. Returns the voice guide text.',
    inputSchema: z.object({}),
    execute: async (): Promise<VoiceSamplesResult> => {
      // READ-ONLY: whole-doc lookup of the published reply/voice doc — no Firestore writes.
      const docSnap = await kbDocsRef()
        .where('pillar', '==', 'reply')
        .where('category', '==', 'voice')
        .where('status', '==', 'published')
        .limit(1)
        .get()

      if (docSnap.empty) {
        return { voiceDocId: null, voiceText: '' }
      }

      const voiceDocId = docSnap.docs[0].id

      // READ-ONLY: read the voice doc's chunk text.
      const chunkSnap = await kbChunksRef().where('docId', '==', voiceDocId).get()

      const voiceText = chunkSnap.docs
        .map((d) => (d.data().text as string) ?? '')
        .filter((t) => t.length > 0)
        .join('\n\n')

      return { voiceDocId, voiceText }
    },
  })
}

// ─── 3. makeFetchLeadContextTool ──────────────────────────────────────────────

/**
 * AI SDK tool that returns the recent reply context for a lead (READ-ONLY).
 *
 * Wraps readReplySlot(leadId) (mirrors coach getCurrentCheckpoint wrapping a read).
 * Per-lead isolation (REPLY-03 / SC2): the slot is keyed by leadId, so this never
 * returns another lead's content. Returns { replySlot: null } when no leadId is in
 * scope or the lead has no stored reply context yet (first touch).
 *
 * @param leadId  The current lead ID — injected via closure at invocation time.
 */
export function makeFetchLeadContextTool(leadId?: string) {
  return tool({
    description:
      'Get the recent reply context for the current lead (last classification + draft). ' +
      'Use this to stay consistent across turns for the same lead.',
    inputSchema: z.object({}),
    execute: async (): Promise<LeadContextResult> => {
      // READ-ONLY: reads the replySlot for THIS lead only — no Firestore writes.
      if (!leadId) {
        return { replySlot: null }
      }
      const replySlot = await readReplySlot(leadId)
      return { replySlot }
    },
  })
}
