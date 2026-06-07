/**
 * app/[lang]/(admin)/erasure/page.tsx
 *
 * PDPA data-erasure admin page — RSC shell.
 *
 * Three-layer admin gate (HR-12):
 *   Layer 1: (admin)/layout.tsx redirects non-admins (first gate).
 *   Layer 2: This page re-checks role === 'admin' (second gate — defense in depth).
 *   Layer 3: eraseDataSubjectAction Server Action asserts admin (third gate).
 *
 * Pattern: VERBATIM copy of app/[lang]/(admin)/kb/page.tsx admin-gate block (:43-68).
 * Page wrapper: `container mx-auto max-w-4xl px-4 py-8` (matches kb/page.tsx:82).
 *
 * References:
 *   - QUAL-09 (PDPA erasure), D-01/D-02 (admin-triggered cascade, chunked)
 *   - HR-8…HR-12 (safety-critical destructive flow rules)
 *   - 05-PATTERNS.md §app/[lang]/(admin)/erasure/page.tsx
 *   - T-05-ADMINGATE (three-layer admin gate)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { listErasureRequests, type ErasureRequestRow } from './actions'
import { ErasureRequestForm } from './erasure-request-form'
import { ErasureStatusList } from './erasure-status-list'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'PDPA Data Erasure — D2 Admin',
  }
}

export default async function ErasureAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate (Layer 2 of 3) — verbatim copy of kb/page.tsx:43-68 ──────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/erasure', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/${lang}/sign-in`)
    }
    throw err
  }

  if (user.role !== 'admin') {
    // Non-admin users are redirected to the chat surface (HR-12)
    redirect(`/${lang}/chat`)
  }

  // ── Fetch initial erasure request list ────────────────────────────────────
  let initialRequests: ErasureRequestRow[] = []
  try {
    const result = await listErasureRequests()
    if (result.ok && result.requests) {
      initialRequests = result.requests
    }
  } catch {
    // Non-blocking — show empty list if fetch fails (mirror kb/page.tsx:71-77)
    initialRequests = []
  }

  const t = await getTranslations('adminErasure')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      {/* Erasure request form (Stage A: subject search + Stage B: type-to-confirm dialog) */}
      <div className="mb-10">
        <ErasureRequestForm lang={lang} />
      </div>

      {/* Request status list (Stage C) */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">{t('statusTitle')}</h2>
        <ErasureStatusList initialRequests={initialRequests} />
      </div>
    </div>
  )
}
