/**
 * Firestore `findNearest` retrieval adapter — the DEFAULT RAG backend.
 *
 * Implements the core retrieval contract:
 *   embedText(query, {inputType:'query'}) → FieldValue.vector(q) →
 *   kbChunks.where('lang','in',[userLang,'en']).findNearest(DOT_PRODUCT, limit:8).get()
 *   → map to RetrievalResult[]
 *
 * Returns empty array on no matches — the retrieval-miss signal the Coach uses to
 * emit a handoff/no_sop_match instead of hallucinating.
 *
 * Security:
 *   - Reads kbChunks as the Admin SDK service account (server-only).
 *   - The lang pre-filter prevents cross-language/cross-tenant chunk leakage (T-01-28).
 *   - Never logs raw user query text.
 *
 * References:
 *   - TSD §4: kbChunks findNearest DOT_PRODUCT, lang pre-filter, 1024-d
 *   - 01-RESEARCH.md lines 384-413: findNearest signature + billing model
 *   - firestore.indexes.json: kbChunks composite vector index (lang + embedding 1024-d flat)
 *   - SPIKES.md SPIKE-RAG: Firestore is the DEFAULT adapter; Pinecone is the fallback seam
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/src/firebase/admin'
import { embedText } from '@/src/rag/embed'

/** The result shape returned by all RAG adapter implementations. */
export interface RetrievalResult {
  /** The Firestore document ID of the kbChunk — the grounding citation source. */
  chunkId: string
  /** The parent KB document ID for display and de-duplication. */
  docId: string
  /** The chunk text — injected into the agent context window. */
  text: string
  /** Language of the chunk: 'en' | 'ms' | 'zh' */
  lang: 'en' | 'ms' | 'zh'
  /**
   * DOT_PRODUCT distance score from Firestore.
   * Higher = more similar (for normalized unit vectors: range 0–1).
   */
  score: number
}

/** findNearest limit: top-K results per retrieval query. */
const FIND_NEAREST_LIMIT = 8

/**
 * Firestore `findNearest` retrieval (the DEFAULT adapter).
 *
 * Steps:
 *   1. Embed the query with Gemini gemini-embedding-001 (inputType='query', 1024-d).
 *   2. Build the lang pre-filter: where('lang', 'in', [userLang, 'en']).
 *      - For userLang='en': ['en', 'en'] → deduplicated to ['en'] by Firestore — still valid.
 *      - For userLang='ms': ['ms', 'en'] — cross-lingual EN fallback included.
 *      - For userLang='zh': ['zh', 'en'] — same cross-lingual pattern.
 *   3. Run findNearest(DOT_PRODUCT, limit:8) against the composite vector index.
 *   4. Map snap.docs → RetrievalResult[], using d.id as the chunkId (citation source).
 *
 * The composite vector index (lang + embedding 1024-d flat) is defined in
 * firestore.indexes.json and covers this exact query shape.
 *
 * @param query      Raw user query text (caller must have PDPA-redacted any PII upstream).
 * @param userLang   Language of the current conversation turn.
 * @returns          Ordered RetrievalResult[] (most similar first), or [] on miss.
 */
export async function firestoreRetrieve(
  query: string,
  userLang: 'en' | 'ms' | 'zh',
): Promise<RetrievalResult[]> {
  // 1. Embed the query
  const q = await embedText(query, { inputType: 'query' })

  // 2. Build the pre-filter languages (cross-lingual EN fallback)
  //    For userLang='en': ['en', 'en'] is acceptable; Firestore de-dupes it.
  const langFilter = [userLang, 'en'] as const

  // 3. Run findNearest against the kbChunks collection
  const snap = await adminDb
    .collection('kbChunks')
    .where('lang', 'in', langFilter)
    .findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(q),
      limit: FIND_NEAREST_LIMIT,
      distanceMeasure: 'DOT_PRODUCT',
    })
    .get()

  // 4. Map to typed results — d.id is the chunkId (the citation source)
  if (snap.docs.length === 0) {
    return [] // retrieval miss
  }

  return snap.docs.map((d) => {
    const data = d.data()
    return {
      chunkId: d.id,
      docId: (data.docId as string) ?? '',
      text: (data.text as string) ?? '',
      lang: (data.lang as 'en' | 'ms' | 'zh') ?? 'en',
      // Firestore DOT_PRODUCT distance: lower distance = more similar.
      // We store as-is; buildCitations handles ranking by position.
      score: typeof data._distance === 'number' ? (data._distance as number) : 1,
    }
  })
}
