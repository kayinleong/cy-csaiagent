/**
 * src/agents/finder/tools.ts — AI SDK tools for the D2 Property Finder agent.
 *
 * Tools (all READ-ONLY — no Firestore writes inside any tool execute):
 *   1. makeSearchProjectsTool    — wraps searchProjects (two-stage active/eligibility filter + vector re-rank)
 *   2. makeQueryInventoryTool    — wraps queryInventory (structured VP/priceBand filters, no vector, FIND-07)
 *   3. makeFetchCollateralTool   — reads collateralRef for a projectId → {type, url} (Storage path or externalUrl)
 *   4. makeProjectDetailTool     — reads projects/{pid} BY ID + its collateral + finder kbChunks
 *                                  (quick-kayinleong-088; the only path that carries `description`)
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
import {
  searchProjects,
  queryInventory,
  getProjectDetail,
  MAX_MATCHES,
} from '@/src/inventory/search'
import { collateralRef } from '@/src/firebase/collections'
import { retrieve, buildCitations, isRetrievalMiss } from '@/src/rag'
import type {
  SearchResult,
  InventoryFilters,
  ProjectMatch,
  ProjectDetail,
} from '@/src/inventory/search'
import type { ProjectDoc } from '@/src/firebase/collections'
import type { FinderRow } from './schema'
import type { JSONValue } from '@ai-sdk/provider'

// ─── Infra-failure guard (quick-kayinleong-040) ───────────────────────────────

/**
 * Maximum collateral items returned per project (quick-kayinleong-054).
 *
 * Enough to attach a brochure, a sales kit, an FAQ, a price list and a folder link without
 * shipping a project's entire media library into the model context on every step.
 */
export const MAX_COLLATERAL_ITEMS = 12

/**
 * How many of a search's top matches get their collateral attached inline
 * (quick-kayinleong-067).
 *
 * Three, not all eight: the tail of a shortlist is rarely what the agent forwards, and
 * every attached item is re-sent to the model on every subsequent step of the tool loop —
 * the token blowup quick-054 was fixed to stop.
 */
export const INLINE_COLLATERAL_MATCHES = 3

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
 * Request-scoped collector the searchProjects tool writes its FULL row set into
 * (quick-kayinleong-085).
 *
 * WHY A SINK AND A `toModelOutput` BOTH EXIST — they do different jobs and neither is
 * redundant:
 *   - `toModelOutput` bounds what the MODEL sees (the context/token constraint).
 *   - the sink is what the ROUTE reads, to put rows on `messageMetadata` and into the
 *     persisted envelope.
 * Whether `onStepFinish` receives the raw or the projected tool output is an SDK-semantics
 * question this claim cannot settle offline, and getting it wrong renders an empty table.
 * Reading an explicit sink takes that question off the critical path. Do not delete either
 * mechanism as duplication.
 */
export type FinderRowSink = { rows: FinderRow[] }

/**
 * Project a `ProjectMatch` down to the client row allowlist.
 *
 * Nothing is computed here — every value is copied from the tool result. `priceBand`,
 * `description` and `embedding` are dropped on purpose; see `FinderRowSchema`.
 */
function toFinderRow(m: ProjectMatch): FinderRow {
  return {
    projectId: m.projectId,
    name: m.name,
    priceValue: m.priceValue,
    bedrooms: m.bedrooms,
    tenure: m.tenure,
    locationText: m.locationText,
    vpStatus: m.vpStatus,
    bumiQuota: m.bumiQuota,
    foreignEligible: m.foreignEligible,
    sizeMinSqft: m.sizeMinSqft,
    sizeMaxSqft: m.sizeMaxSqft,
    score: m.score,
  }
}

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
 * @param sink      Optional request-scoped collector for the FULL row set. Optional so the
 *                  offline/test path and `ReturnType<typeof finderAgent.makeTools>` are
 *                  unchanged.
 */
export function makeSearchProjectsTool(userLang: 'en' | 'ms' | 'zh', sink?: FinderRowSink) {
  // userLang is available for future description localisation
  void userLang

  return tool({
    description:
      'Search the D2 project inventory for active properties matching the lead\'s criteria. ' +
      'Always call this before recommending any project. ' +
      'Only returns projects with status=active — sold-out and hidden projects are excluded. ' +
      'Eligibility (bumiQuota / foreignEligible) and affordability (priceValue vs income ceiling) ' +
      'are enforced deterministically — the results are the ground truth. ' +
      'If the result is no_match or ineligible, deliver the grounded refusal — do NOT invent a project. ' +
      'The top matches already include their shareable collateral inline, so you do NOT need to call ' +
      'fetchCollateral for them — use what is attached.',
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
      runReadOnly('searchProjects', async () => {
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

        // Attach collateral INLINE for the top matches (quick-kayinleong-067).
        //
        // The model used to spend a whole extra STEP calling fetchCollateral, and a Finder
        // turn was already running past the platform's function timeout — killed mid-flight
        // with a 500 and an empty body, which is why onFinish never ran and replies were
        // never persisted. Measured: searchProjects is 4519ms cold, a model round trip is
        // seconds. Reading collateral here costs one more Firestore query in a step that is
        // already open, and removes a whole round trip from the common path.
        //
        // Only the top INLINE_COLLATERAL_MATCHES get it: the tail of a shortlist is rarely
        // the one the agent forwards, and every attached item is re-sent on every
        // subsequent step (the token blowup quick-054 fixed).
        if (!result.found || !result.matches?.length) return result

        const top = result.matches.slice(0, INLINE_COLLATERAL_MATCHES)
        const collaterals = await Promise.all(
          top.map((m) =>
            collateralFor(m.projectId).catch(() => {
              // A collateral read must never fail the search. The match is still the
              // ground truth; the agent just gets no files for it.
              console.warn(`[searchProjects] inline collateral failed for ${m.projectId}`)
              return [] as Array<{ type: string; url: string }>
            }),
          ),
        )

        const enriched = {
          ...result,
          matches: result.matches.map((m, i) =>
            i < top.length && collaterals[i].length > 0
              ? { ...m, collateral: collaterals[i] }
              : m,
          ),
        }

        // Hand the ROUTE the complete row set (quick-kayinleong-085). REPLACE, never
        // append: the prompt already tells the model that only the CURRENT search result
        // counts, so the last search of the turn is the table. Appending would show a
        // narrowed re-search stacked on top of the query it replaced.
        if (sink) sink.rows = enriched.matches.map(toFinderRow)

        return enriched
      }),

    /**
     * What the MODEL sees — at most `MAX_MATCHES` entries (quick-kayinleong-085).
     *
     * `execute` now returns up to `MAX_ROWS` (100) matches so the client table is
     * complete. That array must NOT reach the model: the tool result is re-sent on every
     * step of the 5-step Finder loop, and 82 uncapped projects measured ~10,100 tokens per
     * step — ~50k tokens on one turn against a 300,000/24h TOKEN_CAP.
     *
     * Per-match shape is preserved exactly (including the inline collateral on the top
     * `INLINE_COLLATERAL_MATCHES`), so no prompt rule changes; only the LENGTH is bounded.
     * A found:false result passes through untouched — the refusal signal is the payload.
     *
     * Returns the SDK's tool-result envelope (`{ type: 'json', value }`), which is what
     * `LanguageModelV2ToolResultOutput` requires — verified against the installed
     * ai@5.0.193 types at node_modules/@ai-sdk/provider-utils/dist/index.d.ts:772.
     */
    toModelOutput: (output) => {
      if (!output || typeof output !== 'object' || !('found' in output) || !output.found) {
        return { type: 'json', value: output as unknown as JSONValue }
      }
      const bounded = {
        ...output,
        matches: (output.matches ?? []).slice(0, MAX_MATCHES),
      }
      return { type: 'json', value: bounded as unknown as JSONValue }
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
      'Only needed for a project whose collateral was NOT already attached by searchProjects — for example a ' +
      'project the agent names directly, or a lower-ranked match. Do not re-fetch collateral that the ' +
      'search result already gave you.',
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
      runReadOnly('fetchCollateral', () => collateralFor(projectId)),
  })
}

/**
 * Read, rank and cap the shareable collateral for one project.
 *
 * Extracted so searchProjects can attach collateral INLINE (quick-kayinleong-067) rather
 * than the model spending a whole extra step calling fetchCollateral for it. A Firestore
 * read costs ~100-300ms; a model round trip costs seconds, and a Finder turn was running
 * past the platform's function timeout.
 */
async function collateralFor(projectId: string): Promise<Array<{ type: string; url: string }>> {
  {
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
  }
}

// ─── 4. makeProjectDetailTool (quick-kayinleong-088) ─────────────────────────

/**
 * How many `kbChunks` of sales-kit prose are attached to one detail lookup.
 *
 * Five, matching the Coach's `retrieveKnowledge` cap (`src/agents/coach/tools.ts`), for
 * the same reason: the tool result is re-sent to the model on EVERY step of the Finder's
 * 5-step loop, so the cost of a chunk is paid up to five times.
 */
export const KB_CHUNKS_FOR_DETAIL = 5

/**
 * Per-chunk character cap for the attached KB prose.
 *
 * Measured on the live finder corpus (400-chunk sample, 2026-09-05): min 80, median 956,
 * p90 1,340, p99 1,694, max 2,027 chars. 1,600 therefore passes ~99% of chunks through
 * whole while still bounding the worst case, so five chunks cost at most ~8,000 chars
 * (~2,200 tokens) per step instead of an unbounded amount.
 */
export const KB_CHUNK_CHARS = 1_600

/**
 * The default retrieval topics when the model asks for a project's details without
 * naming a specific question.
 *
 * These are the Quick-Facts headings that actually appear in the D2 sales kits and that
 * a D2 agent is expected to be able to recite to a client. They are RETRIEVAL TERMS, not
 * content: nothing here is asserted about the project, and a topic with no matching chunk
 * simply returns nothing.
 */
const DETAIL_TOPICS =
  'quick facts developer land tenure built-up sizes layouts price per square foot ' +
  'maintenance fee booking fee panel bankers margin of finance parking bays facilities ' +
  'furnishing selling points VP target completion'

/** What `projectDetail` hands the model. `embedding` is absent by construction. */
export type ProjectDetailToolResult =
  | {
      found: true
      project: ProjectDetail
      /**
       * Present ONLY when `project.status !== 'active'`. A plain sentence the prompt
       * requires the agent to lead with, so a sold-out or hidden project can be looked
       * up (see `getProjectDetail`) without ever being presented as available.
       */
      availability?: string
      collateral: Array<{ type: string; url: string }>
      /** Sales-kit prose from `kbChunks` (pillar:'finder') with its citation IDs. */
      kb: {
        found: boolean
        citations: Array<{ chunkId: string; docId: string; snippet: string }>
        context: string
      }
    }
  | { found: false; reason: 'not_found'; projectId: string; message: string }

/**
 * AI SDK tool that returns EVERYTHING on record for ONE named project
 * (quick-kayinleong-088).
 *
 * WHY IT EXISTS — two defects, one tool:
 *
 * 1. **Output depth.** Every other Finder path produces `ProjectMatch`, which copies 12
 *    scalars and drops `description` (`src/inventory/search.ts` → `ProjectMatch`). But
 *    `description` is the whole Skool write-up — developer, land tenure, sizes by layout,
 *    maintenance fee, booking fee, furnishing, facilities. So the agent could see a price
 *    and a bedroom count and nothing a client would actually ask about, even though the
 *    prose was sitting in Firestore the entire time. This tool carries it.
 *
 * 2. **Wrong project.** The "Details" button used to push a canned sentence back through
 *    a normal Finder turn, which re-ran `searchProjects` — a semantic re-rank capped at
 *    `MAX_MATCHES` for the model. Clicking row 37 of 50 handed the model eight OTHER
 *    projects, and the prompt then correctly made it say it could not find the project
 *    the agent had just clicked. A `projects/{pid}` read cannot miss.
 *
 * It ALSO retrieves from `kbChunks` (pillar:'finder') — 25,153 chunks of ingested Drive
 * sales kits that, until this claim, NO Finder tool queried. That is where the panel
 * bankers, margin-of-finance percentages and "top reasons to invest" content lives; the
 * Skool write-ups do not have it (2 of 82). Live probe: "panel bankers loan margin for
 * Imperial Residences" retrieves at 0.8337 similarity. Those chunks come back WITH their
 * chunk IDs so the answer stays citable (grounding is mandatory).
 *
 * READ-ONLY: `projects/{pid}` read + `collateral` read + `kbChunks` findNearest. No writes.
 * Authenticates through the same accessors as every other inventory read — as the user's
 * request, never an escalated admin path from a user-facing surface.
 *
 * @param userLang  Language of the turn — threaded into `retrieve` for the lang pre-filter.
 */
export function makeProjectDetailTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Get the FULL record for ONE specific D2 project by its projectId: every stored field, ' +
      'the complete project write-up, the per-layout size/price table when one is on record, ' +
      'the shareable documents, and the matching sales-kit knowledge-base extracts. ' +
      'USE THIS — never searchProjects — whenever the agent asks about a project they have ' +
      'already named or whose projectId is in the message (for example after tapping the ' +
      'Details button on a result row). searchProjects is a ranked semantic search: it can ' +
      'return eight DIFFERENT projects and miss the one that was asked about. This tool reads ' +
      'the document directly and cannot. ' +
      'Cite the kb chunkIds for any fact you take from the knowledge-base extracts. ' +
      'If it returns found:false the projectId does not exist — say so plainly, never substitute ' +
      'another project. If it returns an "availability" warning the project is NOT active: lead ' +
      'with that and do not present it as available inventory.',
    inputSchema: z.object({
      projectId: z
        .string()
        .min(1)
        .describe(
          'The Firestore projects/{pid} document ID, copied EXACTLY from the search result ' +
            'row, from the agent\'s message, or from an earlier citation. Never invent or ' +
            'reconstruct one.',
        ),
      question: z
        .string()
        .nullable()
        .optional()
        .describe(
          'What the agent actually wants to know, in their own words (e.g. "panel bankers and ' +
            'loan margin", "price per layout", "maintenance fee"). Sharpens the knowledge-base ' +
            'retrieval. Omit or null for a general overview.',
        ),
    }),
    execute: async ({ projectId, question }): Promise<ProjectDetailToolResult | ToolFailure> =>
      // READ-ONLY: three reads, no writes. Infra errors become a grounded
      // inventory_unavailable signal rather than a raw provider error.
      runReadOnly('projectDetail', async () => {
        const detail = await getProjectDetail(projectId)

        if (!detail.found) {
          return {
            found: false as const,
            reason: 'not_found' as const,
            projectId: detail.projectId,
            message:
              'No project exists with that ID. Do not substitute a different project — ' +
              'tell the agent the project is not in the D2 inventory record.',
          }
        }

        const project = detail.project

        // Collateral and KB retrieval are independent — run them together rather than
        // paying two sequential round trips inside a step that is already open. A Finder
        // turn has run past the platform's function timeout before (quick-067).
        const [collateral, kbResults] = await Promise.all([
          collateralFor(project.projectId).catch(() => {
            // A collateral read must never fail the lookup. The stored record is still
            // the ground truth; the agent just gets no files.
            console.warn(`[projectDetail] collateral read failed for ${project.projectId}`)
            return [] as Array<{ type: string; url: string }>
          }),
          // The sales-kit half. Scoped to pillar:'finder' so a project lookup can never
          // cite a Coach SOP or a Reply template as project data.
          retrieve(
            `${project.name} ${question?.trim() || DETAIL_TOPICS}`,
            userLang,
            { pillar: 'finder' },
          ).catch(() => {
            console.warn(`[projectDetail] kb retrieval failed for ${project.projectId}`)
            return []
          }),
        ])

        const kbMiss = isRetrievalMiss(kbResults)
        const kept = kbResults.slice(0, KB_CHUNKS_FOR_DETAIL)
        const { citations } = buildCitations(kept)

        return {
          found: true as const,
          project,
          // Availability travels WITH the payload, as a sentence the model cannot skim
          // past. getProjectDetail deliberately does not filter on status — see its doc
          // comment — so this warning is the guard rail that makes that safe.
          ...(project.status !== 'active'
            ? {
                availability:
                  `NOT AVAILABLE: this project's status is "${project.status}". ` +
                  'Lead with that. Answer the factual question if asked, but do NOT ' +
                  'present it as available inventory and do NOT put it in a shortlist.',
              }
            : {}),
          collateral,
          kb: {
            found: !kbMiss,
            citations,
            context: kept
              .map((r) => `[KB:${r.chunkId}]\n${r.text.slice(0, KB_CHUNK_CHARS)}`)
              .join('\n\n---\n\n'),
          },
        }
      }),
  })
}
