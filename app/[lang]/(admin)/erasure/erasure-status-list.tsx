'use client'

/**
 * app/[lang]/(admin)/erasure/erasure-status-list.tsx
 *
 * PDPA erasure request status list — Stage C client island.
 *
 * Displays the erasureRequests ledger entries with:
 *   - Subject ref (font-mono text-xs) — shows the subjectIdHash truncated
 *   - Subject type Badge
 *   - Status Badge (pending→secondary, in-progress→default, complete→secondary, failed→destructive)
 *   - Requested/completed timestamps (formatRelativeTime)
 *   - <72h SLA marker (slaRemaining / slaMet)
 *   - "Retry" for failed requests — re-opens the type-to-confirm gate (NOT one-click, HR-8)
 *
 * Pattern: stall-inbox.tsx:99-135 Card list + Badge + formatRelativeTime.
 *
 * References:
 *   - 05-UI-SPEC.md §Surface 5 Stage C
 *   - 05-PATTERNS.md §erasure-status-list.tsx
 *   - _components/stall-inbox.tsx:199-211 (formatRelativeTime)
 */

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ErasureRequestRow } from './actions'

interface ErasureStatusListProps {
  initialRequests: ErasureRequestRow[]
}

export function ErasureStatusList({ initialRequests }: ErasureStatusListProps) {
  const t = useTranslations('adminErasure')
  const [requests] = useState<ErasureRequestRow[]>(initialRequests)

  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('idle')}</p>
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <ErasureRequestCard key={req.id} req={req} t={t} />
      ))}
    </div>
  )
}

interface ErasureRequestCardProps {
  req: ErasureRequestRow
  t: ReturnType<typeof useTranslations<'adminErasure'>>
}

function ErasureRequestCard({ req, t }: ErasureRequestCardProps) {
  const slaDeadlineMs = req.slaDeadline
  // slaMet compares two fixed stored timestamps — safe during render.
  const slaMet = req.completedAt !== undefined && req.completedAt <= slaDeadlineMs
  // remainingMs/remainingHours/slaBreached depend on Date.now() — compute after mount
  // via a single batched state object to avoid hydration mismatch.
  const [slaLive, setSlaLive] = useState<{ remainingMs: number; remainingHours: number; slaBreached: boolean }>({
    remainingMs: 0,
    remainingHours: 0,
    slaBreached: false,
  })
  useEffect(() => {
    const ms = slaDeadlineMs - Date.now()
    // One-shot clock sync on mount — reading an external time source, not cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlaLive({
      remainingMs: ms,
      remainingHours: Math.ceil(ms / (1000 * 60 * 60)),
      slaBreached: ms <= 0 && !req.completedAt,
    })
  }, [slaDeadlineMs, req.completedAt])
  const { remainingMs, remainingHours, slaBreached } = slaLive

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: subject + type + status */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Subject hash — font-mono text-xs (05-UI-SPEC.md §Surface 5 Stage C) */}
              <span className="font-mono text-xs text-muted-foreground">
                {req.subjectIdHash.slice(0, 12)}…
              </span>

              {/* Subject type Badge */}
              <Badge variant="secondary" className="text-xs">
                {req.subjectType === 'lead' ? t('subjectTypeLead') : t('subjectTypeAgent')}
              </Badge>

              {/* Status Badge */}
              <StatusBadge status={req.status} t={t} />
            </div>

            {/* Timestamps */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                {t('colRequestedAt')}: {formatRelativeTime(req.requestedAt)}
              </span>
              {req.completedAt && (
                <span>
                  {t('colCompletedAt')}: {formatRelativeTime(req.completedAt)}
                </span>
              )}
            </div>

            {/* Error message for failed requests */}
            {req.status === 'failed' && req.error && (
              <p className="text-xs text-destructive">{req.error}</p>
            )}
          </div>

          {/* Right: SLA marker */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <SlaMarker
              status={req.status}
              slaMet={slaMet}
              slaBreached={slaBreached}
              remainingHours={remainingHours}
              t={t}
            />

            {/* Audit retained note for completed requests */}
            {req.status === 'complete' && (
              <p className="text-right text-xs text-muted-foreground">{t('auditRetainedNote')}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: ErasureRequestRow['status']
  t: ReturnType<typeof useTranslations<'adminErasure'>>
}

function StatusBadge({ status, t }: StatusBadgeProps) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary">{t('statusPending').split('—')[0]?.trim() ?? 'Pending'}</Badge>
    case 'sweeping':
      return <Badge variant="default">{t('statusInProgress').split('—')[0]?.trim() ?? 'In Progress'}</Badge>
    case 'complete':
      return (
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="size-3" />
          {t('statusComplete').split('.')[0]?.trim() ?? 'Complete'}
        </Badge>
      )
    case 'failed':
      return <Badge variant="destructive">{t('statusFailed').split('.')[0]?.trim() ?? 'Failed'}</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

// ─── SLA Marker ───────────────────────────────────────────────────────────────

interface SlaMarkerProps {
  status: ErasureRequestRow['status']
  slaMet: boolean
  slaBreached: boolean
  remainingHours: number
  t: ReturnType<typeof useTranslations<'adminErasure'>>
}

function SlaMarker({ status, slaMet, slaBreached, remainingHours, t }: SlaMarkerProps) {
  if (status === 'complete') {
    return (
      <Badge variant={slaMet ? 'secondary' : 'destructive'} className="text-xs">
        {slaMet ? t('slaMet') : 'SLA exceeded'}
      </Badge>
    )
  }

  if (slaBreached) {
    return (
      <Badge variant="destructive" className="text-xs">
        SLA exceeded
      </Badge>
    )
  }

  if (status === 'pending' || status === 'sweeping') {
    return (
      <Badge variant="outline" className="text-xs">
        {t('slaRemaining', { n: Math.max(1, remainingHours) })}
      </Badge>
    )
  }

  return null
}

// ─── formatRelativeTime ───────────────────────────────────────────────────────

/**
 * Format an epoch ms timestamp as a relative time (e.g. "2 days ago").
 * Copied from stall-inbox.tsx:199-211 pattern — same helper, same contract.
 */
function formatRelativeTime(epochMs: number): string {
  try {
    const diffMs = Date.now() - epochMs
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'just now'
  } catch {
    return new Date(epochMs).toLocaleDateString()
  }
}
