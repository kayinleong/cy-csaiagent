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

import { Fragment, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
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
import type { FinderMatch, MatchSummary } from '@/src/agents/finder/schema'
import {
  GROUP_PAGE_SIZE,
  ProjectDetailsPanel,
  buildSummaryEntries,
  hasDetails,
} from './match-summaries'

/** Rows per page — the shared `usePagination` default, not a new convention. */
const ROWS_PER_PAGE = GROUP_PAGE_SIZE

const EM_DASH = '—'

interface MatchTableProps {
  /** The server's complete, ranked result set. Order IS the ranking — never re-sort. */
  rows: FinderRow[]
  /** The model's narrative shortlist — read ONLY for its per-row `highlight`. */
  matches: FinderMatch[]
  /**
   * The server-built layouts and detail sections per project (quick-kayinleong-108). A row
   * with details opens them inline under the row; a row without (an older persisted turn)
   * keeps the old behaviour of asking the AI via `onAsk`.
   */
  summaries?: MatchSummary[]
  /** The group heading shown above the table (e.g. "Other projects around Bangsar"). */
  heading?: string
  /** Dispatch a follow-up Finder turn for one project. Absent → the buttons disable. */
  onAsk?: (prompt: string) => void
  className?: string
}

/**
 * What a Details click does: a row with server details toggles its panel and NEVER asks the
 * AI; only a row without them (an older persisted turn) runs `ask`.
 */
export function handleDetailsClick(
  inline: boolean,
  toggle: () => void,
  ask: (() => void) | undefined,
): void {
  if (inline) toggle()
  else ask?.()
}

/**
 * Does a tap on a table row toggle its Details panel (quick-kayinleong-109)? On a phone the
 * Details button sits off-screen to the right of a sideways-scrolling table, so the whole row
 * opens the panel. Not when the row has no server details (an older persisted turn: tapping
 * a row must never start an AI turn), not when the tap landed on a control inside the row
 * (the Details button handles its own click, so the row would toggle it twice), and not
 * when the user was selecting text to copy.
 */
export function rowClickToggles(args: { inline: boolean; fromControl: boolean; hasSelection: boolean }): boolean {
  return args.inline && !args.fromControl && !args.hasSelection
}

/** Interactive elements whose own click must not also count as a row tap. */
const ROW_CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="button"]'

/** Toggle one project id in the set of open Details panels (a new Set; several may be open). */
export function toggleOpen(open: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(open)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
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

/** Name, Price, Size, Bedrooms, Tenure, Location, Highlight, Actions. */
const COLUMN_COUNT = 8

/**
 * Which group heading, if any, goes above `rows[index]` on this page
 * (quick-kayinleong-103).
 *
 * The server sends in-area rows first, then the rows that only sit around the requested
 * area (`locationMatch: 'nearby'`). The nearby heading goes above the first nearby row on
 * a page, including a page that starts with one, so a later page still says what those rows
 * are. The in-area heading is shown only when both groups exist, and only at the top of a
 * page that starts with in-area rows. A search without a location preference has no headings.
 *
 * Exported for unit testing (no jsdom in this repo, see `formatPrice`).
 */
export function groupHeadingBefore(
  rows: Array<Pick<FinderRow, 'locationMatch' | 'locationArea'>>,
  index: number,
  hasBothGroups: boolean,
): 'in_area' | 'nearby' | null {
  const row = rows[index]
  if (!row?.locationArea) return null
  if (row.locationMatch === 'nearby') {
    return index === 0 || rows[index - 1]?.locationMatch !== 'nearby' ? 'nearby' : null
  }
  if (row.locationMatch === 'in_area' && hasBothGroups && index === 0) return 'in_area'
  return null
}

/**
 * The Finder result table: one row per project, paginated, with a per-row action that
 * asks the chat to expand that one project with its supporting documents.
 */
export function MatchTable({ rows, matches, summaries, heading, onAsk, className }: MatchTableProps) {
  const t = useTranslations('chat.matchTable')
  // Reuse the already-trilingual admin column headers rather than duplicating five
  // strings in three catalogs (app/[lang]/(admin)/inventory/project-list.tsx uses these).
  const tCol = useTranslations('inventory')

  const displayRows = withHighlights(rows, matches)
  const { page, setPage, pageCount, pageItems, total } = usePagination(
    displayRows,
    ROWS_PER_PAGE,
  )
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const baseId = useId()
  const entryById = new Map(
    buildSummaryEntries(rows, matches, summaries, {
      sqft: t('sqft'),
      bed: t('bed'),
      nett: t('nett'),
      gross: t('gross'),
    }).map((e) => [e.projectId, e]),
  )

  return (
    <div data-slot="match-table" className={cn('flex w-full flex-col gap-2', className)}>
      {heading && (
        <h3
          data-slot="match-table-group"
          className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {heading}
        </h3>
      )}
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('rowCount', { count: total })}
      </span>

      {/* `Table` already wraps ITSELF in `relative w-full overflow-x-auto`
          (components/ui/table.tsx) — that IS the horizontal-scroll affordance at 440px. Do
          not add a second scroll container, and never add a horizontal-centring utility to
          it: centring an overflowing scroll container clips BOTH ends (quick-081, and the
          warning left at chat-header.tsx:199-202). */}
      {/* `@container` on a wrapper OUTSIDE the scroller: the open Details panel is sized
          `100cqw` = this wrapper's width = the visible scroll area, and pinned `left-0`, so on
          a phone it stays inside the viewport while the table scrolls sideways under it. */}
      <div className="@container w-full min-w-0">
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
            const entry = entryById.get(row.projectId)
            const inline = hasDetails(entry)
            const isOpen = inline && open.has(row.projectId)
            const panelId = `${baseId}-${row.projectId}`
            return (
              <Fragment key={row.projectId}>
                {/* projectId stays on the row and in the name's title: it is the grounding
                    citation (D-04) and the admin surfaces key off it, exactly as
                    match-list.tsx:176 does today. */}
                <TableRow
                  data-project-id={row.projectId}
                  data-location-match={row.locationMatch}
                  data-expandable={inline ? 'true' : undefined}
                  className={cn(inline && 'cursor-pointer')}
                  // quick-kayinleong-109: tapping anywhere on the row opens or closes its
                  // details. Pointer only; keyboard and screen-reader users have the Details
                  // button, which keeps aria-expanded.
                  onClick={
                    inline
                      ? (e) => {
                          const target = e.target as HTMLElement | null
                          const fromControl = !!target?.closest(ROW_CONTROL_SELECTOR)
                          const hasSelection = (window.getSelection?.()?.toString() ?? '').length > 0
                          if (rowClickToggles({ inline, fromControl, hasSelection })) {
                            setOpen((prev) => toggleOpen(prev, row.projectId))
                          }
                        }
                      : undefined
                  }
                >
                  {/* WRAPS, never truncates (quick-kayinleong-103): the agent reads the name
                      out to a lead, and "The Cedar Damansara H…" cannot be read out. The
                      right-edge shadow marks where scrolled cells slide under it. */}
                  <TableCell
                    className="sticky left-0 z-10 min-w-[9rem] max-w-[13rem] whitespace-normal break-words bg-background font-medium shadow-[1px_0_0_0_var(--color-border)]"
                    title={`${row.name} (${row.projectId})`}
                  >
                    <span className="flex items-start gap-1">
                      {inline && (
                        // A tap cue that stays in view (the name column is sticky).
                        <ChevronRight
                          aria-hidden="true"
                          data-slot="match-row-chevron"
                          className={cn(
                            'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-90',
                          )}
                        />
                      )}
                      <span>{row.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {price ?? (
                      <span title={t('priceUnknown')} aria-label={t('priceUnknown')}>
                        {EM_DASH}
                      </span>
                    )}
                    {/* quick-kayinleong-110: how far over the budget an over_budget alternative is. */}
                    {price && row.alternative === 'over_budget' && typeof row.overBudgetPct === 'number' && (
                      <span
                        data-slot="over-budget-badge"
                        className="ml-1.5 text-[0.6875rem] font-medium text-muted-foreground"
                      >
                        {t('overBudgetBadge', { pct: row.overBudgetPct })}
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
                  <TableCell className="min-w-[12rem] max-w-[16rem] whitespace-normal break-words">
                    {row.locationText || EM_DASH}
                  </TableCell>
                  <TableCell className="min-w-[12rem] max-w-[18rem] whitespace-normal break-words">
                    {row.highlight}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      // 44px touch-target floor, the same one match-list.tsx's collateral
                      // rows use.
                      className="min-h-11 whitespace-nowrap"
                      disabled={!inline && !onAsk}
                      aria-label={
                        inline
                          ? t('detailsAria', { name: row.name })
                          : t('showMoreAria', { name: row.name })
                      }
                      aria-expanded={inline ? isOpen : undefined}
                      aria-controls={inline && isOpen ? panelId : undefined}
                      onClick={() =>
                        handleDetailsClick(
                          inline,
                          () => setOpen((prev) => toggleOpen(prev, row.projectId)),
                          // quick-kayinleong-108: a row with server details opens them inline,
                          // no AI turn. Only a row without them (an older persisted turn) asks.
                          //
                          // A TRANSLATED prompt, not an English literal: the agent replies in
                          // the language of the incoming message, so an English prompt would
                          // flip a BM or 中文 conversation to English.
                          //
                          // THE projectId IS THE POINT (quick-kayinleong-088): the marker
                          // `projectId: <id>` (deliberately UNtranslated) is bound by the Finder
                          // system prompt to the `projectDetail` tool, a direct projects/{pid}
                          // read that cannot resolve to the wrong project. Change this string
                          // only together with the "DETAIL REQUEST" section of
                          // src/agents/finder/prompt.ts.
                          onAsk
                            ? () =>
                                onAsk(
                                  t('showMorePrompt', { name: row.name, projectId: row.projectId }),
                                )
                            : undefined,
                        )
                      }
                    >
                      {isOpen ? t('hideDetails') : t('showMore')}
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen && entry && (
                  <TableRow data-slot="match-table-details" className="hover:bg-transparent">
                    <TableCell colSpan={COLUMN_COUNT} className="p-0 whitespace-normal">
                      {/* Pinned to the visible area (see the `@container` wrapper): no
                          horizontal scrolling inside the panel, the text wraps. */}
                      <div className="sticky left-0 box-border w-[100cqw] max-w-[100cqw] px-3 py-3">
                        <ProjectDetailsPanel entry={entry} id={panelId} />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
      </div>

      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
