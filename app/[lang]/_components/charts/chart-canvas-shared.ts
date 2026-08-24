/**
 * app/[lang]/_components/charts/chart-canvas-shared.tsx — recharts-FREE constants and
 * types shared between the lazy boundary (`./lazy-chart`) and the canvas
 * (`./chart-canvas`).
 *
 * ⚡ PERF (quick-kayinleong-046). This file exists so `lazy-chart.tsx` can re-export the
 * palette / height / prop types WITHOUT statically importing `chart-canvas.tsx` — a
 * value import of that module would pull `recharts` (375 KB) back into the initial
 * bundle and silently undo the lazy boundary.
 *
 * ⚠️ NEVER import `recharts` from this file.
 */

/** House chart palette — primary / secondary (HR-3). */
export const CHART_PRIMARY = '#6366f1'
export const CHART_SECONDARY = '#f59e0b'

/** Default chart height. The lazy placeholder uses the same value (no layout shift). */
export const CHART_HEIGHT = 220

/** One plotted series (a `<Bar>` or a `<Line>`). */
export interface ChartSeries {
  /** Key on each data row holding the numeric value. */
  dataKey: string
  /** Stroke (line) / fill (bar) colour. Use CHART_PRIMARY / CHART_SECONDARY. */
  color: string
  /** LineChart only — render as a dashed comparison series ("5 5"). */
  dashed?: boolean
}

export interface ChartCanvasProps {
  /** Plain serializable rows aggregated server-side. */
  data: readonly object[]
  /** Key on each row used for the X axis category. */
  xKey: string
  /** One or more series to plot. */
  series: readonly ChartSeries[]
  /** Chart height in px. Defaults to CHART_HEIGHT; must match the lazy placeholder. */
  height?: number
  /** Y-axis unit suffix (e.g. '%'). */
  yUnit?: string
  /** Fixed Y-axis domain (e.g. [0, 100] for a score). */
  yDomain?: readonly [number, number]
  /** Render the recharts <Legend> (LineChart multi-series only). */
  showLegend?: boolean
}
