/**
 * app/[lang]/(admin)/users/page.tsx — Add-user admin surface (RSC).
 *
 * Admin-ONLY (read-only is NOT in the allow-list → redirected to Home). Lives in
 * the (admin) route group under System & Compliance. Fetches the cohort list
 * server-side (for the new-agent intake-batch picker) and hands plain rows to the
 * AddUserForm client island.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper
 * (same as cohorts/page.tsx).
 *
 * Analogs: cohorts/page.tsx (RSC gate + server-fetch → client island), roles/page.tsx.
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listCohorts, type CohortSummary } from '../cohorts/actions'
import { AddUserForm } from './add-user-form'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Add User — D2 Admin',
  }
}

export default async function AddUserAdminPage({ params }: PageProps) {
  const { lang } = await params

  // Admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

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
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <AddUserForm cohorts={cohorts} />
    </div>
  )
}
