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
 * References:
 *   - D-10 (recharts for dashboard metrics)
 *   - CDASH-05 (training-stage funnel)
 *   - CDASH-07 (60→7-10 day ramp reporting)
 *   - Pitfall 7 (recharts client-only)
 *   - Pitfall 8 (no lead/close in P2)
 */

import { useTranslations } from 'next-intl'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts'
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
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funnelData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rampData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="checkpoint"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="days"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  strokeDasharray="5 5"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
