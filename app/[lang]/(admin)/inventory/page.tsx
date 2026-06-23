/**
 * app/[lang]/(admin)/inventory/page.tsx
 *
 * Inventory admin page — React Server Component shell (ADMIN-04).
 *
 * Mirrors app/[lang]/(admin)/kb/page.tsx exactly:
 *   1. await cookies() → __session → requireUser (async cookies — Next.js 16)
 *   2. Admin gate: role !== 'admin' → redirect to chat
 *   3. List projects server-side (listProjects — admin-gated read)
 *   4. Render client islands: ProjectList, ProjectForm (add), CSV import
 *
 * Threat model:
 *   T-03-22: RSC admin gate — non-admins redirect to /${lang}/chat before any
 *             data is fetched or HTML is rendered. Mutations are re-checked in
 *             actions.ts + the core assertAdmin (three independent gates).
 *
 * References:
 *   - 03-08-PLAN.md Task 1
 *   - app/[lang]/(admin)/kb/page.tsx (the pattern this mirrors)
 *   - src/inventory/list.ts (listProjects — admin-gated, added in 03-08)
 *   - src/firebase/auth.ts (requireUser, UnauthorizedError)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { listProjects } from '@/src/inventory/list'
import { ProjectList, type SerializableProjectWithId } from './project-list'
import { ProjectForm } from './project-form'
import { ImportForm } from './import-form'

interface PageProps {
  params: Promise<{ lang: string }>
}

/**
 * Firestore `Timestamp` → plain `Date` (or null). A Timestamp is a class instance
 * and cannot cross the RSC→Client boundary unserialized — passing it raw throws
 * "Only plain objects… can be passed to Client Components". `Date` is a supported
 * serializable built-in, and returning a real `Date` keeps the `vpDate instanceof
 * Date` guards in ProjectList/ProjectForm working. Returns null for missing values
 * (vpDate is null when VP is not yet completed).
 */
function toDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  const t = value as { toDate?: () => Date }
  if (typeof t.toDate === 'function') return t.toDate()
  return null
}

export async function generateMetadata() {
  return {
    title: 'Inventory Manager — D2 Admin',
  }
}

export default async function InventoryAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate (T-03-22) ───────────────────────────────────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/inventory', {
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
    redirect(`/${lang}`)
  }

  // ── Fetch project list server-side ─────────────────────────────────────────
  let projects: Awaited<ReturnType<typeof listProjects>> = []
  try {
    projects = await listProjects(user)
  } catch {
    // Non-blocking — show empty list on error; admin can still add/import
    projects = []
  }

  // Serialize the Firestore Timestamp (vpDate) before the projects cross into the
  // ProjectList client component — the RSC→Client boundary only accepts plain objects.
  const serializedProjects: SerializableProjectWithId[] = projects.map(({ id, data }) => ({
    id,
    data: { ...data, vpDate: toDate(data.vpDate) },
  }))

  const t = await getTranslations('inventory')

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Add project form */}
      <div className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">{t('addProject')}</h2>
        <ProjectForm />
      </div>

      {/* Existing projects */}
      <div className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">
          {t('existingProjects')} ({projects.length})
        </h2>
        <ProjectList projects={serializedProjects} lang={lang} />
      </div>

      {/* CSV import */}
      <div className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">{t('importSection')}</h2>
        <ImportForm />
      </div>
    </div>
  )
}
