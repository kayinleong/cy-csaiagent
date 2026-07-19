'use client'

/**
 * app/[lang]/chat/chat-header.tsx — Top navigation bar for the chat surface
 * (redesign quick-kayinleong-032).
 *
 * Layout (left → center → right), matching the D2 brand screenshot:
 *   LEFT   — conversation-history button, D2 lime logo, app name, persistent "AI" badge
 *   CENTER — segmented Auto / Coach / Finder / Reply pillar-override control (FIND-11)
 *   RIGHT  — EN / BM / 中文 reply-language toggles (CHAT-08) + "Talk to my coach" pill (CHAT-06)
 *
 * Preserved contracts (do not remove — referenced by e2e + PDPA):
 *   - data-slot="chat-header"        (e2e/finder-flow.spec.ts)
 *   - AI badge, text "AI", visible   (e2e/disclosure.spec.ts getByTestId('ai-badge'), CHAT-05)
 *   - aria-label per pillar item     (e2e/finder-flow.spec.ts locator('[aria-label="Finder"]'))
 *   - data-slot="talk-to-coach-button" + requestHandoff Server Action (CHAT-06)
 *
 * Security:
 *   - requestHandoff re-verifies the session server-side (fail-closed).
 *   - contextBundle carries references/summaries only — no raw PII (T-02-11).
 *   - langOverride is validated on the server too (T-02-12).
 *
 * References: D-04, D-05, CHAT-05, CHAT-06, CHAT-08, FIND-11.
 */

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { requestHandoff } from '@/app/_actions/chat'

export type LangOverride = 'en' | 'ms' | 'zh'
export type PillarOverride = 'coach' | 'finder' | 'reply'

const LANG_OPTIONS: LangOverride[] = ['en', 'ms', 'zh']

interface ChatHeaderProps {
  /** The active conversation ID — passed into the handoff context bundle. */
  conversationId: string
  /** Callback: invoked when the user selects a language override. */
  onLangOverride: (lang: LangOverride | undefined) => void
  /** Current override value (controlled — parent owns state). */
  langOverride?: LangOverride
  /**
   * Callback: invoked when the user selects a pillar override (FIND-11/SC5).
   * Passing undefined means 'Auto' (router decides).
   */
  onPillarOverride: (pillar: PillarOverride | undefined) => void
  /** Current pillar override value (controlled — parent owns state). */
  pillarOverride?: PillarOverride
  /** Callback: open the conversation history drawer. */
  onOpenHistory: () => void
}

/**
 * Top navigation for the chat surface. See file header for the preserved contracts.
 */
export function ChatHeader({
  conversationId,
  onLangOverride,
  langOverride,
  onPillarOverride,
  pillarOverride,
  onOpenHistory,
}: ChatHeaderProps) {
  const t = useTranslations('chat')
  const locale = useLocale()
  const [isHandoffPending, setIsHandoffPending] = useState(false)

  // The visually-active language: the pinned override, else the current UI locale
  // (so something is always highlighted, matching the screenshot). Clicking the
  // active one clears the override back to per-message auto-detect (CHAT-08).
  const activeLang = (langOverride ?? locale) as LangOverride

  const handleHandoff = async () => {
    if (isHandoffPending) return
    setIsHandoffPending(true)
    try {
      const result = await requestHandoff(conversationId)
      if (result.ok) {
        toast.success(t('talkToCoachSent'), { duration: 5000 })
      } else {
        toast.error(t('talkToCoachError'))
      }
    } catch {
      toast.error(t('talkToCoachError'))
    } finally {
      setIsHandoffPending(false)
    }
  }

  const handleLangClick = (lang: LangOverride) => {
    // Toggle-off when the pinned language is clicked again → revert to auto-detect.
    onLangOverride(lang === langOverride ? undefined : lang)
  }

  const handlePillarChange = (value: string) => {
    if (value === '' || value === 'auto' || value === pillarOverride) {
      onPillarOverride(undefined)
    } else {
      onPillarOverride(value as PillarOverride)
    }
  }

  const pillarItemClass =
    'h-7 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors ' +
    'hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground ' +
    'data-[state=on]:shadow-sm'

  return (
    <header
      data-slot="chat-header"
      className="shrink-0 sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:px-4">
        {/* ── LEFT: history · logo · name · AI badge ─────────────────────────── */}
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenHistory}
            className="size-8 shrink-0 text-muted-foreground"
            aria-label={t('history')}
          >
            <HistoryIcon className="h-4 w-4" />
          </Button>

          {/* D2 lime logo mark */}
          <div
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[0.8rem] font-bold tracking-tight text-primary-foreground"
          >
            D2
          </div>

          <span className="hidden truncate text-sm font-medium sm:block">
            D2 Agent Assistant
          </span>

          {/* Persistent AI disclosure badge (CHAT-05) — e2e getByTestId('ai-badge') */}
          <Badge
            data-slot="ai-badge"
            data-testid="ai-badge"
            variant="secondary"
            className="h-auto shrink-0 px-1.5 py-0.5 text-[0.625rem] font-medium"
          >
            {t('aiBadge')}
          </Badge>
        </div>

        {/* ── CENTER: segmented pillar tabs (FIND-11) ────────────────────────── */}
        <div className="flex flex-1 justify-center overflow-x-auto">
          <ToggleGroup
            type="single"
            value={pillarOverride ?? 'auto'}
            onValueChange={handlePillarChange}
            className="gap-1 rounded-full bg-muted p-1"
            aria-label={t('pillarOverride.label')}
          >
            <ToggleGroupItem value="auto" className={pillarItemClass} aria-label={t('pillarOverride.auto')}>
              {t('pillarOverride.auto')}
            </ToggleGroupItem>
            <ToggleGroupItem value="coach" className={pillarItemClass} aria-label={t('pillarOverride.coach')}>
              {t('pillarOverride.coach')}
            </ToggleGroupItem>
            <ToggleGroupItem value="finder" className={pillarItemClass} aria-label={t('pillarOverride.finder')}>
              {t('pillarOverride.finder')}
            </ToggleGroupItem>
            {/* Reply pillar (Phase 4). Selecting Reply with no leadId triggers the
                lead-selector in chat-shell before dispatch. */}
            <ToggleGroupItem value="reply" className={pillarItemClass} aria-label={t('pillarOverride.reply')}>
              {t('pillarOverride.reply')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* ── RIGHT: language toggles + talk-to-coach ────────────────────────── */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden items-center gap-0.5 sm:flex" aria-label={t('langOverride.label')}>
            {LANG_OPTIONS.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => handleLangClick(lang)}
                aria-label={t(`langOverride.${lang}`)}
                aria-pressed={activeLang === lang}
                className={cn(
                  'rounded-md px-1.5 py-1 text-xs font-medium transition-colors',
                  activeLang === lang
                    ? 'text-foreground'
                    : 'text-muted-foreground/60 hover:text-foreground',
                )}
              >
                {t(`langOverride.${lang}`)}
              </button>
            ))}
          </div>

          <Button
            data-slot="talk-to-coach-button"
            onClick={() => void handleHandoff()}
            disabled={isHandoffPending}
            className="h-8 shrink-0 rounded-full px-3 text-xs font-semibold"
          >
            {t('talkToCoach')}
          </Button>
        </div>
      </div>
    </header>
  )
}

// ─── Inline icon ─────────────────────────────────────────────────────────────

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}
