'use client'

/**
 * app/[lang]/(admin)/usage/usage-dashboard.tsx — Admin usage+cost analytics island.
 *
 * MUST be a 'use client' component — recharts uses browser APIs and cannot render
 * in a Server Component (Pitfall 7 / HR-3).
 *
 * Fed plain serializable props from the RSC parent (page.tsx). The scope is
 * decided server-side (admin = org-wide, HR-4). This component ONLY displays;
 * it never re-queries Firestore or calls any action.
 *
 * RO-01 (Wave 3 / 06-04): a `read-only` analytics stakeholder also reaches this
 * surface. It sees the ORG usage/cost view (KPIs, volume trend, pillar spend) but
 * NOT the per-AGENT breakdown table — that surfaces agent UIDs (CONTEXT: read-only
 * sees org usage/cost only, no per-agent, no PII). The RSC already empties
 * perAgentRows for read-only; this component additionally hides the whole section
 * so no empty-state placeholder hints at per-agent data.
 *
 * Charts follow the VERBATIM metrics-panel.tsx recharts conventions (HR-3):
 *   - ResponsiveContainer width="100%" height={220}
 *   - margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
 *   - tick fontSize: 12
 *   - primary series #6366f1 / secondary #f59e0b
 *   - Bar radius [4, 4, 0, 0]
 *
 * Empty state: centered muted p.py-8 with adminUsage.noRollups copy (HR-3, expected
 * on a fresh deploy before the lazy-cron usage-rollup window fires).
 *
 * References:
 *   - ADMIN-08 (usage analytics), QUAL-08 (cost view — single dashboard, HR-7)
 *   - 05-UI-SPEC.md Surface 4 (KPIs, states, window Select)
 *   - 05-PATTERNS.md section usage-dashboard.tsx
 *   - HR-1/HR-2/HR-3/HR-4/HR-7
 */

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { Role } from '@/src/firebase/auth'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ─── Serializable prop types (from RSC page) ──────────────────────────────────

export interface VolumeTrendPoint {
  day: string
  count: number
}

export interface TokenByPillarPoint {
  pillar: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export interface AgentRow {
  uid: string
  shortUid: string
  inputTokens: number
  outputTokens: number
  reads: number
  writes: number
}

export interface UsageDashboardProps {
  windowDays: number
  activeAgents: number
  totalMsgCount: number
  totalInputTokens: number
  totalOutputTokens: number
  cacheHitRate: number
  avgResolutionTimeMs: number | null
  avgEscalationRate: number | null
  totalReads: number
  totalWrites: number
  volumeTrend: VolumeTrendPoint[]
  tokenByPillar: TokenByPillarPoint[]
  perAgentRows: AgentRow[]
  staleWatchdog: boolean
  latestRollupRelative: string | null
  lang: string
  /**
   * Verified role of the viewer (RO-01). Drives the read-only variant: a
   * `read-only` viewer sees org aggregates but NOT the per-agent breakdown.
   */
  role: Role
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  const min = Math.round(ms / 60000)
  if (min < 1) return '<1 min'
  return `${min} min`
}

function kNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UsageDashboard({
  windowDays,
  activeAgents,
  totalMsgCount,
  totalInputTokens,
  totalOutputTokens,
  cacheHitRate,
  avgResolutionTimeMs,
  avgEscalationRate,
  totalReads,
  totalWrites,
  volumeTrend,
  tokenByPillar,
  perAgentRows,
  staleWatchdog,
  latestRollupRelative,
  lang,
  role,
}: UsageDashboardProps) {
  const t = useTranslations('adminUsage')
  const router = useRouter()

  const hasData = totalMsgCount > 0
  // RO-01: the per-agent breakdown surfaces agent UIDs — hidden from read-only.
  const showPerAgent = role !== 'read-only'

  // Window switch re-navigates so RSC re-fetches the correct window
  function handleWindowChange(value: string) {
    router.push(`/${lang}/usage?window=${value}`)
  }

  return (
    <div className="grid gap-8">
      {/* ── Stale watchdog alert ─────────────────────────────────────────── */}
      {staleWatchdog && latestRollupRelative && (
        <Alert variant="default">
          <AlertDescription>
            {t('staleWatchdog', { relative: latestRollupRelative })}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Window selector + subtitle ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {hasData ? `${activeAgents} agent(s), ${kNum(totalMsgCount)} messages` : ''}
        </p>
        <Select
          value={String(windowDays)}
          onValueChange={handleWindowChange}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('windowLast7')}</SelectItem>
            <SelectItem value="30">{t('windowLast30')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── KPI stat tiles ───────────────────────────────────────────────── */}
      <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
        {/* Active agents */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('kpiActiveAgents')}</p>
            <span className="text-2xl font-bold">{hasData ? activeAgents : '—'}</span>
          </CardHeader>
        </Card>

        {/* Message volume */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('kpiMessageVolume')}</p>
            <span className="text-2xl font-bold">{hasData ? kNum(totalMsgCount) : '—'}</span>
          </CardHeader>
        </Card>

        {/* Resolution time */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('kpiResolutionTime')}</p>
            <span className="text-2xl font-bold">{fmtMs(avgResolutionTimeMs)}</span>
          </CardHeader>
        </Card>

        {/* Escalation rate */}
        <Card>
          <CardHeader>
            <p className="text-xs text-muted-foreground">{t('kpiEscalationRate')}</p>
            <span className="text-2xl font-bold">
              {avgEscalationRate != null ? pct(avgEscalationRate) : '—'}
            </span>
          </CardHeader>
        </Card>
      </div>

      {/* ── Volume trend LineChart ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('volumeTrendTitle')}</h2>
        <Card>
          <CardContent className="pt-4">
            {!hasData ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('noRollups')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={volumeTrend}
                  margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Token spend by pillar BarChart ──────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('tokenSpendTitle')}</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold">{t('byPillarLabel')}</h3>
            </CardHeader>
            <CardContent>
              {!hasData ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('noRollups')}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={tokenByPillar}
                    margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
                  >
                    <XAxis dataKey="pillar" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="inputTokens" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outputTokens" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Cache hit + read/write KPI tiles */}
          <div className="grid gap-6 grid-cols-2 content-start">
            <Card>
              <CardHeader>
                <p className="text-xs text-muted-foreground">{t('cacheHitLabel')}</p>
                <span className="text-2xl font-bold">{hasData ? pct(cacheHitRate) : '—'}</span>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <p className="text-xs text-muted-foreground">{t('readWriteTitle')}</p>
                <span className="text-2xl font-bold">
                  {hasData ? `${kNum(totalReads)} / ${kNum(totalWrites)}` : '—'}
                </span>
              </CardHeader>
            </Card>
            <Card className="col-span-2">
              <CardHeader>
                <p className="text-xs text-muted-foreground">{t('colTokensIn')} / {t('colTokensOut')}</p>
                <span className="text-2xl font-bold">
                  {hasData ? `${kNum(totalInputTokens)} / ${kNum(totalOutputTokens)}` : '—'}
                </span>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Per-agent breakdown Table (admin only — surfaces agent UIDs; RO-01) ── */}
      {showPerAgent && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('byAgentTitle')}</h2>
          <Card>
            <CardContent className="pt-4">
              {!hasData ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('noRollups')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('colAgent')}</TableHead>
                        <TableHead className="text-right">{t('colTokensIn')}</TableHead>
                        <TableHead className="text-right">{t('colTokensOut')}</TableHead>
                        <TableHead className="text-right">{t('colReads')}</TableHead>
                        <TableHead className="text-right">{t('colWrites')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {perAgentRows.map((row) => (
                        <TableRow key={row.uid}>
                          <TableCell className="font-mono text-xs">{row.shortUid}</TableCell>
                          <TableCell className="text-right">{kNum(row.inputTokens)}</TableCell>
                          <TableCell className="text-right">{kNum(row.outputTokens)}</TableCell>
                          <TableCell className="text-right">{kNum(row.reads)}</TableCell>
                          <TableCell className="text-right">{kNum(row.writes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
