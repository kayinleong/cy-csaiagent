/**
 * app/[lang]/chat/match-list.tsx — Finder match renderer.
 *
 * Render-only. Composes vendored Card, Badge from @/components/ui — do NOT re-add shadcn.
 * It now also composes a CLIENT child (`MatchTable`, which needs usePagination and
 * useTranslations). That is fine and needs no "use client" here: the whole subtree already
 * sits inside the `chat-shell.tsx` client island, so the `onAsk` function prop crosses no
 * server/client boundary (quick-kayinleong-085).
 *
 * Renders one of three states (FIND-01/04):
 *   1. Matches found  → ranked project cards with rationale + matched-criteria
 *      badges + collateral chips (links, never Drive embed — D-09/C2)
 *   2. Refusal        → grounded explanation card (no_match / ineligible)
 *   3. Clarifying Q   → a plain explanatory message asking for missing info
 *
 * Design constraints:
 *   - Grounding is mandatory: rationale references real fields (D-04).
 *   - Collateral chips are plain anchor <a> tags pointing to the URL returned
 *     by fetchCollateral (Storage download URL or external URL). Never a
 *     Drive API embed (D-09/C2).
 *   - No match fabrication: component renders exactly what the agent produced.
 *
 * References: FIND-01, FIND-04, D-04, D-09, C2, 03-07-PLAN.md.
 */

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { FinderOutput, FinderMatch } from '@/src/agents/finder/schema'
import { MarkdownMessage } from './markdown-message'
import { MatchTable } from './match-table'
import { presentCollateral, type CollateralKind } from './collateral-label'

// ─── Props ────────────────────────────────────────────────────────────────────

interface MatchListProps {
  output: FinderOutput
  /**
   * Dispatch a follow-up chat turn for one project (quick-kayinleong-085).
   *
   * Forwarded chat-shell -> MessageList -> here -> MatchTable's per-row button. Optional,
   * so a caller that does not want the action still renders the table (with the buttons
   * disabled).
   */
  onAsk?: (prompt: string) => void
  className?: string
}

// ─── MatchList ────────────────────────────────────────────────────────────────

/**
 * Render the Finder agent's output as a structured match list.
 *
 * Handles all three FinderOutput states:
 *   - matches.length > 0 → project cards
 *   - refusal present     → grounded refusal card
 *   - clarifyingQuestion  → plain clarifying message
 *   - all empty           → empty placeholder (should not normally occur)
 */
/**
 * Is this string something a browser can actually navigate to?
 *
 * Inlined rather than imported from src/agents/finder/tools.ts (which has the canonical
 * `webAddressableUrl`): that module pulls the AI SDK and Firebase Admin, and this is a
 * client component — importing it would drag server-only code into the browser bundle.
 */
function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function MatchList({ output, onAsk, className }: MatchListProps) {
  const { matches, refusal, clarifyingQuestion, answer, rows } = output

  // ── State 3: Clarifying question ─────────────────────────────────────────
  if (clarifyingQuestion) {
    return (
      <div
        data-slot="match-list"
        data-state="clarifying"
        className={cn('flex flex-col gap-3', className)}
      >
        <p className="text-sm text-muted-foreground leading-relaxed">
          {clarifyingQuestion}
        </p>
      </div>
    )
  }

  // ── State 2: Grounded refusal ─────────────────────────────────────────────
  if (refusal) {
    return (
      <div
        data-slot="match-list"
        data-state="refusal"
        className={cn('flex flex-col gap-3', className)}
      >
        <Card
          data-slot="refusal-card"
          className="rounded-xl ring-1 ring-foreground/10 shadow-sm"
        >
          <CardHeader className="pb-2 pt-4 px-4">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {refusal.reason === 'ineligible' ? 'Eligibility issue' : 'No match found'}
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-sm leading-relaxed">
            {refusal.explanation}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── State 0: Conversational answer (quick-kayinleong-051) ────────────────
  // The agent asked ABOUT a project rather than FOR a shortlist. Before this branch the
  // model had no shape for that and stuffed an essay into matches[0].rationale, which
  // reached the user as a raw JSON envelope.
  if (answer) {
    return (
      <div
        data-slot="match-list"
        data-state="answer"
        className={cn('text-sm leading-relaxed', className)}
      >
        <MarkdownMessage content={answer} />
      </div>
    )
  }

  // ── State 1: Ranked project matches ──────────────────────────────────────
  if (matches.length > 0) {
    // The TABLE is the primary rendering (quick-kayinleong-085): it shows every project
    // the tool returned with its real attributes, which the card list structurally could
    // not — the attributes died at the tool boundary before `rows` existed.
    //
    // MatchCard stays the fallback for an empty `rows`: an older persisted turn, or a turn
    // whose rows never arrived. Losing the whole answer because the rows are missing would
    // be a worse trade than showing the cards it used to show.
    if (rows.length > 0) {
      return (
        <div
          data-slot="match-list"
          data-state="matches"
          className={cn('flex w-full flex-col gap-3', className)}
        >
          <MatchTable rows={rows} matches={matches} onAsk={onAsk} />
        </div>
      )
    }

    return (
      <div
        data-slot="match-list"
        data-state="matches"
        className={cn('flex flex-col gap-3', className)}
      >
        {matches.map((match, idx) => (
          <MatchCard key={match.projectId} match={match} rank={idx + 1} />
        ))}
      </div>
    )
  }

  // ── Fallback: empty output (no matches, no refusal, no question) ──────────
  // Should not normally occur in production (agent always produces one of the three).
  return (
    <div
      data-slot="match-list"
      data-state="empty"
      className={cn('flex flex-col gap-3', className)}
    >
      <p className="text-sm text-muted-foreground">
        No results returned. Please try rephrasing your criteria.
      </p>
    </div>
  )
}

// ─── MatchCard ────────────────────────────────────────────────────────────────

interface MatchCardProps {
  match: FinderMatch
  rank: number
}

/**
 * A single ranked project match card.
 *
 * Header: rank badge + project ID
 * Content: grounded rationale (references real project fields — D-04)
 * Footer: matched-criteria badges + collateral chips (links, never Drive embed)
 */
function MatchCard({ match, rank }: MatchCardProps) {
  const { projectId, name, rationale, matchedCriteria, collateral } = match
  const criteriaLabels = criteriaToLabels(matchedCriteria)
  const files = (collateral ?? []).filter((item) => isWebUrl(item.url))

  return (
    <Card
      data-slot="match-card"
      data-project-id={projectId}
      // overflow-hidden so the last attachment row's hover fill is clipped to the card's
      // rounded corner instead of squaring it off.
      className="overflow-hidden rounded-xl ring-1 ring-foreground/10 shadow-sm"
    >
      <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center gap-2">
        {/* Rank badge */}
        <Badge
          variant="secondary"
          className="h-5 w-5 rounded-full p-0 flex items-center justify-center text-[0.625rem] font-semibold shrink-0"
        >
          {rank}
        </Badge>
        {/* Name first, ID second (quick-kayinleong-056). The ID stays visible — it is the
            grounding citation (D-04) and the admin surfaces key off it — but an agent
            cannot say "QiQthTM3nC4SqWnST1Q6" to a lead, and until now that opaque string
            was the only thing identifying the project on the card. Falls back to the ID
            alone when the model omitted the name, which is the pre-056 rendering. */}
        {name ? (
          <>
            <span className="text-sm font-semibold truncate">{name}</span>
            <span
              className="font-mono text-[0.625rem] text-muted-foreground truncate shrink"
              title={projectId}
            >
              {projectId}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs text-muted-foreground truncate" title={projectId}>
            {projectId}
          </span>
        )}
      </CardHeader>

      {/* Grounded rationale — references real project fields.
          Rendered as markdown (quick-kayinleong-051): the model legitimately writes bold
          and bullets here, and as plain text they showed as literal ** and collapsed
          newlines. */}
      <CardContent className="px-4 pb-3 text-sm md:text-[0.8125rem] leading-relaxed">
        <MarkdownMessage content={rationale} />
      </CardContent>

      {/* Matched criteria — a QUIET meta line, not chips (quick-kayinleong-062).
          Rendering these identically to the collateral made context look like actions.
          They are what the search matched on; the files below are what the agent taps. */}
      {criteriaLabels.length > 0 && (
        <div
          data-slot="match-criteria"
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4 pb-3 text-[0.6875rem] text-muted-foreground"
        >
          {criteriaLabels.map((label, i) => (
            <span key={label} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground/40">·</span>}
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Collateral — a stacked list of real files, not a wrapping pill row.
          quick-kayinleong-062: every chip used to read "whatsapp-media" (the raw type on a
          WhatsApp import), so the agent had to open all three to find the sales kit. The
          name comes out of the URL. Stacked because this is a phone surface first and a
          wrapping row of chips is its worst case; each row is min-h-11 (44px), the
          touch-target floor.

          Defence in depth (quick-050): fetchCollateral omits items without a
          web-addressable URL, and this filter is the second line — a chip that looks
          clickable and 404s is the UI telling the agent something false. */}
      {files.length > 0 && (
        <div data-slot="match-collateral" className="border-t border-foreground/10">
          <span className="block px-4 pt-2.5 pb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {files.length === 1 ? '1 file to share' : `${files.length} files to share`}
          </span>
          <ul className="pb-1">
            {files.map((item, i) => {
              const { label, kind, ext } = presentCollateral(item)
              return (
                <li key={`${item.url}-${i}`}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'group flex min-h-11 items-center gap-2.5 px-4 py-2',
                      'transition-colors hover:bg-accent focus-visible:bg-accent',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    )}
                  >
                    <KindIcon kind={kind} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                      {label}
                    </span>
                    {ext && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.5625rem] font-semibold tracking-wide text-muted-foreground">
                        {ext}
                      </span>
                    )}
                    <ExternalIcon className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}

// ─── Criteria labels ──────────────────────────────────────────────────────────

/**
 * The matched criteria as plain strings, in the order an agent would say them.
 * Only non-null / non-unknown fields appear — an empty array means the search had nothing
 * concrete to match on, and the meta line is omitted entirely.
 */
function criteriaToLabels(criteria: FinderMatch['matchedCriteria']): string[] {
  const labels: string[] = []

  if (criteria.segment !== 'unknown') {
    labels.push(criteria.segment === 'investment' ? 'Investment' : 'Own-stay')
  }
  if (criteria.nationality !== 'unknown') {
    labels.push(criteria.nationality === 'foreign' ? 'Foreign buyer' : 'Malaysian')
  }
  if (criteria.bumiputera !== null) {
    labels.push(criteria.bumiputera ? 'Bumi' : 'Non-bumi')
  }
  if (criteria.priceMax !== null) {
    labels.push(
      criteria.priceMax >= 1_000_000
        ? `\u2264RM${(criteria.priceMax / 1_000_000).toFixed(1)}M`
        : `\u2264RM${Math.round(criteria.priceMax / 1_000)}k`,
    )
  }
  if (criteria.locationPref) labels.push(criteria.locationPref)
  if (criteria.bedrooms !== null) labels.push(`${criteria.bedrooms} bed`)

  return labels
}

// ─── Inline icons ─────────────────────────────────────────────────────────────

/** One glyph per file class, so the list is scannable without reading every label. */
function KindIcon({ kind, className }: { kind: CollateralKind; className?: string }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }

  if (kind === 'image') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m21 15-4.5-4.5L7 20" />
      </svg>
    )
  }
  if (kind === 'video') {
    return (
      <svg {...common}>
        <rect x="2" y="4" width="14" height="16" rx="2" />
        <path d="m16 10 6-3v10l-6-3z" />
      </svg>
    )
  }
  if (kind === 'folder') {
    return (
      <svg {...common}>
        <path d="M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    )
  }
  if (kind === 'link') {
    return (
      <svg {...common}>
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </svg>
    )
  }
  // pdf / doc / sheet — a document page with a folded corner.
  return (
    <svg {...common}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}
