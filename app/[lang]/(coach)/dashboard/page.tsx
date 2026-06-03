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

  // Build serializable agent summary rows for the downline table
  const agentRows = downlineAgents.map((agent) => ({
    id: agent.id,
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
          <KbDocExplorer idToken={sessionCookie.value} />
        </section>

        {/* CDASH-05/07: Metrics panel with recharts (client island) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('metricsTitle')}</h2>
          <MetricsPanel
            funnel={funnel}
            agentRows={agentRows}
          />
        </section>
      </div>
    </div>
  )
}
