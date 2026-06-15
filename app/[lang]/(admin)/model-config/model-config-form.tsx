'use client'

/**
 * app/[lang]/(admin)/model-config/model-config-form.tsx — Model-config publish
 * client island (MODEL-02 / D-15/16/17).
 *
 * One `Card` per pillar (5 pillars always shown). Each card has a free-form
 * `Input` whose placeholder shows the current published value (or an "unset —
 * fallback in effect" hint when null), and a "Publish change" CTA that opens a
 * neutral-primary `AlertDialog` (the publish is REVERSIBLE, D-16 — NOT a
 * destructive red confirm). On a stale-ETag conflict the form surfaces the
 * UI-SPEC conflict copy + a "Reload" action and never blind-overwrites. On
 * success it shows the propagation toast ("may take a moment") — it does NOT
 * claim instant.
 *
 * There is NO send / connect / WABA affordance anywhere on this surface.
 * Model ids are free-form strings — NO hard-coded model id literal lives here
 * (ci-guard 1). All strings via next-intl (adminModelConfig.* — keys land in
 * the catalogs in 07-06).
 *
 * References:
 *   - MODEL-02, D-15/16/17, D-24
 *   - 07-UI-SPEC.md Surface 6 (per-pillar cards, neutral-primary confirm,
 *     ETag-conflict + propagation copy)
 *   - cohorts/cohort-management.tsx (useTransition + sonner + AlertDialog analog)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { publishModelConfig, type ModelConfigRow } from './actions'

interface ModelConfigFormProps {
  initialRows: ModelConfigRow[]
}

/** The 5 pillars in display order — kept here so the grid renders even when a
 *  read failed and `initialRows` is empty. */
const PILLAR_ORDER: ModelConfigRow['pillar'][] = [
  'coach',
  'finder',
  'reply',
  'router',
  'grader',
]

export function ModelConfigForm({ initialRows }: ModelConfigFormProps) {
  const t = useTranslations('adminModelConfig')

  // Current published value per pillar (null = unpublished, fallback in effect).
  const [published, setPublished] = useState<Record<string, string | null>>(() => {
    const map: Record<string, string | null> = {}
    for (const pillar of PILLAR_ORDER) map[pillar] = null
    for (const row of initialRows) map[row.pillar] = row.modelId
    return map
  })

  // Pending free-form input value per pillar.
  const [draft, setDraft] = useState<Record<string, string>>({})

  const [isPending, startTransition] = useTransition()

  // The pillar awaiting a publish confirm (null = dialog closed).
  const [confirmPillar, setConfirmPillar] = useState<ModelConfigRow['pillar'] | null>(null)

  // True after a conflict — prompts a reload rather than a blind retry.
  const [conflict, setConflict] = useState(false)

  function openConfirm(pillar: ModelConfigRow['pillar']) {
    if (!draft[pillar]?.trim()) return
    setConfirmPillar(pillar)
  }

  function handlePublishConfirm() {
    const pillar = confirmPillar
    if (!pillar) return
    const modelId = draft[pillar]?.trim()
    if (!modelId) return

    startTransition(async () => {
      const result = await publishModelConfig(pillar, modelId)
      if (result.ok) {
        // Do NOT claim instant — Remote Config propagates (D-15).
        toast.success(t('publishedToast'))
        setPublished((prev) => ({ ...prev, [pillar]: modelId }))
        setDraft((prev) => ({ ...prev, [pillar]: '' }))
        setConflict(false)
      } else if (result.error === 'conflict') {
        // Stale ETag — never blind-overwrite. Prompt a reload (D-16).
        setConflict(true)
        toast.error(t('conflictError'))
      } else {
        toast.error(result.error ?? t('genericError'))
      }
      setConfirmPillar(null)
    })
  }

  return (
    <div className="space-y-6">
      {conflict && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <p>{t('conflictBody')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => window.location.reload()}
          >
            {t('reloadCta')}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PILLAR_ORDER.map((pillar) => {
          const current = published[pillar]
          return (
            <Card key={pillar}>
              <CardHeader>
                <CardTitle className="capitalize">{t(`pillar.${pillar}`)}</CardTitle>
                <CardDescription>
                  {current ? (
                    <>
                      {t('currentLabel')}{' '}
                      <span className="font-mono text-sm">{current}</span>
                    </>
                  ) : (
                    t('unsetHint')
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor={`model-${pillar}`}>{t('newValueLabel')}</Label>
                <Input
                  id={`model-${pillar}`}
                  className="font-mono text-sm"
                  placeholder={current ?? t('inputPlaceholder')}
                  value={draft[pillar] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [pillar]: e.target.value }))
                  }
                  disabled={isPending}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={() => openConfirm(pillar)}
                    disabled={isPending || !draft[pillar]?.trim()}
                  >
                    {t('publishCta')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Publish confirm — NEUTRAL primary (reversible, D-16), NOT destructive. */}
      <AlertDialog
        open={confirmPillar !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPillar(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPillar
                ? t('confirmBody', {
                    pillar: t(`pillar.${confirmPillar}`),
                    model: draft[confirmPillar]?.trim() ?? '',
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancelCta')}</AlertDialogCancel>
            {/* Neutral primary (default) — NOT a destructive variant. */}
            <AlertDialogAction onClick={handlePublishConfirm} disabled={isPending}>
              {t('publishCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
