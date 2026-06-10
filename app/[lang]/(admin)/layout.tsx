/**
 * app/[lang]/(admin)/layout.tsx — Admin route-group shell + role gate.
 *
 * Access boundary for the admin console surfaces (KB, inventory). Resolves the
 * verified role server-side and:
 *   - no session     → /[lang]/sign-in
 *   - new-agent      → /[lang]/chat
 *   - read-only      → /[lang] (Home — RO-01; never chat or an admin page)
 *   - senior-coach   → /[lang]/dashboard (has a console, but not admin pages)
 *   - admin          → render the console (sidebar + content)
 *
 * The gate lives here (defense-in-depth alongside each page's own admin check)
 * and the verified role drives the role-filtered AppSidebar.
 *
 * RO-01 (Wave 3 / 06-04): this layout still DENIES the read-only role every admin
 * page — read-only only renders the specific pages whose own gate admits it (usage
 * analytics). The redirect below catches read-only on EVERY other admin route and
 * sends it to Home, NOT chat (read-only is not a chat role; downline/write surfaces
 * carry PII). The deny is server-side (this gate) + the Firestore rules (Wave 2),
 * never nav-hiding.
 *
 * References: access matrix — only admin manages KB + inventory.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { ConsoleShell } from '../_components/console-shell'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    const syntheticReq = new Request('https://d2.app/admin', {
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
    // Senior-coaches have a console (dashboard) but not the admin pages.
    // Read-only is sent to Home (its analytics landing), never chat (RO-01).
    redirect(
      user.role === 'senior-coach'
        ? `/${lang}/dashboard`
        : user.role === 'read-only'
          ? `/${lang}`
          : `/${lang}/chat`
    )
  }

  return (
    <ConsoleShell role={user.role} lang={lang}>
      {children}
    </ConsoleShell>
  )
}
