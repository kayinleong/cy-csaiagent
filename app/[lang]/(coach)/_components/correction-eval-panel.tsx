'use client'

/**
 * app/[lang]/(coach)/_components/correction-eval-panel.tsx
 *
 * CDASH-08: Inline-correction → eval feedback panel.
 *
 * MUST be a 'use client' component — recharts uses browser APIs (Pitfall 7 / HR-3).
 *
 * Fed plain serializable props from dashboard/page.tsx (getCorrectionEvalFeedback result).
 * Shows:
 *   1. A Table of recent inline corrections (doc ref, corrected-by uid, re-ingest status,
 *      pillar) — read-only display of the existing correction signal.
 *   2. A LineChart of eval-score trend (across recent eval runs).
 *
 * No new correction control — the correction dialog already exists (CDASH-04).
 * PDPA: correctedBy is a uid (not a name/email); shortDocId/shortCorrectedBy are truncated.
 *
 * recharts conventions VERBATIM (HR-3). All strings from dashboard.v2.* (HR-2).
 * Empty state: centered muted p.py-8 with dashboard.v2.noData.
 *
 * References:
 *   - CDASH-08 (coach dashboard v2 panels)
 *   - 05-UI-SPEC.md Surface 1, panel 3
 *   - 05-PATTERNS.md correction-eval-panel.tsx section
 *   - HR-1/HR-2/HR-3
 */

import { useTranslations } from 'next-intl'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export interface CorrectionRow {
  docId: string
  shortDocId: string
  correctedBy: string
  shortCorrectedBy: string
  status: string
  pillar: string
}

export interface EvalTrendPoint {
  suite: string
  score: number
}

export interface CorrectionEvalPanelProps {
  corrections: CorrectionRow[]
  evalTrend: EvalTrendPoint[]
}

/** Map KB doc status to a badge variant. */
function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'published' || status === 'superseded') return 'secondary'
  if (status === 'unpublished') return 'destructive'
  return 'default'
}

export function CorrectionEvalPanel({ corrections, evalTrend }: CorrectionEvalPanelProps) {
  const t = useTranslations('dashboard.v2')

  const hasCorrections = corrections.length > 0
  const hasEvalTrend = evalTrend.length > 0

  return (
    <div className="grid gap-6">
      {/* ── Recent corrections Table ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('correctionEvalTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('correctionEvalSubtitle')}</p>
        </CardHeader>
        <CardContent>
          {!hasCorrections ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('noData')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('correctionColDoc')}</TableHead>
                    <TableHead>{t('correctionColBy')}</TableHead>
                    <TableHead>{t('correctionColStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corrections.map((row) => (
                    <TableRow key={row.docId}>
                      <TableCell className="font-mono text-xs">{row.shortDocId}</TableCell>
                      <TableCell className="font-mono text-xs">{row.shortCorrectedBy}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Eval score trend LineChart ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold">{t('evalTrendTitle')}</h3>
        </CardHeader>
        <CardContent>
          {!hasEvalTrend ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('noData')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={evalTrend}
                margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="suite" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  allowDecimals={false}
                  domain={[0, 100]}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
