'use client'

/**
 * app/[lang]/(admin)/users/user-list.tsx — read-only directory of all users.
 *
 * Thin client island: renders the serialized user rows (email + role + senior
 * coach) passed from the RSC. Email is resolved server-side by listUsersWithRoles
 * (Auth-only PII); a missing email falls back to a truncated UID. The senior-coach
 * column reuses the same roster to show the coach's email (no extra lookup).
 *
 * No mutations here — role changes live on /roles, coach reassignment on
 * /coach-assignment. This is a directory view.
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Paginator, usePagination } from '../../_components/paginator'
import type { UserWithRole } from '../roles/actions'
import type { Role } from '@/src/firebase/auth'
import { TOKEN_CAP, REQUEST_CAP } from '@/src/ratelimit/window'
import { resetUserRateLimit, type RateBudgetSummary } from './actions'

interface UserListProps {
  users: UserWithRole[]
  /**
   * Current rate-limit budgets, keyed by uid (quick-kayinleong-049). Only users who have
   * actually spent something appear here — a missing entry means a fresh budget.
   */
  budgets?: RateBudgetSummary[]
}

function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'outline' {
  if (role === 'admin') return 'default'
  if (role === 'senior-coach') return 'secondary'
  return 'outline'
}

function roleLabelKey(role: Role): string {
  switch (role) {
    case 'senior-coach':
      return 'roleSeniorCoach'
    case 'admin':
      return 'roleAdmin'
    case 'read-only':
      return 'roleReadOnly'
    default:
      return 'roleNewAgent'
  }
}

export function UserList({ users, budgets = [] }: UserListProps) {
  const t = useTranslations('adminUsers')
  const [isPending, startTransition] = useTransition()
  const [resetTarget, setResetTarget] = useState<UserWithRole | null>(null)
  // Locally clear the readout after a successful reset, so the row reflects reality
  // without a full page refetch.
  const [resetUids, setResetUids] = useState<Set<string>>(new Set())

  const { page, setPage, pageItems, pageCount } = usePagination(users)

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('emptyList')}</p>
  }

  // Resolve a senior-coach UID to their email from the same roster (no extra read).
  const emailByUid = new Map(users.map((u) => [u.id, u.email]))
  const budgetByUid = new Map(budgets.map((b) => [b.uid, b]))

  /** Is this agent currently blocked by either cap in a live (non-expired) window? */
  function isAtCap(b: RateBudgetSummary): boolean {
    return !b.expired && (b.tokenCount >= TOKEN_CAP || b.requestCount >= REQUEST_CAP)
  }

  function handleReset(target: UserWithRole) {
    startTransition(async () => {
      const result = await resetUserRateLimit(target.id)
      if (result.ok) {
        setResetUids((prev) => new Set(prev).add(target.id))
        toast.success(t('resetLimitSuccess'))
      } else {
        toast.error(t('resetLimitError'))
      }
      setResetTarget(null)
    })
  }

  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colEmail')}</TableHead>
              <TableHead>{t('colRole')}</TableHead>
              <TableHead>{t('colCoach')}</TableHead>
              <TableHead>{t('colUsage')}</TableHead>
              <TableHead className="text-right">{t('colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((u) => {
              const coachEmail = u.seniorCoachId ? (emailByUid.get(u.seniorCoachId) ?? null) : null
              return (
                <TableRow key={u.id}>
                  <TableCell className={u.email ? 'text-sm' : 'font-mono text-xs'}>
                    {u.email ?? `${u.displayRef}…`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={roleBadgeVariant(u.role)}>
                      {t(roleLabelKey(u.role) as Parameters<typeof t>[0])}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.seniorCoachId
                      ? (coachEmail ?? `${u.seniorCoachId.slice(0, 8)}…`)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(() => {
                      const b = budgetByUid.get(u.id)
                      // A just-reset row, or an agent with no doc, has a fresh budget.
                      if (!b || resetUids.has(u.id)) {
                        return <span className="text-muted-foreground">—</span>
                      }
                      if (b.expired) {
                        return (
                          <span className="text-muted-foreground">
                            {t('usageWindowExpired')}
                          </span>
                        )
                      }
                      return (
                        <span
                          className={
                            isAtCap(b) ? 'font-medium text-destructive' : 'text-muted-foreground'
                          }
                        >
                          {t('usageTokens', {
                            used: b.tokenCount.toLocaleString(),
                            cap: TOKEN_CAP.toLocaleString(),
                          })}
                          {isAtCap(b) ? ` · ${t('usageAtCap')}` : ''}
                        </span>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setResetTarget(u)}
                    >
                      {t('resetLimit')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />

      {/* Confirm before resetting — it hands back a full fresh 24h budget. */}
      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetLimitConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('resetLimitConfirmBody', {
                user: resetTarget?.email ?? `${resetTarget?.displayRef ?? ''}…`,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => resetTarget && handleReset(resetTarget)}
            >
              {t('resetLimitConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
