/**
 * app/[lang]/(admin)/roles/page.tsx — Admin role/permission matrix (ADMIN-07).
 *
 * RSC shell: three-layer admin gate (verbatim copy of kb/page.tsx:43-68).
 * Fetches listUsersWithRoles server-side; passes as props to the RoleAssignment island.
 *
 * Gate layers:
 *   Layer 1: (admin)/layout.tsx redirects non-admins (first gate).
 *   Layer 2: This page re-checks role (second gate — defence-in-depth).
 *   Layer 3: Server Actions in actions.ts assert admin independently.
 *
 * References:
 *   - ADMIN-07 (read-only matrix + guarded assignment via setUserClaims)
 *   - HR-6 (demotion AlertDialog confirm — in RoleAssignment client island)
 *   - 05-PATTERNS.md §roles/page.tsx (kb/page.tsx gate verbatim)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { listUsersWithRoles } from './actions'
import { RoleAssignment } from './role-assignment'
import type { UserWithRole } from './actions'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'Role Matrix — D2 Admin',
  }
}

export default async function RolesAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate (verbatim copy of kb/page.tsx:43-68) ───────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin/roles', {
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

  // Fetch users + roles server-side; non-blocking (empty fallback on error — kb/page.tsx:71-77)
  let initialUsers: UserWithRole[] = []
  try {
    const result = await listUsersWithRoles()
    if (result.ok) {
      initialUsers = result.users
    }
  } catch {
    // Non-blocking — show empty matrix rather than crashing
    initialUsers = []
  }

  const t = await getTranslations('adminRoles')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <RoleAssignment initialUsers={initialUsers} lang={lang} />
    </div>
  )
}
