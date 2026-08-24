import type { Metadata } from 'next'
import { Geist, Geist_Mono, Fraunces } from 'next/font/google'
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

// Fraunces — editorial display serif used for hero headings (chat surface + app-wide
// heading language). Variable font: no explicit weight needed. quick-kayinleong-032.
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  display: 'swap',
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
 * <Toaster /> is mounted here — ONCE, and only here (quick-kayinleong-046).
 * Sonner's own guidance: "Never render it per-page or conditionally; a second
 * mounted Toaster duplicates every toast." app/[lang]/chat/page.tsx used to mount
 * a second one, so every chat toast fired twice; its richColors + top-center props
 * moved onto this instance. top-center is the mobile-correct position: D2 agents
 * are on phones and the bottom of the chat surface is the composer + keyboard.
 * toast() works from any descendant, including the KB-miss handoff signal and
 * ingestion progress toasts (D-10).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
