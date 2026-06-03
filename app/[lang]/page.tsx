// app/[lang]/page.tsx — locale-scoped landing.
//
// Role-aware entry point: if a valid session exists, route by verified role
// (new-agent → chat; senior-coach | admin → dashboard). Otherwise → sign-in.
//
// Note: params is a Promise in Next.js 16 — always await. cookies() is async.
// redirect() throws NEXT_REDIRECT, so resolve the role inside try/catch but call
// redirect() OUTSIDE it (a redirect thrown inside the catch would be swallowed).

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireUser, type Role } from '@/src/firebase/auth'

export default async function LangPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  let role: Role | null = null
  if (sessionCookie?.value) {
    try {
      const syntheticReq = new Request('https://d2.app/', {
        headers: { Authorization: `Bearer ${sessionCookie.value}` },
      })
      role = (await requireUser(syntheticReq)).role
    } catch {
      role = null // invalid/expired session → sign-in
    }
  }

  if (role === 'senior-coach' || role === 'admin') {
    redirect(`/${lang}/dashboard`)
  }
  if (role === 'new-agent') {
    redirect(`/${lang}/chat`)
  }
  redirect(`/${lang}/sign-in`)
}
