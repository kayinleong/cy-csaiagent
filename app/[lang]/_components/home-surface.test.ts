/**
 * app/[lang]/_components/home-surface.test.ts — Home widget grid, per-role variant (HOME-01).
 *
 * Wave 4 (06-06) turns `/${lang}` into the Home landing RSC; `<HomeSurface>` is the
 * presentational widget grid it renders. This logic-only test asserts the prop-driven
 * BRANCH DECISIONS without rendering JSX (@testing-library/react is NOT installed —
 * 06-PATTERNS.md "No Analog Found"). The component exports a PURE `homeBlocksFor(role)`
 * helper returning which blocks render for a role, plus `shouldRenderStale(...)` and
 * `kpiCell(...)` so the per-role / stale / empty decisions are unit-testable.
 *
 * Per-role variant (06-UI-SPEC §3, 06-CONTEXT lock):
 *   - read-only → KPIs + Recent + Quick actions; the Alerts block is HIDDEN
 *     (alerts reference agent PII — stalls/gaps carry agentUid).
 *   - senior-coach / admin → all four blocks (KPIs + Alerts + Recent + Quick actions).
 *   - stale watchdog renders only when `staleWatchdog && latestRollupRelative`.
 *   - empty rollups → KPI tiles render `—` (em-dash), matching usage-dashboard.tsx.
 *
 * Requirements: HOME-01. Threat: T-06-18 (read-only never sees PII-referencing alerts).
 */

import { describe, it, expect } from 'vitest'
import {
  homeBlocksFor,
  shouldRenderStale,
  kpiCell,
} from './home-surface'

describe('HomeSurface — per-role block visibility (HOME-01, T-06-18)', () => {
  it('read-only sees KPIs + Recent + Quick actions but NOT Alerts (PII)', () => {
    const blocks = homeBlocksFor('read-only')
    expect(blocks.keyMetrics).toBe(true)
    expect(blocks.alerts).toBe(false) // alerts reference agent PII — hidden for read-only
    expect(blocks.recentActivity).toBe(true)
    expect(blocks.quickActions).toBe(true)
  })

  it('senior-coach sees all four blocks (downline-scoped)', () => {
    const blocks = homeBlocksFor('senior-coach')
    expect(blocks.keyMetrics).toBe(true)
    expect(blocks.alerts).toBe(true)
    expect(blocks.recentActivity).toBe(true)
    expect(blocks.quickActions).toBe(true)
  })

  it('admin sees all four blocks (org-wide)', () => {
    const blocks = homeBlocksFor('admin')
    expect(blocks.keyMetrics).toBe(true)
    expect(blocks.alerts).toBe(true)
    expect(blocks.recentActivity).toBe(true)
    expect(blocks.quickActions).toBe(true)
  })

  it('only read-only hides the Alerts block (admin/coach both show it)', () => {
    expect(homeBlocksFor('read-only').alerts).toBe(false)
    expect(homeBlocksFor('admin').alerts).toBe(true)
    expect(homeBlocksFor('senior-coach').alerts).toBe(true)
  })
})

describe('HomeSurface — stale watchdog (reuse usage-dashboard pattern)', () => {
  it('renders the stale Alert only when staleWatchdog AND latestRollupRelative are set', () => {
    expect(shouldRenderStale(true, '26h ago')).toBe(true)
    expect(shouldRenderStale(true, null)).toBe(false)
    expect(shouldRenderStale(false, '26h ago')).toBe(false)
    expect(shouldRenderStale(false, null)).toBe(false)
  })
})

describe('HomeSurface — empty KPI rendering (em-dash, matches usage-dashboard)', () => {
  it('renders the em-dash for an empty/zero KPI and the formatted value otherwise', () => {
    // empty (no data yet) → em-dash like usage-dashboard tiles
    expect(kpiCell(0, false)).toBe('—')
    expect(kpiCell(42, false)).toBe('—')
    // has data → the provided display string
    expect(kpiCell('1.2k', true)).toBe('1.2k')
    expect(kpiCell(42, true)).toBe('42')
  })
})
