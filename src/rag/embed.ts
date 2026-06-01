/**
 * Gemini embedding — gemini-embedding-001 (1024-d, normalized).
 *
 * Exports `embedText(text, opts)` which calls the Gemini Developer API via
 * the Vercel AI SDK (@ai-sdk/google) and returns a normalized 1024-dimensional
 * float vector suitable for DOT_PRODUCT similarity in Firestore findNearest.
 *
 * Security:
 *   - GOOGLE_GENERATIVE_AI_API_KEY is read from env (Secret Manager binding on App Hosting).
 *   - The key is NEVER logged, printed, or embedded in responses.
 *   - T-01-29: grep gate `grep -nE "console\.(log|info).*GOOGLE|console.*api.?key"` must return nothing.
 *
 * Provider options verified against installed @ai-sdk/google@2.0.74 types:
 *   - providerOptions key: "google"
 *   - outputDimensionality: number (NOT outputDimension)
 *   - taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" | (others)
 *   - embed() returns { embedding: number[] } (EmbeddingModelV2Embedding = Array<number>)
 *
 * References:
 *   - TSD §2.3: Gemini gemini-embedding-001 (1024-d, multilingual), normalized vectors
 *   - TSD §4: findNearest DOT_PRODUCT, normalized embeddings
 *   - Decision 2026-06-01: swap Voyage → Gemini Developer API (gemini-embedding-001 @1024-d)
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { embed } from 'ai'
import { google } from '@ai-sdk/google'

/** The standard embedding dimension across all Firestore vector collections. */
export const EMBED_DIM = 1024 as const

/** Supported input types for query vs document embedding. */
export type EmbedInputType = 'query' | 'document'

export interface EmbedTextOpts {
  /**
   * Distinguishes query vectors from document vectors.
   * Use 'query' for user messages; 'document' for KB chunks during ingestion.
   * This improves asymmetric retrieval quality (maps to Gemini taskType).
   */
  inputType: EmbedInputType
}

/**
 * Map our inputType to the Gemini taskType string.
 * Verified against @ai-sdk/google@2.0.74 GoogleGenerativeAIEmbeddingProviderOptions.
 */
function toTaskType(
  inputType: EmbedInputType,
): 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' {
  return inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
}

/**
 * Embed a single text string via Gemini gemini-embedding-001.
 *
 * Returns a 1024-dimensional float vector normalized to unit length,
 * suitable for DOT_PRODUCT similarity (equivalent to cosine on unit vectors).
 *
 * @param text       The text to embed (query or document passage).
 * @param opts       Input type options ({ inputType: 'query' | 'document' }).
 * @returns          A 1024-length number[] (normalized, unit vector).
 * @throws           On missing API key, Gemini API errors (network, auth, quota),
 *                   or unexpected embedding dimension.
 */
export async function embedText(text: string, opts: EmbedTextOpts): Promise<number[]> {
  // Key guard — fail early before making any network call. Never log the key.
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      'GOOGLE_GENERATIVE_AI_API_KEY is not set. Provide it via Secret Manager binding or env.',
    )
  }

  const { embedding } = await embed({
    model: google.textEmbedding('gemini-embedding-001'),
    value: text,
    providerOptions: {
      google: {
        outputDimensionality: EMBED_DIM,
        taskType: toTaskType(opts.inputType),
      },
    },
  })

  if (!embedding || embedding.length !== EMBED_DIM) {
    throw new Error(
      `Gemini returned unexpected embedding dimension: expected ${EMBED_DIM}, got ${embedding?.length ?? 0}`,
    )
  }

  // Normalize to unit vector so DOT_PRODUCT == cosine similarity.
  return normalize(embedding)
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
