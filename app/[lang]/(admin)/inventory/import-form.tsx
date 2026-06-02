'use client'

/**
 * app/[lang]/(admin)/inventory/import-form.tsx
 *
 * CSV bulk-import control for the inventory admin (ADMIN-04, FIND-02).
 *
 * Admin pastes a CSV string (or types it) → calls importProjectsAction
 * which uses the default csvProjectSource adapter (G4 FORMAT TBD — flagged
 * for Derek, see 03-08-SUMMARY.md § Flagged Decision G4).
 *
 * Surfaces per-row validation errors returned by importProjects so the admin
 * can fix individual rows without re-importing everything (T-03-23 / ASVS V5).
 *
 * Reuses vendored shadcn: Card, Textarea, Button.
 * All labels via useTranslations('inventory') (trilingual).
 *
 * References:
 *   - 03-08-PLAN.md Task 2 (import control)
 *   - app/[lang]/(admin)/inventory/actions.ts (importProjectsAction)
 *   - src/inventory/import.ts (csvProjectSource + ImportResult)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { importProjectsAction } from './actions'

interface RowError {
  row: number
  message: string
}

export function ImportForm() {
  const t = useTranslations('inventory')
  const [isPending, startTransition] = useTransition()
  const [rowErrors, setRowErrors] = useState<RowError[]>([])
  const [lastResult, setLastResult] = useState<{ created: number; errors: number } | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setRowErrors([])
    setLastResult(null)

    const formData = new FormData(e.currentTarget)
    const raw = (formData.get('csv') as string) ?? ''

    if (!raw.trim()) {
      toast.error('Please paste CSV content before importing.')
      return
    }

    startTransition(async () => {
      const result = await importProjectsAction(raw)

      if (!result.ok) {
        toast.error(result.error ?? t('importError'))
        return
      }

      const created = result.created ?? 0
      const errors = result.errors ?? []

      setLastResult({ created, errors: errors.length })
      setRowErrors(errors)

      if (errors.length === 0) {
        toast.success(t('importSuccess').replace('{created}', String(created)))
        window.location.reload()
      } else {
        toast.warning(
          t('importPartial')
            .replace('{created}', String(created))
            .replace('{errors}', String(errors.length)),
        )
        if (created > 0) {
          // Reload to show the successfully imported projects
          window.location.reload()
        }
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">{t('importSection')}</h3>
        <p className="text-sm text-muted-foreground">{t('importDescription')}</p>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <Textarea
            name="csv"
            placeholder={t('importPlaceholder')}
            rows={8}
            disabled={isPending}
            className="min-h-[160px] font-mono text-xs"
          />

          {/* Per-row errors */}
          {rowErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="mb-2 font-medium text-destructive">{t('importRowErrors')}</p>
              <ul className="space-y-1">
                {rowErrors.map((err) => (
                  <li key={err.row} className="text-destructive/80">
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Success summary */}
          {lastResult && rowErrors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('importSuccess').replace('{created}', String(lastResult.created))}
            </p>
          )}
        </CardContent>

        <CardFooter className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? t('importing') : t('importButton')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
