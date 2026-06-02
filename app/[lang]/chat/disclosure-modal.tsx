'use client'

/**
 * app/[lang]/chat/disclosure-modal.tsx — First-run AI disclosure modal (CHAT-05).
 *
 * PDPA-aligned: shown BEFORE the first interaction. A new agent sees this modal
 * when their disclosure ack flag is absent from localStorage (client gate) AND
 * from `users/{uid}.disclosureAckAt` (server-side defence-in-depth via Server Action).
 *
 * Client-side gate: localStorage key `d2-disclosure-ack` checked on mount.
 * Server-side gate: ackDisclosure() Server Action persists disclosureAckAt on users/{uid}.
 *
 * The modal blocks the chat input until the agent acknowledges. Once acked,
 * it never shows again (localStorage persists across refreshes).
 *
 * A persistent "AI" badge in the chat header (chat-header.tsx) provides ongoing
 * disclosure signal after the first-run modal is dismissed (CHAT-05).
 *
 * References: D-04, T-02-13, PDPA Article 7, TSD §5.3.
 */

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ackDisclosure } from '@/app/_actions/chat'

const DISCLOSURE_ACK_KEY = 'd2-disclosure-ack'

interface DisclosureModalProps {
  /** Called when the user acknowledges — parent unmounts the modal or hides it. */
  onAck: () => void
}

/**
 * First-run disclosure modal.
 *
 * Checks localStorage on mount; if ack is already present, calls onAck immediately
 * without rendering the modal (avoids flash). Otherwise renders the Dialog open.
 */
export function DisclosureModal({ onAck }: DisclosureModalProps) {
  const t = useTranslations('chat.disclosure')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Check localStorage — if already acked, skip the modal entirely
    const acked = typeof window !== 'undefined'
      ? localStorage.getItem(DISCLOSURE_ACK_KEY)
      : null
    if (acked) {
      onAck()
    } else {
      // One-shot mount-time localStorage gate — running once on mount is intentional
      // (post-mount read avoids SSR/hydration mismatch). Not a cascading-render risk.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAck = async () => {
    // 1. Persist to localStorage (primary client gate)
    localStorage.setItem(DISCLOSURE_ACK_KEY, '1')
    // 2. Persist to Firestore via Server Action (defence-in-depth / audit trace, T-02-13)
    void ackDisclosure()
    // 3. Close modal and notify parent
    setOpen(false)
    onAck()
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={() => void 0}>
      {/* Prevent closing via overlay click or Escape — user MUST acknowledge */}
      <DialogContent
        data-slot="disclosure-modal"
        className="max-w-sm mx-4"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{t('title')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed mt-2">
            {t('body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button
            data-slot="disclosure-ack-button"
            onClick={() => void handleAck()}
            className="w-full"
          >
            {t('ackButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
