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
 * RO-01: this layout ADMITS the read-only role INTO the group so the read-only-allowed
 * pages (usage analytics, the KB version-history viewer) are reachable — each such
 * page's OWN gate admits read-only, and every admin-only page's own gate redirects
 * read-only to Home (NEVER chat; read-only is not a chat role). new-agent → chat,
 * senior-coach → its own dashboard console. The read-only deny on admin-only
 * surfaces is enforced server-side (the per-page gate) + the Firestore rules
 * (Wave 2), never nav-hiding.
 *
 * NOTE (CR-01 fix): if this layout denied read-only here, the page-level gates that
 * admit read-only would be unreachable dead code — so the group-level gate must let
 * read-only through and defer the per-page decision to each page.
 *
 * References: access matrix — only admin manages KB + inventory; read-only reads
 * analytics + the KB version viewer.
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

  // Admit admin AND read-only into the group; each page's own gate then decides
  // (usage + KB viewer admit read-only; every admin-only page redirects it to Home).
  // CR-01: denying read-only here would make those page gates unreachable dead code.
  if (user.role !== 'admin' && user.role !== 'read-only') {
    // Senior-coaches have a console (dashboard) but not the admin group.
    // new-agent → chat.
    redirect(user.role === 'senior-coach' ? `/${lang}/dashboard` : `/${lang}/chat`)
  }

  return (
    <ConsoleShell role={user.role} lang={lang}>
      {children}
    </ConsoleShell>
  )
}
