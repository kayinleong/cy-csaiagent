'use client'

/**
 * app/[lang]/(admin)/priority-list/priority-list-form.tsx — Priority-List publish
 * client island (quick-kayinleong-090).
 *
 * A single `Card` holding one roomy free-text `Textarea` (the ordering prompt) and
 * a "Publish" CTA that opens a neutral-primary `AlertDialog` — publishing is
 * REVERSIBLE (re-publish, or clear the box to turn the feature off), so it is NOT
 * a destructive red confirm. On a stale-value conflict the form surfaces the
 * conflict banner + a "Reload" action and never blind-overwrites.
 *
 * The help copy states the feature's real limit: this prompt only RE-ORDERS
 * projects that already matched the buyer's area, budget and eligibility. It can
 * never surface a sold-out project or one outside the area the user asked about.
 * An EMPTY box is a valid, meaningful state — it turns the feature off.
 *
 * All strings via next-intl (adminPriorityList.*).
 *
 * References:
 *   - model-config/model-config-form.tsx (useTransition + sonner + AlertDialog analog)
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { publishPriorityList } from './actions'

interface PriorityListFormProps {
  /** The currently published prompt ('' = nothing published / feature off). */
  initialText: string
}

export function PriorityListForm({ initialText }: PriorityListFormProps) {
  const t = useTranslations('adminPriorityList')

  // The value currently PUBLISHED (the optimistic-concurrency baseline).
  const [published, setPublished] = useState(initialText)

  // The value in the box (may differ from `published` until a publish lands).
  const [draft, setDraft] = useState(initialText)

  const [isPending, startTransition] = useTransition()

  // True while the publish confirm dialog is open.
  const [confirmOpen, setConfirmOpen] = useState(false)

  // True after a conflict — prompts a reload rather than a blind retry.
  const [conflict, setConflict] = useState(false)

  // Nothing to publish when the box matches what is already live.
  const isDirty = draft.trim() !== published.trim()

  function handlePublishConfirm() {
    const next = draft.trim()

    // Pass the value the admin currently sees so the action can detect a
    // concurrent publish — never blind-overwrite.
    const expectedCurrent = published

    startTransition(async () => {
      const result = await publishPriorityList(next, expectedCurrent)
      if (result.ok) {
        toast.success(t('publishedToast'))
        setPublished(next)
        setDraft(next)
        setConflict(false)
      } else if (result.error === 'conflict') {
        // Concurrent publish since load — never blind-overwrite. Prompt a reload.
        setConflict(true)
        toast.error(t('conflictError'))
      } else if (result.error === 'too-long') {
        toast.error(t('tooLongError'))
      } else {
        toast.error(t('genericError'))
      }
      setConfirmOpen(false)
    })
  }

  return (
    <div className="space-y-6">
      {conflict && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <p>{t('conflictError')}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>{t('fieldLabel')}</CardTitle>
          <CardDescription>{t('helpText')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="priority-list-text">{t('fieldLabel')}</Label>
          <Textarea
            id="priority-list-text"
            rows={10}
            className="min-h-56 text-sm"
            placeholder={t('fieldPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isPending}
          />
          <div className="flex justify-end">
            <Button onClick={() => setConfirmOpen(true)} disabled={isPending || !isDirty}>
              {t('publishButton')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Publish confirm — NEUTRAL primary (reversible), NOT destructive. */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
            {/* Neutral primary (default) — NOT a destructive variant. */}
            <AlertDialogAction onClick={handlePublishConfirm} disabled={isPending}>
              {t('confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
