'use client'

/**
 * app/[lang]/(admin)/inventory/project-list.tsx
 *
 * Inventory project list with status badges, hide/unhide toggle, edit affordance,
 * and inline collateral attach (ADMIN-04, FIND-04).
 *
 * Mirrors app/[lang]/(admin)/kb/kb-doc-list.tsx — table + Badge + action buttons.
 *
 * References:
 *   - 03-08-PLAN.md Task 2
 *   - app/[lang]/(admin)/kb/kb-doc-list.tsx (table/badge pattern)
 *   - app/[lang]/(admin)/kb/publish-toggle.tsx (soft-toggle pattern)
 *   - src/inventory/list.ts (ProjectWithId)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProjectForm } from './project-form'
import { CollateralForm } from './collateral-form'
import { hideProjectAction, unhideProjectAction } from './actions'
import { Paginator, usePagination } from '../../_components/paginator'
import type { ProjectDoc } from '@/src/firebase/collections'

// ─── Client-serializable project ────────────────────────────────────────────────

/**
 * The RSC→Client boundary only accepts plain objects. A project's `vpDate` is a
 * Firestore `Timestamp` (a class instance) — passing it raw throws "Only plain
 * objects… can be passed to Client Components". The server shell (inventory/page.tsx)
 * converts it to a plain `Date` (or null) first. `Date` is a supported serializable
 * built-in, and keeping it a `Date` preserves the `instanceof Date` checks here and
 * in ProjectForm. (`embedding` is a plain number[] and stays serializable as-is.)
 */
export interface SerializableProjectWithId {
  id: string
  data: Omit<ProjectDoc, 'vpDate'> & { vpDate: Date | null }
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'sold_out' | 'hidden' | undefined }) {
  if (status === 'active') return <Badge variant="default">active</Badge>
  if (status === 'sold_out') return <Badge variant="secondary">sold out</Badge>
  return <Badge variant="outline">hidden</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ProjectListProps {
  projects: SerializableProjectWithId[]
  lang: string
}

export function ProjectList({ projects, lang: _lang }: ProjectListProps) {
  const t = useTranslations('inventory')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collateralProjectId, setCollateralProjectId] = useState<string | null>(null)
  const [hidingId, setHidingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { page, setPage, pageItems, pageCount } = usePagination(projects)

  function handleHideToggle(projectId: string, currentStatus: string) {
    setHidingId(projectId)
    startTransition(async () => {
      const isHidden = currentStatus === 'hidden'
      const result = isHidden
        ? await unhideProjectAction(projectId)
        : await hideProjectAction(projectId)

      setHidingId(null)
      if (!result.ok) {
        toast.error(isHidden ? t('unhideError') : t('hideError'))
        return
      }
      toast.success(isHidden ? t('unhidden') : t('hidden'))
      window.location.reload()
    })
  }

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colName')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
            <TableHead>{t('colPrice')}</TableHead>
            <TableHead>{t('colTenure')}</TableHead>
            <TableHead>{t('colBedrooms')}</TableHead>
            <TableHead>{t('colLocation')}</TableHead>
            <TableHead className="text-right">{t('colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map(({ id, data }) => (
            <TableRow key={id}>
              <TableCell className="max-w-[200px] truncate font-medium">{data.name}</TableCell>

              <TableCell>
                <StatusBadge status={data.status} />
              </TableCell>

              <TableCell>RM {data.priceValue.toLocaleString()}</TableCell>
              <TableCell>{data.tenure}</TableCell>
              <TableCell>{data.bedrooms}</TableCell>

              <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                {data.locationText}
              </TableCell>

              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {/* Edit affordance */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditingId((prev) => (prev === id ? null : id))
                    }
                  >
                    {t('actionEdit')}
                  </Button>

                  {/* Collateral affordance */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCollateralProjectId((prev) => (prev === id ? null : id))
                    }
                  >
                    {t('collateralSection')}
                  </Button>

                  {/* Hide / Unhide */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={
                      data.status !== 'hidden'
                        ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                        : ''
                    }
                    disabled={isPending && hidingId === id}
                    onClick={() => handleHideToggle(id, data.status)}
                  >
                    {hidingId === id
                      ? t('hiding')
                      : data.status === 'hidden'
                        ? t('actionUnhide')
                        : t('actionHide')}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />

      {/* Inline edit form */}
      {editingId && (
        <div className="mt-4">
          {projects
            .filter(({ id }) => id === editingId)
            .map(({ id, data }) => (
              <ProjectForm
                key={id}
                projectId={id}
                initialValues={{
                  name: data.name,
                  status: data.status,
                  priceValue: data.priceValue,
                  tenure: data.tenure,
                  bedrooms: data.bedrooms,
                  locationText: data.locationText,
                  description: data.description,
                  vpStatus: data.vpStatus,
                  vpDate: data.vpDate instanceof Date ? data.vpDate : null,
                  bumiQuota: data.bumiQuota,
                  foreignEligible: data.foreignEligible,
                }}
                onSuccess={() => {
                  setEditingId(null)
                  window.location.reload()
                }}
                onCancel={() => setEditingId(null)}
              />
            ))}
        </div>
      )}

      {/* Inline collateral form */}
      {collateralProjectId && (
        <div className="mt-4">
          <CollateralForm
            projectId={collateralProjectId}
            onDone={() => setCollateralProjectId(null)}
          />
        </div>
      )}
    </div>
  )
}
