/**
 * Inventory search engine — two-stage searchProjects + queryInventory.
 *
 * The LOAD-BEARING rule (FIND-01/03/06/07/09/10, T-03-04, T-03-05, T-03-06):
 *
 *   STAGE A (deterministic — NEVER skipped):
 *     Firestore filters enforce `status:'active'` + eligibility (bumiQuota/foreignEligible)
 *     + optional priceBand equality pre-filter BEFORE any vector work.
 *     Sold-out, hidden, bumi-reserved, and foreign-ineligible projects are physically
 *     unreachable — the gate is code, not prompt-controlled (T-03-05).
 *
 *   AFFORDABILITY (FIND-10 — T-03-06):
 *     `affordabilityCeiling(monthlyIncome)` filters the Stage-A set in-memory by priceValue.
 *     An all-unaffordable eligible set → {found:false, reason:'ineligible', why:'financing'}.
 *     Never a stretch match (Pitfall 3).
 *
 *   STAGE B (vector re-rank WITHIN eligible+affordable set):
 *     Embed criteria.freeText via embedText({inputType:'query'}).
 *     Compute dot-product in-memory against each candidate's embedding vector.
 *     Sort by score descending. Inventory is assumed ≤ a few hundred projects (A5 in
 *     03-RESEARCH.md) so in-memory scoring is viable and avoids the findNearest
 *     range-filter limitation (Pitfall 6).
 *
 *   SEGMENT WEIGHTS (FIND-09):
 *     applySegmentWeights() reorders Stage-B output:
 *       - 'investment': boosts vpStatus:true (VP completed = yield-ready) + priceValue rank
 *       - 'own_stay': boosts bedroom count + location richness (locationText length as proxy)
 *     Investment vs own-stay MUST produce a different top-1/top-3 for the same eligible set
 *     (Pitfall 4).
 *
 *   RETURNING-CLIENT (FIND-06):
 *     Optional `since?: Date` parameter in ParsedCriteria.
 *     Applied in-memory BEFORE vector scoring: only eligible projects with
 *     `createdAt > since` (using vpDate if createdAt absent) pass through.
 *
 *   queryInventory (FIND-07):
 *     Structured Firestore query (status + vpDate + priceBand etc.) — NO vector search.
 *     The embedText function is NEVER called from queryInventory.
 *
 * DSR_MULTIPLE constant:
 *   affordabilityCeiling = monthlyIncome * 12 * DSR_MULTIPLE.
 *   DSR_MULTIPLE defaults to 4.5 (a conservative Malaysian DSR proxy for v1).
 *   Export it so Derek/A2 can confirm or revise the financing rule without touching
 *   other logic. The gate logic (all-exceed → ineligible refusal) is correct regardless
 *   of the constant (03-RESEARCH.md A2).
 *
 * Core/shell rule: NO imports from app/ or next.
 * References:
 *   - 03-02-PLAN.md
 *   - 03-RESEARCH.md Pattern 4 (two-stage), Pitfalls 1/3/4/6
 *   - src/rag/search.ts (findNearest pattern — inventory uses in-memory dot-product instead
 *     because range filters cannot be combined with findNearest: Pitfall 6)
 *   - src/firebase/collections.ts (ProjectDoc, projectsRef, priceBandFor, PRICE_BANDS)
 *   - src/rag/embed.ts (embedText 1024-d Gemini)
 */

import { projectsRef } from '@/src/firebase/collections'
import type { PriceBand, ProjectDoc } from '@/src/firebase/collections'
import { embedText } from '@/src/rag/embed'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The Finder agent's criteria-parser output.
 * Defined here so 03-04 (Finder agent tools.ts) imports from @/src/inventory/search.
 *
 * CRITICAL: Fields default to null/unknown — the parser MUST NOT invent missing values.
 * Missing eligibility-critical fields (nationality, income) → the agent asks, not guesses
 * (03-RESEARCH.md Pitfalls 23/36).
 */
export interface ParsedCriteria {
  /** FIND-09 ranking branch — drives segment weighting in Stage B */
  segment: 'investment' | 'own_stay' | 'unknown'
  priceMin: number | null
  priceMax: number | null
  /** FIND-10: affordability ceiling derived from income × DSR. null = no ceiling. */
  monthlyIncome: number | null
  /** Eligibility — foreignEligible filter (Stage A) */
  nationality: 'malaysian' | 'foreign' | 'unknown'
  /** Eligibility — bumiQuota filter (Stage A). null = unknown (do not filter) */
  bumiputera: boolean | null
  locationPref: string | null
  bedrooms: number | null
  /** Raw free-text criteria → feeds the Stage-B query vector */
  freeText: string
  /** FIND-06 returning-client: only surface projects created/activated after this date. */
  since?: Date
}

/** A single match in searchProjects results — includes all fields the agent's rationale cites. */
export interface ProjectMatch {
  projectId: string
  name: string
  priceBand: PriceBand
  priceValue: number
  tenure: string
  vpStatus: boolean
  bumiQuota: boolean
  foreignEligible: boolean
  bedrooms: number
  locationText: string
  /** Dot-product score from Stage B (normalized unit vectors → range 0–1). */
  score: number
  /** Criteria fields that drove this match — grounding citation. */
  matchedCriteria: {
    segment: ParsedCriteria['segment']
    priceMax: number | null
    nationality: ParsedCriteria['nationality']
    bumiputera: boolean | null
    locationPref: string | null
    bedrooms: number | null
  }
}

export type SearchResult =
  | { found: true; matches: ProjectMatch[] }
  | { found: false; reason: 'no_match' }
  | { found: false; reason: 'ineligible'; why: 'financing' }

/** Filters accepted by queryInventory (FIND-07). All fields optional. */
export interface InventoryFilters {
  /** Include only projects with vpDate >= vpDateFrom (FIND-07 "completed VP this year") */
  vpDateFrom?: Date
  /** Include only projects with vpDate <= vpDateTo */
  vpDateTo?: Date
  /** Equality filter on discrete price band */
  priceBand?: PriceBand
  /** Include only projects with vpStatus === vpStatus */
  vpStatus?: boolean
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Debt-service ratio multiple for affordability ceiling v1.
 * affordabilityCeiling = monthlyIncome × 12 × DSR_MULTIPLE.
 *
 * Default: 4.5 (conservative Malaysian DSR proxy).
 * Export so Derek can confirm or revise (03-RESEARCH.md A2).
 * Gate logic (all-exceed → ineligible refusal) is correct regardless.
 */
export const DSR_MULTIPLE = 4.5

// ─── Affordability helper ────────────────────────────────────────────────────

/**
 * Derive a price ceiling from monthly income (FIND-10).
 *
 * ceiling = monthlyIncome × 12 × DSR_MULTIPLE
 * Returns Infinity when monthlyIncome is null (no ceiling applied).
 */
export function affordabilityCeiling(monthlyIncome: number | null): number {
  if (monthlyIncome === null) return Infinity
  return monthlyIncome * 12 * DSR_MULTIPLE
}

// ─── Segment weighting ────────────────────────────────────────────────────────

/**
 * Reorder Stage-B ranked candidates based on buyer segment (FIND-09).
 *
 * investment: boost vpStatus:true (VP completed = yield-ready) projects to the top.
 *             Secondary: sort by priceValue desc (premium projects preferred by investors).
 *
 * own_stay: boost projects with higher bedroom count (family-size proxy).
 *           Secondary: longer locationText (richer location descriptor = more neighbourhood
 *           detail — a proxy for lifestyle fit; real impl would use a location-embedding match).
 *
 * unknown: return Stage-B order unchanged.
 *
 * Must produce a different top-1/top-3 for 'investment' vs 'own_stay' given the same eligible
 * set (Pitfall 4 — segment-blind ranking).
 */
function applySegmentWeights(
  ranked: Array<{ doc: ProjectDoc; score: number; id: string }>,
  segment: ParsedCriteria['segment'],
): Array<{ doc: ProjectDoc; score: number; id: string }> {
  if (segment === 'investment') {
    return [...ranked].sort((a, b) => {
      // Primary: vpStatus:true first (yield-ready / VP completed)
      if (a.doc.vpStatus !== b.doc.vpStatus) {
        return a.doc.vpStatus ? -1 : 1
      }
      // Secondary: higher priceValue preferred (premium units → higher yield potential)
      if (a.doc.priceValue !== b.doc.priceValue) {
        return b.doc.priceValue - a.doc.priceValue
      }
      // Tertiary: vector score
      return b.score - a.score
    })
  }

  if (segment === 'own_stay') {
    return [...ranked].sort((a, b) => {
      // Primary: more bedrooms preferred (family-size proxy)
      if (a.doc.bedrooms !== b.doc.bedrooms) {
        return b.doc.bedrooms - a.doc.bedrooms
      }
      // Secondary: richer location descriptor (lifestyle fit proxy)
      if (a.doc.locationText.length !== b.doc.locationText.length) {
        return b.doc.locationText.length - a.doc.locationText.length
      }
      // Tertiary: vector score
      return b.score - a.score
    })
  }

  // 'unknown': Stage-B vector score order unchanged
  return ranked
}

// ─── Dot-product scoring ──────────────────────────────────────────────────────

/**
 * Score a single document embedding against the query vector using dot product.
 * Both vectors are assumed to be normalized unit vectors (Gemini guarantees this).
 * DOT_PRODUCT on unit vectors == cosine similarity.
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

// ─── Main search function ────────────────────────────────────────────────────

/**
 * Two-stage project search (FIND-01/03/06/09/10).
 *
 * STAGE A: deterministic Firestore filter (never skipped).
 * STAGE B: in-memory dot-product re-rank within eligible+affordable set.
 *
 * @param criteria ParsedCriteria from the Finder agent's criteria parser.
 * @returns        SearchResult — found:true with matches, or found:false with a reason signal.
 */
export async function searchProjects(criteria: ParsedCriteria): Promise<SearchResult> {
  // ── STAGE A: Deterministic eligibility/availability gate (NEVER skipped) ────
  //
  // Start unconditionally with status:'active' — the most critical gate.
  // All sold_out and hidden projects are unreachable from this point.
  // (T-03-04: deterministic filter runs BEFORE any vector work — T-03-05: code gate,
  //  not prompt-controlled.)
  let q = projectsRef().where('status', '==', 'active')

  // Eligibility: foreign buyer → only foreignEligible:true projects
  if (criteria.nationality === 'foreign') {
    q = q.where('foreignEligible', '==', true)
  }

  // Eligibility: non-bumiputera buyer → exclude bumi-reserved projects
  if (criteria.bumiputera === false) {
    q = q.where('bumiQuota', '==', false)
  }

  // priceBand equality pre-filter (optional, findNearest-safe):
  // If a maximum price is specified AND it maps to a specific band, we could add
  // where('priceBand','==',band) — BUT this would only filter to ONE band.
  // We skip the priceBand Firestore filter here and handle range in-memory via
  // affordabilityCeiling (Pitfall 6: findNearest pre-filters are equality-only,
  // and range filters on priceBand would miss adjacent bands).

  const eligibleSnap = await q.get()

  if (eligibleSnap.empty) {
    return { found: false, reason: 'no_match' }
  }

  // Collect eligible docs with their IDs
  const eligibleDocs = eligibleSnap.docs.map((d) => ({
    id: d.id,
    doc: d.data() as ProjectDoc,
  }))

  // ── RETURNING-CLIENT filter (FIND-06) ────────────────────────────────────
  // Applied in-memory before affordability and vector scoring.
  // Uses createdAt if present (Phase-3 schema adds it); falls back to vpDate.
  let candidates = eligibleDocs
  if (criteria.since !== undefined) {
    const since = criteria.since
    candidates = eligibleDocs.filter(({ doc }) => {
      // createdAt is a runtime field — check if it exists on the doc
      // We treat the raw Firestore value as unknown and extract Date safely
      const rawDoc = doc as unknown as Record<string, unknown>
      const createdAtRaw = rawDoc['createdAt']
      if (createdAtRaw) {
        if (createdAtRaw instanceof Date) return createdAtRaw > since
        // Firestore Timestamp has a .toDate() method
        if (typeof createdAtRaw === 'object' && createdAtRaw !== null && 'toDate' in createdAtRaw) {
          const asTimestamp = createdAtRaw as { toDate: () => Date }
          return asTimestamp.toDate() > since
        }
      }
      // Fallback: vpDate (present when VP is completed)
      const vpDateRaw = rawDoc['vpDate']
      if (vpDateRaw) {
        if (vpDateRaw instanceof Date) return vpDateRaw > since
        if (typeof vpDateRaw === 'object' && vpDateRaw !== null && 'toDate' in vpDateRaw) {
          const asTimestamp = vpDateRaw as { toDate: () => Date }
          return asTimestamp.toDate() > since
        }
      }
      return false // no date field → exclude from returning-client results
    })
  }

  // ── AFFORDABILITY gate (FIND-10 — T-03-06) ──────────────────────────────
  // In-memory because range filters cannot be combined with findNearest (Pitfall 6).
  const ceiling = affordabilityCeiling(criteria.monthlyIncome)
  const affordableDocs = criteria.monthlyIncome !== null
    ? candidates.filter(({ doc }) => doc.priceValue <= ceiling)
    : candidates

  if (affordableDocs.length === 0) {
    if (criteria.monthlyIncome !== null) {
      // All eligible projects exceed the affordability ceiling
      return { found: false, reason: 'ineligible', why: 'financing' }
    }
    // No income specified but since-filter or other in-memory filter eliminated all candidates
    return { found: false, reason: 'no_match' }
  }

  // ── STAGE B: Vector re-rank WITHIN the eligible+affordable set ─────────
  //
  // Embed the freeText query with Gemini (inputType:'query').
  // Score each candidate by dot product against its stored embedding.
  // In-memory scoring is viable for ≤ a few hundred projects (A5 in 03-RESEARCH.md)
  // and avoids the findNearest range-filter limitation (Pitfall 6).
  const queryVector = await embedText(criteria.freeText, { inputType: 'query' })

  const scored = affordableDocs.map(({ id, doc }) => ({
    id,
    doc,
    score: doc.embedding.length > 0 ? dotProduct(queryVector, doc.embedding) : 0,
  }))

  // Sort by score descending (highest dot product = most similar)
  scored.sort((a, b) => b.score - a.score)

  // ── SEGMENT WEIGHTING (FIND-09) ──────────────────────────────────────────
  const reranked = applySegmentWeights(scored, criteria.segment)

  // ── Map to ProjectMatch ──────────────────────────────────────────────────
  const matches: ProjectMatch[] = reranked.map(({ id, doc, score }) => ({
    projectId: id,
    name: doc.name,
    priceBand: doc.priceBand,
    priceValue: doc.priceValue,
    tenure: doc.tenure,
    vpStatus: doc.vpStatus,
    bumiQuota: doc.bumiQuota,
    foreignEligible: doc.foreignEligible,
    bedrooms: doc.bedrooms,
    locationText: doc.locationText,
    score,
    matchedCriteria: {
      segment: criteria.segment,
      priceMax: criteria.priceMax,
      nationality: criteria.nationality,
      bumiputera: criteria.bumiputera,
      locationPref: criteria.locationPref,
      bedrooms: criteria.bedrooms,
    },
  }))

  return { found: true, matches }
}

// ─── Structured inventory query ───────────────────────────────────────────────

/**
 * Structured filtered query over the projects collection (FIND-07).
 *
 * Answers questions like "which projects completed VP this year" without any
 * vector search. embedText is NEVER called from this function.
 *
 * Always enforces status:'active' as the base filter — sold_out/hidden projects
 * are excluded from structured queries too.
 *
 * @param filters  Optional structured filters (vpDateFrom, vpDateTo, priceBand, vpStatus).
 * @returns        Array of matching projects (raw ProjectDoc shape + projectId).
 */
export async function queryInventory(
  filters: InventoryFilters,
): Promise<Array<ProjectDoc & { projectId: string }>> {
  // Always active-only — same deterministic gate as searchProjects
  let q = projectsRef().where('status', '==', 'active')

  // VP-date range filters (FIND-07)
  if (filters.vpDateFrom !== undefined) {
    q = q.where('vpDate', '>=', filters.vpDateFrom)
  }
  if (filters.vpDateTo !== undefined) {
    q = q.where('vpDate', '<=', filters.vpDateTo)
  }

  // Equality filter on discrete price band (findNearest-safe — but this is structured, no vector)
  if (filters.priceBand !== undefined) {
    q = q.where('priceBand', '==', filters.priceBand)
  }

  // VP status boolean filter
  if (filters.vpStatus !== undefined) {
    q = q.where('vpStatus', '==', filters.vpStatus)
  }

  const snap = await q.get()
  return snap.docs.map((d) => ({
    ...(d.data() as ProjectDoc),
    projectId: d.id,
  }))
}
