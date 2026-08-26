// app/[lang]/layout.tsx — locale-scoped layout
// Source: node_modules/next/dist/docs/01-app/02-guides/internationalization.md
//
// IMPORTANT (Next.js 16 gotcha): params is a Promise — always await it.
// https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing

import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { routing } from '@/src/i18n/routing'
import { SessionTokenSync } from './_components/session-token-sync'

// Generate static params for all supported locales so Next.js knows the valid
// [lang] values at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ lang: locale }))
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  // Next.js 16: params is async — must await
  const { lang } = await params

  // Validate locale — redirect to 404 if unsupported
  if (!(routing.locales as readonly string[]).includes(lang)) {
    notFound()
  }

  // Load messages server-side (next-intl getMessages reads from i18n/request.ts)
  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      {/* Keeps the __session cookie in step with the Firebase ID token inside it, which
          expires after an hour while the cookie itself is set for 14 days
          (quick-kayinleong-059). Renders nothing; a no-op when signed out. */}
      <SessionTokenSync />
      {children}
    </NextIntlClientProvider>
  )
}
