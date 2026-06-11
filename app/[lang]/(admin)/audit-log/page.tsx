/**
 * app/[lang]/(admin)/audit-log/page.tsx — Audit-log viewer (RSC, AUDIT-01,
 * D-25 System & Compliance).
 *
 * Admin-ONLY (D-24: 'read-only' is NOT in the allow-list → denied). Fetches the
 * first bounded page of audit rows server-side via the admin-gated listAuditLogs
 * action and hands metadata-only rows to the AuditLogViewer client island.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper.
 *
 * References:
 *   - AUDIT-01, D-12/13/14 (admin-only bounded read; hashes not decoded; no
 *     self-audit), D-24
 *   - 07-UI-SPEC.md Surface 5 (table + filter toolbar + "Load more"; font-mono
 *     for actorUid/targetRef)
 *   - cohorts/page.tsx (admin list-page analog)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listAuditLogs, type AuditLogRow } from './actions'
import { AuditLogViewer } from './audit-log-viewer'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Audit Log — D2 Admin',
  }
}

export default async function AuditLogAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let initialRows: AuditLogRow[] = []
  try {
    const result = await listAuditLogs({})
    if (result.ok) {
      initialRows = result.rows
    }
  } catch {
    // Non-blocking — render an empty table rather than crash.
    initialRows = []
  }

  const t = await getTranslations('adminAuditLog')

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <AuditLogViewer initialRows={initialRows} />
    </div>
  )
}
