/**
 * app/[lang]/(admin)/users/page.tsx — User management admin surface (RSC).
 *
 * Admin-ONLY (read-only is NOT in the allow-list → redirected to Home). Lives in
 * the (admin) route group under System & Compliance. Two sections:
 *   1. UserList — all users (email + role + coach), server-fetched via the
 *      admin-gated listUsersWithRoles (which resolves emails Auth-side).
 *   2. AddUserForm — create a new account + grant a role (quick-023).
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper
 * (same as cohorts/page.tsx).
 *
 * Analogs: cohorts/page.tsx (RSC gate + server-fetch → client island), roles/page.tsx.
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listCohorts, type CohortSummary } from '../cohorts/actions'
import { listUsersWithRoles, type UserWithRole } from '../roles/actions'
import { AddUserForm } from './add-user-form'
import { UserList } from './user-list'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Users — D2 Admin',
  }
}

export default async function UsersAdminPage({ params }: PageProps) {
  const { lang } = await params

  // Admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  // All users for the directory (email resolved Auth-side by the action).
  // Non-blocking — render an empty list rather than crash if the read fails.
  let users: UserWithRole[] = []
  try {
    const result = await listUsersWithRoles()
    if (result.ok) {
      users = result.users
    }
  } catch {
    users = []
  }

  // Cohorts power the new-agent intake-batch picker. Non-blocking — render an
  // empty picker rather than crash if the read fails.
  let cohorts: CohortSummary[] = []
  try {
    const result = await listCohorts()
    if (result.ok) {
      cohorts = result.cohorts
    }
  } catch {
    cohorts = []
  }

  const t = await getTranslations('adminUsers')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <div className="grid gap-10">
        {/* All users directory */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('listTitle')} ({users.length})</h2>
          <UserList users={users} />
        </section>

        {/* Add a new user */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('addTitle')}</h2>
          <AddUserForm cohorts={cohorts} />
        </section>
      </div>
    </div>
  )
}
