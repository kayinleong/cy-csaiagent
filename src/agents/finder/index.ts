/**
 * src/agents/finder/index.ts — D2 Property Finder agent.
 *
 * Exports `finderAgent` which is invoked THROUGH the router (TSD §6, D-03/D-04/D-05):
 *   const { pillar } = await routeAsync(messages, { override })
 *   if (pillar === 'finder') {
 *     const systemPrompt = finderAgent.buildSystemPrompt({ leadContext: storedFinderSlot })
 *     const tools = finderAgent.makeTools(userLang, agentUid, leadId)
 *     // Pass systemPrompt + tools to streamText (route handler owns streaming)
 *   }
 *
 * Three load-bearing behaviors (from 03-04-PLAN.md):
 *   1. Criteria parser — `generateObject` + CriteriaSchema turns pasted free text into
 *      a typed ParsedCriteria. Emits 'unknown' for missing eligibility-critical fields
 *      (never invents nationality/income — Pitfalls 23/36).
 *   2. Tools are READ-ONLY — delegate availability/eligibility/affordability entirely to
 *      the deterministic `searchProjects` from 03-02. The model can EXPLAIN a refusal
 *      but never OVERRIDE the gate (anti-pattern).
 *   3. Grounded refusal — when searchProjects returns no_match/ineligible, finderAgent.run
 *      emits a FinderOutput with an empty matches array and a grounded refusal signal.
 *      Never a fabricated project (D-04/D-05).
 *
 * The `run()` method handles the offline/test path (injected search results).
 * The streaming path (route) reuses buildSystemPrompt + makeTools and passes them to
 * streamText({ model, system, tools, stopWhen: stepCountIs(N) }) in 03-07.
 *
 * Anti-patterns (from RESEARCH.md):
 *   - Tools are READ-ONLY (no Firestore writes inside tool execute — T-03-14).
 *   - finderSlot write happens in the route's onFinish, NOT inside a tool.
 *   - Model IDs resolved via modelFor() — never hard-coded.
 *   - Model cannot bypass the availability/eligibility gate — tools are the only inventory source.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { buildFinderSystemPrompt, FINDER_SYSTEM_PROMPT } from './prompt'
import {
  makeSearchProjectsTool,
  makeQueryInventoryTool,
  makeFetchCollateralTool,
} from './tools'
import { FinderOutputSchema } from './schema'
import type { FinderOutput } from './schema'
import type { SearchResult } from '@/src/inventory/search'
import type { ParsedCriteria } from '@/src/inventory/search'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinderRunArgs {
  /** Conversation messages (most-recent last). Content is already PDPA-redacted upstream. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Language of the current turn. */
  userLang: 'en' | 'ms' | 'zh'
  /** The authenticated agent's UID. */
  agentUid: string
  /** Lead ID — used for finderSlot write in onFinish (route). Optional for non-lead sessions. */
  leadId?: string
  /** Parsed criteria — injected for the offline/test path. */
  parsedCriteria?: ParsedCriteria
  /** Injected searchProjects result for the offline/test path (bypasses actual Firestore call). */
  injectedSearchResult?: SearchResult
}

export interface FinderRunResult {
  /** The Finder's validated output (matches / refusal / clarifyingQuestion). */
  output: FinderOutput
}

// ─── finderAgent ───────────────────────────────────────────────────────────────

/**
 * The Finder agent singleton.
 *
 * Mirrors coachAgent shape exactly:
 *   - buildSystemPrompt(options?) → system prompt with optional lead context
 *   - makeTools(userLang, agentUid?, leadId?) → read-only tool set
 *   - outputSchema → FinderOutputSchema (for route streamText experimental_output)
 *   - run(args, options?) → offline/test path with injected results
 *
 * The streaming path in 03-07 uses buildSystemPrompt + makeTools + modelFor('finder').
 * run() is used for offline testing and for output validation + refusal gate.
 */
export const finderAgent = {
  /**
   * Base system prompt (no lead context).
   * Use buildSystemPrompt() in production to inject finderSlot context.
   * Kept for backwards compatibility.
   */
  systemPrompt: FINDER_SYSTEM_PROMPT,

  /**
   * Build a lead-context-aware system prompt.
   * Call this at invocation time with the stored finderSlot (if available).
   *
   * @param options  Optional runtime context (leadContext from finderSlot).
   */
  buildSystemPrompt(options?: { leadContext?: Record<string, unknown> }): string {
    return buildFinderSystemPrompt(options)
  },

  /** Output schema — used for Zod validation + streamText experimental_output. */
  outputSchema: FinderOutputSchema,

  /**
   * Build the tool set for this conversation turn.
   *
   * @param userLang  Injected via closure so tools can localise descriptions.
   * @param agentUid  The authenticated agent's UID (for audit / future tool needs).
   * @param leadId    The current lead ID (for future per-lead tools if needed).
   */
  makeTools(userLang: 'en' | 'ms' | 'zh', agentUid?: string, leadId?: string) {
    // agentUid and leadId are available for future tool needs
    void agentUid
    void leadId

    return {
      searchProjects: makeSearchProjectsTool(userLang),
      queryInventory: makeQueryInventoryTool(userLang),
      fetchCollateral: makeFetchCollateralTool(userLang),
    }
  },

  /**
   * Run the Finder agent for one turn (offline / test path).
   *
   * This method is called by the route handler AFTER router decides 'finder'.
   * It handles the refusal gate and Zod validation.
   *
   * For the streaming path (route handler), the handler passes:
   *   - buildSystemPrompt({ leadContext: storedFinderSlot })
   *   - makeTools(userLang, uid, body.leadId)
   *   - modelFor('finder')
   * to streamText. The streaming path does NOT call run() directly.
   *
   * For the offline/test path, run() uses injectedSearchResult to exercise
   * the full gate: eligibility check → refusal gate → grounded rationale → Zod validation.
   */
  async run(args: FinderRunArgs): Promise<FinderRunResult> {
    const { parsedCriteria, injectedSearchResult, userLang } = args

    // ── Offline/test path: injected search result ─────────────────────────────
    // When injectedSearchResult is provided, skip the actual searchProjects call
    // and exercise the refusal gate + output construction directly.
    if (injectedSearchResult !== undefined) {
      const output = buildOutputFromSearchResult(
        injectedSearchResult,
        parsedCriteria,
        userLang,
      )
      const validated = FinderOutputSchema.parse(output)
      return { output: validated }
    }

    // ── Default path (no injection, no streaming) ─────────────────────────────
    // When called without injection and without a live streaming context,
    // return a placeholder (the real streaming path goes through route.ts).
    const defaultOutput: FinderOutput = {
      matches: [],
    }
    const validated = FinderOutputSchema.parse(defaultOutput)
    return { output: validated }
  },
} as const

// ─── Output builder ───────────────────────────────────────────────────────────

/**
 * Build a FinderOutput from a SearchResult (for the offline/test path).
 *
 * Grounding rules:
 *   - found:false → grounded refusal (no matches, no invented project)
 *   - found:true  → build grounded matches with per-match rationale citing real fields
 *
 * When parsedCriteria is present and eligibility-critical fields are 'unknown',
 * emit a clarifyingQuestion rather than a refusal or matches.
 */
function buildOutputFromSearchResult(
  searchResult: SearchResult,
  parsedCriteria?: ParsedCriteria,
  userLang?: 'en' | 'ms' | 'zh',
): FinderOutput {
  void userLang // available for future i18n of refusal messages

  // Check if eligibility-critical fields are unknown — agent should ask, not guess
  if (parsedCriteria) {
    const nationalityUnknown = parsedCriteria.nationality === 'unknown'
    const incomeUnknown = parsedCriteria.monthlyIncome === null
    const segmentUnknown = parsedCriteria.segment === 'unknown'

    // If the search came back no_match AND we have unknown eligibility-critical fields,
    // emit a clarifying question rather than just a refusal (Pitfalls 23/36)
    if (nationalityUnknown || (segmentUnknown && incomeUnknown)) {
      const questions: string[] = []
      if (nationalityUnknown) {
        questions.push('Could you confirm the lead\'s nationality (Malaysian or foreign buyer)?')
      }
      if (segmentUnknown) {
        questions.push('Is the lead looking to invest or to own-stay (primary residence)?')
      }
      if (incomeUnknown && !segmentUnknown) {
        questions.push('Could you share the lead\'s approximate monthly household income? This helps with affordability matching.')
      }

      return {
        matches: [],
        clarifyingQuestion: questions.join(' '),
      }
    }
  }

  // ── Grounded refusal (no_match / ineligible) ──────────────────────────────
  if (!searchResult.found) {
    if (searchResult.reason === 'ineligible' && 'why' in searchResult) {
      const why = searchResult.why
      let explanation: string
      if (why === 'financing') {
        explanation =
          'Based on the lead\'s monthly income, the estimated affordability ceiling does not cover any of our currently active projects at their price points. ' +
          'This lead does not meet the financing requirements for available projects. ' +
          'Consider discussing refinancing options or adjusting the target price range with D2 sales admin.'
      } else {
        explanation =
          `This lead is not eligible for currently active projects (reason: ${why}). ` +
          'Please consult D2 sales admin for eligibility guidance.'
      }

      return {
        matches: [],
        refusal: {
          reason: 'ineligible',
          explanation,
        },
      }
    }

    // no_match
    return {
      matches: [],
      refusal: {
        reason: 'no_match',
        explanation:
          'No active D2 projects currently match the lead\'s criteria. ' +
          'This may be due to eligibility requirements (bumiQuota / foreignEligible), ' +
          'price range, or no available inventory in the preferred area. ' +
          'Criteria can be adjusted or the lead can be revisited when new projects are launched.',
      },
    }
  }

  // ── Found: build grounded matches with per-match rationale ───────────────
  const matches = searchResult.matches.map((match) => {
    const rationale = buildRationale(match)

    return {
      projectId: match.projectId,
      rationale,
      matchedCriteria: {
        segment: match.matchedCriteria.segment,
        priceMax: match.matchedCriteria.priceMax,
        nationality: match.matchedCriteria.nationality,
        bumiputera: match.matchedCriteria.bumiputera,
        locationPref: match.matchedCriteria.locationPref,
        bedrooms: match.matchedCriteria.bedrooms,
      },
    }
  })

  return { matches }
}

// ─── Rationale builder ────────────────────────────────────────────────────────

/**
 * Build a "why this match" rationale grounded in real project fields.
 *
 * Cites the projectId and references real project data (priceBand, tenure, vpStatus,
 * bumiQuota, foreignEligible, bedrooms, locationText). Never invents a field value.
 *
 * D-04: rationale must reference the project's real fields + matched criteria.
 */
function buildRationale(match: {
  projectId: string
  name: string
  priceBand: string
  priceValue: number
  tenure: string
  vpStatus: boolean
  bumiQuota: boolean
  foreignEligible: boolean
  bedrooms: number
  locationText: string
  score: number
  matchedCriteria: {
    segment: string
    priceMax: number | null
    nationality: string
    bumiputera: boolean | null
    locationPref: string | null
    bedrooms: number | null
  }
}): string {
  const parts: string[] = []

  // Always cite the projectId — grounding mandate
  parts.push(`Project ID: ${match.projectId} (${match.name})`)

  // Price information from real project fields
  const formattedPrice = match.priceValue >= 1_000_000
    ? `RM${(match.priceValue / 1_000_000).toFixed(1)}M`
    : `RM${Math.round(match.priceValue / 1_000)}k`
  parts.push(`Price: ${formattedPrice} (${match.priceBand} band)`)

  // Tenure from real field
  parts.push(`Tenure: ${match.tenure}`)

  // VP status from real field
  parts.push(`VP status: ${match.vpStatus ? 'completed (VP done — vacant possession available)' : 'not yet completed'}`)

  // Bedrooms from real field
  parts.push(`Bedrooms: ${match.bedrooms}`)

  // Location from real field
  parts.push(`Location: ${match.locationText}`)

  // Eligibility signals from real fields
  const eligibilityParts: string[] = []
  if (match.foreignEligible) {
    eligibilityParts.push('foreign-buyer eligible')
  }
  if (!match.bumiQuota) {
    eligibilityParts.push('not bumi-reserved (open to all)')
  } else {
    eligibilityParts.push('bumi-quota project')
  }
  if (eligibilityParts.length > 0) {
    parts.push(`Eligibility: ${eligibilityParts.join(', ')}`)
  }

  // Matched criteria summary (what drove this match)
  const criteriaHighlights: string[] = []
  if (match.matchedCriteria.segment !== 'unknown') {
    criteriaHighlights.push(`segment: ${match.matchedCriteria.segment}`)
  }
  if (match.matchedCriteria.priceMax !== null) {
    const maxFormatted = match.matchedCriteria.priceMax >= 1_000_000
      ? `RM${(match.matchedCriteria.priceMax / 1_000_000).toFixed(1)}M`
      : `RM${Math.round(match.matchedCriteria.priceMax / 1_000)}k`
    criteriaHighlights.push(`within budget (max ${maxFormatted})`)
  }
  if (match.matchedCriteria.locationPref) {
    criteriaHighlights.push(`location preference: ${match.matchedCriteria.locationPref}`)
  }
  if (match.matchedCriteria.bedrooms !== null) {
    criteriaHighlights.push(`${match.matchedCriteria.bedrooms}-bedroom preference`)
  }
  if (criteriaHighlights.length > 0) {
    parts.push(`Matched criteria: ${criteriaHighlights.join('; ')}`)
  }

  // Semantic match score (from Stage B vector re-rank)
  parts.push(`Semantic match score: ${(match.score * 100).toFixed(0)}%`)

  return parts.join(' | ')
}
