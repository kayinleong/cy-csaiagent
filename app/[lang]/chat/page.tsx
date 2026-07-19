/**
 * app/[lang]/chat/page.tsx — Mobile-first chat shell (server component), served at /[lang]/chat.
 *
 * RSC-by-default — this is a Server Component (no "use client").
 * It renders the mobile-first layout and mounts the client island.
 *
 * Auth strategy:
 *   - OPTIMISTIC: the proxy.ts checks the session cookie at the edge.
 *   - HARD gate: /api/chat requires a valid Firebase Bearer token server-side.
 *   - If the session cookie is absent, users land here unauthenticated — the
 *     ChatInput island will detect no Firebase currentUser and toast an error.
 *     Phase 2 will add a redirect-to-sign-in redirect from proxy.ts.
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
import { getTranslations } from 'next-intl/server'
import { Toaster } from '@/components/ui/sonner'
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
  void lang // lang is available for future locale-scoped logic

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
      {/* Sonner toaster for handoff signals + error notifications */}
      <Toaster richColors position="top-center" />

      {/* Chat shell: message list (flex-1) + input bar (sticky bottom) */}
      <ChatShell
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </main>
  )
}
