'use client'

/**
 * app/[lang]/chat/match-summaries.tsx — the project summaries under the Finder table
 * (quick-kayinleong-106).
 *
 * One numbered entry per shortlisted project, in the table's rank order, under the same
 * "In <area>" / "Other projects around <area>" headings:
 *
 *   1. Pavilion Damansara Heights
 *   Best for: …                      (model-written, from the project's quick facts)
 *   Layouts & sizing: Type A · 1,076 sqft · 2 bed · Nett RM1.2m–1.35m · Gross RM1.4m–1.5m
 *                     Sold out: Type C, Type D
 *   Key selling points: …            (model-written, from the project's quick facts)
 *   [Details]
 *
 * The layout lines are SERVER data (`output.summaries`, built from the stored `unitTypes`),
 * never model text. A sold-out layout is only ever named, never priced, and a price that is
 * missing or zero prints nothing, never "RM 0". The two prose fields come from the
 * model's `matches[]` and are rendered as plain text only: no markdown, no raw HTML.
 * An entry with nothing to show is not rendered.
 *
 * 'use client' for `useTranslations`, like `match-table.tsx`.
 */

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type {
  FinderMatch,
  FinderRow,
  MatchSummary,
  SummaryLayoutRow,
} from '@/src/agents/finder/schema'
import { groupHeadingBefore } from './match-table'

/** A price as a short RM figure ("RM850k", "RM1.2m", "RM1.35m"), or null when not > 0. */
export function compactRM(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `RM${+(n / 1_000_000).toFixed(2)}m`
  if (n >= 1_000) return `RM${+(n / 1_000).toFixed(1)}k`
  return `RM${Math.round(n)}`
}

/** "RM1.2m–1.35m", "RM1.2m" when both bounds agree or one is missing, null when neither is on record. */
export function formatRMRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  const lo = compactRM(min)
  const hi = compactRM(max)
  if (!lo && !hi) return null
  if (!lo || !hi) return (lo ?? hi) as string
  if (lo === hi) return lo
  const a = Math.min(min as number, max as number)
  const b = Math.max(min as number, max as number)
  return `${compactRM(a)}–${compactRM(b)?.replace(/^RM/, '')}`
}

export interface LayoutLabels {
  sqft: string
  bed: string
  nett: string
  gross: string
}

/**
 * One available layout as a single line: label · size · beds · Nett range · Gross range.
 * Every part that is not on record is left out. A sold-out layout carries no price here
 * even if its data did (it is listed under "Sold out" by name only).
 */
export function formatLayoutLine(layout: SummaryLayoutRow, labels: LayoutLabels): string {
  const parts: string[] = [layout.label]
  if (typeof layout.sizeSqft === 'number' && layout.sizeSqft > 0) {
    parts.push(`${layout.sizeSqft.toLocaleString('en-MY', { maximumFractionDigits: 0 })} ${labels.sqft}`)
  }
  if (typeof layout.bedrooms === 'number' && layout.bedrooms > 0) {
    parts.push(`${layout.bedrooms} ${labels.bed}`)
  }
  if (!layout.soldOut) {
    const nett = formatRMRange(layout.priceMinRM, layout.priceMaxRM)
    if (nett) parts.push(`${labels.nett} ${nett}`)
    const gross = formatRMRange(layout.grossMinRM, layout.grossMaxRM)
    if (gross) parts.push(`${labels.gross} ${gross}`)
  }
  return parts.join(' · ')
}

export interface SummaryEntry {
  projectId: string
  name: string
  locationMatch?: FinderRow['locationMatch']
  locationArea?: string
  bestFor: string
  sellingPoints: string
  /** Available layouts, already formatted as lines. */
  layoutLines: string[]
  /** Names of the sold-out layouts. */
  soldOut: string[]
}

/**
 * The entries to show: the table's rows (rank order, never re-sorted) that the model
 * shortlisted, each with its prose fields and the server's layouts. An entry with no
 * `bestFor`, no `sellingPoints` and no layouts is dropped.
 *
 * Exported for unit testing (no jsdom in this repo, see `formatPrice` in match-table.tsx).
 */
export function buildSummaryEntries(
  rows: FinderRow[],
  matches: FinderMatch[],
  summaries: MatchSummary[] | undefined,
  labels: LayoutLabels,
): SummaryEntry[] {
  const matchById = new Map(matches.map((m) => [m.projectId, m]))
  const layoutsById = new Map((summaries ?? []).map((s) => [s.projectId, s.layouts]))
  const entries: SummaryEntry[] = []
  for (const row of rows) {
    // Every shortlisted table row gets an entry, not only the projects the model chose to
    // write a match for: the layouts are server data (quick-kayinleong-106). The two prose
    // lines appear where the model wrote them.
    const match = matchById.get(row.projectId)
    const layouts = layoutsById.get(row.projectId) ?? []
    const entry: SummaryEntry = {
      projectId: row.projectId,
      name: row.name,
      locationMatch: row.locationMatch,
      locationArea: row.locationArea,
      bestFor: match?.bestFor?.trim() ?? '',
      sellingPoints: match?.sellingPoints?.trim() ?? '',
      layoutLines: layouts.filter((l) => !l.soldOut).map((l) => formatLayoutLine(l, labels)),
      soldOut: layouts.filter((l) => l.soldOut).map((l) => l.label),
    }
    if (
      entry.bestFor ||
      entry.sellingPoints ||
      entry.layoutLines.length > 0 ||
      entry.soldOut.length > 0
    ) {
      entries.push(entry)
    }
  }
  return entries
}

interface MatchSummariesProps {
  rows: FinderRow[]
  matches: FinderMatch[]
  summaries?: MatchSummary[]
  /** Dispatch the same follow-up turn as the table's Details button. Absent → disabled. */
  onAsk?: (prompt: string) => void
  className?: string
}

export function MatchSummaries({ rows, matches, summaries, onAsk, className }: MatchSummariesProps) {
  const t = useTranslations('chat.matchTable')
  const entries = buildSummaryEntries(rows, matches, summaries, {
    sqft: t('sqft'),
    bed: t('bed'),
    nett: t('nett'),
    gross: t('gross'),
  })
  if (entries.length === 0) return null

  const areaLabel = entries.find((e) => e.locationArea)?.locationArea ?? ''
  const hasBothGroups =
    areaLabel.length > 0 &&
    entries.some((e) => e.locationMatch === 'in_area') &&
    entries.some((e) => e.locationMatch === 'nearby')

  return (
    <section
      data-slot="match-summaries"
      aria-label={t('summaryTitle')}
      className={cn('flex w-full min-w-0 flex-col gap-3', className)}
    >
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('summaryTitle')}
      </h3>
      {entries.map((entry, index) => {
        const heading = groupHeadingBefore(entries, index, hasBothGroups)
        return (
          <div key={entry.projectId} className="flex min-w-0 flex-col gap-3">
            {heading && (
              <p
                data-slot="match-summaries-group"
                className="pt-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {heading === 'nearby'
                  ? t('nearbyHeading', { area: areaLabel })
                  : t('inAreaHeading', { area: areaLabel })}
              </p>
            )}
            <div
              data-slot="match-summary"
              data-project-id={entry.projectId}
              className="flex min-w-0 flex-col gap-1 break-words text-[0.8125rem] leading-relaxed"
            >
              <p className="font-medium">
                {index + 1}. {entry.name}
              </p>
              {entry.bestFor && (
                <p>
                  <span className="font-semibold">{t('bestFor')}:</span> {entry.bestFor}
                </p>
              )}
              {(entry.layoutLines.length > 0 || entry.soldOut.length > 0) && (
                <div>
                  <span className="font-semibold">{t('layouts')}:</span>
                  {entry.layoutLines.length > 0 && (
                    <ul className="ml-4 list-disc">
                      {entry.layoutLines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {entry.soldOut.length > 0 && (
                    <p className="text-muted-foreground">
                      {t('soldOut')}: {entry.soldOut.join(', ')}
                    </p>
                  )}
                </div>
              )}
              {entry.sellingPoints && (
                <p>
                  <span className="font-semibold">{t('sellingPoints')}:</span> {entry.sellingPoints}
                </p>
              )}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 whitespace-nowrap"
                  disabled={!onAsk}
                  aria-label={t('showMoreAria', { name: entry.name })}
                  onClick={() =>
                    onAsk?.(t('showMorePrompt', { name: entry.name, projectId: entry.projectId }))
                  }
                >
                  {t('showMore')}
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
