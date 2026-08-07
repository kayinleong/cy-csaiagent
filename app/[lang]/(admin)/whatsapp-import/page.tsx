/**
 * app/[lang]/(admin)/whatsapp-import/page.tsx
 *
 * WhatsApp-import admin page — React Server Component shell.
 *
 * Flow:
 *   1. Admin gate via requireRole (T-03-22 pattern; verified token only).
 *   2. List projects server-side (admin-gated read) → pass the candidate set to
 *      the client form for the manual-override dropdown.
 *   3. Render the client island (WhatsAppImportForm) which parses the uploaded
 *      .zip in-browser (JSZip), calls the classify Server Action, and — on
 *      confirm — drives the existing KB-ingest + collateral Server Actions.
 *
 * The client form performs the side effects; this shell only gates + seeds data.
 *
 * References:
 *   - app/[lang]/(admin)/inventory/page.tsx (the RSC shell this mirrors)
 *   - app/[lang]/_lib/require-role.ts (requireRole admin gate)
 *   - src/inventory/list.ts (listProjects)
 */

import { getTranslations } from 'next-intl/server'
import { requireRole } from '@/app/[lang]/_lib/require-role'
import { listProjects } from '@/src/inventory/list'
import { WhatsAppImportForm } from './whatsapp-import-form'
import type { ProjectOption } from './actions'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'WhatsApp Import — D2 Admin',
  }
}

export default async function WhatsAppImportPage({ params }: PageProps) {
  const { lang } = await params

  // Admin gate — read-only (the only other role in this group) falls back to Home.
  const user = await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  // Candidate project set for the manual-override dropdown (admin-gated read).
  let projects: ProjectOption[] = []
  try {
    const list = await listProjects(user)
    projects = list.map(({ id, data }) => ({ id, name: data.name, status: data.status }))
  } catch {
    projects = []
  }

  const t = await getTranslations('adminWhatsapp')

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <WhatsAppImportForm lang={lang} projects={projects} />
    </div>
  )
}
