/**
 * Pinecone Serverless fallback adapter — the RAG FALLBACK seam.
 *
 * This module is the documented fallback if SPIKE-RAG fails and the team
 * decides to swap the retrieval backend from Firestore to Pinecone Serverless
 * (aws-ap-southeast-1). App state continues to live in Firestore; only the
 * vector search backend changes.
 *
 * ACTIVATION GATE:
 *   - DEFAULT:  RAG_ADAPTER env is unset or 'firestore' → firestoreRetrieve() is used.
 *   - FALLBACK: RAG_ADAPTER='pinecone' → pineconeRetrieve() is used.
 *   - The active adapter is selected in src/rag/index.ts.
 *
 * CURRENT STATE (Phase 1):
 *   SPIKE-RAG decision is PENDING (see .planning/phases/01-foundations/SPIKES.md).
 *   Firestore is the current default. This seam will be wired to a real
 *   Pinecone SDK call only if the SPIKE-RAG decision selects the Pinecone fallback.
 *
 * When the decision is made to activate Pinecone:
 *   1. Install @pinecone-database/pinecone (npm install @pinecone-database/pinecone).
 *   2. Implement the query inside pineconeRetrieve() using the same
 *      RetrievalResult shape so call sites are unaffected.
 *   3. Set PINECONE_API_KEY + PINECONE_INDEX in Secret Manager + env.
 *   4. Set RAG_ADAPTER=pinecone in apphosting.yaml.
 *   5. Update SPIKES.md with the decision.
 *
 * References:
 *   - D-05: spike-failure protocol — SPIKE-RAG fail → swap adapter to Pinecone Serverless
 *   - TSD §2.2: Pinecone Serverless aws-ap-southeast-1 (fallback only)
 *   - .planning/phases/01-foundations/SPIKES.md: SPIKE-RAG decision record
 *   - .env.sample: PINECONE_API_KEY + PINECONE_INDEX (commented out until activated)
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import type { RetrievalResult } from '@/src/rag/search'
import { embedText } from '@/src/rag/embed'

/**
 * Pinecone Serverless retrieval (FALLBACK adapter — currently a seam).
 *
 * When activated: embed query → Pinecone query(vector, topK:8, filter:{lang:...})
 * → map to RetrievalResult[] with the same shape as firestoreRetrieve().
 *
 * @param query      Raw user query text (PDPA-redacted upstream).
 * @param userLang   Language of the current conversation turn.
 * @returns          Ordered RetrievalResult[] (most similar first), or [] on miss.
 */
export async function pineconeRetrieve(
  query: string,
  userLang: 'en' | 'ms' | 'zh',
): Promise<RetrievalResult[]> {
  // ── SEAM: Pinecone retrieval (activated only when SPIKE-RAG selects this fallback) ──
  //
  // Implementation sketch (activate by installing @pinecone-database/pinecone):
  //
  //   const apiKey = process.env.PINECONE_API_KEY
  //   const indexName = process.env.PINECONE_INDEX
  //   if (!apiKey || !indexName) throw new Error('Pinecone fallback requires PINECONE_API_KEY + PINECONE_INDEX env vars')
  //
  //   const { Pinecone } = await import('@pinecone-database/pinecone')
  //   const client = new Pinecone({ apiKey })
  //   const index = client.index(indexName)
  //
  //   const vector = await embedText(query, { inputType: 'query' })
  //
  //   const response = await index.query({
  //     vector,
  //     topK: 8,
  //     // status:'published' filter (Pitfall 3 fix, 02-02): mirrors the Firestore
  //     // where('status','==','published') filter so a fallback swap preserves the
  //     // same contract — superseded/unpublished chunks are never retrievable.
  //     filter: { lang: { $in: [userLang, 'en'] }, status: { $eq: 'published' } },
  //     includeMetadata: true,
  //   })
  //
  //   return (response.matches ?? []).map(m => ({
  //     chunkId: m.id,
  //     docId: (m.metadata?.docId as string) ?? '',
  //     text: (m.metadata?.text as string) ?? '',
  //     lang: (m.metadata?.lang as 'en' | 'ms' | 'zh') ?? 'en',
  //     score: m.score ?? 0,
  //   }))
  //
  // ─────────────────────────────────────────────────────────────────────────────

  // Prevent unused-variable linting until this seam is activated
  void (await embedText(query, { inputType: 'query' }))
  void userLang

  throw new Error(
    'Pinecone fallback adapter is not yet activated. ' +
      'SPIKE-RAG decision is PENDING. ' +
      'Set RAG_ADAPTER=pinecone in env only after the fallback decision is recorded in SPIKES.md.',
  )
}
