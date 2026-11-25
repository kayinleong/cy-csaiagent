'use client'

/**
 * app/[lang]/chat/match-summaries.tsx — the Finder's per-project facts
 * (quick-kayinleong-106/107/108).
 *
 * Two surfaces share the server-built data in `output.summaries` (never model text):
 *
 *   - `QuickFactsList`: under each table, one numbered block per project in table order:
 *     the name, the model's "Best for" / "Key selling points" lines (where it wrote them),
 *     then the project's Quick Facts as one "Label: value" line each.
 *   - `ProjectDetailsPanel`: the full details shown by a row's Details button inside the
 *     table: Quick Facts, Built-Up Sizes & Layouts (sold out named, never priced), Prices &
 *     Fees, the other write-up sections, Top Reasons Why, D2 focus lists.
 *
 * A price that is missing or zero prints nothing, never "RM 0". All text is plain: no
 * markdown, no raw HTML. An entry with nothing to show is not rendered.
 *
 * 'use client' for `useTranslations`, like `match-table.tsx`.
 */

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type {
  DetailSectionRow,
  FinderMatch,
  FinderRow,
  MatchSummary,
  SummaryLayoutRow,
} from '@/src/agents/finder/schema'

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
  /** The server-built detail sections (quick-kayinleong-107), as stored. */
  sections: DetailSectionRow[]
}

/** The fixed label keys a detail item may carry (`chat.matchTable.details.<key>`). */
export const DETAIL_ITEM_KEYS = [
  'area',
  'developer',
  'landTitle',
  'tenure',
  'totalUnits',
  'floors',
  'completion',
  'furnishing',
  'carPark',
  'maintenanceFee',
  'fromPrice',
  'psfRate',
] as const

const DETAIL_KEY_SET: ReadonlySet<string> = new Set(DETAIL_ITEM_KEYS)

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
  const summaryById = new Map((summaries ?? []).map((s) => [s.projectId, s]))
  const entries: SummaryEntry[] = []
  for (const row of rows) {
    // Every shortlisted table row gets an entry, not only the projects the model chose to
    // write a match for: the layouts are server data (quick-kayinleong-106). The two prose
    // lines appear where the model wrote them.
    const match = matchById.get(row.projectId)
    const layouts = summaryById.get(row.projectId)?.layouts ?? []
    const sections = summaryById.get(row.projectId)?.sections ?? []
    const entry: SummaryEntry = {
      projectId: row.projectId,
      name: row.name,
      locationMatch: row.locationMatch,
      locationArea: row.locationArea,
      bestFor: match?.bestFor?.trim() ?? '',
      sellingPoints: match?.sellingPoints?.trim() ?? '',
      layoutLines: layouts.filter((l) => !l.soldOut).map((l) => formatLayoutLine(l, labels)),
      soldOut: layouts.filter((l) => l.soldOut).map((l) => l.label),
      sections,
    }
    if (
      entry.bestFor ||
      entry.sellingPoints ||
      entry.layoutLines.length > 0 ||
      entry.soldOut.length > 0 ||
      entry.sections.length > 0
    ) {
      entries.push(entry)
    }
  }
  return entries
}

/** Rows per table page, and the most quick-facts blocks shown per group. */
export const GROUP_PAGE_SIZE = 10

/** True when the entry has anything for the Details dropdown (layouts or detail sections). */
export function hasDetails(entry: SummaryEntry | undefined): entry is SummaryEntry {
  return !!entry && (entry.layoutLines.length > 0 || entry.soldOut.length > 0 || entry.sections.length > 0)
}

type Translate = ReturnType<typeof useTranslations>

function itemLabel(t: Translate, item: DetailSectionRow['items'][number]): string | null {
  if (item.key) return DETAIL_KEY_SET.has(item.key) ? t(`details.${item.key}`) : item.key
  return item.label ?? null
}

/** The project's Quick Facts as "Label: value" lines (the database's Quick Facts format). */
export function quickFactLines(
  entry: Pick<SummaryEntry, 'sections'>,
  labelOf: (item: DetailSectionRow['items'][number]) => string | null,
): string[] {
  return entry.sections
    .filter((s) => s.kind === 'quickFacts')
    .flatMap((s) => s.items)
    .map((item) => {
      const label = labelOf(item)
      return label ? `${label}: ${item.value}` : item.value
    })
}

interface QuickFactsListProps {
  /** One group's table rows (recommended or nearby), in table order. */
  rows: FinderRow[]
  matches: FinderMatch[]
  summaries?: MatchSummary[]
  className?: string
}

/**
 * The numbered quick-facts blocks under one table. Only the group's first
 * `GROUP_PAGE_SIZE` rows get a block; a longer group ends with one muted line pointing at
 * the Details buttons. Renders nothing when no shown project has anything to say.
 */
export function QuickFactsList({ rows, matches, summaries, className }: QuickFactsListProps) {
  const t = useTranslations('chat.matchTable')
  const shownRows = rows.slice(0, GROUP_PAGE_SIZE)
  const entries = buildSummaryEntries(shownRows, matches, summaries, {
    sqft: t('sqft'),
    bed: t('bed'),
    nett: t('nett'),
    gross: t('gross'),
  })
    .map((entry) => ({ entry, lines: quickFactLines(entry, (item) => itemLabel(t, item)) }))
    .filter(({ entry, lines }) => entry.bestFor || entry.sellingPoints || lines.length > 0)
  if (entries.length === 0) return null
  const rest = rows.length - shownRows.length

  return (
    <section
      data-slot="match-quick-facts"
      aria-label={t('quickFactsTitle')}
      className={cn('flex w-full min-w-0 flex-col gap-3', className)}
    >
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('quickFactsTitle')}
      </h3>
      {entries.map(({ entry, lines }, index) => (
        <div
          key={entry.projectId}
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
          {entry.sellingPoints && (
            <p>
              <span className="font-semibold">{t('sellingPoints')}:</span> {entry.sellingPoints}
            </p>
          )}
          {lines.length > 0 && (
            <ul className="ml-4 list-disc">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {rest > 0 && (
        <p data-slot="match-quick-facts-rest" className="text-[0.75rem] text-muted-foreground">
          {t('restUnderDetails', { count: rest })}
        </p>
      )}
    </section>
  )
}

/**
 * The full details of one project, for the table's Details dropdown: Quick Facts, Built-Up
 * Sizes & Layouts, Prices & Fees, the other write-up sections in source order, Top Reasons
 * Why, D2 focus lists. Fixed keys and fixed titles are translated; write-up labels, titles
 * and values are shown as stored. Plain text that wraps (no horizontal scrolling).
 */
export function ProjectDetailsPanel({ entry, id }: { entry: SummaryEntry; id?: string }) {
  const t = useTranslations('chat.matchTable')
  const hasLayouts = entry.layoutLines.length > 0 || entry.soldOut.length > 0
  const ofKind = (kind: DetailSectionRow['kind']) => entry.sections.filter((s) => s.kind === kind)
  const renderSection = (section: DetailSectionRow, title: string, i: number) => (
    <div key={`${section.kind}-${i}`} data-slot="match-detail-section" className="flex flex-col gap-0.5">
      <p className="font-semibold">{title}</p>
      <ul className="ml-4 list-disc">
        {section.items.map((item, j) => {
          const label = itemLabel(t, item)
          return (
            <li key={j}>
              {label && <span className="font-semibold">{label}: </span>}
              {item.value}
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <div
      id={id}
      data-slot="match-details"
      data-project-id={entry.projectId}
      className="flex min-w-0 flex-col gap-2 break-words text-[0.8125rem] leading-relaxed"
    >
      {ofKind('quickFacts').map((sec, i) => renderSection(sec, t('details.quickFacts'), i))}
      {hasLayouts && (
        <div data-slot="match-detail-layouts" className="flex flex-col gap-0.5">
          <p className="font-semibold">{t('details.layouts')}</p>
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
      {ofKind('pricesFees').map((sec, i) => renderSection(sec, t('details.pricesFees'), i))}
      {ofKind('other').map((sec, i) => renderSection(sec, sec.title ?? '', i))}
      {ofKind('topReasons').map((sec, i) => renderSection(sec, t('details.topReasons'), i))}
      {ofKind('focusLists').map((sec, i) => renderSection(sec, t('details.focusLists'), i))}
    </div>
  )
}
