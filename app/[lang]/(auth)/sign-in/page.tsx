/**
 * app/[lang]/(auth)/sign-in/page.tsx — Sign-in page (server component shell).
 *
 * Thin server component that renders localized copy from next-intl and
 * delegates the interactive form to SignInForm (client island).
 *
 * RSC-by-default: this file has NO "use client" — it's a server component.
 * The client island is sign-in-form.tsx ("use client").
 */

import { getTranslations } from 'next-intl/server'
import { SignInForm } from './sign-in-form'

// Metadata is per-locale (returned by the server component shell)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'auth' })
  return {
    title: t('signInTitle'),
  }
}

export default async function SignInPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  // Next.js 16: params is a Promise — always await
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'auth' })
  const tApp = await getTranslations({ locale: lang, namespace: 'app' })

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        {/* App name / branding */}
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{tApp('name')}</h1>
          <p className="text-sm text-muted-foreground">{t('signInTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('signInDescription')}</p>
        </div>

        {/* Client island — interactive form with Firebase Auth */}
        <SignInForm />
      </div>
    </main>
  )
}
