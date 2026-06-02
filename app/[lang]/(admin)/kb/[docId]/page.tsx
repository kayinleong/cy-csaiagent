/**
 * app/[lang]/(admin)/kb/[docId]/page.tsx
 *
 * Per-doc admin detail page — version history + plain-language edit.
 *
 * This is a React Server Component that:
 *   1. Admin-gates the same way as the list page (cookie → requireUser → redirect).
 *   2. Loads the target doc + walks the supersedesId / supersededBy version chain
 *      via listDocs (filtered) to render version lineage.
 *   3. Renders <KbDocForm> in edit mode (pre-filled with doc title/lang/pillar)
 *      so Derek can update content in plain language.
 *      On submit, updateKbDocAction creates a new version → browser poll → supersede.
 *
 * References:
 *   - T-02-24: double admin gate (page + Server Action)
 *   - T-02-26: version history read — admin-only, tenant-scoped (accepted risk)
 *   - ADMIN-01/03: plain-language edit, version history visible to Derek
 */

import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { listDocs, type KbDocWithId } from '@/src/kb/crud'
import { KbDocForm } from '../kb-doc-form'

interface PageProps {
  params: Promise<{ lang: string; docId: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { docId } = await params
  return {
    title: `KB Document ${docId.slice(0, 8)}… — D2 Admin`,
  }
}

/**
 * Build the version lineage chain for a given docId.
 *
 * Walks backwards through supersedesId and forwards through supersededBy
 * using the already-loaded list (no extra Firestore round trips).
 */
function buildVersionChain(targetId: string, allDocs: KbDocWithId[]): KbDocWithId[] {
  const byId = new Map(allDocs.map((d) => [d.id, d]))

  // Collect ancestors (follow supersedesId backwards)
  const ancestors: KbDocWithId[] = []
  let current = byId.get(targetId)
  while (current?.data.supersedesId) {
    const prev = byId.get(current.data.supersedesId)
    if (!prev) break
    ancestors.unshift(prev)
    current = prev
  }

  // Collect descendants (follow supersededBy forwards from target)
  const descendants: KbDocWithId[] = []
  current = byId.get(targetId)
  while (current?.data.supersededBy) {
    const next = byId.get(current.data.supersededBy)
    if (!next) break
    descendants.push(next)
    current = next
  }

  const target = byId.get(targetId)
  if (!target) return []

  return [...ancestors, target, ...descendants]
}

export default async function KbDocDetailPage({ params }: PageProps) {
  const { lang, docId } = await params

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/kb', {
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

  // ── Load all docs (used for version chain) ──────────────────────────────────
  let allDocs: KbDocWithId[] = []
  try {
    allDocs = await listDocs(user)
  } catch {
    allDocs = []
  }

  // Find the target doc
  const target = allDocs.find((d) => d.id === docId)
  if (!target) {
    notFound()
  }

  // Build version lineage chain
  const chain = buildVersionChain(docId, allDocs)

  const t = await getTranslations('kb')

  const LANG_LABEL: Record<string, string> = { en: 'EN', ms: 'BM', zh: '中文' }
  const PILLAR_LABEL: Record<string, string> = {
    coach: 'Onboarding Coach',
    finder: 'Property Finder',
    reply: 'Reply Assistant',
  }
  const STATUS_LABEL: Record<string, string> = {
    published: 'Published',
    unpublished: 'Unpublished',
    superseded: 'Superseded',
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href={`/${lang}/admin/kb`}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          ← {t('title')}
        </Link>
      </div>

      {/* Doc header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{target.data.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {LANG_LABEL[target.data.lang] ?? target.data.lang} ·{' '}
          {PILLAR_LABEL[target.data.pillar] ?? target.data.pillar} · v{target.data.version ?? 1} ·{' '}
          {STATUS_LABEL[target.data.status ?? 'unpublished'] ?? target.data.status}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">ID: {docId}</p>
      </div>

      {/* Version history */}
      {chain.length > 1 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">{t('versionHistory')}</h2>
          <ol className="space-y-2">
            {chain.map(({ id, data }, idx) => {
              const isCurrent = id === docId
              return (
                <li
                  key={id}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                    isCurrent ? 'border-primary bg-primary/5 font-medium' : ''
                  }`}
                >
                  <span className="w-6 shrink-0 text-center text-muted-foreground">
                    v{data.version ?? idx + 1}
                  </span>
                  <span className="flex-1 truncate">
                    {isCurrent ? (
                      data.title
                    ) : (
                      <Link
                        href={`/${lang}/admin/kb/${id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {data.title}
                      </Link>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      data.status === 'published'
                        ? 'text-primary'
                        : data.status === 'superseded'
                          ? 'text-muted-foreground line-through'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {STATUS_LABEL[data.status ?? 'unpublished'] ?? data.status}
                  </span>
                  {data.correctedBy && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      corrected
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* Edit form — only available for non-superseded docs */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('editDocument')}</h2>
        {target.data.status === 'superseded' && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            {t('supersededNotice')}
          </p>
        )}
        <KbDocForm
          docId={docId}
          initialValues={{
            title: target.data.title,
            lang: target.data.lang,
            pillar: target.data.pillar,
          }}
        />
      </section>
    </div>
  )
}
