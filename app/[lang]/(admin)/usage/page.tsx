/**
 * app/[lang]/(admin)/usage/page.tsx
 *
 * Admin usage+cost analytics dashboard (ADMIN-08 + QUAL-08, HR-7).
 *
 * RSC shell that:
 *   1. Three-layer admin gate (layout → page → Server Action) — (HR-12).
 *   2. Reads usageRollups ONLY — NEVER raw usageEvents (HR-7).
 *   3. Computes org KPIs server-side; passes plain serializable props to the island.
 *   4. Window filter: default last-7-days (URL searchParam ?window=7|30).
 *
 * Security:
 *   - Role gate: admin only. Non-admins redirected to chat.
 *   - usageRollupsRef() is Admin-SDK only (client write: if false in rules).
 *   - No PII — rollups are counts-only by schema (05-02).
 *
 * References:
 *   - ADMIN-08 (usage analytics), QUAL-08 (cost view)
 *   - 05-UI-SPEC.md Surface 4 (states: Empty / Populated / staleWatchdog)
 *   - 05-PATTERNS.md section usage/page.tsx
 *   - HR-7 (rollups only, never raw events)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { usageRollupsRef } from '@/src/firebase/collections'
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

/** Compute ISO date string N days ago (Asia/KL for consistency with rollup keys). */
function nDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export default async function UsagePage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { window: windowParam } = await searchParams

  // ── Admin gate (layer 2 of 3; layout.tsx is layer 1) ─────────────────────
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

  if (user.role !== 'admin') {
    redirect(`/${lang}/chat`)
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
    const snap = await usageRollupsRef()
      .where('day', '>=', windowStart)
      .orderBy('day', 'asc')
      .get()

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
  let resolutionTimeSamples: number[] = []
  let escalationRateSamples: number[] = []

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
  let staleWatchdog = false
  let latestRollupRelative: string | null = null
  if (latestUpdatedAt) {
    const msSince = Date.now() - (latestUpdatedAt as Date).getTime()
    const hoursSince = msSince / (1000 * 60 * 60)
    // Flag stale if no rollup in the last 25h (1h buffer on the daily window)
    if (hoursSince > 25) {
      staleWatchdog = true
      const h = Math.round(hoursSince)
      latestRollupRelative = `${h}h ago`
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
    perAgentRows,
    staleWatchdog,
    latestRollupRelative,
    lang,
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
