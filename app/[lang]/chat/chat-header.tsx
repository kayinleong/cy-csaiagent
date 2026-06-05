'use client'

/**
 * app/[lang]/chat/chat-header.tsx — Sticky chat header with AI badge, handoff action,
 * and language-override chip (CHAT-05, CHAT-06, CHAT-08).
 *
 * Contains:
 *   (a) A persistent "AI" Badge — ongoing disclosure signal after first-run modal (CHAT-05)
 *   (b) A "Talk to my coach" button — triggers requestHandoff Server Action with a
 *       context bundle ({conversationId, journeyStage, summary}) and toasts result (CHAT-06)
 *   (c) A language-override ToggleGroup chip (EN/BM/中文) — sets langOverride which
 *       is passed through ChatInput → POST body (CHAT-08)
 *
 * Security:
 *   - requestHandoff is a Server Action — re-verifies the session server-side (fail-closed).
 *   - contextBundle contains references/summaries only — no raw PII (T-02-11).
 *   - langOverride is validated on the server too (T-02-12 — worst case is wrong-lang reply).
 *
 * References: D-04, D-05, CHAT-05, CHAT-06, CHAT-08.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { requestHandoff } from '@/app/_actions/chat'

export type LangOverride = 'en' | 'ms' | 'zh'
export type PillarOverride = 'coach' | 'finder' | 'reply'

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
 * Sticky chat header.
 *
 * Renders a sticky top bar with:
 *   - App name / back-to-history button
 *   - Persistent "AI" badge (PDPA disclosure — always visible once acked)
 *   - "Talk to my coach" handoff button
 *   - Language-override ToggleGroup (EN / BM / 中文)
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
  const [isHandoffPending, setIsHandoffPending] = useState(false)

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

  const handleLangChange = (value: string) => {
    if (value === '' || value === langOverride) {
      // Deselect — clear override and revert to auto-detect
      onLangOverride(undefined)
    } else {
      onLangOverride(value as LangOverride)
    }
  }

  const handlePillarChange = (value: string) => {
    if (value === '' || value === 'auto' || value === pillarOverride) {
      // Deselect or Auto selected — clear pillar override, router decides
      onPillarOverride(undefined)
    } else {
      onPillarOverride(value as PillarOverride)
    }
  }

  return (
    <header
      data-slot="chat-header"
      className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-3 py-2 flex items-center gap-2"
    >
      {/* History button — opens conversation list drawer */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenHistory}
        className="shrink-0 text-muted-foreground h-8 px-2"
        aria-label={t('history')}
      >
        <HistoryIcon className="h-4 w-4" />
      </Button>

      {/* App name — takes up remaining space */}
      <span className="flex-1 font-medium text-sm truncate">
        D2 Agent Assistant
      </span>

      {/* Persistent AI badge — ongoing disclosure signal (CHAT-05) */}
      <Badge
        data-slot="ai-badge"
        variant="secondary"
        className="text-[0.625rem] px-1.5 py-0.5 h-auto font-medium shrink-0"
      >
        {t('aiBadge')}
      </Badge>

      {/* Pillar override chip — Auto / Coach / Finder (FIND-11) */}
      <ToggleGroup
        type="single"
        value={pillarOverride ?? 'auto'}
        onValueChange={handlePillarChange}
        className="shrink-0 gap-0.5"
        aria-label={t('pillarOverride.label')}
      >
        <ToggleGroupItem
          value="auto"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('pillarOverride.auto')}
        >
          {t('pillarOverride.auto')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="coach"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('pillarOverride.coach')}
        >
          {t('pillarOverride.coach')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="finder"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('pillarOverride.finder')}
        >
          {t('pillarOverride.finder')}
        </ToggleGroupItem>
        {/* Reply pillar (Phase 4, Surface 3). Selecting Reply with no leadId
            triggers the lead-selector (Surface 2) in chat-shell before dispatch. */}
        <ToggleGroupItem
          value="reply"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('pillarOverride.reply')}
        >
          {t('pillarOverride.reply')}
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Language override chip — EN / BM / 中文 (CHAT-08) */}
      <ToggleGroup
        type="single"
        value={langOverride ?? ''}
        onValueChange={handleLangChange}
        className="shrink-0 gap-0.5"
        aria-label={t('langOverride.label')}
      >
        <ToggleGroupItem
          value="en"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('langOverride.en')}
        >
          {t('langOverride.en')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="ms"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('langOverride.ms')}
        >
          {t('langOverride.ms')}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="zh"
          size="sm"
          className="h-6 px-1.5 text-[0.625rem] font-medium"
          aria-label={t('langOverride.zh')}
        >
          {t('langOverride.zh')}
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Talk to my coach — handoff action (CHAT-06) */}
      <Button
        data-slot="talk-to-coach-button"
        variant="outline"
        size="sm"
        onClick={() => void handleHandoff()}
        disabled={isHandoffPending}
        className="shrink-0 h-7 px-2 text-[0.6875rem]"
      >
        {t('talkToCoach')}
      </Button>
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
