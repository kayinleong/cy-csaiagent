import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'D2 Agent Assistant',
    template: '%s | D2 Agent Assistant',
  },
  description:
    'AI-powered coaching and property matching for D2 real-estate agents. Your 11pm answer, powered by D2 knowledge.',
  robots: { index: false, follow: false }, // internal tool — no public indexing
}

/**
 * Root layout — minimal html/body shell.
 *
 * Locale-specific wiring (NextIntlClientProvider, <html lang={locale}>) lives in
 * app/[lang]/layout.tsx so it has access to the [lang] segment param.
 *
 * <Toaster /> is mounted here so toast() works from any descendant, including
 * the KB-miss handoff signal and ingestion progress toasts (D-10).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
