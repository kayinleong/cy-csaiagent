// app/[lang]/page.tsx — locale-scoped landing = the Home surface RSC (HOME-01).
//
// Wave 4 (06-06) turns this from a pure redirect into the Home LANDING for the
// three console roles (read-only | senior-coach | admin), superseding the Wave-3
// interim that redirected read-only → /usage. new-agent still redirects to chat;
// no/invalid session → sign-in.
//
// Home COMPOSES EXISTING aggregations only (06-CONTEXT lock):
//   - usageRollups (the pre-aggregated rollup collection, NEVER the raw per-event
//     telemetry — HR-7) for the org/downline KPIs + the stale watchdog, computed
//     exactly as app/[lang]/(admin)/usage/page.tsx does.
//   - for coach/admin ONLY: open-stall + knowledge-gap COUNTS via Firestore count()
//     aggregation (never fetch-all) — the same scoped pattern as
//     (coach)/dashboard/actions.ts (adminAll vs seniorCoachId).
// No new lazy-cron job, no new collection, no write. Home is strictly read-only.
//
// SECURITY:
//   - role from the VERIFIED token (requireUser → verifyIdToken) only (T-06-19).
//   - read-only NEVER triggers a PII-scoped read: its props come ONLY from org
//     usageRollups (counts-only by schema); the stall/gap count() reads (which
//     filter on seniorCoachId/agentUid scope) run for coach/admin ONLY, and the
//     HomeSurface hides the Alerts block for read-only (T-06-18, defense in depth).
//
// Next 16: params is a Promise; cookies() is async — await both. redirect() throws
// NEXT_REDIRECT, so resolve the role INSIDE try/catch but call redirect() OUTSIDE
// it (Pitfall 6) — a redirect thrown inside the catch would be swallowed.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireUser, type Role } from '@/src/firebase/auth'
import { usageRollupsRef, escalationsRef, knowledgeGapsRef } from '@/src/firebase/collections'
import { dayKey } from '@/src/usage/types'
import {
  HomeSurface,
  type HomeKpi,
  type HomeQuickAction,
} from './_components/home-surface'
import { ConsoleShell } from './_components/console-shell'

/** Compute the Asia/Kuala_Lumpur day-key string N days ago (matches rollup keys). */
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

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function kNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** A minimal count()-able query view of an Admin-SDK collection ref. */
type CountableQuery = {
  where: (field: string, op: string, value: unknown) => CountableQuery
  count: () => { get: () => Promise<{ data: () => { count: number } }> }
}

export default async function LangPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  // ── Resolve role INSIDE try/catch; redirect() OUTSIDE (Pitfall 6) ──────────
  let role: Role | null = null
  let uid: string | null = null
  if (sessionCookie?.value) {
    try {
      const syntheticReq = new Request('https://d2.app/', {
        headers: { Authorization: `Bearer ${sessionCookie.value}` },
      })
      const user = await requireUser(syntheticReq)
      role = user.role
      uid = user.uid
    } catch {
      role = null // invalid/expired session → sign-in
    }
  }

  // new-agent never reaches the console — chat-only shell.
  if (role === 'new-agent') {
    redirect(`/${lang}/chat`)
  }
  // Only the three console roles render Home; anyone else → sign-in.
  if (role !== 'read-only' && role !== 'senior-coach' && role !== 'admin') {
    redirect(`/${lang}/sign-in`)
  }

  // ── Compose EXISTING aggregations (rollups + scoped counts) ────────────────
  // From here `role` ∈ {read-only, senior-coach, admin} and `uid` is set.
  const adminAll = role === 'admin'
  const windowDays = 7
  const windowStart = nDaysAgo(windowDays)

  // usageRollups read (the pre-aggregated rollup collection, NEVER the raw
  // per-event telemetry — HR-7). Org-wide aggregates only; rollups are counts-only
  // by schema, so this is safe for read-only.
  const activeAgentUids = new Set<string>()
  let totalMsgCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCachedInputTokens = 0
  const escalationRateSamples: number[] = []
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
        `[home] usageRollups scan hit its safety cap (${scanLimit} docs, ${windowDays}d window). The KPI tiles below are PARTIAL — pre-aggregate an org-level daily rollup in the usage-rollup job.`,
      )
    }
    for (const d of snap.docs) {
      const data = d.data()
      activeAgentUids.add(data.uid)
      totalMsgCount += data.msgCount
      totalInputTokens += data.inputTokens
      totalOutputTokens += data.outputTokens
      totalCachedInputTokens += data.cachedInputTokens
      if (data.escalationRate != null) escalationRateSamples.push(data.escalationRate)
      const updatedAt = data.updatedAt instanceof Date ? data.updatedAt : undefined
      if (updatedAt && (!latestUpdatedAt || updatedAt > latestUpdatedAt)) {
        latestUpdatedAt = updatedAt
      }
    }
  } catch {
    // Non-blocking — render the empty state if the read fails.
  }

  const hasData = totalMsgCount > 0
  const activeAgents = activeAgentUids.size
  const cacheHitRate =
    totalInputTokens + totalCachedInputTokens > 0
      ? totalCachedInputTokens / (totalInputTokens + totalCachedInputTokens)
      : 0
  const avgEscalationRate =
    escalationRateSamples.length > 0
      ? escalationRateSamples.reduce((a, b) => a + b, 0) / escalationRateSamples.length
      : null

  // ── Stale watchdog (computed exactly as usage-dashboard) ───────────────────
  let staleWatchdog = false
  let latestRollupRelative: string | null = null
  if (latestUpdatedAt) {
    const hoursSince = (Date.now() - (latestUpdatedAt as Date).getTime()) / 3_600_000
    if (hoursSince > 25) {
      staleWatchdog = true
      latestRollupRelative = `${Math.round(hoursSince)}h ago`
    }
  }

  // ── KPI tiles (org usage/cost — counts-only) ───────────────────────────────
  const kpis: HomeKpi[] = [
    { label: 'Active agents', value: kNum(activeAgents) },
    { label: 'Message volume', value: kNum(totalMsgCount) },
    {
      label: 'Escalation rate',
      value: avgEscalationRate != null ? pct(avgEscalationRate) : '—',
    },
    { label: 'Cache hit rate', value: hasData ? pct(cacheHitRate) : '—' },
  ]

  // ── Alerts (coach/admin ONLY — count() never fetch-all; carries no PII rows) ─
  // read-only NEVER triggers these reads (they scope on seniorCoachId/agentUid).
  let alerts: { openStalls: number; knowledgeGaps: number } | undefined
  if (role === 'senior-coach' || role === 'admin') {
    try {
      const scopedStalls = (): CountableQuery => {
        const base = escalationsRef() as unknown as CountableQuery
        return adminAll ? base : base.where('seniorCoachId', '==', uid)
      }
      const scopedGaps = (): CountableQuery => {
        const base = knowledgeGapsRef() as unknown as CountableQuery
        return adminAll ? base : base.where('seniorCoachId', '==', uid)
      }
      const openStalls = (
        await scopedStalls().where('status', '==', 'open').count().get()
      ).data().count
      const knowledgeGaps = (await scopedGaps().count().get()).data().count
      alerts = { openStalls, knowledgeGaps }
    } catch {
      alerts = { openStalls: 0, knowledgeGaps: 0 }
    }
  }

  // ── Recent activity (org rollup window summary) ────────────────────────────
  const recentActivity: string[] = hasData
    ? [
        `${activeAgents} active agent(s) over the last ${windowDays} days`,
        `${kNum(totalMsgCount)} messages, ${kNum(totalInputTokens)} input / ${kNum(totalOutputTokens)} output tokens`,
      ]
    : []

  // ── Quick actions (role's allowed sections; hrefs unchanged — never /admin/) ─
  const quickActions: HomeQuickAction[] = ((): HomeQuickAction[] => {
    if (role === 'admin') {
      return [
        { label: 'Knowledge Base', href: `/${lang}/kb` },
        { label: 'Inventory', href: `/${lang}/inventory` },
        { label: 'Usage & Cost', href: `/${lang}/usage` },
        { label: 'Conversations', href: `/${lang}/conversations` },
        { label: 'Roles & Permissions', href: `/${lang}/roles` },
        { label: 'Integrations', href: `/${lang}/integrations` },
      ]
    }
    if (role === 'senior-coach') {
      return [
        { label: 'Agents', href: `/${lang}/dashboard` },
        { label: 'Escalations', href: `/${lang}/dashboard#stalls` },
        { label: 'Coach Analytics', href: `/${lang}/dashboard` },
      ]
    }
    // read-only: analytics aggregates + KB version-history viewer only (no PII).
    return [
      { label: 'Usage & Cost', href: `/${lang}/usage` },
      { label: 'Knowledge Base', href: `/${lang}/kb` },
    ]
  })()

  // Home lives at the locale root (outside the (admin)/(coach) route groups), so it
  // must wrap itself in ConsoleShell to get the sidebar — the route-group layouts do
  // that for every other console surface, but never run for /[lang]. role is narrowed
  // to a console role by the guards above.
  return (
    <ConsoleShell role={role} lang={lang}>
      <HomeSurface
        role={role}
        lang={lang}
        hasData={hasData}
        kpis={kpis}
        alerts={alerts}
        recentActivity={recentActivity}
        quickActions={quickActions}
        staleWatchdog={staleWatchdog}
        latestRollupRelative={latestRollupRelative}
      />
    </ConsoleShell>
  )
}
