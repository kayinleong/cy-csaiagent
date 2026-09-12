/**
 * app/[lang]/(admin)/priority-list/page.tsx — Priority-List admin surface (RSC,
 * quick-kayinleong-090, D-25 System & Compliance).
 *
 * Admin-ONLY (D-24: 'read-only' is NOT in the allow-list → denied). Reads the
 * published ordering prompt server-side via the admin-gated readPriorityList
 * action and hands the plain string to the PriorityListForm client island, which
 * drives the conflict-safe publish round-trip.
 *
 * The prompt is a RANKING preference layered over the projects the Finder tools
 * already returned — it re-orders matches, it never widens them. The help copy on
 * this surface states that limit plainly so an admin does not expect it to surface
 * a sold-out or out-of-area project.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper.
 *
 * References:
 *   - src/firebase/collections.ts PriorityListDoc (appConfig/priorityList)
 *   - model-config/page.tsx (the admin singleton-config analog)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { readPriorityList } from './actions'
import { PriorityListForm } from './priority-list-form'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Priority List — D2 Admin',
  }
}

export default async function PriorityListAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let initialText = ''
  try {
    const result = await readPriorityList()
    if (result.ok) {
      initialText = result.text
    }
  } catch {
    // Non-blocking — render an empty editor rather than crash. An empty value is
    // also the legitimate "feature off" state, so this degrades cleanly.
    initialText = ''
  }

  const t = await getTranslations('adminPriorityList')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <PriorityListForm initialText={initialText} />
    </div>
  )
}
