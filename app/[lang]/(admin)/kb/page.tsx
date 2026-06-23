/**
 * app/[lang]/(admin)/kb/page.tsx
 *
 * KB admin page — server shell.
 *
 * This is a React Server Component that:
 *   1. requireUser(req) — gates to role === 'admin' (T-01-30).
 *   2. Lists existing KB documents from Firestore.
 *   3. Renders the KbDocForm client island for creating new documents.
 *
 * Pattern: RSC shell + 'use client' island (PATTERNS Tier-A KB CRUD).
 * Admin gate: requireUser is called server-side via the session cookie.
 *
 * References:
 *   - PATTERNS Tier-A KB CRUD (lines 151-177)
 *   - TSD §5.1 roles (admin — full tenant access)
 *   - D-10 (multi-doc-capable KB + minimal authenticated CRUD form)
 *   - D-11 (thin admin role uses KB CRUD form)
 *   - T-01-30 (admin gate on both page + Server Action)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { listDocs } from '@/src/kb/crud'
import { KbDocForm } from './kb-doc-form'
import { KbDocList, type SerializedKbDocWithId } from './kb-doc-list'

interface PageProps {
  params: Promise<{ lang: string }>
}

/**
 * Firestore `Timestamp` → epoch millis (or null). A Timestamp is a class instance
 * and cannot cross the RSC→Client boundary unserialized — passing it raw throws
 * "Only plain objects… can be passed to Client Components". Mirrors the toMillis
 * helper in (admin)/audit-log/actions.ts. Returns null for missing/unknown values
 * (e.g. legacy docs written before publishedAt existed).
 */
function toMillis(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return value.getTime()
  const t = value as { toMillis?: () => number; toDate?: () => Date }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  return null
}

export async function generateMetadata() {
  return {
    title: 'Knowledge Base — D2 Admin',
  }
}

export default async function KbAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate ─────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  // Verify the token and check the admin role
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/kb', {
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
    // read-only (the only other role admitted to this group) → Home, never chat (RO-01).
    // The read-only KB version-history viewer lives at kb/[docId], not this management list.
    redirect(`/${lang}`)
  }

  // ── Fetch existing KB docs ─────────────────────────────────────────────────
  let kbDocs: Awaited<ReturnType<typeof listDocs>> = []
  try {
    kbDocs = await listDocs(user)
  } catch {
    // Non-blocking — if listing fails, show an empty list
    kbDocs = []
  }

  // Serialize the Firestore Timestamp before the docs cross into the KbDocList
  // client component — the RSC→Client boundary only accepts plain objects.
  const serializedDocs: SerializedKbDocWithId[] = kbDocs.map(({ id, data }) => ({
    id,
    data: { ...data, publishedAt: toMillis(data.publishedAt) },
  }))

  const t = await getTranslations('kb')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the D2 Knowledge Base documents. Documents are chunked and indexed for RAG
          retrieval by the AI agents.
        </p>
      </div>

      {/* Create form */}
      <div className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">{t('addDocument')}</h2>
        <KbDocForm />
      </div>

      {/* Existing documents list */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          {t('existingDocuments')} ({kbDocs.length})
        </h2>
        <KbDocList docs={serializedDocs} lang={lang} />
      </div>
    </div>
  )
}
