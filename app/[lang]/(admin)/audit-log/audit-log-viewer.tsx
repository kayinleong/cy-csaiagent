'use client'

/**
 * app/[lang]/(admin)/audit-log/audit-log-viewer.tsx — Audit-log viewer client
 * island (AUDIT-01 / D-12).
 *
 * A read-only `Table` of audit metadata with a filter toolbar (action `Select`,
 * actorUid `Input`, date inputs) and a cursor-based "Load more" control. Machine
 * values — `actorUid` and `targetRef` — render in `font-mono text-sm` (UI-SPEC
 * typography). Hashes are NEVER shown: the action returns metadata only and the
 * viewer has no concept of a decoded hash (D-12).
 *
 * There is NO write affordance on this surface (read-only). All strings via
 * next-intl (adminAuditLog.* — keys land in the catalogs in 07-06).
 *
 * References:
 *   - AUDIT-01, D-12 (hashes not decoded)
 *   - 07-UI-SPEC.md Surface 5 (table + filter toolbar + "Load more"; font-mono)
 *   - conversations/conversation-viewer.tsx (table + filter analog)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { listAuditLogs, type AuditLogRow, type AuditLogFilter } from './actions'

interface AuditLogViewerProps {
  initialRows: AuditLogRow[]
}

/** Known audit actions for the filter `Select`. "all" means no action filter. */
const ACTION_OPTIONS = [
  'all',
  'chat',
  'role-assign',
  'coach-assign',
  'cohort-create',
  'cohort-update',
  'cohort-delete',
  'model_config_publish',
  'erasure',
] as const

export function AuditLogViewer({ initialRows }: AuditLogViewerProps) {
  const t = useTranslations('adminAuditLog')

  const [rows, setRows] = useState<AuditLogRow[]>(initialRows)
  const [action, setAction] = useState<string>('all')
  const [actorUid, setActorUid] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [isPending, startTransition] = useTransition()

  function buildFilter(cursorTs?: number): AuditLogFilter {
    const filter: AuditLogFilter = {}
    if (action !== 'all') filter.action = action
    if (actorUid.trim()) filter.actorUid = actorUid.trim()
    if (fromDate) filter.fromTs = new Date(fromDate).getTime()
    if (toDate) filter.toTs = new Date(toDate).getTime()
    if (cursorTs !== undefined) filter.cursorTs = cursorTs
    return filter
  }

  function applyFilters() {
    startTransition(async () => {
      const result = await listAuditLogs(buildFilter())
      if (result.ok) {
        setRows(result.rows)
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  function loadMore() {
    const last = rows[rows.length - 1]
    if (!last?.ts) return
    startTransition(async () => {
      const result = await listAuditLogs(buildFilter(last.ts ?? undefined))
      if (result.ok) {
        setRows((prev) => [...prev, ...result.rows])
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  function formatTs(ts: number | null): string {
    if (ts == null) return '—'
    return new Date(ts).toISOString()
  }

  return (
    <div className="space-y-6">
      {/* Filter toolbar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="filter-action">{t('filterAction')}</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="filter-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt === 'all' ? t('filterActionAll') : opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-actor">{t('filterActor')}</Label>
          <Input
            id="filter-actor"
            className="font-mono text-sm"
            value={actorUid}
            onChange={(e) => setActorUid(e.target.value)}
            placeholder={t('filterActorPlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-from">{t('filterFrom')}</Label>
          <Input
            id="filter-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-to">{t('filterTo')}</Label>
          <Input
            id="filter-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <Button onClick={applyFilters} disabled={isPending}>
          {t('applyCta')}
        </Button>
      </div>

      {/* Results */}
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colTime')}</TableHead>
                <TableHead>{t('colAction')}</TableHead>
                <TableHead>{t('colActor')}</TableHead>
                <TableHead>{t('colTarget')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatTs(row.ts)}
                  </TableCell>
                  <TableCell className="text-sm">{row.action}</TableCell>
                  <TableCell className="font-mono text-sm">{row.actorUid}</TableCell>
                  <TableCell className="font-mono text-sm">{row.targetRef ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Cursor "Load more" — bounded pages of 50 (D-13). */}
          {rows.length >= 50 && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={isPending}>
                {t('loadMoreCta')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
