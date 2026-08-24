'use client'

/**
 * app/[lang]/(coach)/_components/metrics-panel.tsx
 *
 * CDASH-05/07: Training-funnel BarChart + ramp LineChart (recharts client island).
 *
 * MUST be a 'use client' component — recharts uses browser APIs and cannot
 * render in a Server Component (Pitfall 7 / RESEARCH §recharts under React 19).
 *
 * Charts rendered:
 *   1. Training-stage funnel BarChart: agents per journeyStage (CDASH-05).
 *      Intentionally scope-limited to training stages (no lead/close — Pitfall 8).
 *   2. Ramp LineChart: checkpoint velocity per agent (CDASH-07).
 *      Shows agent checkpoint index vs. target progression.
 *
 * If recharts fails to render under React 19, add overrides.react-is pin to
 * package.json (recharts#4558 fix). No changes needed here in that case.
 *
 * ⚡ PERF (quick-046): both charts render through ../../_components/charts/lazy-chart,
 * the single `next/dynamic` boundary for recharts (375 KB). Do NOT import `recharts`
 * here again — that re-eagerises the chunk on /[lang]/(coach)/dashboard.
 *
 * References:
 *   - D-10 (recharts for dashboard metrics)
 *   - CDASH-05 (training-stage funnel)
 *   - CDASH-07 (60→7-10 day ramp reporting)
 *   - Pitfall 7 (recharts client-only)
 *   - Pitfall 8 (no lead/close in P2)
 */

import { useTranslations } from 'next-intl'
import {
  LazyBarChart,
  LazyLineChart,
  CHART_PRIMARY,
  CHART_SECONDARY,
} from '../../_components/charts/lazy-chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { AgentRow } from './downline-table'

interface FunnelData {
  stages: Record<string, number>
  stallRate: number
}

interface MetricsPanelProps {
  funnel: FunnelData
  agentRows: AgentRow[]
}

export function MetricsPanel({ funnel, agentRows }: MetricsPanelProps) {
  const t = useTranslations('dashboard')

  // Training-stage funnel bar chart data
  const funnelData = Object.entries(funnel.stages).map(([stage, count]) => ({
    stage,
    count,
  }))

  // Ramp line chart data: each agent as a data point with velocity (checkpoint index)
  const rampData = agentRows.map((agent, index) => ({
    name: `A${index + 1}`, // anonymized agent label (no raw uid in chart)
    checkpoint: agent.velocity,
    days: agent.daysInJourney,
  }))

  const stallPct = Math.round(funnel.stallRate * 100)

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Training-stage funnel BarChart (CDASH-05) */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('funnelChartTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('stallRateLabel')}: {stallPct}%
          </p>
        </CardHeader>
        <CardContent>
          {funnelData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('noAgents')}
            </p>
          ) : (
            <LazyBarChart
              data={funnelData}
              xKey="stage"
              series={[{ dataKey: 'count', color: CHART_PRIMARY }]}
            />
          )}
        </CardContent>
      </Card>

      {/* Ramp LineChart: checkpoint velocity per agent (CDASH-07) */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('rampChartTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('rampChartSubtitle')}</p>
        </CardHeader>
        <CardContent>
          {rampData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('noAgents')}
            </p>
          ) : (
            <LazyLineChart
              data={rampData}
              xKey="name"
              showLegend
              series={[
                { dataKey: 'checkpoint', color: CHART_PRIMARY },
                { dataKey: 'days', color: CHART_SECONDARY, dashed: true },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
