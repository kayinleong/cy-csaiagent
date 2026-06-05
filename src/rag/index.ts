/**
 * RAG adapter facade — the single entry point for all retrieval calls.
 *
 * Exports `retrieve(query, userLang)` which dispatches to the active adapter:
 *   - DEFAULT  (RAG_ADAPTER unset or 'firestore'): Firestore findNearest
 *   - FALLBACK (RAG_ADAPTER='pinecone'):           Pinecone Serverless
 *
 * The SPIKE-RAG decision (see .planning/phases/01-foundations/SPIKES.md)
 * determines which adapter becomes the permanent default. Until that decision
 * is recorded, Firestore is the active backend.
 *
 * Also re-exports:
 *   - buildCitations / isRetrievalMiss from citations.ts (grounding contract)
 *   - RetrievalResult type (for callers in agents/coach)
 *
 * Usage (Coach agent tool):
 *   import { retrieve, buildCitations, isRetrievalMiss } from '@/src/rag'
 *   const results = await retrieve(query, userLang)
 *   if (isRetrievalMiss(results)) { // emit handoff signal }
 *   const { citations } = buildCitations(results)
 *
 * References:
 *   - 01-09-PLAN.md: retrieve() adapter facade (Firestore default | Pinecone seam)
 *   - D-05: adapter seam — call sites unaffected when backend swaps
 *   - TSD §3.2: rag/ adapter; Firestore default, Pinecone fallback
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { firestoreRetrieve, type RetrievalResult, type RetrieveOpts } from '@/src/rag/search'
import { pineconeRetrieve } from '@/src/rag/pinecone'
export type { RetrievalResult, RetrieveOpts } from '@/src/rag/search'
export { buildCitations, isRetrievalMiss } from '@/src/rag/citations'
export { embedText, normalize } from '@/src/rag/embed'

/** Supported adapter identifiers (resolved from RAG_ADAPTER env var). */
type RagAdapter = 'firestore' | 'pinecone'

/**
 * Read the active adapter from the environment.
 * Defaults to 'firestore' (the SPIKE-RAG default per D-05).
 */
function activeAdapter(): RagAdapter {
  const raw = process.env.RAG_ADAPTER?.toLowerCase()
  if (raw === 'pinecone') return 'pinecone'
  return 'firestore'
}

/**
 * Retrieve relevant KB chunks for a query in the given language.
 *
 * This is the contract consumed by the Coach agent's `retrieveKnowledge` tool
 * (01-12). Call sites never reference firestoreRetrieve or pineconeRetrieve
 * directly — only this facade.
 *
 * @param query      User query text (PDPA-redacted upstream per TSD §5.3).
 * @param userLang   Language of the current turn ('en' | 'ms' | 'zh').
 * @param opts       Optional pillar/category filters (REPLY-01). `pillar` is an
 *                   index-backed equality pre-filter; `category` is narrowed in memory.
 *                   Threaded through to the active adapter so the Reply
 *                   retrieveReplySop tool can request `{ pillar: 'reply' }` retrieval.
 * @returns          RetrievalResult[] ordered by relevance, or [] on miss.
 *                   An empty return value is the retrieval-miss signal —
 *                   the Coach must emit a handoff/no_sop_match instead of hallucinating.
 */
export async function retrieve(
  query: string,
  userLang: 'en' | 'ms' | 'zh',
  opts?: RetrieveOpts,
): Promise<RetrievalResult[]> {
  const adapter = activeAdapter()

  if (adapter === 'pinecone') {
    return pineconeRetrieve(query, userLang, opts)
  }

  // Default: Firestore findNearest (DOT_PRODUCT, lang pre-filter)
  return firestoreRetrieve(query, userLang, opts)
}
