// app/[lang]/page.tsx — locale-scoped home page
// This is the landing page inside the [lang] segment.
// The sign-in surface will be implemented in 01-04; the chat shell in 01-11.
// For now this renders the locale-aware shell and redirects to the chat route.
//
// Note: params is a Promise in Next.js 16 — always await.

import { redirect } from 'next/navigation'

export default async function LangPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  // Redirect to the chat route once the chat shell is built (01-11).
  // For now, forward to sign-in (01-04 will create /[lang]/sign-in).
  redirect(`/${lang}/sign-in`)
}
