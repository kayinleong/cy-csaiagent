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
 * ── RE-MEASURED 2026-09-05 (quick-kayinleong-088), and the value is now PER-PILLAR ──
 *
 * The previous number (0.55) was measured by quick-066 against a **14-chunk** coach
 * corpus and its own note said to re-measure once real content landed. Real content
 * landed: 25,153 `kbChunks` with `pillar:'finder'` (the ingested Drive sales kits). They
 * had been unreachable — stored as plain `number[]`, which a vector index does not cover —
 * so findNearest returned zero rows for every Finder query and nothing ever reached this
 * floor. With them converted to the VECTOR type, 0.55 no longer separates: "banana bread
 * recipe" cleared it with 8 chunks the model could have cited.
 *
 * Method: 10 real questions + 10 deliberately off-topic controls per pillar, run against
 * live Firestore with NO `distanceThreshold` so the raw distribution is visible.
 *
 *   pillar=finder (25,153 chunks)
 *     RELEVANT  top   0.7114 .. 0.8337   (median 0.7437)   all 80 chunks: min 0.6884
 *     CONTROL   top   0.5423 .. 0.6152   (median 0.5890)   all 80 chunks: max 0.6152
 *     → gap 0.6152 → 0.6884.  At 0.55, 52 of 80 control chunks were admitted.
 *
 *   pillar=coach (47 chunks)
 *     RELEVANT  top   0.5632 .. 0.7076   all 64 chunks: min 0.5395
 *     CONTROL   top   0.4701 .. 0.5321   all 80 chunks: max 0.5321
 *     → gap 0.5321 → 0.5395, only 0.0074 wide.  At 0.55, 0 of 80 control chunks were
 *       admitted.  NOTE 0.55 sits ABOVE that gap, not inside it: it drops the tail of
 *       the top-8 on weakly-matching questions. Deliberate — the gap is too narrow to
 *       target on a 47-chunk corpus, and the TOP chunk of every measured real question
 *       (min 0.5632) still clears 0.55, so no real question is silenced.
 *
 *   pillar=reply (10 chunks)
 *     RELEVANT  top   0.6228 .. 0.7457   all 64 chunks: min 0.5666
 *     CONTROL   top   0.4448 .. 0.5328   all 80 chunks: max 0.5328
 *     → gap 0.5328 → 0.5666.  At 0.55, 0 of 80 control chunks were admitted.
 *
 * ONE NUMBER CANNOT SERVE ALL THREE, so do not collapse this back into a single constant.
 * Gemini similarity sits HIGHER across the board on the finder corpus — long marketing
 * write-ups score ~0.6 against almost any English text — so the finder floor must be
 * ~0.65. Applying 0.65 to coach would silently kill real coach questions: "how do I get
 * my REN tag" tops out at 0.5632, so it would return nothing. Applying 0.55 to finder
 * admits banana bread. The floors are 0.65 / 0.55 / 0.55, each measured on its own corpus.
 *
 * `MIN_SIMILARITY` is the DEFAULT, used when the caller passes no pillar — and it is 0.65,
 * the FINDER number, because an unfiltered query searches one corpus that is 25,153 of
 * 25,210 chunks (99.8%) finder content. Measured on that path: "banana bread recipe"
 * returned 8 chunks at 0.5700 and "python pandas groupby" 8 at 0.6152, all `pillar:finder`.
 * Sizing the default for the corpus that is actually searched is the only defensible
 * choice; sizing it for a 47-chunk pillar the query does not restrict to is not.
 *
 * ⚠ KNOWN CONSEQUENCE, and it is a truthfulness fix rather than a regression:
 * `src/agents/coach/tools.ts` calls `retrieve(query, userLang)` with NO pillar, so a coach
 * question is answered from the finder corpus today ("how do I get my REN tag" → 8
 * property write-up chunks, zero coach chunks). Under 0.65 those return nothing and the
 * Coach emits an honest `kb_miss` + handoff (D-10) instead of citing project marketing at
 * an onboarding question. The real fix is for the Coach to pass `{ pillar: 'coach' }`, at
 * which point it gets its own measured 0.55 back — that is a separate claim, in a file
 * this one does not own.
 *
 * ⚠ coach/reply remain THIN: 47 and 10 chunks, and the coach gap is only 0.0074 wide
 * (0.5321 → 0.5395). Re-measure both when real coach/reply content is ingested. Every
 * result carries `_vectorDistance`, so the distribution stays observable.
 */
export const MIN_SIMILARITY = 0.65

/**
 * Per-pillar similarity floors — see the `MIN_SIMILARITY` comment for the measurements
 * each one comes from (quick-kayinleong-088).
 *
 * Keyed by pillar rather than tuned as one number because the three corpora score on
 * genuinely different scales: long finder write-ups sit ~0.1 higher against arbitrary
 * English than short coach SOPs do. A single floor is either too low for finder or too
 * high for coach; there is no value that is right for both.
 */
export const MIN_SIMILARITY_BY_PILLAR: Record<'coach' | 'finder' | 'reply', number> = {
  /** 47 chunks. Relevant chunks reach 0.5395; controls top out at 0.5321. */
  coach: 0.55,
  /** 25,153 chunks. Relevant chunks reach 0.6884; controls top out at 0.6152. */
  finder: 0.65,
  /** 10 chunks. Relevant chunks reach 0.5666; controls top out at 0.5328. */
  reply: 0.55,
}

/**
 * Resolve the similarity floor for a retrieval call.
 *
 * @param pillar  The pillar pre-filter this query will apply, if any. Undefined means the
 *                query searches ALL pillars, which in practice means the finder corpus
 *                (99.8% of chunks) — hence the `MIN_SIMILARITY` default.
 */
export function minSimilarityFor(pillar?: 'coach' | 'finder' | 'reply'): number {
  return pillar ? MIN_SIMILARITY_BY_PILLAR[pillar] : MIN_SIMILARITY
}

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
      //
      // PER-PILLAR (quick-kayinleong-088): the floor tracks the corpus this query will
      // actually search, because the three corpora score on different scales. Passing the
      // pillar here and in the pre-filter above keeps the two in step — a query filtered
      // to `coach` is scored against the coach floor, and only an unfiltered query falls
      // back to the finder-sized default.
      distanceThreshold: minSimilarityFor(opts?.pillar),
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
