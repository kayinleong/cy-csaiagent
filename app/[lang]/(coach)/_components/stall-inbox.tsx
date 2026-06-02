'use client'

/**
 * app/[lang]/(coach)/_components/stall-inbox.tsx
 *
 * CDASH-02: Stall-alert inbox — lists open stall escalations for the coach's downline.
 *
 * Displays: agent UID (truncated for PDPA), stall reason, time opened.
 * Resolve action: calls the resolveStall Server Action, optimistically removes
 * the resolved stall from the local list.
 *
 * Working-hours note (CDASH-06): escalation DELIVERY is gated by working hours
 * in the lazy-cron escalate job (02-05). Stalls already in the inbox (status:'open')
 * are always visible regardless of time.
 *
 * References:
 *   - CDASH-02 (stall-alert inbox)
 *   - CDASH-06 (working-hours gating on escalation delivery)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { resolveStall } from '../dashboard/actions'

export interface StallItem {
  id: string
  agentUid: string
  reason: string
  openedAt: string // ISO string (serialized from RSC)
  contextBundle: Record<string, unknown>
}

interface StallInboxProps {
  stalls: StallItem[]
}

export function StallInbox({ stalls: initialStalls }: StallInboxProps) {
  const t = useTranslations('dashboard')
  const [stalls, setStalls] = useState<StallItem[]>(initialStalls)
  const [isPending, startTransition] = useTransition()

  function handleResolve(eid: string) {
    startTransition(async () => {
      const result = await resolveStall(eid)
      if (result.ok) {
        setStalls((prev) => prev.filter((s) => s.id !== eid))
        toast.success(t('stallResolved'))
      } else {
        toast.error(result.error ?? t('stallResolveError'))
      }
    })
  }

  if (stalls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('noStalls')}</p>
    )
  }

  return (
    <div className="space-y-3">
      {stalls.map((stall) => (
        <Card key={stall.id}>
          <CardContent className="flex items-start justify-between gap-4 py-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">{stall.reason}</Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {t('agentRef')}: {stall.agentUid.slice(0, 8)}…
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('openedAt')}: {formatRelativeTime(stall.openedAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handleResolve(stall.id)}
            >
              {t('resolveStall')}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Format an ISO date string as a relative time (e.g. "2 days ago"). */
function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'just now'
  } catch {
    return iso
  }
}
