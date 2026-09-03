'use client'

/**
 * app/[lang]/chat/match-table.tsx — the Finder result table (quick-kayinleong-085).
 *
 * The reported defect was "it only shows 5 cards; show all relevant results in one table
 * with the important attributes". The card list could not carry attributes at all —
 * `FinderMatchSchema` held only projectId / name / rationale / matchedCriteria, so price,
 * size, bedrooms, tenure and location died at the tool boundary. They now travel as
 * `output.rows` (`FinderRow[]`), attached SERVER-side from the searchProjects tool result.
 *
 * Reads `rows`, NOT `matches`. `matches` is the model's narrative shortlist (at most
 * `MAX_MATCHES`, because that is all the model ever sees); `rows` is the complete tool
 * result. `matches` is joined in only to pick up its per-row `highlight`.
 *
 * 'use client' because of `usePagination` (useState) and `useTranslations`. The whole
 * subtree already sits inside the `chat-shell.tsx` client island, so the `onAsk` function
 * prop crosses no server/client boundary.
 */

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Paginator, usePagination } from '../_components/paginator'
import type { FinderRow } from '@/src/agents/finder/schema'
import type { FinderMatch } from '@/src/agents/finder/schema'

/** Rows per page — the shared `usePagination` default, not a new convention. */
const ROWS_PER_PAGE = 10

const EM_DASH = '—'

interface MatchTableProps {
  /** The server's complete, ranked result set. Order IS the ranking — never re-sort. */
  rows: FinderRow[]
  /** The model's narrative shortlist — read ONLY for its per-row `highlight`. */
  matches: FinderMatch[]
  /** Dispatch a follow-up Finder turn for one project. Absent → the buttons disable. */
  onAsk?: (prompt: string) => void
  className?: string
}

/**
 * Format an asking price for the Price cell, or null when there is no price to show.
 *
 * Returns null for `priceValue <= 0` and for any non-finite value. THIS IS D2'S HARD
 * INVARIANT: 32 of 82 projects carry `priceValue: 0`, which means UNKNOWN, and the price
 * gate now ADMITS them (`projectMatchesPrice`). An unpriced row must therefore never
 * render a price — not "RM 0", and above all not a `priceBand`, because
 * `priceBandFor(0) === 'under_500k'` labels every unpriced project as the cheapest band.
 * `FinderRow` does not even carry the band, so this function has nothing to fall back to
 * by construction.
 *
 * Exported for unit testing: there is no jsdom in this repo, so component rendering is not
 * available and the formatters are where the testable logic has to live.
 */
export function formatPrice(priceValue: number): string | null {
  if (typeof priceValue !== 'number' || !Number.isFinite(priceValue) || priceValue <= 0) {
    return null
  }
  return `RM ${priceValue.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`
}

/**
 * Format a built-up sqft range, or null when the project has no size on record
 * (16 of 82 — `extractSizeRange` returned null and the backfill wrote null).
 *
 * Null when EITHER bound is missing: half a range is not a range. A single number when the
 * bounds are equal (a project offering one layout), otherwise `min–max`. The unit lives in
 * the column header rather than being repeated in every cell.
 */
export function formatSize(min: number | null, max: number | null): string | null {
  if (typeof min !== 'number' || typeof max !== 'number') return null
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const fmt = (n: number) => n.toLocaleString('en-MY', { maximumFractionDigits: 0 })
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`
}

/**
 * Join the server rows to the model's highlights.
 *
 * The model only authors a highlight for the matches it saw (~8), so on a 50-row table the
 * Highlight column is populated for the strongest handful and EMPTY below. That is the
 * confirmed D3 decision: an empty cell honestly reads "not assessed", whereas a
 * description-snippet fallback would mix curated highlights and truncated blurbs in one
 * column. The concrete attribute columns carry every row.
 */
function withHighlights(
  rows: FinderRow[],
  matches: FinderMatch[],
): Array<FinderRow & { highlight: string }> {
  const byId = new Map<string, string>()
  for (const m of matches) {
    if (m.highlight && m.highlight.length > 0) byId.set(m.projectId, m.highlight)
  }
  return rows.map((r) => ({ ...r, highlight: byId.get(r.projectId) ?? '' }))
}

/**
 * The Finder result table: one row per project, paginated, with a per-row action that
 * asks the chat to expand that one project with its supporting documents.
 */
export function MatchTable({ rows, matches, onAsk, className }: MatchTableProps) {
  const t = useTranslations('chat.matchTable')
  // Reuse the already-trilingual admin column headers rather than duplicating five
  // strings in three catalogs (app/[lang]/(admin)/inventory/project-list.tsx uses these).
  const tCol = useTranslations('inventory')

  const displayRows = withHighlights(rows, matches)
  const { page, setPage, pageCount, pageItems, total } = usePagination(
    displayRows,
    ROWS_PER_PAGE,
  )

  return (
    <div data-slot="match-table" className={cn('flex w-full flex-col gap-2', className)}>
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('rowCount', { count: total })}
      </span>

      {/* `Table` already wraps ITSELF in `relative w-full overflow-x-auto`
          (components/ui/table.tsx) — that IS the horizontal-scroll affordance at 440px. Do
          not add a second scroll container, and never add a horizontal-centring utility to
          it: centring an overflowing scroll container clips BOTH ends (quick-081, and the
          warning left at chat-header.tsx:199-202). */}
      <Table className="text-[0.8125rem]">
        <TableHeader>
          <TableRow>
            {/* Sticky so scrolling right never loses which project a row belongs to. The
                opaque background is required — without it the scrolled cells show
                through. */}
            <TableHead className="sticky left-0 z-10 bg-background whitespace-nowrap">
              {tCol('colName')}
            </TableHead>
            <TableHead className="whitespace-nowrap">{tCol('colPrice')}</TableHead>
            <TableHead className="whitespace-nowrap">{t('colSize')}</TableHead>
            <TableHead className="whitespace-nowrap">{tCol('colBedrooms')}</TableHead>
            <TableHead className="whitespace-nowrap">{tCol('colTenure')}</TableHead>
            <TableHead className="whitespace-nowrap">{tCol('colLocation')}</TableHead>
            <TableHead className="whitespace-nowrap">{t('colHighlight')}</TableHead>
            <TableHead className="whitespace-nowrap">{tCol('colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((row) => {
            const price = formatPrice(row.priceValue)
            const size = formatSize(row.sizeMinSqft, row.sizeMaxSqft)
            return (
              // projectId stays on the row and in the name's title: it is the grounding
              // citation (D-04) and the admin surfaces key off it, exactly as
              // match-list.tsx:176 does today.
              <TableRow key={row.projectId} data-project-id={row.projectId}>
                <TableCell
                  className="sticky left-0 z-10 max-w-[11rem] truncate bg-background font-medium"
                  title={`${row.name} (${row.projectId})`}
                >
                  {row.name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {price ?? (
                    <span title={t('priceUnknown')} aria-label={t('priceUnknown')}>
                      {EM_DASH}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {size ?? (
                    <span title={t('notOnRecord')} aria-label={t('notOnRecord')}>
                      {EM_DASH}
                    </span>
                  )}
                </TableCell>
                {/* 0 means UNKNOWN on 29 of 82 projects — never render "0 beds". */}
                <TableCell className="whitespace-nowrap">
                  {row.bedrooms > 0 ? row.bedrooms : EM_DASH}
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.tenure || EM_DASH}</TableCell>
                <TableCell className="max-w-[12rem] truncate" title={row.locationText}>
                  {row.locationText || EM_DASH}
                </TableCell>
                <TableCell className="max-w-[14rem] truncate" title={row.highlight}>
                  {row.highlight}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    // 44px touch-target floor, the same one match-list.tsx's collateral
                    // rows use.
                    className="min-h-11 whitespace-nowrap"
                    disabled={!onAsk}
                    aria-label={t('showMoreAria', { name: row.name })}
                    onClick={() =>
                      onAsk?.(
                        // A TRANSLATED prompt, not an English literal: the agent replies in
                        // the language of the incoming message, so an English prompt would
                        // flip a BM or 中文 conversation to English. The projectId is
                        // included because it is the grounding citation and it lets the
                        // Finder's answer branch and fetchCollateral pick up files the
                        // search's inline top-3 missed.
                        t('showMorePrompt', { name: row.name, projectId: row.projectId }),
                      )
                    }
                  >
                    {t('showMore')}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
