/**
 * app/[lang]/(coach)/agents/page.tsx — Agent-list index (RSC, NAV-01 reachability / W2).
 *
 * WHY THIS EXISTS: the NAV-01 `agentProfiles` nav href is `/[lang]/agents` (an
 * index), but Phase 6 created no such route — so the nav entry 404'd and the
 * `[uid]` drill-in was unreachable. This minimal index makes BOTH reachable: it
 * reuses the EXISTING getDownline query (it does NOT rebuild the downline list)
 * and each row deep-links to `/[lang]/agents/[uid]`.
 *
 * Lives in the (coach) route group (the (admin) layout redirects senior-coach to
 * /dashboard, so a coach-OR-admin surface MUST live here). Gate: coach + admin
 * only — read-only is NOT admitted (D-24). The gate copies the verbatim Pattern-A
 * cookie→requireUser gate from (coach)/dashboard/page.tsx:62-89.
 *
 * READ-ONLY navigation only — NO journey-edit control, NO send/connect affordance.
 *
 * References:
 *   - NAV-01 (the /[lang]/agents href must resolve), PROF-01, D-05, D-24
 *   - (coach)/dashboard/page.tsx (role-gate + getDownline analog — REUSE, don't rebuild)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminAuth } from '@/src/firebase/admin'
import { getDownline, type DownlineAgent } from '@/src/dashboard/queries'
import { AgentList } from './agent-list'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Agents — D2',
  }
}

export default async function AgentsIndexPage({ params }: PageProps) {
  const { lang } = await params

  // ── Role gate (verbatim copy of (coach)/dashboard/page.tsx:66-89) ──────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/coach/agents', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/${lang}/sign-in`)
    }
    throw err
  }

  // Only senior-coach + admin (read-only is NOT admitted — D-24).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    redirect(`/${lang}/chat`)
  }

  // REUSE the existing downline query (do NOT rebuild it). Admin reads all.
  const adminAll = user.role === 'admin'
  let agents: DownlineAgent[] = []
  try {
    agents = await getDownline(user.uid, { adminAll })
  } catch {
    agents = []
  }

  // Resolve each agent's email for display. Email lives ONLY in Firebase Auth
  // (the agentProfiles/users docs carry none), so resolve it server-side via
  // adminAuth.getUsers (chunked at 100 — the getUsers cap). PII: resolved here,
  // never logged; a resolution failure falls back to the truncated UID.
  // Mirrors roles/actions.ts:194-207.
  const uids = agents.map((a) => a.id)
  const emailByUid = new Map<string, string | null>()
  try {
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100)
      const { users: records } = await adminAuth.getUsers(chunk.map((uid) => ({ uid })))
      for (const rec of records) {
        emailByUid.set(rec.uid, rec.email ?? null)
      }
    }
  } catch {
    // Leave emailByUid empty — every row falls back to its truncated UID.
  }

  // Plain serializable rows. Email shown when resolvable; UID is the fallback.
  const rows = agents.map((a) => ({
    id: a.id,
    email: emailByUid.get(a.id) ?? null,
    journeyStage: a.data.journeyStage,
    currentCheckpoint: a.data.currentCheckpoint,
  }))

  const t = await getTranslations('agentsIndex')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {adminAll ? t('subtitleAll') : t('subtitleDownline')}
        </p>
      </div>

      <AgentList agents={rows} lang={lang} />
    </div>
  )
}
