'use client'

/**
 * app/[lang]/chat/hero-empty-state.tsx — First-run hero for the chat surface
 * (redesign quick-kayinleong-032).
 *
 * Renders the serif greeting, subtitle, and a 2×2 grid of suggestion cards that
 * seed the first message. Shown by chat-shell only when the transcript is empty.
 *
 * Each card carries a pillar so tapping it pins the matching pillar override
 * (Finder/Coach/Reply) and sends the prompt. A Reply card with no active lead
 * flows through the existing lead-selector gate in chat-shell (unchanged).
 *
 * The greeting uses the signed-in agent's first name when Firebase Auth exposes a
 * displayName; otherwise it falls back to a name-less greeting (heroGreetingNoName).
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { onAuthStateChanged } from 'firebase/auth'
import { clientAuth } from '@/src/firebase/client'
import { cn } from '@/lib/utils'
import { REPLY_PILLAR_ENABLED, type PillarOverride } from './chat-header'

/** Suggestion cards — i18n key for the prompt + the pillar it routes to. */
const ALL_SUGGESTIONS: { key: string; pillar: PillarOverride }[] = [
  { key: 'finder', pillar: 'finder' },
  { key: 'coachViewing', pillar: 'coach' },
  { key: 'reply', pillar: 'reply' },
  { key: 'coachPricing', pillar: 'coach' },
]

/**
 * The cards actually offered, filtered by the same flag the header tab reads
 * (quick-kayinleong-075).
 *
 * Tapping a card PINS its pillar, so leaving the Reply card while the Reply tab is hidden
 * would give an agent a one-tap route into a mode the header says does not exist.
 */
const SUGGESTIONS = ALL_SUGGESTIONS.filter(
  (s) => s.pillar !== 'reply' || REPLY_PILLAR_ENABLED,
)

interface HeroEmptyStateProps {
  /** Fired when a suggestion card is tapped — seeds + sends the prompt. */
  onSuggestion: (prompt: string, pillar: PillarOverride) => void
}

export function HeroEmptyState({ onSuggestion }: HeroEmptyStateProps) {
  const t = useTranslations('chat')
  const [firstName, setFirstName] = useState<string>('')

  useEffect(() => {
    // Resolve the agent's first name for the greeting (best-effort — the hero
    // renders immediately with the name-less greeting until auth resolves).
    const unsub = onAuthStateChanged(clientAuth, (user) => {
      const display = user?.displayName?.trim() ?? ''
      setFirstName(display ? display.split(/\s+/)[0] : '')
    })
    return () => unsub()
  }, [])

  const greeting = firstName
    ? t('heroGreeting', { name: firstName })
    : t('heroGreetingNoName')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-10">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <h1 className="text-balance text-center font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl md:text-5xl">
          {greeting}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-center text-sm text-muted-foreground sm:text-base">
          {t(REPLY_PILLAR_ENABLED ? 'heroSubtitle' : 'heroSubtitleNoReply')}
        </p>

        {/* ── Suggestion cards (2×2) ───────────────────────────────────────── */}
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, pillar }) => {
            const prompt = t(`suggestions.${key}`)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSuggestion(prompt, pillar)}
                className={cn(
                  'group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-left',
                  'transition-colors hover:border-primary/60 hover:bg-accent/40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                )}
              >
                <span className="text-xs font-medium tracking-wide text-muted-foreground">
                  {t(`pillarOverride.${pillar}`)}
                </span>
                <span className="text-sm font-medium leading-snug text-foreground">
                  {prompt}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
