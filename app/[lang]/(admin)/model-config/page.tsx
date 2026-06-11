/**
 * app/[lang]/(admin)/model-config/page.tsx — Model-config admin surface (RSC,
 * MODEL-01/MODEL-02, D-25 System & Compliance).
 *
 * Admin-ONLY (D-24: 'read-only' is NOT in the allow-list → denied). Reads the
 * current model.{pillar}.default value for the 5 pillars server-side via the
 * admin-gated readModelConfig action and hands plain serializable rows to the
 * ModelConfigForm client island, which drives the ETag-safe publish round-trip.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper.
 *
 * References:
 *   - MODEL-01/02, D-15/16/17 (admin-only, model-agnostic, ETag publish), D-24
 *   - 07-UI-SPEC.md Surface 6 (per-pillar cards + neutral-primary publish confirm)
 *   - cohorts/page.tsx (admin list-page analog)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { readModelConfig, type ModelConfigRow } from './actions'
import { ModelConfigForm } from './model-config-form'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Model Config — D2 Admin',
  }
}

export default async function ModelConfigAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let rows: ModelConfigRow[] = []
  try {
    const result = await readModelConfig()
    if (result.ok) {
      rows = result.rows
    }
  } catch {
    // Non-blocking — render an empty grid rather than crash. The 5 pillars are
    // always known to the client island even without published values.
    rows = []
  }

  const t = await getTranslations('adminModelConfig')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <ModelConfigForm initialRows={rows} />
    </div>
  )
}
