/**
 * Project embedding-text composer and embedder (FIND-03).
 *
 * composeProjectEmbeddingText(project) → semantic text string for Gemini 1024-d embedding.
 * embedProject(project) → 1024-d normalized vector via embedText({inputType:'document'}).
 *
 * CRITICAL — status is NOT included in embedding text (Pitfall 1/8):
 *   `status` is a hard filter applied deterministically in Stage A of searchProjects.
 *   Including status in the vector would let semantic similarity influence availability
 *   decisions — the exact anti-pattern that Pitfall 1 warns about.
 *   Two projects identical except status MUST produce the SAME embedding text (and thus
 *   the same vector), so the only thing separating them in the pipeline is the Stage-A
 *   deterministic filter.
 *
 * Semantic fields (the project's "what and where"):
 *   name, priceBand, tenure, bedrooms, locationText, description
 *
 * Excluded fields (hard filters, not vector content):
 *   status, bumiQuota, foreignEligible, vpStatus, vpDate, priceValue, tenantId, embedding
 *
 * The priceBand label IS included because it is a human-readable semantic descriptor
 * ("500k_800k" signals affordability tier) — buyers mentally filter by band. The raw
 * numeric priceValue is excluded to avoid over-weighting exact price matching in the
 * embedding space (the affordability ceiling handles range in-memory).
 *
 * Reuse pattern:
 *   - Inventory admin CRUD: call embedProject(updatedDoc) on create/edit if any of the
 *     semantic fields change (Pitfall 8 — stale embedding after edit).
 *   - Bulk import: call embedProject per row after CSV parse + schema validation.
 *
 * Core/shell rule: NO imports from app/ or next.
 * References:
 *   - 03-02-PLAN.md Task 3
 *   - 03-RESEARCH.md Pattern 4 code example (composeProjectEmbeddingText)
 *   - src/rag/embed.ts (embedText 1024-d Gemini, reused — not re-implemented)
 */

import type { ProjectDoc } from '@/src/firebase/collections'
import { embedText } from '@/src/rag/embed'

/**
 * Compose the semantic text string for a project's 1024-d Gemini embedding.
 *
 * Joins semantic fields with ' · ' as a delimiter (mirrors 03-RESEARCH.md code example).
 * Falsy/zero values are filtered out to avoid empty segments.
 *
 * NOTE: `status` is intentionally excluded — see module header.
 *       `priceValue` is excluded (priceBand label carries the tier signal).
 *       `bumiQuota`, `foreignEligible`, `vpStatus`, `vpDate` are excluded
 *       (hard eligibility filters, not semantic content).
 *
 * @param project A ProjectDoc (only semantic fields are read).
 * @returns       A human-readable string to pass to embedText({inputType:'document'}).
 */
export function composeProjectEmbeddingText(project: ProjectDoc): string {
  // Semantic fields — in order: identity, price-tier, ownership, size, location, description
  const parts = [
    project.name,
    project.priceBand,          // e.g. "500k_800k" — price tier signal
    project.tenure,             // e.g. "freehold" | "leasehold"
    project.bedrooms ? `${project.bedrooms} bedrooms` : null,
    project.locationText,
    project.description,
  ]

  return parts
    .filter((p): p is string => Boolean(p))
    .join(' · ')
}

/**
 * Embed a project document into a 1024-d normalized vector.
 *
 * Calls composeProjectEmbeddingText to build the semantic text, then passes it
 * to embedText with {inputType:'document'} (Gemini RETRIEVAL_DOCUMENT task type).
 *
 * Returns a 1024-length number[] ready to store as `ProjectDoc.embedding`.
 *
 * @param project A ProjectDoc with at minimum name, priceBand, tenure,
 *                bedrooms, locationText, description populated.
 * @returns       A normalized 1024-d unit vector.
 */
export async function embedProject(project: ProjectDoc): Promise<number[]> {
  const text = composeProjectEmbeddingText(project)
  return embedText(text, { inputType: 'document' })
}
