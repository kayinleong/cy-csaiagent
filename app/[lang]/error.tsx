'use client'

/**
 * app/[lang]/error.tsx — error boundary for every route under /[lang].
 *
 * quick-kayinleong-046 (Track MOTION, task 6). The app previously had ZERO
 * error.tsx files, so an unhandled render error anywhere under /[lang] fell
 * through to Next's bare "Application error" page.
 *
 * ⚠ INTENTIONALLY COPY-FREE — follow-up required.
 * This track does not own src/i18n/messages/* (Track LEADS does), and D2 ships
 * EN/BM/中文 from day one, so no user-facing prose could be added without either
 * hard-coding English or referencing catalogue keys that do not exist yet. The
 * visible surface is therefore icon-only; the retry affordance carries an sr-only
 * English label so it is not unlabelled for assistive tech. FOLLOW-UP: add
 * `error.title` / `error.body` / `error.retry` to en/ms/zh.json and render them
 * here via useTranslations.
 *
 * PDPA: only `error.digest` is logged. Never log the message or stack — a server
 * component error can carry query values or user identifiers, and the project rule
 * is that PII never reaches a log.
 *
 * Motion: the card uses the `--ease-out-strong` / `--duration-modal` tokens added
 * in app/globals.css. It enters once, via @starting-style (Emil's tool ladder:
 * "Entry animation on mount, no JS state -> CSS @starting-style"), on transform +
 * opacity only, from scale(0.97) — never scale(0). The global
 * prefers-reduced-motion guard in globals.css collapses it.
 */

import { useEffect } from 'react'
import { OctagonAlert, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LangError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Digest only — see the PDPA note above.
    console.error('[route-error]', error.digest ?? 'no-digest')
  }, [error])

  return (
    <div
      role="alert"
      className="flex min-h-[60dvh] flex-1 items-center justify-center px-4 py-8"
    >
      <div
        data-slot="route-error"
        className="flex flex-col items-center gap-6 rounded-xl border bg-card px-8 py-10"
      >
        <OctagonAlert className="size-8 text-destructive" aria-hidden="true" />

        {/* Placeholder for the not-yet-translated title + body. Rendered as neutral
            blocks rather than English prose so no untranslated copy ships. */}
        <div className="flex w-48 flex-col items-center gap-2">
          <div className="h-3 w-full rounded-full bg-muted" />
          <div className="h-3 w-2/3 rounded-full bg-muted" />
        </div>

        {/* size-11 = 44px: the mobile minimum touch target. The vendored
            `icon` (32px) and `icon-lg` (36px) sizes are both under that floor. */}
        <Button
          variant="outline"
          size="icon-lg"
          className="size-11"
          onClick={() => reset()}
        >
          <RotateCcwIcon aria-hidden="true" />
          <span className="sr-only">Retry</span>
        </Button>
      </div>
    </div>
  )
}
