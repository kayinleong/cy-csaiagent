/**
 * Voyage AI embedding — voyage-3-large (1024-d, normalized).
 *
 * Exports `voyageEmbed(text, opts)` which calls the Voyage API and
 * returns a normalized 1024-dimensional float vector suitable for
 * DOT_PRODUCT similarity in Firestore findNearest.
 *
 * Security:
 *   - VOYAGE_API_KEY is read from env (Secret Manager binding on App Hosting).
 *   - The key is NEVER logged, printed, or embedded in responses.
 *   - T-01-29: grep gate `grep -nE "console\.(log|info).*VOYAGE|console.*api.?key"` must return nothing.
 *
 * References:
 *   - TSD §2.3: Voyage voyage-3-large (1024-d, multilingual), normalized vectors
 *   - TSD §4: findNearest DOT_PRODUCT, normalized embeddings
 *   - 01-09-PLAN.md: voyageEmbed(text, { model, inputType }) interface
 *   - voyageai@0.2.1 (installed in 01-08)
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { VoyageAIClient } from 'voyageai'

/** The standard embedding dimension across all Firestore vector collections. */
export const EMBED_DIM = 1024 as const

/** Supported Voyage input types for query vs document embedding. */
export type VoyageInputType = 'query' | 'document'

export interface VoyageEmbedOpts {
  /** Voyage model — always 'voyage-3-large' for this project. */
  model: 'voyage-3-large'
  /**
   * Distinguishes query vectors from document vectors.
   * Use 'query' for user messages; 'document' for KB chunks during ingestion.
   * This improves asymmetric retrieval quality.
   */
  inputType: VoyageInputType
}

/**
 * Embed a single text string via Voyage voyage-3-large.
 *
 * Returns a 1024-dimensional float vector normalized to unit length,
 * suitable for DOT_PRODUCT similarity (equivalent to cosine on unit vectors).
 *
 * @param text       The text to embed (query or document passage).
 * @param opts       Model + input type options.
 * @returns          A 1024-length number[] (normalized, unit vector).
 * @throws           On Voyage API errors (network, auth, quota) — callers should catch.
 */
export async function voyageEmbed(text: string, opts: VoyageEmbedOpts): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set. Provide it via Secret Manager binding or env.')
  }

  const client = new VoyageAIClient({ apiKey })

  const result = await client.embed({
    model: opts.model,
    input: [text],
    inputType: opts.inputType,
    outputDimension: EMBED_DIM,
  })

  const raw = result.data?.[0]?.embedding
  if (!raw || raw.length !== EMBED_DIM) {
    throw new Error(
      `Voyage returned unexpected embedding dimension: expected ${EMBED_DIM}, got ${raw?.length ?? 0}`,
    )
  }

  // Normalize to unit vector so DOT_PRODUCT == cosine similarity.
  // Voyage voyage-3-large already returns normalized vectors when outputDimension
  // is specified, but we re-normalize here as a defensive invariant.
  return normalize(raw)
}

/**
 * L2-normalize a vector to unit length.
 * After normalization, DOT_PRODUCT(a, b) == cosine_similarity(a, b).
 */
export function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vec // zero vector — return as-is
  return vec.map((v) => v / norm)
}
