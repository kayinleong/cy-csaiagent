'use client'

/**
 * app/[lang]/(coach)/_components/knowledge-gap-feed.tsx
 *
 * CDASH-03: Knowledge-gap feed — shows the topics agents asked about
 * that the KB couldn't answer, aggregated per coach.
 *
 * PDPA: topicLabel is a short PDPA-safe label (≤120 chars, never raw query text).
 * The knowledge-gap store is aggregated per coach — no raw transcript data shown.
 *
 * Displays: topicLabel, count (number of misses), language, last seen time.
 *
 * References:
 *   - CDASH-03 (knowledge-gap feed)
 *   - T-02-32 (knowledge-gap PII — only topicLabel/hash stored, never raw query)
 */

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export interface GapItem {
  id: string
  topicLabel: string
  count: number
  lang: string
  lastSeenAt: string // ISO string
}

interface KnowledgeGapFeedProps {
  gaps: GapItem[]
}

export function KnowledgeGapFeed({ gaps }: KnowledgeGapFeedProps) {
  const t = useTranslations('dashboard')

  if (gaps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('noGaps')}</p>
    )
  }

  return (
    <div className="space-y-2">
      {gaps.map((gap) => (
        <Card key={gap.id}>
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{gap.topicLabel}</p>
              <p className="text-xs text-muted-foreground">
                {t('lastSeen')}: {formatRelativeTime(gap.lastSeenAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline">{gap.lang.toUpperCase()}</Badge>
              <Badge variant="secondary">
                {gap.count}x
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'just now'
  } catch {
    return iso
  }
}
