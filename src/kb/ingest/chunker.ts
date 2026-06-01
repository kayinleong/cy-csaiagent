/**
 * src/kb/ingest/chunker.ts
 *
 * Token-aware text chunker for KB documents.
 *
 * Uses `gpt-tokenizer` (countTokens/encode) to split text into overlapping
 * chunks that respect a maximum token budget. This ensures each chunk passed
 * to the Voyage embedding API does not exceed the model's context limit and
 * that chunks stay consistent with the way the model counts tokens.
 *
 * Design:
 *   - Splits on paragraph/sentence boundaries first, then force-splits words
 *     if a single sentence exceeds maxTokens.
 *   - Overlap: the last `overlapTokens` tokens of each chunk are prepended to
 *     the next chunk, giving the embedding model context across boundaries.
 *   - Deterministic: same input → same output every time.
 *
 * References:
 *   - TSD §3.4 (chunked ingestion; never embed in one request)
 *   - RESEARCH §Don't-Hand-Roll (chunk sizing → gpt-tokenizer)
 *   - 01-10-PLAN.md Task 1 behavior 1
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { countTokens } from 'gpt-tokenizer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Chunk {
  /** The chunk text (may include overlap from the previous chunk) */
  text: string
  /** Token count of this chunk (according to gpt-tokenizer) */
  tokens: number
  /** Zero-based index of this chunk in the document */
  index: number
}

export interface ChunkOptions {
  /**
   * Maximum number of tokens per chunk (inclusive).
   * Default: 400 tokens — well within gemini-embedding-001's token limit but small
   * enough that each embedding is topically focused.
   */
  maxTokens?: number
  /**
   * Number of tokens to overlap between consecutive chunks.
   * Default: 50 — provides context continuity across boundaries.
   */
  overlapTokens?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 400
const DEFAULT_OVERLAP_TOKENS = 50

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Split `text` into token-bounded, overlapping chunks.
 *
 * Algorithm:
 *   1. Split the input into paragraphs (double newline) then sentences (. / ? / !).
 *   2. Accumulate sentences into a chunk until adding the next sentence would
 *      exceed `maxTokens`.
 *   3. When the limit is reached, close the current chunk and start a new one
 *      that begins with the `overlapTokens` worth of content from the end of
 *      the previous chunk.
 *   4. A sentence that is itself longer than `maxTokens` is split by words.
 *
 * @param text         The document text to chunk.
 * @param opts         Tunable parameters (maxTokens, overlapTokens).
 * @returns            Array of Chunk objects in document order.
 */
export function chunk(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS

  if (!text || text.trim().length === 0) {
    return []
  }

  // Step 1: split into sentences
  const sentences = splitIntoSentences(text)

  const result: Chunk[] = []
  let current: string[] = [] // sentences in current chunk
  let currentTokens = 0
  let overlapText = '' // trailing text carried forward as overlap

  function flushChunk() {
    if (current.length === 0 && !overlapText) return

    const fullText = overlapText
      ? (overlapText.trim() + ' ' + current.join(' ')).trim()
      : current.join(' ')

    const finalText = fullText.trim()
    if (!finalText) return

    const tokens = countTokens(finalText)
    result.push({ text: finalText, tokens, index: result.length })

    // Compute new overlap: take the last `overlapTokens` worth of content
    overlapText = extractTailByTokens(finalText, overlapTokens)
    current = []
    currentTokens = 0
  }

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence)

    if (sentenceTokens > maxTokens) {
      // Flush current chunk first
      flushChunk()
      // Then split the oversized sentence by words
      const subChunks = splitLongSentence(sentence, maxTokens, overlapTokens)
      for (const sub of subChunks) {
        result.push({ text: sub.text, tokens: sub.tokens, index: result.length })
      }
      // The overlap after an oversized sentence is the tail of the last sub-chunk
      if (subChunks.length > 0) {
        const lastSub = subChunks[subChunks.length - 1]
        overlapText = extractTailByTokens(lastSub.text, overlapTokens)
      }
      continue
    }

    // Will adding this sentence exceed the limit?
    const overlapTokenCount = overlapText ? countTokens(overlapText) : 0
    const projectedTotal = overlapTokenCount + currentTokens + sentenceTokens

    if (projectedTotal > maxTokens && current.length > 0) {
      flushChunk()
    }

    current.push(sentence)
    currentTokens += sentenceTokens
  }

  // Flush any remaining content
  flushChunk()

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split text into sentences at . / ? / ! followed by whitespace or end of string.
 * Also split on paragraph boundaries (double newline).
 */
function splitIntoSentences(text: string): string[] {
  // First split on paragraphs
  const paragraphs = text.split(/\n\s*\n/)
  const sentences: string[] = []

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    // Split each paragraph into sentences
    // Pattern: sentence-ending punctuation followed by whitespace/end
    const parts = trimmed.split(/(?<=[.?!])\s+/)
    for (const part of parts) {
      const s = part.trim()
      if (s) sentences.push(s)
    }
  }

  return sentences.filter((s) => s.length > 0)
}

/**
 * Split a single sentence that exceeds maxTokens into word-boundary sub-chunks.
 * Returns an array of sub-chunks (without overlap between them, for simplicity).
 */
function splitLongSentence(
  sentence: string,
  maxTokens: number,
  overlapTokens: number,
): { text: string; tokens: number }[] {
  const words = sentence.split(/\s+/)
  const result: { text: string; tokens: number }[] = []
  let current: string[] = []
  let currentTokens = 0

  for (const word of words) {
    const wordTokens = countTokens(word)
    if (currentTokens + wordTokens > maxTokens && current.length > 0) {
      const text = current.join(' ')
      result.push({ text, tokens: countTokens(text) })
      // Start new chunk with overlap
      const overlapWords = extractTailByTokens(text, overlapTokens).split(/\s+/).filter(Boolean)
      current = [...overlapWords, word]
      currentTokens = countTokens(current.join(' '))
    } else {
      current.push(word)
      currentTokens += wordTokens
    }
  }

  if (current.length > 0) {
    const text = current.join(' ')
    result.push({ text, tokens: countTokens(text) })
  }

  return result
}

/**
 * Extract the trailing portion of `text` that fits within `tokenBudget` tokens.
 * Returns a string (may be empty if the budget is 0 or text is short enough
 * that no tail extraction is needed).
 */
function extractTailByTokens(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0 || !text) return ''

  const words = text.split(/\s+/)
  const tail: string[] = []
  let tailTokens = 0

  // Walk backwards, adding words until we hit the budget
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]
    const wTokens = countTokens(w)
    if (tailTokens + wTokens > tokenBudget) break
    tail.unshift(w)
    tailTokens += wTokens
  }

  return tail.join(' ')
}
