'use client'

/**
 * app/[lang]/_components/debug-sidebar.tsx — hidden admin-only debug panel.
 *
 * Unlocked by the easter egg: pressing "e" DEBUG_UNLOCK_COUNT times in a burst
 * (ignored while typing in a form field). Slides in from the right (Sheet) and
 * exposes ONE destructive action — "Clear all data" — behind an AlertDialog
 * confirm. The Server Action re-verifies the admin claim server-side.
 *
 * Mounted ONLY for admins by console-shell.tsx, so this component assumes the
 * caller is an admin (the action gate is still the real boundary). Copy is
 * hardcoded English on purpose: a hidden dev tool adds no next-intl keys, so the
 * EN/BM/中文 i18n-parity gate stays green.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Bug } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { Button } from '@/components/ui/button'
import { clearAllData } from './debug-actions'
import {
  DEBUG_UNLOCK_COUNT,
  DEBUG_UNLOCK_WINDOW_MS,
  isUnlockKeypress,
} from './debug-trigger'

export function DebugSidebar() {
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const countRef = useRef(0)
  const lastPressRef = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isUnlockKeypress(e.key, e.target as EventTarget & { tagName?: string; isContentEditable?: boolean })) {
        return
      }
      const now = Date.now()
      countRef.current =
        now - lastPressRef.current > DEBUG_UNLOCK_WINDOW_MS ? 1 : countRef.current + 1
      lastPressRef.current = now

      if (countRef.current >= DEBUG_UNLOCK_COUNT) {
        countRef.current = 0
        setOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleClearConfirm() {
    startTransition(async () => {
      const result = await clearAllData()
      if (result.ok) {
        toast.success(`Cleared ${result.cleared} collections — users + model config preserved.`)
      } else {
        toast.error(result.error)
      }
      setConfirmOpen(false)
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bug className="size-4" />
              Debug
            </SheetTitle>
            <SheetDescription>
              Hidden admin tools. Actions here are not reversible — use with care.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2 px-4 pb-4">
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {isPending ? 'Clearing…' : 'Clear all data'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Deletes every Firestore collection except <code>users</code> and the model config
              (<code>appConfig</code>).
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all Firestore data except the <code>users</code> collection
              and the model config (<code>appConfig</code>). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={handleClearConfirm}
            >
              {isPending ? 'Clearing…' : 'Clear everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
