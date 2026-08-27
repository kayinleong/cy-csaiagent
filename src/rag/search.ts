/**
 * Firestore `findNearest` retrieval adapter — the DEFAULT RAG backend.
 *
 * Implements the core retrieval contract:
 *   embedText(query, {inputType:'query'}) → FieldValue.vector(q) →
 *   kbChunks.where('lang','in',[userLang,'en'])
 *           .where('status','==','published')   ← Pitfall 3 fix (02-02)
 *           .findNearest(DOT_PRODUCT, limit:8).get()
 *   → map to RetrievalResult[]
 *
 * Returns empty array on no matches — the retrieval-miss signal the Coach uses to
 * emit a handoff/no_sop_match instead of hallucinating.
 *
 * Security:
 *   - Reads kbChunks as the Admin SDK service account (server-only).
 *   - The lang pre-filter prevents cross-language/cross-tenant chunk leakage (T-01-28).
 *   - The status='published' filter ensures superseded/unpublished chunks are never
 *     returned to the Coach, closing the stale-chunk gap (T-02-07, 02-RESEARCH Pitfall 3).
 *   - Never logs raw user query text.
 *
 * References:
 *   - TSD §4: kbChunks findNearest DOT_PRODUCT, lang pre-filter, 1024-d
 *   - 01-RESEARCH.md lines 384-413: findNearest signature + billing model
 *   - 02-02-PLAN.md Task 1: published-only filter + composite index
 *   - firestore.indexes.json: kbChunks composite vector index (lang+status+embedding 1024-d flat)
 *     added in 02-01 Task 2 to back this exact query shape.
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
  /**
   * Pillar the chunk belongs to (denormalized from the parent kbDoc).
   * Present when the chunk carries a pillar; undefined for legacy chunks not
   * yet backfilled. Callers may use it for in-memory filtering / display.
   */
  pillar?: 'coach' | 'finder' | 'reply'
  /**
   * SOP category metadata (denormalized from the parent kbDoc when set).
   * Used by retrieveReplySop to filter by category IN MEMORY (04-RESEARCH §Q7 —
   * avoids a second composite index). Undefined when the chunk has no category.
   */
  category?: string
}

/**
 * Optional retrieval filters for the pillar-aware retrieval path (REPLY-01).
 *
 * - `pillar`  — applied as an EQUALITY findNearest pre-filter
 *   (`where('pillar','==',opts.pillar)`); must be backed by the
 *   (pillar,lang,status,embedding) composite vector index (firestore.indexes.json).
 * - `category` — filtered IN MEMORY after retrieval (NOT a pre-filter) so we do
 *   NOT need a second composite index per category (04-RESEARCH §Q7 / Pitfall F).
 */
export interface RetrieveOpts {
  pillar?: 'coach' | 'finder' | 'reply'
  category?: string
}

/** findNearest limit: top-K results per retrieval query. */
const FIND_NEAREST_LIMIT = 8

/**
 * Minimum similarity a chunk must reach to be returned (quick-kayinleong-046).
 *
 * Embeddings are L2-normalized 1024-d vectors (src/rag/embed.ts), so with
 * `distanceMeasure: 'DOT_PRODUCT'` the "distance" IS the cosine similarity in
 * [-1, 1] — and for DOT_PRODUCT Firestore's threshold semantics are
 * `WHERE dot_product_distance >= distanceThreshold` (higher = more similar; see
 * @google-cloud/firestore firestore.d.ts:3293-3294). So this is a similarity FLOOR,
 * not a distance ceiling.
 *
 * Why this exists: without a threshold, `findNearest` returns up to
 * FIND_NEAREST_LIMIT rows whenever the equality pre-filter set is non-empty —
 * regardless of relevance. That made an honest "no results" impossible: once the KB
 * is populated, every query would return 8 chunks and the Coach would cite whatever
 * came back, turning a truthful `kb_miss` into a confidently-wrong grounded answer.
 *
 * MEASURED at last, against live Firestore (quick-kayinleong-066). The previous value of
 * 0.35 was a guess, and its own note said it had "NOT been validated against real content" —
 * it could not be, because quick-066 found that kbChunks stored `embedding` as a plain
 * number[], which a vector index does not cover, so findNearest returned zero rows for
 * every query and nothing ever reached this floor.
 *
 * With the chunks converted to the VECTOR type, the top score per query separates cleanly
 * (coach corpus, 14 chunks):
 *
 *   RELEVANT     0.6060 .. 0.6496   ("Core Residence @ TRX", "what unit types are available")
 *   OFF-TOPIC    0.4587 .. 0.4924   ("banana bread recipe", "capital of France", "car tyre")
 *
 * 0.55 sits in the gap with ~0.06 of clearance either side. At the old 0.35, "banana bread
 * recipe" returned 8 chunks and the Coach would have cited TRX pricing for it — a
 * confidently-wrong grounded answer, which is worse than an honest kb_miss (D-10).
 *
 * ⚠ STILL THIN. That is 14 chunks from ONE project. As the corpus grows both distributions
 * move — off-topic queries find something nearer, and questions about other projects land
 * differently. Re-measure when real coach content is loaded; `score` carries
 * `_vectorDistance` on every result, so the distribution is observable.
 */
export const MIN_SIMILARITY = 0.55

/**
 * Field name Firestore writes the computed similarity into on each returned doc.
 * Must be set explicitly — previously unset, which is why `score` below was always
 * the `1` fallback and the similarity distribution was unobservable.
 */
const DISTANCE_RESULT_FIELD = '_vectorDistance'

/**
 * Firestore `findNearest` retrieval (the DEFAULT adapter).
 *
 * Steps:
 *   1. Embed the query with Gemini gemini-embedding-001 (inputType='query', 1024-d).
 *   2. Build the lang pre-filter: where('lang', 'in', [userLang, 'en']).
 *      - For userLang='en': ['en', 'en'] → deduplicated to ['en'] by Firestore — still valid.
 *      - For userLang='ms': ['ms', 'en'] — cross-lingual EN fallback included.
 *      - For userLang='zh': ['zh', 'en'] — same cross-lingual pattern.
 *   3. Add status pre-filter: where('status', '==', 'published') — Pitfall 3 fix (02-02).
 *      Superseded and unpublished chunks are excluded before the vector search.
 *      Legacy chunks without a status field are treated as published via the backfill
 *      script (scripts/backfill-kb-status.ts) which stamps status:'published' on all
 *      existing kbDocs + kbChunks that have no status set.
 *   4. Run findNearest(DOT_PRODUCT, limit:8) against the composite vector index.
 *   5. Map snap.docs → RetrievalResult[], using d.id as the chunkId (citation source).
 *
 * The composite vector index (lang + status + embedding 1024-d flat) is defined in
 * firestore.indexes.json (added in 02-01 Task 2) and covers this exact query shape.
 *
 * @param query      Raw user query text (caller must have PDPA-redacted any PII upstream).
 * @param userLang   Language of the current conversation turn.
 * @param opts       Optional pillar/category filters (REPLY-01). When `opts.pillar`
 *                   is set, a `where('pillar','==',opts.pillar)` equality pre-filter is
 *                   added (index-backed). When `opts.category` is set, results are
 *                   narrowed IN MEMORY (no second index — 04-RESEARCH §Q7).
 * @returns          Ordered RetrievalResult[] (most similar first), or [] on miss.
 */
export async function firestoreRetrieve(
  query: string,
  userLang: 'en' | 'ms' | 'zh',
  opts?: RetrieveOpts,
): Promise<RetrievalResult[]> {
  // 1. Embed the query
  const q = await embedText(query, { inputType: 'query' })

  // 2. Build the pre-filter languages (cross-lingual EN fallback)
  //    For userLang='en': ['en', 'en'] is acceptable; Firestore de-dupes it.
  const langFilter = [userLang, 'en'] as const

  // 3. Run findNearest against the kbChunks collection.
  //    Pre-filters applied before the vector search (all equality-only — Pitfall 6):
  //      a) lang filter — only chunks in the user's language + EN fallback
  //      b) status='published' filter — Pitfall 3 fix (02-02): superseded/unpublished
  //         chunks are never served; backed by the lang+status+embedding composite index.
  //      c) pillar filter (REPLY-01, optional) — when opts.pillar is set, restrict to that
  //         pillar so reply drafts never cite Coach chunks; backed by the new
  //         (pillar,lang,status,embedding) composite vector index (firestore.indexes.json).
  //    NOTE: category is intentionally NOT a pre-filter — it is narrowed in memory below
  //    to avoid a second composite index (04-RESEARCH §Q7).
  let baseQuery = adminDb
    .collection('kbChunks')
    .where('lang', 'in', langFilter)
    .where('status', '==', 'published')

  if (opts?.pillar) {
    baseQuery = baseQuery.where('pillar', '==', opts.pillar)
  }

  const snap = await baseQuery
    .findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(q),
      limit: FIND_NEAREST_LIMIT,
      distanceMeasure: 'DOT_PRODUCT',
      // Similarity FLOOR — see MIN_SIMILARITY. Without this, a non-empty pre-filter
      // set always yields FIND_NEAREST_LIMIT rows regardless of relevance, so a real
      // retrieval miss could never be distinguished from an irrelevant match.
      distanceThreshold: MIN_SIMILARITY,
      // Surface the computed similarity so `score` below is real (and MIN_SIMILARITY
      // is tunable against observed data instead of guessed).
      distanceResultField: DISTANCE_RESULT_FIELD,
    })
    .get()

  // 4. Map to typed results — d.id is the chunkId (the citation source)
  if (snap.docs.length === 0) {
    return [] // retrieval miss
  }

  const results: RetrievalResult[] = snap.docs.map((d) => {
    const data = d.data()
    return {
      chunkId: d.id,
      docId: (data.docId as string) ?? '',
      text: (data.text as string) ?? '',
      lang: (data.lang as 'en' | 'ms' | 'zh') ?? 'en',
      // Firestore DOT_PRODUCT with L2-normalized vectors: the value IS cosine
      // similarity, so HIGHER = more similar (the old comment here said the
      // opposite). Read from DISTANCE_RESULT_FIELD; `_distance` was never populated
      // because distanceResultField was unset, so this silently fell back to 1 on
      // every row. buildCitations still ranks by position (findNearest returns
      // most-similar-first), so this is for observability and threshold tuning.
      score:
        typeof data[DISTANCE_RESULT_FIELD] === 'number'
          ? (data[DISTANCE_RESULT_FIELD] as number)
          : 1,
      pillar: data.pillar as 'coach' | 'finder' | 'reply' | undefined,
      category: typeof data.category === 'string' ? (data.category as string) : undefined,
    }
  })

  // 5. In-memory category narrowing (REPLY-06). Categories are few and the top-K
  //    result set is small, so an in-memory filter is cheaper than a second index.
  if (opts?.category) {
    return results.filter((r) => r.category === opts.category)
  }

  return results
}
