'use client'

/**
 * app/[lang]/(coach)/_components/funnel-v2-panel.tsx
 *
 * CDASH-08: Full training→lead→close funnel + ramp KPI panel.
 *
 * MUST be a 'use client' component — recharts uses browser APIs and cannot render
 * in a Server Component (Pitfall 7 / HR-3).
 *
 * Fed plain serializable props from dashboard/page.tsx (getFunnelV2Metrics result).
 * Extends the Phase-2 MetricsPanel training-only funnel to the full pipeline
 * (training→lead→close) + adds the ramp-compression KPI scalar (avg days to
 * productive vs the 7–10 day target). Does NOT duplicate the existing MetricsPanel;
 * it is appended as a new section (D-07 grow, don't fork).
 *
 * recharts conventions VERBATIM (HR-3):
 *   - ResponsiveContainer width="100%" height={220}
 *   - margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
 *   - tick fontSize: 12
 *   - primary series #6366f1 / secondary #f59e0b
 *   - Bar radius [4, 4, 0, 0]
 *
 * All strings from dashboard.v2.* (HR-2). Empty state: centered muted p.py-8.
 *
 * References:
 *   - CDASH-08 (coach dashboard v2 panels)
 *   - 05-UI-SPEC.md Surface 1, panel 1
 *   - 05-PATTERNS.md funnel-v2-panel.tsx section
 *   - HR-1/HR-2/HR-3/HR-4
 */

import { useTranslations } from 'next-intl'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export interface FunnelV2Stage {
  stage: string
  count: number
}

export interface FunnelV2PanelProps {
  stages: FunnelV2Stage[]
  activeAgents: number
  totalAgents: number
  avgDaysToProductive: number | null
  scope: 'downline' | 'org'
}

const RAMP_TARGET_DAYS = 10 // 7–10 day target; use upper bound

export function FunnelV2Panel({
  stages,
  activeAgents,
  totalAgents,
  avgDaysToProductive,
  scope,
}: FunnelV2PanelProps) {
  const t = useTranslations('dashboard.v2')
  const tDash = useTranslations('dashboard')

  const hasData = totalAgents > 0

  // Ramp KPI: compare avgDaysToProductive to the 7–10-day target
  const rampDisplay =
    avgDaysToProductive != null ? `${avgDaysToProductive.toFixed(1)} days` : '—'
  const targetDisplay = `${RAMP_TARGET_DAYS} days`

  const scopeLabel =
    scope === 'org' ? tDash('viewingAll') : tDash('viewingDownline')

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* ── Full funnel BarChart ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('funnelTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('funnelSubtitle')} · {scopeLabel}
          </p>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('noData')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={stages}
                margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
              >
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Ramp KPI stat card ────────────────────────────────────────────── */}
      <div className="grid gap-6 content-start">
        {/* Avg days to productive */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('avgDaysToProductive')}</p>
            <span className="text-2xl font-bold">{rampDisplay}</span>
          </CardHeader>
        </Card>

        {/* Target */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('rampTargetLabel')}</p>
            <span className="text-2xl font-bold">{targetDisplay}</span>
          </CardHeader>
        </Card>

        {/* Actual label (scope badge) */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('rampActualLabel')}</p>
            <span className="text-2xl font-bold">
              {activeAgents} / {totalAgents}
            </span>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
