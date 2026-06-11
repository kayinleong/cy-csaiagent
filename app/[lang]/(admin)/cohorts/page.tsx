/**
 * app/[lang]/(admin)/cohorts/page.tsx — Cohort management (RSC, COH-03).
 *
 * Admin-ONLY surface (D-24: 'read-only' is NOT in the allow-list → denied). Lives
 * in the (admin) route group (Agents & Cohorts section, D-25). Fetches cohorts
 * server-side via the admin-gated listCohorts action and hands plain serializable
 * rows to the CohortManagement client island.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper.
 *
 * References:
 *   - COH-03 (admin-only cohort CRUD), D-03 (admin-only), D-24 (read-only denied)
 *   - 07-UI-SPEC.md Surface 1 (table + create/edit dialog + delete alert-dialog)
 *   - roles/page.tsx (admin list-page analog)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listCohorts, type CohortSummary } from './actions'
import { CohortManagement } from './cohort-management'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Cohorts — D2 Admin',
  }
}

export default async function CohortsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let initialCohorts: CohortSummary[] = []
  try {
    const result = await listCohorts()
    if (result.ok) {
      initialCohorts = result.cohorts
    }
  } catch {
    // Non-blocking — render an empty table rather than crash.
    initialCohorts = []
  }

  const t = await getTranslations('adminCohorts')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <CohortManagement initialCohorts={initialCohorts} lang={lang} />
    </div>
  )
}
