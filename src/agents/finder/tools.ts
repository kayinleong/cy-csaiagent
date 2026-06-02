/**
 * src/agents/finder/tools.ts — AI SDK tools for the D2 Property Finder agent.
 *
 * Tools (all READ-ONLY — no Firestore writes inside any tool execute):
 *   1. makeSearchProjectsTool    — wraps searchProjects (two-stage active/eligibility filter + vector re-rank)
 *   2. makeQueryInventoryTool    — wraps queryInventory (structured VP/priceBand filters, no vector, FIND-07)
 *   3. makeFetchCollateralTool   — reads collateralRef for a projectId → {type, url} (Storage path or externalUrl)
 *
 * Security (TSD §3.3, T-03-14 carried from T-02-15):
 *   - Tools are READ-ONLY: no Firestore writes (no .set(), .add(), .update()) inside execute().
 *   - finderSlot write happens in the route onFinish (mirrors Coach pattern — T-02-15).
 *   - Tools authenticate as the service account via adminDb (projects rules: signed-in tenant read).
 *   - No Google Drive API — collateral returns Storage path or externalUrl only (D-09/C2).
 *
 * Hard constraints:
 *   - No Google Drive API (C2 / D-09). fetchCollateral returns Storage refs / external URLs only.
 *   - searchProjects ALWAYS enforces status:'active' — done inside the imported searchProjects function.
 *   - Model cannot bypass the deterministic gate — tools are the only inventory source.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { searchProjects, queryInventory } from '@/src/inventory/search'
import { collateralRef } from '@/src/firebase/collections'
import type { SearchResult, InventoryFilters } from '@/src/inventory/search'
import type { ProjectDoc } from '@/src/firebase/collections'

// ─── 1. makeSearchProjectsTool ────────────────────────────────────────────────

/**
 * AI SDK tool wrapping `searchProjects` — the two-stage active/eligibility filter
 * (Stage A: deterministic Firestore) + in-memory dot-product re-rank (Stage B).
 *
 * READ-ONLY: only calls searchProjects() — no Firestore writes.
 * The model receives the SearchResult and narrates it; the model does NOT override
 * the gate result — it can only explain a refusal, never invent a match.
 *
 * searchProjects ALWAYS enforces status:'active' (D-03 / grounding mandate).
 *
 * @param userLang  Injected via closure for future i18n of tool descriptions.
 */
export function makeSearchProjectsTool(userLang: 'en' | 'ms' | 'zh') {
  // userLang is available for future description localisation
  void userLang

  return tool({
    description:
      'Search the D2 project inventory for active properties matching the lead\'s criteria. ' +
      'Always call this before recommending any project. ' +
      'Only returns projects with status=active — sold-out and hidden projects are excluded. ' +
      'Eligibility (bumiQuota / foreignEligible) and affordability (priceValue vs income ceiling) ' +
      'are enforced deterministically — the results are the ground truth. ' +
      'If the result is no_match or ineligible, deliver the grounded refusal — do NOT invent a project.',
    inputSchema: z.object({
      segment: z
        .enum(['investment', 'own_stay', 'unknown'])
        .describe('Lead segment — drives ranking branch. Use "unknown" if not determinable.'),
      priceMin: z.number().nullable().describe('Minimum price in RM. null if not stated.'),
      priceMax: z.number().nullable().describe('Maximum price in RM. null if not stated.'),
      monthlyIncome: z
        .number()
        .nullable()
        .describe('Monthly household income in RM for affordability gate. null = no ceiling.'),
      financingNote: z.string().nullable().describe('Financing note (e.g. "end-financing required"). null if not stated.'),
      nationality: z
        .enum(['malaysian', 'foreign', 'unknown'])
        .describe('Lead nationality — determines foreignEligible filter. Use "unknown" if not stated.'),
      bumiputera: z.boolean().nullable().describe('Bumiputera status — determines bumiQuota filter. null if not stated.'),
      locationPref: z.string().nullable().describe('Location preference (e.g. "Cheras, KL"). null if not stated.'),
      tenurePref: z.string().nullable().describe('Preferred tenure (e.g. "freehold"). null if not stated.'),
      bedrooms: z.number().nullable().describe('Preferred number of bedrooms. null if not stated.'),
      freeText: z.string().describe('Raw pasted criteria text — feeds the semantic re-rank vector.'),
    }),
    execute: async (input): Promise<SearchResult> => {
      // READ-ONLY: calls searchProjects, no Firestore writes
      const result = await searchProjects({
        segment: input.segment,
        priceMin: input.priceMin,
        priceMax: input.priceMax,
        monthlyIncome: input.monthlyIncome,
        nationality: input.nationality,
        bumiputera: input.bumiputera,
        locationPref: input.locationPref,
        bedrooms: input.bedrooms,
        freeText: input.freeText,
      })
      return result
    },
  })
}

// ─── 2. makeQueryInventoryTool ────────────────────────────────────────────────

/**
 * AI SDK tool wrapping `queryInventory` — structured Firestore query for
 * inventory questions like "which projects completed VP this year" (FIND-07).
 *
 * READ-ONLY: only calls queryInventory() — no Firestore writes.
 * embedText is NOT called from this tool — pure structured/filtered query.
 * Always enforces status:'active' (done inside queryInventory).
 *
 * @param userLang  Injected via closure for future i18n of tool descriptions.
 */
export function makeQueryInventoryTool(userLang: 'en' | 'ms' | 'zh') {
  void userLang

  return tool({
    description:
      'Query the D2 project inventory using structured filters (VP date, price band, VP status). ' +
      'Use this for inventory questions like "which projects completed VP this year" or ' +
      '"show active leasehold projects under RM500k". ' +
      'This tool does NOT do semantic/vector matching — use searchProjects for lead matching. ' +
      'Always returns only active projects.',
    inputSchema: z.object({
      vpDateFrom: z
        .string()
        .datetime()
        .nullable()
        .optional()
        .describe('ISO datetime string — include only projects with vpDate >= this date. null/absent for no lower bound.'),
      vpDateTo: z
        .string()
        .datetime()
        .nullable()
        .optional()
        .describe('ISO datetime string — include only projects with vpDate <= this date. null/absent for no upper bound.'),
      priceBand: z
        .enum(['under_500k', '500k_800k', '800k_1.2m', 'above_1.2m'])
        .optional()
        .describe('Discrete price band equality filter. Omit for all price bands.'),
      vpStatus: z
        .boolean()
        .optional()
        .describe('Filter by VP completion status. Omit for all statuses.'),
    }),
    execute: async (input): Promise<Array<ProjectDoc & { projectId: string }>> => {
      // READ-ONLY: calls queryInventory, no Firestore writes
      const filters: InventoryFilters = {}

      if (input.vpDateFrom) {
        filters.vpDateFrom = new Date(input.vpDateFrom)
      }
      if (input.vpDateTo) {
        filters.vpDateTo = new Date(input.vpDateTo)
      }
      if (input.priceBand) {
        filters.priceBand = input.priceBand
      }
      if (input.vpStatus !== undefined) {
        filters.vpStatus = input.vpStatus
      }

      return queryInventory(filters)
    },
  })
}

// ─── 3. makeFetchCollateralTool ───────────────────────────────────────────────

/**
 * AI SDK tool that reads the `collateral` collection for a given projectId.
 *
 * READ-ONLY: reads collateralRef().where('projectId','==',pid) — no Firestore writes.
 *
 * D-09 / C2 hard constraint: returns Storage path or externalUrl — NEVER calls
 * the Google Drive API. The Drive API is forbidden (no-GCP constraint). The
 * collateral document's `externalUrl` field may contain a Google Drive share link
 * (stored as a plain URL string) but this tool never calls the Drive API client.
 *
 * URL resolution:
 *   - If externalUrl is set → return it as-is (plain external share link)
 *   - Otherwise → return storagePath as the URL (caller / UI resolves to signed URL)
 *
 * @param userLang  Injected via closure for future i18n of tool descriptions.
 */
export function makeFetchCollateralTool(userLang: 'en' | 'ms' | 'zh') {
  void userLang

  return tool({
    description:
      'Fetch the collateral (brochures, videos, fact-sheets) for a specific project by its ID. ' +
      'Returns an array of {type, url} items where url is a Firebase Storage path or an external share link. ' +
      'Call this AFTER searchProjects returns a match to attach the relevant collateral to the recommendation.',
    inputSchema: z.object({
      projectId: z
        .string()
        .min(1)
        .describe('The Firestore projects/{pid} document ID from the searchProjects result.'),
    }),
    execute: async ({ projectId }): Promise<Array<{ type: string; url: string }>> => {
      // READ-ONLY: reads the collateral collection — no Firestore writes
      // D-09/C2: NEVER calls the Google Drive API; returns Storage path or externalUrl only
      const snap = await collateralRef().where('projectId', '==', projectId).get()

      if (snap.empty) {
        return []
      }

      return snap.docs.map((doc) => {
        const data = doc.data()
        // externalUrl takes precedence (plain share link);
        // storagePath is the fallback (Firebase Storage object path)
        const url = data.externalUrl ?? data.storagePath
        return {
          type: data.type,
          url,
        }
      })
    },
  })
}
