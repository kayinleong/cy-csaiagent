'use client'

/**
 * app/[lang]/(admin)/coach-assignment/coach-reassign.tsx — Reassign control (ASSIGN-01).
 *
 * Two pickers (agent + new coach) + a "Reassign coach?" AlertDialog confirm whose
 * body states the D-08 denorm behavior ("Past analytics keep their original
 * coach."). The confirm is NEUTRAL-PRIMARY (reversible — NOT destructive red,
 * per UI-SPEC color rules). Calls the admin-only atomic assignCoach action via
 * useTransition + sonner toast.
 *
 * All strings via next-intl (adminCoachAssignment.* — keys land in 07-06).
 *
 * References:
 *   - ASSIGN-01, D-07 (admin-only), D-08 (no historical backfill — stated in confirm)
 *   - 07-UI-SPEC.md Surface 3 (combobox/select + neutral-primary reassign confirm)
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
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { assignCoach } from './actions'

interface AgentOption {
  id: string
  displayRef: string
  role: string
}

interface CoachOption {
  id: string
  displayRef: string
}

interface CoachReassignProps {
  agents: AgentOption[]
  coaches: CoachOption[]
  lang: string
}

export function CoachReassign({ agents, coaches, lang: _lang }: CoachReassignProps) {
  const t = useTranslations('adminCoachAssignment')

  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [selectedCoach, setSelectedCoach] = useState<string>('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!selectedAgent || !selectedCoach) return
    setConfirmOpen(true)
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await assignCoach(selectedAgent, selectedCoach)
      if (result.ok) {
        toast.success(t('reassigned'))
        setSelectedAgent('')
        setSelectedCoach('')
      } else {
        toast.error(result.error ?? t('genericError'))
      }
      setConfirmOpen(false)
    })
  }

  if (agents.length === 0 || coaches.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const agentLabel = agents.find((a) => a.id === selectedAgent)?.displayRef ?? ''
  const coachLabel = coaches.find((c) => c.id === selectedCoach)?.displayRef ?? ''

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Agent picker */}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('agentLabel')}</p>
          <Select value={selectedAgent} onValueChange={setSelectedAgent}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder={t('agentPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="font-mono text-xs">{a.displayRef}…</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* New-coach picker */}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('coachLabel')}</p>
          <Select value={selectedCoach} onValueChange={setSelectedCoach}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder={t('coachPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {coaches.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="font-mono text-xs">{c.displayRef}…</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Single accent CTA (UI-SPEC: "Save assignment") */}
        <Button onClick={handleSubmit} disabled={!selectedAgent || !selectedCoach || isPending}>
          {isPending ? '…' : t('saveCta')}
        </Button>
      </div>

      {/* Reassign confirm (neutral-primary — reversible; states D-08 denorm behavior) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmBody', { agent: agentLabel, coach: coachLabel })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {t('confirmCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
