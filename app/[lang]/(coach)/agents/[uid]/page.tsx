/**
 * app/[lang]/(coach)/agents/[uid]/page.tsx — Read-only agent profile (RSC, PROF-01/02).
 *
 * Coach-OR-admin drill-in (D-05). Lives in the (coach) route group (the (admin)
 * layout redirects senior-coach to /dashboard — placing it under (admin) would
 * make it unreachable by coaches and break D-05). Gate: ['admin','senior-coach']
 * — read-only is NOT admitted (D-24).
 *
 * Composes a PURE READ-ONLY view via getAgentProfile (audit-before-read PROF-02;
 * downline-gated D-05). There is NO journey-edit affordance anywhere (D-04) — the
 * only write on this surface is the idempotent "Record first close" action, which
 * stamps firstCloseAt and never touches journey state.
 *
 * The per-agent days-to-first-close tile renders an em-dash when no close is
 * recorded (UI-SPEC). All strings via next-intl (agentProfile.* — keys land in 07-06).
 *
 * References:
 *   - PROF-01/PROF-02 (read-only composed profile, audited, downline-gated)
 *   - D-04 (no journey edit), D-05 (coach-or-admin downline scope), D-24 (read-only denied)
 *   - CLOSE-02 (per-agent days-to-first-close), CLOSE-01 (record-first-close action)
 *   - 07-UI-SPEC.md Surface 2 (card grid + badge + metric tiles)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../../_lib/require-role'
import { getAgentProfile, NotInDownlineError, type AgentProfile } from '@/src/dashboard/queries'
import { adminAuth } from '@/src/firebase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RecordFirstClose } from './record-first-close'
import {
  journeyStageLabel,
  journeyCheckpointLabel,
  type JourneyTranslator,
} from '../../../_components/journey-label'

interface PageProps {
  params: Promise<{ lang: string; uid: string }>
}

export async function generateMetadata() {
  return {
    title: 'Agent Profile — D2',
  }
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { lang, uid } = await params

  // D-05 / D-24: coach-or-admin only; read-only denied → chat.
  const user = await requireRole({
    lang,
    allowed: ['admin', 'senior-coach'],
    fallback: `/${lang}/chat`,
  })

  const t = await getTranslations('agentProfile')

  // PROF-02: audited, downline-gated read. A non-downline coach → NotInDownlineError.
  let profile: AgentProfile | null = null
  let denied = false
  try {
    profile = await getAgentProfile(user.uid, uid, { adminAll: user.role === 'admin' })
  } catch (err) {
    if (err instanceof NotInDownlineError) {
      denied = true
    } else {
      throw err
    }
  }

  if (denied || !profile) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('deniedTitle')}</EmptyTitle>
            <EmptyDescription>{t('deniedBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const stage = profile.journeyStage
  const checkpoint = profile.currentCheckpoint
  const daysToClose = profile.daysToFirstClose
  const canRecordClose = !profile.firstCloseAt

  // Resolve the agent's email for the header (Auth-only PII; never logged). A
  // resolution failure falls back to the truncated UID. Mirrors the index/dashboard.
  let email: string | null = null
  try {
    const { users } = await adminAuth.getUsers([{ uid: profile.id }])
    email = users[0]?.email ?? null
  } catch {
    email = null
  }

  // Journey labels resolved in the active locale (humanized fallback if unknown).
  const tj = (await getTranslations('journey')) as unknown as JourneyTranslator

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header — email when resolvable; truncated UID is the fallback. */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1
            className={`text-2xl font-semibold tracking-tight ${email ? '' : 'font-mono'}`}
          >
            {email ?? `${profile.id.slice(0, 8)}…`}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="secondary">{journeyStageLabel(tj, stage)}</Badge>
            <span className="text-sm text-muted-foreground">{journeyCheckpointLabel(tj, checkpoint)}</span>
            {profile.cohortId ? (
              <Badge variant="outline">{t('cohortBadge', { cohort: profile.cohortId.slice(0, 8) })}</Badge>
            ) : null}
          </div>
        </div>
        {/* The ONLY write on this surface — idempotent, audited, no journey edit (D-04). */}
        <RecordFirstClose agentUid={profile.id} canRecord={canRecordClose} />
      </div>

      {/* Metric tiles (mirror usage-dashboard.tsx rhythm: text-2xl numerals in gap-6) */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileDaysToClose')}</p>
            <span className="text-2xl font-bold">{daysToClose != null ? daysToClose : '—'}</span>
            {daysToClose == null ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('noCloseYet')}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileActiveLeads')}</p>
            <span className="text-2xl font-bold">{profile.activeLeadIds.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileEscalations')}</p>
            <span className="text-2xl font-bold">{profile.escalationCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileKnowledgeGaps')}</p>
            <span className="text-2xl font-bold">{profile.knowledgeGapCount}</span>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-8" />

      {/* Usage summary (counts only — no PII) */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileTotalTokens')}</p>
            <span className="text-2xl font-bold">{profile.totalTokens.toLocaleString()}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('tileFirstClose')}</p>
            <span className="text-sm font-medium">
              {profile.firstCloseAt ? profile.firstCloseAt.toISOString().slice(0, 10) : '—'}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
