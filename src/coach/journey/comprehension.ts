/**
 * src/coach/journey/comprehension.ts — Free-text paraphrase grading (COACH-09).
 *
 * Exports `gradeParaphrase(answer, canonicalText, opts)` which evaluates whether
 * a new agent's free-text paraphrase demonstrates understanding of the canonical
 * KB content at a comprehension checkpoint.
 *
 * Anti-patterns avoided:
 *   - NO MCQ (gameable — FEATURES.md line 106, RESEARCH.md anti-patterns)
 *   - Raw answer text is NEVER logged (T-02-17)
 *
 * Grading backend:
 *   - Injectable via opts.grade (a fn: (answer, canonical) => Promise<number>).
 *   - Default (live path, env-gated): embedding cosine similarity via embedText() + normalize()
 *     from the rag facade — a 0.78 threshold is the default (A2: verify with Derek + a coach).
 *   - Alternative (LLM judge path): inject an Opus/Sonnet judge fn for richer grading.
 *   - Tests inject a deterministic fake — no live Gemini call needed for unit tests.
 *
 * Security (T-02-17):
 *   - gradeParaphrase NEVER logs the raw answer text.
 *   - Only the numeric score is returned — callers decide whether to persist it.
 *
 * References: COACH-09, RESEARCH.md Pattern 3 + A2, CONTEXT.md D-06.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { embedText, normalize } from '@/src/rag/embed'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A grading function that computes a semantic similarity score in [0, 1].
 *
 * Default: embedding cosine similarity via Gemini gemini-embedding-001.
 * Alternative: LLM judge returning a normalized score.
 *
 * The function MUST NOT log either string — only the numeric score matters.
 */
export type GradeFn = (answer: string, canonicalText: string) => Promise<number>

export interface GradeParaphraseOpts {
  /**
   * Injectable grading backend. Defaults to embedding cosine similarity via Gemini.
   * Inject a deterministic fake in unit tests to avoid live API calls.
   */
  grade?: GradeFn
  /**
   * Pass threshold in [0, 1]. An answer scores >= threshold is considered a pass.
   * Default: 0.78 (A2 — verify with Derek + a coach before tightening).
   * Document changes to this value in SUMMARY.md.
   */
  threshold?: number
}

export interface GradeParaphraseResult {
  /** Whether the answer meets the comprehension threshold. */
  pass: boolean
  /**
   * The numeric similarity score in [0, 1].
   * 0 for blank/empty answers; the grade fn's value otherwise.
   * Returned (never logged) so the dashboard and eval suite can inspect borderlines.
   */
  score: number
}

// ─── Default threshold ────────────────────────────────────────────────────────

/**
 * Default comprehension pass threshold.
 *
 * A5/A2 note: 0.78 is a reasonable starting point for embedding cosine similarity
 * with gemini-embedding-001. Must be validated with Derek + a D2 coach against
 * real agent paraphrases before the pilot. Leave it tunable via opts.threshold.
 */
export const DEFAULT_THRESHOLD = 0.78

// ─── Default live grading backend ────────────────────────────────────────────

/**
 * Default grading backend: embedding cosine similarity via Gemini.
 *
 * Both strings are embedded as RETRIEVAL_QUERY vectors (asymmetric retrieval
 * is not meaningful here — both sides are passage-level text). The normalized
 * dot product equals cosine similarity.
 *
 * NEVER called directly in unit tests — tests inject a deterministic fake.
 * Requires GOOGLE_GENERATIVE_AI_API_KEY at runtime (env-gated).
 *
 * Security (T-02-17): neither string is logged; only the numeric score is used.
 */
async function embeddingCosineSimilarity(
  answer: string,
  canonicalText: string,
): Promise<number> {
  // Embed both texts and compute the dot product (cosine similarity on unit vectors).
  const [vecA, vecB] = await Promise.all([
    embedText(answer, { inputType: 'query' }),
    embedText(canonicalText, { inputType: 'query' }),
  ])

  // normalize() already returns unit vectors; dot product == cosine similarity.
  const unitA = normalize(vecA)
  const unitB = normalize(vecB)

  return unitA.reduce((sum, a, i) => sum + a * unitB[i], 0)
}

// ─── gradeParaphrase ──────────────────────────────────────────────────────────

/**
 * Grade a free-text paraphrase against canonical KB content.
 *
 * A passing grade means the agent has demonstrated understanding of the checkpoint
 * content — a prerequisite for advancing to the next checkpoint (T-02-15).
 *
 * @param answer         The agent's free-text paraphrase (non-empty, non-MCQ).
 * @param canonicalText  The canonical KB content to compare against.
 * @param opts           Injectable grade fn + configurable threshold.
 * @returns              { pass: boolean, score: number }
 *
 * Security (T-02-17): raw answer text is NEVER logged inside this function.
 */
export async function gradeParaphrase(
  answer: string,
  canonicalText: string,
  opts?: GradeParaphraseOpts,
): Promise<GradeParaphraseResult> {
  const { grade = embeddingCosineSimilarity, threshold = DEFAULT_THRESHOLD } = opts ?? {}

  // Short-circuit: an empty or whitespace-only answer always fails.
  if (!answer || answer.trim().length === 0) {
    return { pass: false, score: 0 }
  }

  // Grade the answer using the injected (or default) backend.
  // Security: we do NOT log `answer` or `canonicalText` here.
  const score = await grade(answer, canonicalText)

  return {
    pass: score >= threshold,
    score,
  }
}
