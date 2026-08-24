'use client'

/**
 * app/[lang]/_components/home-surface.tsx — the Home widget grid (HOME-01).
 *
 * PRESENTATIONAL ONLY. This component renders the per-role Home landing from plain
 * serializable props supplied by the RSC at `app/[lang]/page.tsx` (Wave 4). It does
 * NOT fetch data, query Firestore, or call any Server Action — the RSC composes the
 * EXISTING aggregations (usageRollups, scoped stall/gap counts) and passes them down.
 * No new lazy-cron, no new pipeline (06-CONTEXT lock).
 *
 * Per-role variant (06-UI-SPEC §3 + 06-CONTEXT lock):
 *   - read-only → KPIs (org usage/cost ONLY) + Recent + Quick actions. The Alerts
 *     block is HIDDEN: open-stalls / knowledge-gaps reference agent PII (agentUid).
 *     This is the SAME constraint as Wave 3's per-agent suppression in usage-dashboard.
 *   - senior-coach → downline-scoped KPIs + downline alerts + coach quick links.
 *   - admin → org KPIs + org alerts (counts → links) + all-section quick links.
 *
 * Reuses the usage-dashboard conventions verbatim:
 *   - the stale-watchdog `Alert` ("Showing data from {relative}…") — `shouldRenderStale`.
 *   - the em-dash (`—`) empty-tile pattern — `kpiCell`.
 *   - the `container mx-auto max-w-6xl px-4 py-8` / `grid gap-8` / KPI grid classes.
 *
 * SECURITY (T-06-18): read-only must NEVER be shown the Alerts block. The RSC also
 * never FETCHES stall/gap data for read-only (defense in depth) — this component
 * hides the block as the second layer so no empty placeholder hints at PII data.
 *
 * Requirements: HOME-01.
 */

import Link from 'next/link'
import { RouteProgress } from './route-progress'
import { useTranslations } from 'next-intl'
import type { Role } from '@/src/firebase/auth'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

// ─── Pure, testable decision helpers (no JSX — unit-tested directly) ──────────

/** Which Home blocks render for a role. read-only hides Alerts (PII). */
export function homeBlocksFor(role: Role): {
  keyMetrics: boolean
  alerts: boolean
  recentActivity: boolean
  quickActions: boolean
} {
  return {
    keyMetrics: true,
    // T-06-18: open stalls / knowledge gaps reference agentUid → hidden from read-only.
    alerts: role !== 'read-only',
    recentActivity: true,
    quickActions: true,
  }
}

/** The stale watchdog renders only when both flag + relative label are present. */
export function shouldRenderStale(
  staleWatchdog: boolean,
  latestRollupRelative: string | null | undefined,
): boolean {
  return Boolean(staleWatchdog && latestRollupRelative)
}

/**
 * A KPI tile value: the em-dash (`—`) when there is no data (matches usage-dashboard
 * empty tiles), otherwise the formatted display string.
 */
export function kpiCell(display: string | number, hasData: boolean): string {
  return hasData ? String(display) : '—'
}

// ─── Serializable prop types (from the RSC) ───────────────────────────────────

/** A single KPI tile — label is pre-resolved, value is a display string/number. */
export interface HomeKpi {
  /** i18n key under `home.*` OR a literal label (resolved by the RSC for adminUsage reuse). */
  label: string
  /** The formatted display value (e.g. "1.2k", "42", "85%"). */
  value: string | number
}

/** A quick-action launcher tile (Button-as-Link to an allowed section). */
export interface HomeQuickAction {
  /** Section label (already translated) for the "Open {section}" CTA. */
  label: string
  /** Locale-prefixed href to the existing route (unchanged — never `/admin/`). */
  href: string
}

export interface HomeSurfaceProps {
  role: Role
  lang: string
  /** Whether the rollup window has any data (drives the em-dash empty tiles). */
  hasData: boolean
  /** Org/downline KPI tiles (counts-only — sourced from usageRollups by the RSC). */
  kpis: HomeKpi[]
  /** Alert counts (coach/admin only) — counts → links to Escalations. Omitted for read-only. */
  alerts?: { openStalls: number; knowledgeGaps: number }
  /** Recent-activity summary lines (latest rollup window summary). */
  recentActivity: string[]
  /** Quick-action launcher tiles for the role's allowed sections. */
  quickActions: HomeQuickAction[]
  /** Stale watchdog (reused from usage-dashboard) — true when the latest rollup is stale. */
  staleWatchdog: boolean
  /** Relative age label for the stale watchdog (e.g. "26h ago"). */
  latestRollupRelative?: string | null
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function HomeSurface({
  role,
  lang,
  hasData,
  kpis,
  alerts,
  recentActivity,
  quickActions,
  staleWatchdog,
  latestRollupRelative,
}: HomeSurfaceProps) {
  const t = useTranslations('home')
  const blocks = homeBlocksFor(role)

  const subtitle =
    role === 'admin'
      ? t('subtitleAdmin')
      : role === 'senior-coach'
        ? t('subtitleCoach')
        : t('subtitleReadOnly')

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {/* ── Stale watchdog (reused verbatim from usage-dashboard) ────────── */}
      {shouldRenderStale(staleWatchdog, latestRollupRelative) && (
        <Alert variant="default" className="mb-8">
          <AlertDescription>
            {t('stale', { relative: latestRollupRelative as string })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8">
        {/* ── Section A — Key Metrics (KPI grid; em-dash when empty) ─────── */}
        {blocks.keyMetrics && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t('keyMetricsTitle')}</h2>
            {!hasData ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('empty')}
              </p>
            ) : (
              <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
                {kpis.map((kpi) => (
                  <Card key={kpi.label}>
                    <CardHeader>
                      <p className="text-xs text-muted-foreground">{kpi.label}</p>
                      <span className="text-2xl font-bold">
                        {kpiCell(kpi.value, hasData)}
                      </span>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Section B — Alerts (coach/admin ONLY — read-only hides PII) ── */}
        {blocks.alerts && alerts && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t('alertsTitle')}</h2>
            <Card>
              <CardContent className="grid gap-6 grid-cols-2 pt-4">
                <Link
                  href={`/${lang}/dashboard#stalls`}
                  className="flex flex-col rounded-lg border px-4 py-3 hover:bg-accent"
                >
                  <span className="text-2xl font-bold">{alerts.openStalls}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('alertsTitle')}
                  </span>
                  <RouteProgress />
                </Link>
                <Link
                  href={`/${lang}/dashboard`}
                  className="flex flex-col rounded-lg border px-4 py-3 hover:bg-accent"
                >
                  <span className="text-2xl font-bold">{alerts.knowledgeGaps}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('recentActivityTitle')}
                  </span>
                  <RouteProgress />
                </Link>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Section C — Recent activity (rollup window summary) ───────── */}
        {blocks.recentActivity && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">
              {t('recentActivityTitle')}
            </h2>
            <Card>
              <CardContent className="pt-4">
                {recentActivity.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {recentActivity.map((line, i) => (
                      <li key={i} className="text-muted-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Section D — Quick actions (Button-as-Link launcher tiles) ─── */}
        {blocks.quickActions && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t('quickActionsTitle')}</h2>
            <div className="grid gap-6 grid-cols-2 md:grid-cols-3">
              {quickActions.map((action) => (
                <Button
                  key={action.href}
                  asChild
                  variant="outline"
                  className="h-auto justify-start py-4"
                >
                  <Link href={action.href}>
                    {`Open ${action.label}`}
                    {/* quick-kayinleong-048: these tiles are the main mobile nav path
                        and had no pending feedback at all. */}
                    <RouteProgress />
                  </Link>
                </Button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
