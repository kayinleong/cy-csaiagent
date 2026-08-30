/**
 * app/[lang]/chat/page.tsx — Mobile-first chat shell (server component), served at /[lang]/chat.
 *
 * RSC-by-default — this is a Server Component (no "use client").
 * It renders the mobile-first layout and mounts the client island.
 *
 * Auth strategy (quick-kayinleong-073):
 *   - HARD gate HERE: no valid session cookie -> redirect to sign-in with ?next= so the
 *     agent lands back on this page once they are in. proxy.ts does locale redirects only
 *     and never looks at the cookie, so this page is the first place that can gate.
 *   - HARD gate: /api/chat independently requires a valid Firebase Bearer token. This
 *     redirect is UX; that check is the security boundary.
 *   - Previously there was no gate at all: an unauthenticated visitor rendered the full
 *     chat surface, typed a question, and the only feedback was an error toast.
 *
 * Mobile-first:
 *   - Full-height flex column (100dvh on mobile for viewport consistency).
 *   - Message list takes flex-1 (fills remaining space above the input bar).
 *   - useIsMobile is handled in the client island (chat-input.tsx).
 *
 * Next.js 16 note: params is a Promise — must await before using.
 *
 * References: 01-PATTERNS.md Tier-A page.tsx (lines 136-147), TSD §3.3.
 */

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { signInUrlFor } from '@/src/auth/next-path'
import { ChatShell } from './chat-shell'
import { triggerDueJobs } from '@/app/_actions/jobs'

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'D2 Agent Assistant — Chat',
  description: 'Your AI-powered D2 onboarding coach. Available 24/7.',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ChatPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  // Next.js 16: params is a Promise — must await
  const { lang } = await params

  // ── Auth gate (quick-kayinleong-073) ───────────────────────────────────────
  // Same shape as the coach dashboard's gate: read the cookie, verify it through
  // requireUser, and send anyone without a valid session to sign-in carrying where they
  // were trying to go.
  //
  // Next.js 16: cookies() is async.
  const sessionCookie = (await cookies()).get('__session')
  if (!sessionCookie?.value) {
    redirect(signInUrlFor(lang, `/${lang}/chat`))
  }
  try {
    const syntheticReq = new Request('https://d2.app/chat', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    await requireUser(syntheticReq)
  } catch (err) {
    // An EXPIRED token lands here too, which is the common case: the cookie holds a raw ID
    // token good for one hour (see quick-059).
    if (err instanceof UnauthorizedError) {
      redirect(signInUrlFor(lang, `/${lang}/chat`))
    }
    throw err
  }

  // On-visit lazy-cron: fire-and-forget; never blocks rendering.
  // triggerDueJobs() gates on the session cookie — unauthenticated visits
  // are skipped silently. The last-run guard makes this cheap when no job is due.
  void triggerDueJobs()

  const t = await getTranslations('chat')
  const placeholder = t('placeholder')
  const sendLabel = t('send')

  return (
    /**
     * Full-height flex column for mobile-first layout.
     * 100dvh handles iOS Safari address-bar resize gracefully.
     * overflow-hidden prevents double scroll bars.
     */
    <main className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      {/* Chat shell: message list (flex-1) + input bar (sticky bottom) */}
      <ChatShell
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </main>
  )
}
