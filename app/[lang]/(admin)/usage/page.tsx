/**
 * app/[lang]/(admin)/usage/page.tsx
 *
 * Admin usage+cost analytics dashboard (ADMIN-08 + QUAL-08, HR-7).
 *
 * RSC shell that:
 *   1. Role gate: admin + read-only (analytics). Both the page gate AND this
 *      backing read path are widened together (06-RESEARCH Pitfall 3) — read-only
 *      sees the ORG usage/cost view, NOT empty/Forbidden. Reads run server-side
 *      after the gate, so widening the gate widens the read path (there is no
 *      separate Server Action here — the RSC reads usageRollups via Admin SDK).
 *   2. Reads usageRollups ONLY — NEVER raw usageEvents (HR-7).
 *   3. Computes org KPIs server-side; passes plain serializable props to the island.
 *   4. Window filter: default last-7-days (URL searchParam ?window=7|30).
 *
 * Security:
 *   - Role gate: admin + read-only (RO-01). Other roles redirected (admin/coach
 *     fall through the layout; a verified-but-disallowed role lands on Home).
 *   - usageRollupsRef() is Admin-SDK only (client write: if false in rules).
 *   - No PII — rollups are counts-only by schema (05-02). The per-AGENT breakdown
 *     (which surfaces agent UIDs) is HIDDEN from read-only (CONTEXT: read-only sees
 *     org usage/cost only — no per-agent, no PII); the role is passed to the island.
 *
 * References:
 *   - ADMIN-08 (usage analytics), QUAL-08 (cost view)
 *   - 05-UI-SPEC.md Surface 4 (states: Empty / Populated / staleWatchdog)
 *   - 05-PATTERNS.md section usage/page.tsx
 *   - 06-UI-SPEC.md §2 (read-only sees org usage/cost only) · 06-RESEARCH Pitfall 3
 *   - HR-7 (rollups only, never raw events)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { usageRollupsRef } from '@/src/firebase/collections'
import { getOrgDaysToFirstClose } from '@/src/dashboard/queries'
import { dayKey } from '@/src/usage/types'
import { UsageDashboard } from './usage-dashboard'
import type { UsageDashboardProps } from './usage-dashboard'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ window?: string }>
}

export async function generateMetadata() {
  return {
    title: 'Usage & Cost Analytics — D2 Admin',
  }
}

/**
 * Compute the Asia/Kuala_Lumpur day-key string N days ago.
 * WR-04 fix: reuse dayKey() (which formats in Asia/KL) rather than UTC toISOString(),
 * so the window boundary matches the timezone used by the rollup keys.
 */
function nDaysAgo(n: number): string {
  return dayKey(new Date(Date.now() - n * 86400000))
}

/**
 * ⚡ PERF (quick-kayinleong-046) — safety cap for the usageRollups window scan.
 *
 * `usageRollups` is keyed `${day}__${uid}__${pillar}`, so a windowed scan grows as
 * days x agents x pillars and had NO `limit()` at all: a 7-day window over 100 agents
 * is already ~2100 documents read and summed in JS on EVERY page load, and it is
 * unbounded by design as the agent roster grows.
 *
 * The cap is deliberately sized ABOVE any realistic roster (a 250-agent ceiling, 2.5x
 * the documented 100-agent target) so it never truncates in practice — it exists to
 * bound the worst case, not to change what this surface reports. `orderBy('day','asc')`
 * is kept exactly as it was so the result set is byte-identical below the cap.
 *
 * If the cap ever binds, the aggregates below become PARTIAL (the newest days are the
 * ones dropped, because the scan is ascending) and the call site logs a warning. The
 * real fix is to pre-aggregate an ORG-LEVEL daily doc inside the existing usage-rollup
 * job (src/jobs/runDueJobs.ts) so this page reads O(days) instead of O(days x agents x
 * pillars) — that is a separate change and is NOT done here.
 */
const ROLLUP_PILLARS = 3          // coach | finder | reply — one rollup doc per pillar/day/uid
const ROLLUP_AGENT_CEILING = 250  // 2.5x the 100-agent target this window was sized for

function rollupScanLimit(windowDays: number): number {
  return windowDays * ROLLUP_PILLARS * ROLLUP_AGENT_CEILING
}

export default async function UsagePage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { window: windowParam } = await searchParams

  // ── Analytics gate (layer 2; layout.tsx is layer 1) ──────────────────────
  // RO-01 / Pitfall 3: admit admin + read-only. This single gate covers BOTH the
  // page render AND the usageRollups read below (the RSC reads after the gate).
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/usage', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/${lang}/sign-in`)
    }
    throw err
  }

  if (user.role !== 'admin' && user.role !== 'read-only') {
    redirect(`/${lang}`)
  }

  // ── Window selection (default 7 days) ────────────────────────────────────
  const windowDays = windowParam === '30' ? 30 : 7
  const windowStart = nDaysAgo(windowDays)

  // ── Read usageRollups (NEVER raw usageEvents — HR-7) ─────────────────────
  // Filter to the selected window (inclusive on the start day).
  let rollupDocs: Array<{
    day: string
    uid: string
    pillar: string
    msgCount: number
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    cacheCreationInputTokens: number
    reads?: number
    writes?: number
    resolutionTimeMs?: number
    escalationRate?: number
    updatedAt?: Date
  }> = []

  let latestUpdatedAt: Date | null = null

  try {
    const scanLimit = rollupScanLimit(windowDays)
    const snap = await usageRollupsRef()
      .where('day', '>=', windowStart)
      .orderBy('day', 'asc')
      .limit(scanLimit)
      .get()
    if (snap.size >= scanLimit) {
      // Counts only — never PII. Surfaced instead of silently under-reporting a total.
      console.warn(
        `[admin/usage] usageRollups scan hit its safety cap (${scanLimit} docs, ${windowDays}d window). The KPIs, volume trend and per-agent rows below are PARTIAL — pre-aggregate an org-level daily rollup in the usage-rollup job.`,
      )
    }

    rollupDocs = snap.docs.map((d) => {
      const data = d.data()
      const updatedAt = data.updatedAt instanceof Date ? data.updatedAt : undefined
      if (updatedAt && (!latestUpdatedAt || updatedAt > latestUpdatedAt)) {
        latestUpdatedAt = updatedAt
      }
      return {
        day: data.day,
        uid: data.uid,
        pillar: data.pillar,
        msgCount: data.msgCount,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cachedInputTokens: data.cachedInputTokens,
        cacheCreationInputTokens: data.cacheCreationInputTokens,
        reads: data.reads,
        writes: data.writes,
        resolutionTimeMs: data.resolutionTimeMs,
        escalationRate: data.escalationRate,
        updatedAt,
      }
    })
  } catch {
    // Non-blocking — show empty state if read fails
    rollupDocs = []
  }

  // ── Compute org KPIs (server-side — plain scalars, serializable) ──────────
  const activeAgentUids = new Set<string>()
  let totalMsgCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCachedInputTokens = 0
  let totalReads = 0
  let totalWrites = 0
  const resolutionTimeSamples: number[] = []
  const escalationRateSamples: number[] = []

  for (const doc of rollupDocs) {
    activeAgentUids.add(doc.uid)
    totalMsgCount += doc.msgCount
    totalInputTokens += doc.inputTokens
    totalOutputTokens += doc.outputTokens
    totalCachedInputTokens += doc.cachedInputTokens
    totalReads += doc.reads ?? 0
    totalWrites += doc.writes ?? 0
    if (doc.resolutionTimeMs != null) resolutionTimeSamples.push(doc.resolutionTimeMs)
    if (doc.escalationRate != null) escalationRateSamples.push(doc.escalationRate)
  }

  const activeAgents = activeAgentUids.size
  const cacheHitRate =
    totalInputTokens + totalCachedInputTokens > 0
      ? totalCachedInputTokens / (totalInputTokens + totalCachedInputTokens)
      : 0
  const avgResolutionTimeMs =
    resolutionTimeSamples.length > 0
      ? resolutionTimeSamples.reduce((a, b) => a + b, 0) / resolutionTimeSamples.length
      : null
  const avgEscalationRate =
    escalationRateSamples.length > 0
      ? escalationRateSamples.reduce((a, b) => a + b, 0) / escalationRateSamples.length
      : null

  // ── Volume trend by day (for LineChart) ──────────────────────────────────
  const dayMap = new Map<string, number>()
  for (const doc of rollupDocs) {
    dayMap.set(doc.day, (dayMap.get(doc.day) ?? 0) + doc.msgCount)
  }
  const volumeTrend = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }))

  // ── Token spend by pillar (for BarChart) ─────────────────────────────────
  const pillarMap = new Map<string, { inputTokens: number; outputTokens: number; cachedTokens: number }>()
  for (const doc of rollupDocs) {
    const existing = pillarMap.get(doc.pillar) ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
    existing.inputTokens += doc.inputTokens
    existing.outputTokens += doc.outputTokens
    existing.cachedTokens += doc.cachedInputTokens
    pillarMap.set(doc.pillar, existing)
  }
  const tokenByPillar = Array.from(pillarMap.entries()).map(([pillar, tokens]) => ({
    pillar,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cachedTokens: tokens.cachedTokens,
  }))

  // ── Per-agent rows (for Table) ────────────────────────────────────────────
  const agentMap = new Map<string, {
    uid: string
    inputTokens: number
    outputTokens: number
    reads: number
    writes: number
    msgCount: number
  }>()
  for (const doc of rollupDocs) {
    const existing = agentMap.get(doc.uid) ?? {
      uid: doc.uid,
      inputTokens: 0,
      outputTokens: 0,
      reads: 0,
      writes: 0,
      msgCount: 0,
    }
    existing.inputTokens += doc.inputTokens
    existing.outputTokens += doc.outputTokens
    existing.reads += doc.reads ?? 0
    existing.writes += doc.writes ?? 0
    existing.msgCount += doc.msgCount
    agentMap.set(doc.uid, existing)
  }
  const perAgentRows = Array.from(agentMap.values())
    .sort((a, b) => b.msgCount - a.msgCount)
    .map((row) => ({
      uid: row.uid,
      shortUid: row.uid.length > 8 ? `…${row.uid.slice(-8)}` : row.uid,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reads: row.reads,
      writes: row.writes,
    }))

  // ── Stale watchdog: latest rollup older than window end? ─────────────────
  const now = new Date()
  let staleWatchdog = false
  let latestRollupRelative: string | null = null
  if (latestUpdatedAt) {
    const msSince = now.getTime() - (latestUpdatedAt as Date).getTime()
    const hoursSince = msSince / (1000 * 60 * 60)
    // Flag stale if no rollup in the last 25h (1h buffer on the daily window)
    if (hoursSince > 25) {
      staleWatchdog = true
      const h = Math.round(hoursSince)
      latestRollupRelative = `${h}h ago`
    }
  }

  // ── Days-to-first-close org aggregate (CLOSE-02 / D-22 — admin only) ──────
  // Read-time computation over agentProfiles; em-dash when no close recorded.
  // read-only never reaches this surface section (the nav entry is admin-only,
  // D-24) — only compute the aggregate for an admin viewer.
  let daysToFirstClose: { avg: number | null; median: number | null; closedCount: number } = {
    avg: null,
    median: null,
    closedCount: 0,
  }
  if (user.role === 'admin') {
    try {
      daysToFirstClose = await getOrgDaysToFirstClose()
    } catch {
      daysToFirstClose = { avg: null, median: null, closedCount: 0 }
    }
  }

  const props: UsageDashboardProps = {
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
    // RO-01 / CONTEXT: read-only sees ORG usage/cost only — never the per-agent
    // breakdown (it surfaces agent UIDs). Suppress the rows server-side so they
    // are never serialized to a read-only client; the org aggregates still render.
    perAgentRows: user.role === 'read-only' ? [] : perAgentRows,
    staleWatchdog,
    latestRollupRelative,
    daysToFirstClose,
    lang,
    role: user.role,
  }

  const t = await getTranslations('adminUsage')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      {/* Dashboard island — passes all serializable props */}
      <UsageDashboard {...props} />
    </div>
  )
}
