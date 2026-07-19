'use client'

/**
 * app/[lang]/(coach)/agents/agent-list.tsx — Agent-list index table (NAV-01 / W2).
 *
 * Thin client island: renders the serialized downline rows passed from the RSC and
 * deep-links each row to the read-only `[uid]` profile drill-in via
 * `<Link href={`/${lang}/agents/${id}`}>`. This is what makes the NAV-01
 * `/[lang]/agents` href resolve AND reach the drill-in (no 404).
 *
 * READ-ONLY navigation only — NO journey-edit control, NO send/connect affordance.
 * Mirrors the downline-table.tsx row shape (display refs only — PDPA).
 *
 * References:
 *   - NAV-01 (href resolution), PROF-01, D-04 (read-only — no edit)
 *   - (coach)/_components/downline-table.tsx (row-shape analog)
 */

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Paginator, usePagination } from '../../_components/paginator'
import {
  journeyStageLabel,
  journeyCheckpointLabel,
  type JourneyTranslator,
} from '../../_components/journey-label'

export interface AgentIndexRow {
  id: string
  /** Resolved Firebase Auth email; null falls back to a truncated UID. */
  email: string | null
  journeyStage: string
  currentCheckpoint: string
}

interface AgentListProps {
  agents: AgentIndexRow[]
  lang: string
}

export function AgentList({ agents, lang }: AgentListProps) {
  const t = useTranslations('agentsIndex')
  const tj = useTranslations('journey') as unknown as JourneyTranslator
  const { page, setPage, pageItems, pageCount } = usePagination(agents)

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noAgents')}</p>
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((agent) => (
            <TableRow key={agent.id} className="hover:bg-muted/50">
              <TableCell>
                {/* Deep-link to the read-only [uid] profile drill-in (NAV-01). */}
                <Link
                  href={`/${lang}/agents/${agent.id}`}
                  className={`${agent.email ? 'text-sm' : 'font-mono text-xs'} font-medium text-foreground underline underline-offset-4 hover:opacity-70`}
                >
                  {agent.email ?? `${agent.id.slice(0, 8)}…`}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{journeyStageLabel(tj, agent.journeyStage)}</Badge>
              </TableCell>
              <TableCell className="text-sm">{journeyCheckpointLabel(tj, agent.currentCheckpoint)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
