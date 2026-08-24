'use client'

/**
 * app/[lang]/_components/charts/chart-canvas.tsx — the ONLY module in the app that
 * imports `recharts`.
 *
 * ⚡ PERF (quick-kayinleong-046). recharts is a 375 KB (uncompressed) client chunk and
 * was imported eagerly by SIX chart islands, making /[lang]/(coach)/dashboard the
 * heaviest route in the app (1477 KB) and /[lang]/(admin)/usage the second (1174 KB).
 * Charts are below-the-fold decoration for aggregates that are already rendered as
 * numbers, so they are a natural lazy boundary.
 *
 * Funnelling every chart through this single module means there is exactly ONE dynamic
 * import boundary (`./lazy-chart`) to keep recharts out of the initial bundle. If a
 * second module imports `recharts` directly, the chunk becomes eager again on that
 * route and the win is lost.
 *
 * ⚠️ NEVER import this file directly from a panel. Import `./lazy-chart` instead —
 * that is the `next/dynamic` boundary. A static import of this module re-eagerises
 * recharts.
 *
 * Chart conventions are the VERBATIM house conventions (HR-3) previously duplicated in
 * all six panels — they are now defaults here so they cannot drift:
 *   - ResponsiveContainer width="100%" height={220}
 *   - margin={{ top: 4, right: 8, left: -16, bottom: 4 }}
 *   - tick fontSize: 12, YAxis allowDecimals={false}
 *   - primary series #6366f1 / secondary #f59e0b
 *   - Bar radius [4, 4, 0, 0]; Line type="monotone" strokeWidth={2} dot={{ r: 4 }}
 *   - LineChart carries a CartesianGrid ("3 3", #f0f0f0); BarChart does not.
 *
 * MUST stay 'use client' — recharts uses browser APIs and cannot render in a Server
 * Component (Pitfall 7 / RESEARCH §recharts under React 19).
 */

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

import { CHART_HEIGHT, type ChartCanvasProps } from './chart-canvas-shared'

const CHART_MARGIN = { top: 4, right: 8, left: -16, bottom: 4 } as const
const TICK = { fontSize: 12 } as const

export function BarChartCanvas({
  data,
  xKey,
  series,
  height = CHART_HEIGHT,
  yUnit,
  yDomain,
}: ChartCanvasProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data as object[]} margin={CHART_MARGIN}>
        <XAxis dataKey={xKey} tick={TICK} />
        <YAxis
          tick={TICK}
          allowDecimals={false}
          unit={yUnit}
          domain={yDomain ? [yDomain[0], yDomain[1]] : undefined}
        />
        <Tooltip />
        {series.map((s) => (
          <Bar key={s.dataKey} dataKey={s.dataKey} fill={s.color} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function LineChartCanvas({
  data,
  xKey,
  series,
  height = CHART_HEIGHT,
  yUnit,
  yDomain,
  showLegend = false,
}: ChartCanvasProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data as object[]} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey={xKey} tick={TICK} />
        <YAxis
          tick={TICK}
          allowDecimals={false}
          unit={yUnit}
          domain={yDomain ? [yDomain[0], yDomain[1]] : undefined}
        />
        <Tooltip />
        {showLegend ? <Legend /> : null}
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 4 }}
            strokeDasharray={s.dashed ? '5 5' : undefined}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
