/**
 * app/[lang]/(coach)/flags/page.tsx — Flagged-conversation queue (FLAG-03, Surface S4).
 *
 * RSC shell under the (coach) route group (admits senior-coach + admin). The
 * route group layout is the first gate; this page is the second (defense-in-depth)
 * via the centralized requireRole helper. read-only is NOT in the allow-list — it
 * is DENIED on every Phase-7 surface (D-24 / T-07-14).
 *
 * Fetches the role-scoped flag list server-side (admin = all open, coach =
 * own-downline) and passes serializable rows to the FlagQueue client island.
 * Rows carry a conversationId REFERENCE only and deep-link to the EXISTING audited
 * conversation viewer for content (D-10) — no content is duplicated onto the flag.
 *
 * References:
 *   - FLAG-03 (bounded scoped queue + review/dismiss; read-only DENIED)
 *   - D-10 (content-free, deep-link to existing viewer), D-24 (read-only denied)
 *   - 07-UI-SPEC §S4, 07-PATTERNS §flags
 *   - requireRole (app/[lang]/_lib/require-role.ts), roles/page.tsx (list-page shape)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listFlags } from './actions'
import { FlagQueue } from './flag-queue'
import type { FlagRow } from './actions'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Flagged Conversations — D2 Console',
  }
}

export default async function FlagsQueuePage({ params }: PageProps) {
  const { lang } = await params

  // Coach-or-admin gate. 'read-only' is intentionally EXCLUDED (D-24). A
  // verified-but-disallowed caller is redirected to Home, never chat (RO-01).
  const user = await requireRole({
    lang,
    allowed: ['admin', 'senior-coach'],
    fallback: `/${lang}`,
  })

  // Fetch the role-scoped queue server-side; non-blocking (empty fallback on error
  // — mirrors roles/page.tsx:66-75). listFlags applies the admin-all / coach
  // own-downline scope from the verified token, not from any prop.
  let initialFlags: FlagRow[] = []
  try {
    const result = await listFlags()
    if (result.ok && result.flags) {
      initialFlags = result.flags
    }
  } catch {
    initialFlags = []
  }

  const t = await getTranslations('flagQueue')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <FlagQueue initialFlags={initialFlags} lang={lang} isAdmin={user.role === 'admin'} />
    </div>
  )
}
