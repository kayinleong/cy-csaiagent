/**
 * src/agents/finder/schema.ts — Zod schemas for the Finder agent.
 *
 * Two schemas:
 *   1. `CriteriaSchema`    — the generateObject input schema (LLM criteria parser).
 *      Mirrors the ParsedCriteria interface from src/inventory/search.ts.
 *      CRITICAL: enums include 'unknown' so the parser NEVER invents missing
 *      eligibility-critical fields (03-RESEARCH.md Pitfalls 23/36).
 *
 *   2. `FinderOutputSchema` — the Zod output schema for the Finder agent response.
 *      Matches pattern:
 *        - `matches` non-empty → found projects (each with projectId + rationale + matchedCriteria)
 *        - `refusal` present  → no match or ineligible (grounded refusal, no invented project)
 *        - `clarifyingQuestion` present → eligibility-critical data missing (ask, don't guess)
 *      App-level invariant: matches non-empty XOR refusal present XOR clarifyingQuestion present.
 *      (Same cross-field pattern as CoachOutputSchema — enforced at application level in index.ts)
 *
 * FIND-03, FIND-09, FIND-10, Pitfalls 23/36.
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { z } from 'zod'

// ─── 1. CriteriaSchema (generateObject input) ─────────────────────────────────

/**
 * The Zod schema used with `generateObject` to turn pasted free-text lead
 * criteria into a typed query object (03-RESEARCH.md Pattern 3).
 *
 * All eligibility-critical fields include 'unknown' in their enum / allow null:
 *   - nationality: 'unknown' — do NOT let the parser invent a nationality
 *   - segment: 'unknown' — do NOT let the parser invent investment/own_stay
 *   - monthlyIncome: null — do NOT invent income (FIND-10 affordability gate)
 *   - bumiputera: null — do NOT invent eligibility
 *
 * Missing eligibility-critical fields must cause the agent to ASK, not guess
 * (the prompt enforces this; the schema makes it possible to represent unknown).
 */
export const CriteriaSchema = z.object({
  /**
   * FIND-09 segment — drives ranking branch.
   * 'investment': investor criteria (yield-focus, VP status, price tier).
   * 'own_stay': lifestyle criteria (bedrooms, location, first-home).
   * 'unknown': segment not determinable from text → agent should ask.
   */
  segment: z.enum(['investment', 'own_stay', 'unknown']),

  /**
   * Minimum price in RM. null if not mentioned in the pasted text.
   */
  priceMin: z.number().nullable(),

  /**
   * Maximum price in RM. null if not mentioned.
   */
  priceMax: z.number().nullable(),

  /**
   * Monthly household income in RM (FIND-10 affordability gate).
   * null if not mentioned — do NOT invent; affordabilityCeiling(null) = Infinity
   * (no ceiling applied when income is unknown).
   */
  monthlyIncome: z.number().nullable(),

  /**
   * Financing note (e.g. "first-time buyer", "end-financing required").
   * null/optional if not mentioned. Informational; affordability gate uses monthlyIncome.
   */
  financingNote: z.string().nullable().optional(),

  /**
   * Lead nationality — determines foreign-eligibility filter in Stage A.
   * 'unknown': nationality not stated → do NOT apply foreignEligible filter;
   *   agent should ask if nationality affects eligibility (Pitfall 23).
   */
  nationality: z.enum(['malaysian', 'foreign', 'unknown']),

  /**
   * Whether the lead is bumiputera (affects bumiQuota filter in Stage A).
   * null: not stated → do NOT apply bumiQuota filter (Pitfall 23).
   * false: explicitly non-bumi → filter out bumi-reserved projects.
   * true: bumi buyer → all projects (incl. bumi-reserved) are eligible.
   */
  bumiputera: z.boolean().nullable(),

  /**
   * Location preference (e.g. "Cheras, KL", "Mont Kiara").
   * null if not mentioned.
   */
  locationPref: z.string().nullable(),

  /**
   * Preferred tenure (e.g. "freehold", "leasehold"). null/optional if not mentioned.
   */
  tenurePref: z.string().nullable().optional(),

  /**
   * Preferred number of bedrooms. null if not mentioned.
   */
  bedrooms: z.number().nullable(),

  /**
   * The raw pasted free-text criteria — feeds the Stage-B query vector.
   * Always present (this is the input; even if structured fields parse to unknown/null,
   * the raw text is preserved for semantic re-rank).
   */
  freeText: z.string(),
})

export type ParsedCriteriaInput = z.infer<typeof CriteriaSchema>

// ─── 2. FinderOutputSchema ────────────────────────────────────────────────────

/**
 * A single collateral item attached to a project match.
 * Returns type + URL (Storage path resolved to download URL, or externalUrl).
 * D-09/C2: Never a Drive API link — Storage or plain external URL.
 */
export const CollateralItemSchema = z.object({
  type: z.string().min(1),
  url: z.string().min(1),
})

/**
 * A single project match in the Finder output.
 * Each match carries a "why this match" rationale grounded in real project
 * fields (priceBand, tenure, vpStatus, bumiQuota, foreignEligible) + the
 * matched criteria — cites the projectId (D-04).
 *
 * Invariant: rationale must NOT invent fields absent from the project record.
 * Invariant: projectId comes from the searchProjects tool result — never fabricated.
 */
export const FinderMatchSchema = z.object({
  /**
   * The Firestore projects/{pid} document ID.
   * Comes from searchProjects results — NEVER fabricated.
   */
  projectId: z.string().min(1),

  /**
   * Human-readable "why this match" explanation grounded in real project fields.
   * Must reference at least one of: projectId, priceBand, tenure, vpStatus, bedrooms,
   * locationText, foreignEligible, bumiQuota — no invented attributes.
   */
  rationale: z.string().min(1),

  /**
   * The criteria fields that drove this match — grounding citation.
   * Mirrors matchedCriteria in ProjectMatch.
   */
  matchedCriteria: z.object({
    segment: z.enum(['investment', 'own_stay', 'unknown']),
    priceMax: z.number().nullable(),
    nationality: z.enum(['malaysian', 'foreign', 'unknown']),
    bumiputera: z.boolean().nullable(),
    locationPref: z.string().nullable(),
    bedrooms: z.number().nullable(),
  }),

  /**
   * Collateral attached to this project (optional).
   * Populated by the fetchCollateral tool — type + URL (Storage or external).
   * Never a Drive API link (D-09/C2).
   */
  collateral: z.array(CollateralItemSchema).optional(),
})

/**
 * Grounded refusal signal — emitted when searchProjects returns no match or ineligible.
 * The agent can EXPLAIN the refusal but never OVERRIDE the deterministic gate.
 */
export const FinderRefusalSchema = z.object({
  reason: z.enum(['no_match', 'ineligible']),
  /**
   * Grounded explanation referencing the real gate result.
   * For 'ineligible': must reference the why (e.g., 'financing') — not an invented reason.
   * For 'no_match': explains that no active projects matched the criteria.
   */
  explanation: z.string().min(1),
})

/**
 * The validated output schema for the Finder agent.
 *
 * App-level invariants (checked in index.ts):
 *   - `matches` non-empty → found projects → no refusal, no clarifyingQuestion
 *   - `refusal` present   → tool returned no_match or ineligible → matches must be empty
 *   - `clarifyingQuestion` present → eligibility-critical field unknown → agent asks, doesn't guess
 *
 * The Zod schema allows all three to be optional/empty — the application-level
 * gate in index.ts enforces the XOR invariant (same pattern as CoachOutputSchema).
 */
export const FinderOutputSchema = z.object({
  /**
   * Array of ranked project matches (empty when refusal or clarifyingQuestion is present).
   * Never contains an invented project — all entries come from searchProjects results.
   */
  matches: z.array(FinderMatchSchema),

  /**
   * Present ONLY when searchProjects returns no_match or ineligible.
   * Grounded refusal — the agent explains the result, never fabricates a match.
   */
  refusal: FinderRefusalSchema.optional(),

  /**
   * Present ONLY when eligibility-critical data (nationality/income) is unknown.
   * The agent asks rather than guesses (Pitfalls 23/36).
   * When present, matches must be empty and refusal must be absent.
   */
  clarifyingQuestion: z.string().min(1).optional(),
})

export type FinderOutput = z.infer<typeof FinderOutputSchema>
export type FinderMatch = z.infer<typeof FinderMatchSchema>
export type FinderRefusal = z.infer<typeof FinderRefusalSchema>
export type CollateralItem = z.infer<typeof CollateralItemSchema>
