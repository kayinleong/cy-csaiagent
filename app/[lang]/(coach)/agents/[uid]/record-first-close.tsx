'use client'

/**
 * app/[lang]/(coach)/agents/[uid]/record-first-close.tsx — Record-first-close action
 * island (CLOSE-01 / D-21).
 *
 * The ONLY write affordance on the read-only agent profile (D-04 — it stamps
 * firstCloseAt; it NEVER edits journey state). A "Record first close?" AlertDialog
 * (neutral-primary — reversible-leaning, NOT destructive red, per UI-SPEC) confirms
 * before calling the idempotent recordFirstClose Server Action via useTransition +
 * sonner toast. When a close is already recorded, the trigger is disabled (the
 * action is also idempotent server-side — D-21 second-call no-op).
 *
 * All strings via next-intl (agentProfile.* — keys land in 07-06).
 *
 * References:
 *   - CLOSE-01 (record first close), D-21 (idempotent + admin-override copy)
 *   - 07-UI-SPEC.md Surface 8 ("Record first close?" neutral-primary confirm)
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { recordFirstClose } from '../actions'

interface RecordFirstCloseProps {
  agentUid: string
  /** False when a first close is already recorded (trigger disabled). */
  canRecord: boolean
}

export function RecordFirstClose({ agentUid, canRecord }: RecordFirstCloseProps) {
  const t = useTranslations('agentProfile')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      const result = await recordFirstClose(agentUid)
      if (result.ok) {
        toast.success(t('recordedToast'))
      } else if (result.error === 'already-recorded') {
        // D-21: a first close is already recorded; only an admin can override.
        toast.error(t('alreadyRecordedToast'))
      } else {
        toast.error(result.error ?? t('genericError'))
      }
      setOpen(false)
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={!canRecord || isPending}>{t('recordCloseCta')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('recordCloseTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('recordCloseBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setOpen(false)}>{t('cancel')}</AlertDialogCancel>
          {/* Neutral-primary (reversible-leaning) — NOT destructive (UI-SPEC). */}
          <AlertDialogAction onClick={handleConfirm}>{t('recordCloseConfirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
