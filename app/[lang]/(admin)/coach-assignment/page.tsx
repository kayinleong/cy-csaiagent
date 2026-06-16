/**
 * app/[lang]/(admin)/coach-assignment/page.tsx — Coach reassignment (RSC, ASSIGN-01).
 *
 * Admin-ONLY surface (D-07: a senior-coach can NEVER reassign their own downline;
 * D-24: read-only is NOT in the allow-list → denied). Lives in the (admin) route
 * group (Agents & Cohorts section, D-25).
 *
 * Loads the user roster server-side (reusing the admin-gated listUsersWithRoles
 * from roles/actions) so the island can offer agent + new-coach pickers. The
 * reassignment itself goes through the admin-only atomic assignCoach action.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — read-only + senior-coach denied.
 *
 * References:
 *   - ASSIGN-01 (admin-only atomic dual-write), D-07 (admin-only), D-24 (read-only denied)
 *   - 07-UI-SPEC.md Surface 3 (combobox/select + reassign confirm)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listUsersWithRoles, type UserWithRole } from '../roles/actions'
import { CoachReassign } from './coach-reassign'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Coach Assignment — D2 Admin',
  }
}

export default async function CoachAssignmentPage({ params }: PageProps) {
  const { lang } = await params

  // D-07 / D-24: admin-only — senior-coach + read-only denied → Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let users: UserWithRole[] = []
  try {
    const result = await listUsersWithRoles()
    if (result.ok) {
      users = result.users
    }
  } catch {
    users = []
  }

  // Candidate agents (anyone with a coach can be reassigned) and the coaches they
  // may move to. Email is resolved server-side by listUsersWithRoles (Auth-only PII,
  // never logged); the UI shows it with the truncated UID as fallback.
  const agents = users.map((u) => ({ id: u.id, email: u.email, displayRef: u.displayRef, role: u.role }))
  const coaches = users
    .filter((u) => u.role === 'senior-coach')
    .map((u) => ({ id: u.id, email: u.email, displayRef: u.displayRef }))

  const t = await getTranslations('adminCoachAssignment')

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <CoachReassign agents={agents} coaches={coaches} lang={lang} />
    </div>
  )
}
