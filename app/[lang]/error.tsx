'use client'

/**
 * app/[lang]/error.tsx — error boundary for every route under /[lang].
 *
 * quick-kayinleong-046 (Track MOTION, task 6). The app previously had ZERO
 * error.tsx files, so an unhandled render error anywhere under /[lang] fell
 * through to Next's bare "Application error" page.
 *
 * Copy comes from the `errors.routeError*` keys, at EN/BM/中文 parity.
 *
 * useTranslations is safe HERE specifically: an error.tsx boundary cannot catch a
 * throw from its OWN layout, so by the time this renders `app/[lang]/layout.tsx`
 * (and therefore NextIntlClientProvider) has already rendered successfully. A throw
 * in the layout itself escalates past this boundary to global-error instead.
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
import { useTranslations } from 'next-intl'
import { OctagonAlert, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LangError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors')

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

        <div className="flex max-w-xs flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium">{t('routeErrorTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('routeErrorBody')}</p>
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
          <span className="sr-only">{t('routeErrorRetry')}</span>
        </Button>
      </div>
    </div>
  )
}
