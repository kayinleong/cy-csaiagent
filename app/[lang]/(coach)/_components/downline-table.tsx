'use client'

/**
 * app/[lang]/(coach)/_components/downline-table.tsx
 *
 * CDASH-01: Downline agent list with onboarding stage at a glance.
 *
 * Client island — displays the serialized agent rows passed from the RSC.
 * Renders: agent ID (ref), journey stage, current checkpoint, days in journey,
 * and a stall badge if an open stall exists.
 *
 * Intentionally shows agent UIDs as display refs (no raw names — PDPA).
 *
 * References:
 *   - CDASH-01 (downline onboarding stage at a glance)
 *   - T-02-28 (cross-coach exclusion enforced server-side)
 */

import { useTranslations } from 'next-intl'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Paginator, usePagination } from '../../_components/paginator'

export interface AgentRow {
  id: string
  /** Resolved Firebase Auth email; null falls back to a truncated UID. */
  email: string | null
  journeyStage: string
  currentCheckpoint: string
  seniorCoachId: string
  daysInJourney: number
  velocity: number
  hasOpenStall: boolean
}

interface DownlineTableProps {
  agents: AgentRow[]
}

export function DownlineTable({ agents }: DownlineTableProps) {
  const t = useTranslations('dashboard')
  const { page, setPage, pageItems, pageCount } = usePagination(agents)

  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('noAgents')}</p>
    )
  }

  return (
    <div>
      <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colAgent')}</TableHead>
            <TableHead>{t('colStage')}</TableHead>
            <TableHead>{t('colCheckpoint')}</TableHead>
            <TableHead>{t('colDays')}</TableHead>
            <TableHead>{t('colVelocity')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((agent) => (
            <TableRow key={agent.id}>
              {/* Email when resolvable; truncated UID is the fallback. */}
              <TableCell className={agent.email ? 'text-sm' : 'font-mono text-xs'}>
                {agent.email ?? `${agent.id.slice(0, 8)}…`}
              </TableCell>
              <TableCell>
                <Badge variant={stageBadgeVariant(agent.journeyStage)}>
                  {agent.journeyStage}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{agent.currentCheckpoint}</TableCell>
              <TableCell className="text-sm">{agent.daysInJourney}d</TableCell>
              <TableCell className="text-sm">#{agent.velocity}</TableCell>
              <TableCell>
                {agent.hasOpenStall ? (
                  <Badge variant="destructive">{t('stalledBadge')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('activeBadge')}</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}

function stageBadgeVariant(
  stage: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (stage) {
    case 'onboarding':
      return 'default'
    case 'training':
      return 'secondary'
    case 'qualified':
      return 'outline'
    default:
      return 'secondary'
  }
}
