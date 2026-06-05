'use client'

/**
 * app/[lang]/(coach)/_components/reply-quality-panel.tsx
 *
 * REPLY-11 / ADMIN-06 (D-21/D-22): the Reply Quality dashboard panel — a recharts
 * client island mirroring metrics-panel.tsx.
 *
 * MUST be a 'use client' component — recharts uses browser APIs and cannot render
 * in a Server Component (Pitfall 7 / RESEARCH §recharts under React 19).
 *
 * Renders (props are plain serializable values aggregated server-side in
 * dashboard/actions.ts getReplyQualityMetrics — read-time count(), D-20):
 *   1. Edit-rate-per-SOP LineChart (trend DOWN = good; the feedback loop that
 *      refines SOPs). Subtitle replyQuality.editRateSubtitle.
 *   2. Top-edited-SOPs BarChart (highest edit-rate first).
 *   3. Scalar KPI stat cards: thumbs-down rate, escalation rate, drafts-per-agent.
 *
 * Scope (D-22): a single component, role-conditional. The server passes `scope`
 * ('downline' for a coach, 'org' for admin); the panel renders the matching
 * subtitle copy (replyQuality.scopeDownline / replyQuality.scopeOrg). The coach's
 * data is already downline-locked server-side (AUTH-06) — this component only
 * displays counts; it never re-queries.
 *
 * References:
 *   - REPLY-11 / ADMIN-06 (reply quality analytics, thumbs-down rate KPI)
 *   - D-20 (read-time aggregation, no rollup job)
 *   - D-21 (metrics set) / D-22 (single component, role-conditional scope)
 *   - Pitfall 7 (recharts client-only)
 *   - 04-UI-SPEC §Surface 4 (composition, states, i18n keys)
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
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/** Mirror of SopEditRate in dashboard/actions.ts (plain serializable). */
export interface SopEditRatePoint {
  sopDocId: string
  editRate: number
  total: number
}

export interface ReplyQualityPanelProps {
  perSop: SopEditRatePoint[]
  thumbsDownRate: number
  escalationRate: number
  draftsPerAgent: number
  topEditedSop: string | null
  scope: 'downline' | 'org'
}

/** Render a [0,1] ratio as an integer percentage string. */
function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Shorten a long SOP doc ID for chart axis labels (keep the tail — most distinctive). */
function shortSop(id: string): string {
  return id.length > 10 ? `…${id.slice(-8)}` : id
}

export function ReplyQualityPanel({
  perSop,
  thumbsDownRate,
  escalationRate,
  draftsPerAgent,
  topEditedSop,
  scope,
}: ReplyQualityPanelProps) {
  const t = useTranslations('dashboard')

  const scopeLabel =
    scope === 'org' ? t('replyQuality.scopeOrg') : t('replyQuality.scopeDownline')

  // edit-rate-per-SOP trend points — chart shows editRate as a percentage 0..100.
  const editRateData = perSop.map((s) => ({
    sop: shortSop(s.sopDocId),
    editRate: Math.round(s.editRate * 100),
  }))

  // top-edited SOPs (already sorted DESC by editRate server-side); take the top 5.
  const topEditedData = perSop.slice(0, 5).map((s) => ({
    sop: shortSop(s.sopDocId),
    editRate: Math.round(s.editRate * 100),
  }))

  const hasData = perSop.length > 0

  return (
    <div className="grid gap-6">
      {/* Header / scope subtitle */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('replyQuality.title')}</h3>
          <p className="text-xs text-muted-foreground">{scopeLabel}</p>
        </CardHeader>
      </Card>

      {/* Charts: edit-rate trend + top-edited SOPs */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Edit-rate per SOP (trend DOWN good) */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold">{t('replyQuality.editRateTitle')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('replyQuality.editRateSubtitle')}
            </p>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('replyQuality.noData')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={editRateData}
                  margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="sop" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} unit="%" />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="editRate"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top-edited SOPs (bar) */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold">{t('replyQuality.topEditedTitle')}</h3>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('replyQuality.noData')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={topEditedData}
                  margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
                >
                  <XAxis dataKey="sop" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} unit="%" />
                  <Tooltip />
                  <Bar dataKey="editRate" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Scalar KPI stat cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              {t('replyQuality.thumbsDownLabel')}
            </p>
            <span className="text-2xl font-bold">{pct(thumbsDownRate)}</span>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              {t('replyQuality.escalationRateLabel')}
            </p>
            <span className="text-2xl font-bold">{pct(escalationRate)}</span>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              {t('replyQuality.draftsPerAgentLabel')}
            </p>
            <span className="text-2xl font-bold">{draftsPerAgent.toFixed(1)}</span>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">
              {t('replyQuality.topEditedTitle')}
            </p>
            <span className="text-2xl font-bold">
              {topEditedSop ? shortSop(topEditedSop) : '—'}
            </span>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
