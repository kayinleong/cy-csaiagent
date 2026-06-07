/**
 * app/[lang]/(admin)/conversations/page.tsx — Admin conversation log viewer (ADMIN-02).
 *
 * RSC shell: three-layer admin gate (verbatim copy of kb/page.tsx:43-68).
 * Renders the ConversationViewer client island.
 *
 * Gate layers:
 *   Layer 1: (admin)/layout.tsx redirects non-admins (first gate).
 *   Layer 2: This page re-checks role (second gate — defence-in-depth).
 *   Layer 3: Server Actions in actions.ts assert admin independently.
 *
 * References:
 *   - ADMIN-02 (admin conversation viewer — read-only, cross-pillar, audited)
 *   - HR-5 (audit-before-read, read-only surface)
 *   - 05-PATTERNS.md §conversations/page.tsx (kb/page.tsx gate verbatim)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { ConversationViewer } from './conversation-viewer'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Conversation Log — D2 Admin',
  }
}

export default async function ConversationsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate (verbatim copy of kb/page.tsx:43-68) ───────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/conversations', {
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
    redirect(`/${lang}/chat`)
  }

  const t = await getTranslations('adminConversations')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <ConversationViewer lang={lang} />
    </div>
  )
}
