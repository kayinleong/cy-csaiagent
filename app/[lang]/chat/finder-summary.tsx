'use client'

/**
 * app/[lang]/chat/finder-summary.tsx — the closing summary of a Finder search answer
 * (quick-kayinleong-110).
 *
 * MODEL-WRITTEN plain text, rendered after the tables: what the lead asked for, what fits,
 * and a suggestion. Plain text only: never markdown, never innerHTML. A line that is absent
 * or blank is skipped, and with every line skipped the block renders nothing.
 */

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { FinderOutput } from '@/src/agents/finder/schema'

type Summary = NonNullable<FinderOutput['summary']>

const LINES = ['asked', 'found', 'suggestion'] as const

/** The summary lines that have text, in display order. Exported for unit testing. */
export function summaryLines(
  summary: Summary | undefined,
): Array<{ key: (typeof LINES)[number]; text: string }> {
  if (!summary) return []
  const out: Array<{ key: (typeof LINES)[number]; text: string }> = []
  for (const key of LINES) {
    const text = summary[key]
    if (typeof text === 'string' && text.trim().length > 0) out.push({ key, text: text.trim() })
  }
  return out
}

export function FinderSummary({ summary, className }: { summary?: Summary; className?: string }) {
  const t = useTranslations('chat.summary')
  const lines = summaryLines(summary)
  if (lines.length === 0) return null

  return (
    <div
      data-slot="finder-summary"
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 rounded-xl px-4 py-3 text-sm leading-relaxed ring-1 ring-foreground/10',
        className,
      )}
    >
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('title')}
      </span>
      <dl className="flex flex-col gap-2">
        {lines.map(({ key, text }) => (
          <div key={key} data-slot={`finder-summary-${key}`} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">{t(key)}</dt>
            <dd className="m-0 min-w-0 whitespace-pre-line break-words">{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
