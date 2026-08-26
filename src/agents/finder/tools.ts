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

// ─── Infra-failure guard (quick-kayinleong-040) ───────────────────────────────

/**
 * Maximum collateral items returned per project (quick-kayinleong-054).
 *
 * Enough to attach a brochure, a sales kit, an FAQ, a price list and a folder link without
 * shipping a project's entire media library into the model context on every step.
 */
export const MAX_COLLATERAL_ITEMS = 12

/**
 * Sort key for collateral usefulness — LOWER is better.
 *
 * The corpus is dominated by WhatsApp media, so `type` alone does not discriminate: nearly
 * everything is `whatsapp-media` and the real signal is the file extension in the URL. An
 * agent sending something to a lead wants documents first.
 */
function collateralRank(item: { type: string; url: string }): number {
  const url = item.url.toLowerCase()
  // Strip the query string before testing the extension — Firebase download URLs always
  // carry ?alt=media&token=… so a naive endsWith() would never match.
  const path = url.split('?')[0]

  if (/\.(pdf|docx?|xlsx?|pptx?)$/.test(path)) return 0 // brochures, sales kits, FAQs, price lists
  // Curated folder/video links from the Drive importer — few, and high value.
  if (item.type !== 'whatsapp-media') return 1
  if (/\.(mp4|mov|webm)$/.test(path)) return 2 // walkthroughs
  if (/\.(jpe?g|png|webp)$/.test(path)) return 3 // photos
  return 4 // .opus voice notes, .vcf contacts, anything else
}

/**
 * Rank + cap a collateral list (quick-kayinleong-054).
 *
 * The single implementation — fetchCollateral calls this on its Firestore read, and the
 * tests exercise it directly without needing a Firestore mock. Stable within a rank band:
 * rank first, original order within a rank, so identical calls are deterministic.
 */
export function rankAndCapCollateral(
  items: Array<{ type: string; url: string }>,
): Array<{ type: string; url: string }> {
  return items
    .map((item, index) => ({ item, index, rank: collateralRank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.item)
    .slice(0, MAX_COLLATERAL_ITEMS)
}

/**
 * Structured failure a read-only Finder tool returns when an underlying infra
 * dependency (Gemini embedding, Firestore, network) throws.
 *
 * This is NOT a business refusal (no_match / ineligible) — those are legitimate
 * grounded results from searchProjects. This signals the tool could not run at all.
 * The system prompt instructs the agent to surface a "temporarily unavailable"
 * message and retry — never to invent a project or emit raw technical jargon.
 */
export interface ToolFailure {
  error: 'inventory_unavailable'
  message: string
}

/** The single user-facing message for any infra failure — no technical detail leaks to the model. */
const INVENTORY_UNAVAILABLE_MESSAGE =
  'The D2 inventory system is temporarily unavailable. This is a transient backend issue — ' +
  'no project information could be retrieved for this request. Please try again shortly.'

/**
 * Redact anything that could carry a secret before logging.
 *
 * The AI SDK's Gemini errors can embed the request URL (which may contain the API
 * key as a `?key=...` query param) or an `x-goog-api-key` header echo. We log only
 * the error name plus a key-stripped message so the global secrets-hygiene rule
 * (never log the Gemini key) holds even for caught provider errors.
 */
function redactedErrorLabel(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return raw
    .replace(/key=[^&\s"']+/gi, 'key=<redacted>')
    .replace(/(x-goog-api-key[":\s]*)[^&\s"']+/gi, '$1<redacted>')
}

/**
 * Run a read-only tool body, converting any thrown infra error into a structured
 * ToolFailure. Success values pass through unchanged.
 *
 * @param toolName  Short label for the log line (no secrets).
 * @param body      The tool's original execute logic.
 */
async function runReadOnly<T>(
  toolName: string,
  body: () => Promise<T>,
): Promise<T | ToolFailure> {
  try {
    return await body()
  } catch (err) {
    // console.error is intentional (server logs); message is secret-redacted.
    console.error(`[finder:${toolName}] tool execution failed — ${redactedErrorLabel(err)}`)
    return { error: 'inventory_unavailable', message: INVENTORY_UNAVAILABLE_MESSAGE }
  }
}

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
    execute: async (input): Promise<SearchResult | ToolFailure> =>
      // READ-ONLY: calls searchProjects, no Firestore writes.
      // Infra errors (Gemini embed auth, Firestore, network) are caught and returned
      // as a grounded inventory_unavailable signal instead of a raw provider error.
      runReadOnly('searchProjects', () =>
        searchProjects({
          segment: input.segment,
          priceMin: input.priceMin,
          priceMax: input.priceMax,
          monthlyIncome: input.monthlyIncome,
          nationality: input.nationality,
          bumiputera: input.bumiputera,
          locationPref: input.locationPref,
          bedrooms: input.bedrooms,
          freeText: input.freeText,
        }),
      ),
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
    execute: async (input): Promise<Array<ProjectDoc & { projectId: string }> | ToolFailure> =>
      // READ-ONLY: calls queryInventory, no Firestore writes.
      // Infra errors are caught and returned as a grounded inventory_unavailable signal.
      runReadOnly('queryInventory', () => {
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
      }),
  })
}

/**
 * Return `value` only if it is a complete, web-addressable http(s) URL.
 *
 * This is the guard that stops a raw Firebase Storage bucket key
 * (`collateral/{pid}/whatsapp/brochure.pdf`) from ever reaching the model as a
 * `url`. A bucket key is not a link: the model renders it as dead inline code and
 * the Finder card turns it into a relative href that 404s.
 *
 * Deliberately strict — protocol-relative (`//host/x`) and `data:`/`javascript:`
 * values are rejected too, since the value is emitted into chat markdown and into
 * an `<a href>` in the Finder card.
 */
function webAddressableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null
  } catch {
    // Not an absolute URL — almost always a Storage bucket key.
    return null
  }
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
 * URL resolution (quick-kayinleong-050 — the "dead collateral link" fix):
 *   - `externalUrl` is the ONLY web-addressable field. It holds either a plain
 *     external share link (Drive/Skool importer) or a Firebase Storage *download
 *     URL* captured at upload time by the WhatsApp importer.
 *   - `storagePath` is a bucket key (`collateral/{pid}/whatsapp/x.pdf`). It is NOT a
 *     URL and NOTHING in this repo resolves it to one — no signed-URL minting exists
 *     anywhere (server-side Storage is deliberately not initialised; see the rejected
 *     option in .planning/quick/quick-kayinleong-050/RESEARCH-collateral.md).
 *
 * Guard: an item whose only location is a bucket key is **OMITTED** from the result.
 * Previously the bare key was handed to the model as `url`, which the model then
 * copied into its narration as a dead string (and `match-list.tsx` turned into a
 * relative href → 404). Grounding is a hard constraint: we never present something
 * as a link when it is not one. Omitting (rather than emitting a null/`unavailable`
 * marker) keeps the tool result shape `{type, url}` — so `CollateralItemSchema` and
 * the chat renderer need no change, and the model simply has nothing to attach.
 *
 * Docs whose `externalUrl` is missing are backfilled by
 * `scripts/backfill-collateral-urls.ts`.
 *
 * @param userLang  Injected via closure for future i18n of tool descriptions.
 */
export function makeFetchCollateralTool(userLang: 'en' | 'ms' | 'zh') {
  void userLang

  return tool({
    description:
      'Fetch the collateral (brochures, videos, fact-sheets) for a specific project by its ID. ' +
      'Returns an array of {type, url} items where url is ALWAYS a complete http(s) link that can be ' +
      'shared with a lead. Assets that have no shareable link are omitted, so an empty array means ' +
      'there is no collateral you can attach — say so plainly, never invent or guess a link. ' +
      'Call this AFTER searchProjects returns a match to attach the relevant collateral to the recommendation.',
    inputSchema: z.object({
      projectId: z
        .string()
        .min(1)
        .describe('The Firestore projects/{pid} document ID from the searchProjects result.'),
    }),
    execute: async ({ projectId }): Promise<Array<{ type: string; url: string }> | ToolFailure> =>
      // READ-ONLY: reads the collateral collection — no Firestore writes.
      // D-09/C2: NEVER calls the Google Drive API; returns Storage path or externalUrl only.
      // Infra errors are caught and returned as a grounded inventory_unavailable signal.
      runReadOnly('fetchCollateral', async () => {
        const snap = await collateralRef().where('projectId', '==', projectId).get()

        if (snap.empty) {
          return []
        }

        const items: Array<{ type: string; url: string }> = []
        let omitted = 0

        for (const doc of snap.docs) {
          const data = doc.data()
          // externalUrl is the only web-addressable field. storagePath is a bucket
          // key and is deliberately NOT used as a fallback (quick-kayinleong-050).
          const url = webAddressableUrl(data.externalUrl)
          if (!url) {
            omitted += 1
            continue
          }
          items.push({ type: data.type, url })
        }

        if (omitted > 0) {
          // Counts + projectId only — never any document content (PDPA).
          console.warn(
            `[fetchCollateral] omitted ${omitted} collateral item(s) for project ${projectId}: ` +
              'no externalUrl (storage-path-only doc). Run scripts/backfill-collateral-urls.ts.',
          )
        }

        // Rank, then cap (quick-kayinleong-054). A raw SSE capture of a real turn showed
        // this returning ~200 items for one project, called three times in a turn, with
        // every result re-sent on each subsequent step of the stepCountIs(5) loop — tens
        // of thousands of tokens of Firebase download URLs. That fits the measured data:
        // Finder averages 7,209 tokens/turn vs Coach's 3,273, and one real user-day burned
        // 70,939 tokens in FOUR turns. quick-050 capped searchProjects; this path was left
        // unbounded.
        //
        // It is also simply the wrong content. An agent forwarding something to a lead
        // wants the brochure, sales kit, FAQ and price list — not 200 WhatsApp photos,
        // .opus voice notes and .vcf contact cards, which is what an unranked read returns.
        const ranked = rankAndCapCollateral(items)

        if (items.length > ranked.length) {
          // Counts + projectId only, never content (PDPA).
          console.warn(
            `[fetchCollateral] project ${projectId}: returned ${ranked.length} of ${items.length} items (ranked + capped).`,
          )
        }

        return ranked
      }),
  })
}
