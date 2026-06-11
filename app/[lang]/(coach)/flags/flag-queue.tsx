'use client'

/**
 * app/[lang]/(coach)/flags/flag-queue.tsx — Flagged-conversation queue island (FLAG-03, S4).
 *
 * Renders the role-scoped flag list as a Table with a status Badge per row and
 * "Mark reviewed" / "Dismiss" row actions. Dismiss opens an AlertDialog confirm
 * (neutral-primary, NOT destructive — flags are reversible; never a bare confirm()).
 * Each row deep-links to the EXISTING audited conversation viewer by conversationId
 * (D-10 — no content rendered on the flag row). Empty + loading states use the
 * vendored Empty / Skeleton primitives. sonner toast on every Server Action.
 *
 * No send / connect / WhatsApp / auto-reply affordance anywhere (v1 constraint).
 * All strings via the flagQueue.* next-intl namespace (HR-2 / D-26) — no hard-coded copy.
 *
 * Status Badge variants (07-UI-SPEC §Color): open=default, reviewed=secondary,
 * dismissed=outline + muted.
 *
 * References:
 *   - FLAG-03 (queue + review/dismiss), D-10 (deep-link, content-free)
 *   - 07-UI-SPEC §S4 (table + badge + AlertDialog "Dismiss flag?" + Empty copy)
 *   - role-assignment.tsx (useTransition + sonner + AlertDialog analog)
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listFlags, reviewFlag, dismissFlag } from './actions'
import type { FlagRow, FlagStatus } from './actions'

interface FlagQueueProps {
  initialFlags: FlagRow[]
  lang: string
  /** True when the verified user is an admin (scope is set server-side; UX label only). */
  isAdmin: boolean
}

/** Map a flag status to its Badge variant (07-UI-SPEC §Color). */
function statusBadgeVariant(status: FlagStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'open') return 'default'
  if (status === 'reviewed') return 'secondary'
  return 'outline'
}

/** Format an ISO timestamp for the table (locale-friendly short date), or em-dash. */
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function FlagQueue({ initialFlags, lang, isAdmin: _isAdmin }: FlagQueueProps) {
  const t = useTranslations('flagQueue')

  const [flags, setFlags] = useState<FlagRow[]>(initialFlags)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  /** Re-read the queue after a mutation so the row reflects the new status. */
  function refresh() {
    startTransition(async () => {
      const result = await listFlags()
      if (result.ok && result.flags) {
        setFlags(result.flags)
      }
    })
  }

  function handleReview(flagId: string) {
    setPendingId(flagId)
    startTransition(async () => {
      const result = await reviewFlag(flagId)
      setPendingId(null)
      if (result.ok) {
        toast.success(t('reviewed'))
        refresh()
      } else {
        toast.error(result.error ?? t('error'))
      }
    })
  }

  function handleDismiss(flagId: string) {
    setConfirmDismissId(null)
    setPendingId(flagId)
    startTransition(async () => {
      const result = await dismissFlag(flagId)
      setPendingId(null)
      if (result.ok) {
        toast.success(t('dismissed'))
        refresh()
      } else {
        toast.error(result.error ?? t('error'))
      }
    })
  }

  // ── Loading skeleton (while a refresh transition is in flight on an empty list) ──
  if (isPending && flags.length === 0) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  // ── Empty state (Empty primitive per 07-UI-SPEC §S4) ──
  if (flags.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colConversation')}</TableHead>
            <TableHead>{t('colReason')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
            <TableHead>{t('colFlaggedAt')}</TableHead>
            <TableHead className="text-right">{t('colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flags.map((flag) => (
            <TableRow key={flag.id}>
              <TableCell className="font-mono text-xs">
                {/* Deep-link to the EXISTING audited viewer — content lives there, not here (D-10). */}
                <Link
                  href={`/${lang}/conversations?cid=${encodeURIComponent(flag.conversationId)}`}
                  className="underline underline-offset-4 hover:text-primary"
                >
                  {flag.conversationId.slice(0, 12)}…
                </Link>
              </TableCell>
              <TableCell className="max-w-xs truncate text-sm">{flag.reason}</TableCell>
              <TableCell>
                <Badge
                  variant={statusBadgeVariant(flag.status)}
                  className={flag.status === 'dismissed' ? 'text-muted-foreground' : undefined}
                >
                  {t(`status_${flag.status}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(flag.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                {flag.status === 'open' ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending && pendingId === flag.id}
                      onClick={() => handleReview(flag.id)}
                    >
                      {t('actionReview')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending && pendingId === flag.id}
                      onClick={() => setConfirmDismissId(flag.id)}
                    >
                      {t('actionDismiss')}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('actionDone')}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Dismiss confirm — neutral-primary (flags are reversible, NOT destructive). */}
      <AlertDialog
        open={confirmDismissId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDismissId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dismissConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dismissConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmDismissId) handleDismiss(confirmDismissId) }}
            >
              {t('dismissConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
