/**
 * app/[lang]/(admin)/leads/page.tsx — Lead registry (RSC, quick-kayinleong-046).
 *
 * Admin-ONLY surface (D-24: 'read-only' is NOT in the allow-list → redirected to
 * Home). Lives in the (admin) route group and is reached from the Agents & Cohorts
 * sidebar section (leads are agent-owned).
 *
 * WHY: the Reply pillar requires a `leadId` (app/api/chat/route.ts:402-407) and
 * nothing in the product created `leads/{id}` documents, so the chat lead-selector
 * was permanently empty and Reply was unreachable. This page is the producer.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper. Both
 * server reads are non-blocking (an empty table beats a crash).
 *
 * Mirrors cohorts/page.tsx line-for-line.
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listLeads, type LeadSummary } from './actions'
import { listUsersWithRoles } from '../roles/actions'
import { LeadManagement, type LeadOwner } from './lead-management'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Leads — D2 Admin',
  }
}

export default async function LeadsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  const user = await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let initialLeads: LeadSummary[] = []
  try {
    const result = await listLeads()
    if (result.ok) {
      initialLeads = result.leads
    }
  } catch {
    // Non-blocking — render an empty table rather than crash.
    initialLeads = []
  }

  // Owner roster for the picker. 'read-only' users are excluded: they are denied
  // leadContext read/write entirely (RO-03), so owning a lead is meaningless for
  // them. Failure is non-blocking (the table still renders; the picker is empty).
  let owners: LeadOwner[] = []
  try {
    const rosterResult = await listUsersWithRoles()
    if (rosterResult.ok) {
      owners = rosterResult.users
        .filter((u) => u.role !== 'read-only')
        .map((u) => ({
          id: u.id,
          displayRef: u.displayRef,
          email: u.email,
          role: u.role,
        }))
    }
  } catch {
    owners = []
  }

  const t = await getTranslations('adminLeads')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <LeadManagement initialLeads={initialLeads} owners={owners} currentUid={user.uid} />
    </div>
  )
}
