/**
 * app/[lang]/chat/match-list.tsx — Finder match-card renderer.
 *
 * RSC-compatible render-only component (no "use client" needed).
 * Composes vendored Card, Badge from @/components/ui — do NOT re-add shadcn.
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

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { FinderOutput, FinderMatch } from '@/src/agents/finder/schema'

// ─── Props ────────────────────────────────────────────────────────────────────

interface MatchListProps {
  output: FinderOutput
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

export function MatchList({ output, className }: MatchListProps) {
  const { matches, refusal, clarifyingQuestion } = output

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

  // ── State 1: Ranked project matches ──────────────────────────────────────
  if (matches.length > 0) {
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
  const { projectId, rationale, matchedCriteria, collateral } = match

  return (
    <Card
      data-slot="match-card"
      data-project-id={projectId}
      className="rounded-xl ring-1 ring-foreground/10 shadow-sm"
    >
      <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center gap-2">
        {/* Rank badge */}
        <Badge
          variant="secondary"
          className="h-5 w-5 rounded-full p-0 flex items-center justify-center text-[0.625rem] font-semibold shrink-0"
        >
          {rank}
        </Badge>
        {/* Project ID — cite real ID, never fabricated (D-04) */}
        <span className="font-mono text-xs text-muted-foreground truncate" title={projectId}>
          {projectId}
        </span>
      </CardHeader>

      {/* Grounded rationale — references real project fields */}
      <CardContent className="px-4 pb-3 text-sm md:text-[0.8125rem] leading-relaxed">
        {rationale}
      </CardContent>

      {/* Matched-criteria badges + collateral links */}
      {(hasMatchedCriteria(matchedCriteria) || (collateral && collateral.length > 0)) && (
        <CardFooter className="px-4 pb-4 pt-0 flex flex-wrap gap-1.5">
          {/* Matched-criteria badges */}
          <MatchedCriteriaBadges criteria={matchedCriteria} />

          {/* Collateral chips — plain link anchors, never a Drive embed (D-09/C2).
              Defence in depth (quick-kayinleong-050): fetchCollateral now OMITS items
              without a web-addressable URL, so a bare bucket key should never reach here.
              This filter is the second line — rendering `href="collateral/<id>/x.pdf"`
              produces a chip that looks clickable and 404s, which is the UI telling the
              agent something false. Cheap to keep, and it also covers a hand-entered
              storagePath from the admin collateral form. */}
          {collateral?.filter((item) => isWebUrl(item.url)).map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center gap-1',
                'rounded-full border border-border bg-background',
                'px-2 py-0.5 text-[0.625rem] font-medium text-foreground',
                'hover:bg-accent hover:text-accent-foreground transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <CollateralIcon className="h-2.5 w-2.5 shrink-0" />
              {item.type}
            </a>
          ))}
        </CardFooter>
      )}
    </Card>
  )
}

// ─── MatchedCriteriaBadges ────────────────────────────────────────────────────

interface MatchedCriteriaBadgesProps {
  criteria: FinderMatch['matchedCriteria']
}

/**
 * Render the matched criteria as compact badge chips.
 * Only renders non-null / non-unknown fields.
 */
function MatchedCriteriaBadges({ criteria }: MatchedCriteriaBadgesProps) {
  const badges: string[] = []

  if (criteria.segment !== 'unknown') {
    badges.push(criteria.segment === 'investment' ? 'Investment' : 'Own-stay')
  }
  if (criteria.nationality !== 'unknown') {
    badges.push(criteria.nationality === 'foreign' ? 'Foreign buyer' : 'Malaysian')
  }
  if (criteria.bumiputera !== null) {
    badges.push(criteria.bumiputera ? 'Bumi' : 'Non-bumi')
  }
  if (criteria.priceMax !== null) {
    const formatted =
      criteria.priceMax >= 1_000_000
        ? `≤RM${(criteria.priceMax / 1_000_000).toFixed(1)}M`
        : `≤RM${Math.round(criteria.priceMax / 1_000)}k`
    badges.push(formatted)
  }
  if (criteria.locationPref) {
    badges.push(criteria.locationPref)
  }
  if (criteria.bedrooms !== null) {
    badges.push(`${criteria.bedrooms} bed`)
  }

  return (
    <>
      {badges.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="text-[0.625rem] px-1.5 py-0.5 h-auto font-normal"
        >
          {label}
        </Badge>
      ))}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the matched-criteria object has at least one non-null/non-unknown field.
 */
function hasMatchedCriteria(criteria: FinderMatch['matchedCriteria']): boolean {
  return (
    criteria.segment !== 'unknown' ||
    criteria.nationality !== 'unknown' ||
    criteria.bumiputera !== null ||
    criteria.priceMax !== null ||
    criteria.locationPref !== null ||
    criteria.bedrooms !== null
  )
}

// ─── Inline icon ──────────────────────────────────────────────────────────────

function CollateralIcon({ className }: { className?: string }) {
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
