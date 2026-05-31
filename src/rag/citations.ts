/**
 * Citation assembly — the grounding contract.
 *
 * Converts raw RetrievalResult[] from the adapter into a structured citation
 * list the Coach embeds in its grounded answers. Every citation references a
 * REAL KB chunk ID — no fabricated IDs are ever emitted (T-01-27 mitigation).
 *
 * Exports:
 *   buildCitations(results) → { citations: Citation[], missed: boolean }
 *   isRetrievalMiss(results): boolean
 *
 * Miss signal:
 *   An empty results array (or one that falls below the confidence threshold)
 *   is the "retrieval miss" signal. The Coach agent uses isRetrievalMiss() to
 *   decide whether to emit a handoff/no_sop_match instead of answering.
 *
 * References:
 *   - TSD §6: grounding mandate — answers cite sources (KB chunk IDs / SOP IDs)
 *   - 01-09-PLAN.md Task 2: buildCitations shape + de-dup + cap
 *   - 01-CONTEXT.md D-09: Coach real citations = KB chunk IDs + Zod output schema
 *   - T-01-27: fabricated chunkIds are a tampering threat; only emit IDs from input
 *
 * Core/shell rule: this file must NOT import from app/ or next. Pure function.
 */

import type { RetrievalResult } from '@/src/rag/search'

/** Maximum number of citations to include in a Coach answer. */
export const MAX_CITATIONS = 5

/** A single citation reference attached to a grounded Coach answer. */
export interface Citation {
  /** The Firestore kbChunks/{chunkId} document ID — the citation source. NEVER fabricated. */
  chunkId: string
  /** The parent KB document ID for display / drill-down. */
  docId: string
  /**
   * A short text snippet (≤ 200 chars) from the chunk for inline display.
   * Truncated at word boundary to avoid cutting mid-word.
   */
  snippet: string
}

/** Result shape returned by buildCitations. */
export interface CitationResult {
  citations: Citation[]
  /**
   * true when the retrieval produced no usable chunks.
   * The Coach must emit a handoff/no_sop_match signal when missed === true
   * instead of generating an answer from its parametric knowledge.
   */
  missed: boolean
}

/** Maximum snippet length in characters. */
const SNIPPET_MAX_CHARS = 200

/**
 * Truncate text to `maxChars` at a word boundary.
 * Appends "…" if truncated.
 */
function truncateSnippet(text: string, maxChars = SNIPPET_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}

/**
 * Build a citation list from retrieval results.
 *
 * - Results are de-duplicated by chunkId (first occurrence wins — highest score).
 * - The list is capped at MAX_CITATIONS (5) to keep the Coach output schema bounded.
 * - Each citation.chunkId is guaranteed to come from the input (no fabrication).
 * - When results is empty, missed:true is returned.
 *
 * @param results  Output from retrieve() — the raw retrieval results.
 * @returns        { citations: Citation[], missed: boolean }
 */
export function buildCitations(results: RetrievalResult[]): CitationResult {
  if (results.length === 0) {
    return { citations: [], missed: true }
  }

  // De-duplicate by chunkId (preserve the first / highest-scored occurrence)
  const seen = new Set<string>()
  const deduped: RetrievalResult[] = []
  for (const r of results) {
    if (!seen.has(r.chunkId)) {
      seen.add(r.chunkId)
      deduped.push(r)
    }
  }

  // Cap at MAX_CITATIONS
  const capped = deduped.slice(0, MAX_CITATIONS)

  // Map to Citation objects — chunkId comes directly from input (T-01-27)
  const citations: Citation[] = capped.map((r) => ({
    chunkId: r.chunkId,
    docId: r.docId,
    snippet: truncateSnippet(r.text),
  }))

  return { citations, missed: false }
}

/**
 * Returns true if the retrieval produced no usable chunks.
 *
 * This is the primary gate the Coach agent uses before answering:
 *
 *   const results = await retrieve(query, userLang)
 *   if (isRetrievalMiss(results)) {
 *     // emit handoff signal / no_sop_match — do NOT hallucinate
 *   }
 *
 * @param results  Output from retrieve().
 * @returns        true if results is empty (retrieval miss).
 */
export function isRetrievalMiss(results: RetrievalResult[]): boolean {
  return results.length === 0
}
