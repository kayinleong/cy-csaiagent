'use client'

/**
 * app/[lang]/_components/charts/lazy-chart.tsx — the `next/dynamic` boundary for recharts.
 *
 * ⚡ PERF (quick-kayinleong-046). Before this file there was ZERO `next/dynamic` /
 * `React.lazy` anywhere in the app, so the 375 KB recharts chunk was part of the FIRST
 * LOAD of /[lang]/(coach)/dashboard (1477 KB total) and /[lang]/(admin)/usage (1174 KB).
 * Every chart is below the fold and duplicates aggregates that are already on screen as
 * KPI numbers, so deferring them costs nothing perceptually.
 *
 * `ssr: false` is required and safe:
 *   - REQUIRED because recharts' ResponsiveContainer measures the DOM; it renders an
 *     empty container during SSR anyway, so nothing visible is lost.
 *   - ALLOWED because this module is 'use client'. Next 16 rejects `ssr: false` inside a
 *     Server Component (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
 *     Panels importing these wrappers are all 'use client' islands already.
 *
 * The `loading` placeholder is a plain block of the SAME height as the chart
 * (CHART_HEIGHT), so swapping the real chart in causes NO layout shift. It carries no
 * copy, so it needs no i18n key.
 *
 * Panels import ONLY from this module — never from `./chart-canvas` (a static import of
 * that module would put recharts back in the initial bundle).
 */

import dynamic from 'next/dynamic'
import { CHART_HEIGHT } from './chart-canvas-shared'

export { CHART_PRIMARY, CHART_SECONDARY, CHART_HEIGHT } from './chart-canvas-shared'
export type { ChartSeries } from './chart-canvas-shared'

/**
 * Fixed-height, copy-free skeleton. Height matches CHART_HEIGHT exactly so the real
 * chart replaces it in place (no CLS). Decorative → hidden from assistive tech.
 */
function ChartPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="w-full rounded-md bg-muted/40"
      style={{ height: CHART_HEIGHT }}
    />
  )
}

/** Lazily-loaded BarChart. Same props as BarChartCanvas. */
export const LazyBarChart = dynamic(
  () => import('./chart-canvas').then((m) => m.BarChartCanvas),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

/** Lazily-loaded LineChart. Same props as LineChartCanvas. */
export const LazyLineChart = dynamic(
  () => import('./chart-canvas').then((m) => m.LineChartCanvas),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)
