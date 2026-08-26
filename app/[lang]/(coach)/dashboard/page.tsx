/**
 * app/[lang]/(coach)/dashboard/page.tsx — Senior-coach dashboard (RSC).
 *
 * ROLE GATE: Allows role ∈ {'senior-coach', 'admin'}. Redirects others to chat.
 * All downline reads are server-side via Admin SDK with explicit seniorCoachId filter.
 * No recharts / client imports here — charts live in client islands (Pitfall 7).
 *
 * Pattern mirrors app/[lang]/(admin)/kb/page.tsx:
 *   - Read __session cookie → synthetic Request → requireUser().
 *   - Fetch data server-side → pass plain serializable data to client islands.
 *
 * Security (T-02-31): uid + role from requireUser (verified token via session cookie),
 * never from page params or body.
 *
 * References:
 *   - D-10 / D-11 / D-12 (dashboard scope, downline scoping, inline correction)
 *   - AUTH-06 (coach sees only downline; admin sees all)
 *   - CDASH-01/02/03/04/05/07
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminAuth } from '@/src/firebase/admin'
import {
  getDownline,
  getOpenStalls,
  getKnowledgeGaps,
  type DownlineAgent,
  type StallEscalation,
  type KnowledgeGapItem,
} from '@/src/dashboard/queries'
import { trainingFunnel, daysInJourney, checkpointVelocity } from '@/src/dashboard/metrics'
import { D2_JOURNEY } from '@/src/coach/journey/config'

import { DownlineTable } from '../_components/downline-table'
import { StallInbox } from '../_components/stall-inbox'
import { KnowledgeGapFeed } from '../_components/knowledge-gap-feed'
import { MetricsPanel } from '../_components/metrics-panel'
import { KbDocExplorer } from '../_components/kb-doc-explorer'
import { ReplyQualityPanel } from '../_components/reply-quality-panel'
import { FunnelV2Panel } from '../_components/funnel-v2-panel'
import { KnowledgeGapAggPanel } from '../_components/knowledge-gap-agg-panel'
import { CorrectionEvalPanel } from '../_components/correction-eval-panel'
import {
  getReplyQualityMetrics,
  getFunnelV2Metrics,
  getKnowledgeGapAggregation,
  getCorrectionEvalFeedback,
} from './actions'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Coach Dashboard — D2',
  }
}

export default async function CoachDashboardPage({ params }: PageProps) {
  const { lang } = await params

  // ── Role gate ──────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/coach/dashboard', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/${lang}/sign-in`)
    }
    throw err
  }

  // Only senior-coach and admin may access the dashboard (T-02-31)
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    redirect(`/${lang}/chat`)
  }

  // ── Downline-scoped data reads (server-side, AUTH-06) ──────────────────────
  // Admin reads all; coach reads only their downline.
  const adminAll = user.role === 'admin'

  let downlineAgents: DownlineAgent[] = []
  let openStalls: StallEscalation[] = []
  let knowledgeGaps: KnowledgeGapItem[] = []

  // Run queries in parallel for performance
  await Promise.all([
    getDownline(user.uid, { adminAll }).then((d) => {
      downlineAgents = d
    }),
    getOpenStalls(user.uid, { adminAll }).then((s) => {
      openStalls = s
    }),
    getKnowledgeGaps(user.uid, { adminAll }).then((g) => {
      knowledgeGaps = g
    }),
  ])

  // ── Metric derivation ───────────────────────────────────────────────────────
  const now = new Date()

  // Resolve each agent's email for display (email lives only in Firebase Auth;
  // the agentProfiles/users docs carry none). Chunked at 100 (getUsers cap),
  // fail-soft → fallback to the truncated UID. PII: resolved here, never logged.
  // Mirrors the /agents index (quick-024) + roles/actions.ts.
  const agentUids = downlineAgents.map((a) => a.id)
  const emailByUid = new Map<string, string | null>()
  try {
    for (let i = 0; i < agentUids.length; i += 100) {
      const chunk = agentUids.slice(i, i + 100)
      const { users: records } = await adminAuth.getUsers(chunk.map((uid) => ({ uid })))
      for (const rec of records) {
        emailByUid.set(rec.uid, rec.email ?? null)
      }
    }
  } catch {
    // Leave the map empty — every row falls back to its truncated UID.
  }

  // Build serializable agent summary rows for the downline table
  const agentRows = downlineAgents.map((agent) => ({
    id: agent.id,
    email: emailByUid.get(agent.id) ?? null,
    journeyStage: agent.data.journeyStage,
    currentCheckpoint: agent.data.currentCheckpoint,
    seniorCoachId: agent.data.seniorCoachId,
    daysInJourney: daysInJourney(
      { lastActiveAt: agent.data.lastActiveAt },
      now,
    ),
    velocity: checkpointVelocity(
      {
        journeyStage: agent.data.journeyStage,
        currentCheckpoint: agent.data.currentCheckpoint,
      },
      D2_JOURNEY,
    ),
    hasOpenStall: openStalls.some((s) => s.data.agentUid === agent.id),
  }))

  // Training funnel data for the metrics panel
  const funnel = trainingFunnel(
    downlineAgents.map((a) => ({
      journeyStage: a.data.journeyStage,
      currentCheckpoint: a.data.currentCheckpoint,
    })),
  )

  // ── Reply Quality aggregation (REPLY-11 / ADMIN-06, D-20/D-21/D-22) ──────────
  // Read-time count() aggregation over replyEdits, role-scoped server-side
  // (downline for a coach, org-wide for admin) — counts only, no draft content.
  const replyQuality = await getReplyQualityMetrics()

  // ── CDASH-08: Dashboard v2 data fetches (role-scoped server-side, HR-4) ────
  // All three use count()/select() aggregation (no fetch-all). Run in parallel.
  const [funnelV2, gapAgg, correctionEval] = await Promise.all([
    getFunnelV2Metrics(),
    getKnowledgeGapAggregation(),
    getCorrectionEvalFeedback(),
  ])

  const t = await getTranslations('dashboard')

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {adminAll ? t('viewingAll') : t('viewingDownline')}
        </p>
      </div>

      <div className="grid gap-8">
        {/* CDASH-01: Downline list */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('downlineTitle')}</h2>
          <DownlineTable agents={agentRows} />
        </section>

        {/* CDASH-02: Stall-alert inbox */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            {t('stallsTitle')} ({openStalls.length})
          </h2>
          <StallInbox
            stalls={openStalls.map((s) => ({
              id: s.id,
              agentUid: s.data.agentUid,
              reason: s.data.reason,
              openedAt: s.data.openedAt instanceof Date
                ? s.data.openedAt.toISOString()
                : new Date(s.data.openedAt as unknown as string).toISOString(),
              contextBundle: s.data.contextBundle,
            }))}
          />
        </section>

        {/* CDASH-03: Knowledge-gap feed */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('gapsTitle')}</h2>
          <KnowledgeGapFeed
            gaps={knowledgeGaps.map((g) => ({
              id: g.id,
              topicLabel: g.data.topicLabel,
              count: g.data.count,
              lang: g.data.lang,
              lastSeenAt: g.data.lastSeenAt instanceof Date
                ? g.data.lastSeenAt.toISOString()
                : new Date(g.data.lastSeenAt as unknown as string).toISOString(),
            }))}
          />
        </section>

        {/* CDASH-04: KB document explorer → inline AI correction (client island) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('correctionTitle')}</h2>
          {/* No token prop (quick-kayinleong-058): it used to be handed the __session
              cookie value, which is not an ID token and 401'd — and shipping an httpOnly
              credential into client props is not something to keep either. The dialog
              reads a live token from the client SDK when it needs one. */}
          <KbDocExplorer />
        </section>

        {/* CDASH-05/07: Metrics panel with recharts (client island) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('metricsTitle')}</h2>
          <MetricsPanel
            funnel={funnel}
            agentRows={agentRows}
          />
        </section>

        {/* REPLY-11 / ADMIN-06: Reply Quality panel (recharts client island) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('replyQuality.title')}</h2>
          <ReplyQualityPanel
            perSop={replyQuality.metrics?.perSop ?? []}
            thumbsDownRate={replyQuality.metrics?.thumbsDownRate ?? 0}
            escalationRate={replyQuality.metrics?.escalationRate ?? 0}
            draftsPerAgent={replyQuality.metrics?.draftsPerAgent ?? 0}
            topEditedSop={replyQuality.metrics?.topEditedSop ?? null}
            scope={replyQuality.metrics?.scope ?? (adminAll ? 'org' : 'downline')}
          />
        </section>

        {/* CDASH-08: Full funnel + ramp KPI panel (v2 — grow, don't fork D-07) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('v2.funnelTitle')}</h2>
          <FunnelV2Panel
            stages={funnelV2.metrics?.stages ?? []}
            activeAgents={funnelV2.metrics?.activeAgents ?? 0}
            totalAgents={funnelV2.metrics?.totalAgents ?? 0}
            avgDaysToProductive={funnelV2.metrics?.avgDaysToProductive ?? null}
            scope={funnelV2.metrics?.scope ?? (adminAll ? 'org' : 'downline')}
          />
        </section>

        {/* CDASH-08: Knowledge-gap aggregation by pillar (v2 — grow, don't fork) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('v2.gapAggTitle')}</h2>
          <KnowledgeGapAggPanel
            gapsByTopic={gapAgg.gapsByTopic ?? []}
            scope={gapAgg.scope ?? (adminAll ? 'org' : 'downline')}
          />
        </section>

        {/* CDASH-08: Correction → eval feedback (v2 — grow, don't fork) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('v2.correctionEvalTitle')}</h2>
          <CorrectionEvalPanel
            corrections={correctionEval.corrections ?? []}
            evalTrend={correctionEval.evalTrend ?? []}
          />
        </section>
      </div>
    </div>
  )
}
