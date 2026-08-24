'use client'

/**
 * app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx
 *
 * CDASH-08: Knowledge-gap aggregation by topic + pillar panel.
 *
 * MUST be a 'use client' component — recharts uses browser APIs (Pitfall 7 / HR-3).
 *
 * Fed plain serializable props from dashboard/page.tsx (getKnowledgeGapAggregation result).
 * The Phase-2 KnowledgeGapFeed is per-row with raw feed ordering. This v2 panel adds
 * an AGGREGATED view: a BarChart of gap volume by topic, with a pillar dimension
 * (Coach/Finder/Reply) shown via a Tabs filter (reusing the Phase-4 pillar-filter pattern
 * from (admin)/kb). Counts only — no PII (topicLabel is pseudonymized on write).
 *
 * recharts conventions VERBATIM (HR-3). All strings from dashboard.v2.* (HR-2).
 * Empty state: centered muted p.py-8 with dashboard.v2.noData.
 *
 * ⚡ PERF (quick-046): the chart renders through ../../_components/charts/lazy-chart,
 * the single `next/dynamic` boundary for recharts (375 KB). Do NOT import `recharts`
 * here again.
 *
 * References:
 *   - CDASH-08 (coach dashboard v2 panels)
 *   - 05-UI-SPEC.md Surface 1, panel 2
 *   - 05-PATTERNS.md knowledge-gap-agg-panel.tsx section
 *   - HR-1/HR-2/HR-3/HR-4
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { LazyBarChart, CHART_PRIMARY } from '../../_components/charts/lazy-chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export interface GapAggPoint {
  topicLabel: string
  pillar: string
  count: number
}

export interface KnowledgeGapAggPanelProps {
  gapsByTopic: GapAggPoint[]
  scope: 'downline' | 'org'
}

const PILLARS = ['all', 'coach', 'reply'] as const
type PillarFilter = (typeof PILLARS)[number]

export function KnowledgeGapAggPanel({ gapsByTopic, scope }: KnowledgeGapAggPanelProps) {
  const t = useTranslations('dashboard.v2')
  const tDash = useTranslations('dashboard')

  const [pillarFilter, setPillarFilter] = useState<PillarFilter>('all')

  const filtered =
    pillarFilter === 'all'
      ? gapsByTopic
      : gapsByTopic.filter((g) => g.pillar === pillarFilter)

  // Take the top 10 topics for chart legibility
  const chartData = filtered.slice(0, 10).map((g) => ({
    topic: g.topicLabel.length > 20 ? `${g.topicLabel.slice(0, 17)}…` : g.topicLabel,
    count: g.count,
  }))

  const hasData = gapsByTopic.length > 0

  const scopeLabel =
    scope === 'org' ? tDash('viewingAll') : tDash('viewingDownline')

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">{t('gapAggTitle')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('gapAggSubtitle')} · {scopeLabel}
        </p>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('noData')}
          </p>
        ) : (
          <Tabs
            value={pillarFilter}
            onValueChange={(v) => setPillarFilter(v as PillarFilter)}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="all">{t('gapByPillar')}</TabsTrigger>
              <TabsTrigger value="coach">Coach</TabsTrigger>
              <TabsTrigger value="reply">Reply</TabsTrigger>
            </TabsList>

            {PILLARS.map((p) => (
              <TabsContent key={p} value={p}>
                {chartData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t('noData')}
                  </p>
                ) : (
                  <LazyBarChart
                    data={chartData}
                    xKey="topic"
                    series={[{ dataKey: 'count', color: CHART_PRIMARY }]}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
