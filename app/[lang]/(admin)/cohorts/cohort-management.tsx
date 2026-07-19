'use client'

/**
 * app/[lang]/(admin)/cohorts/cohort-management.tsx — Cohort CRUD + membership island
 * (COH-03, quick-036).
 *
 * Regions:
 *   - A `Table` of cohorts (name, description, agent count) with row Manage/Edit/Delete.
 *   - Create/edit `Dialog` (name/description).
 *   - Delete `AlertDialog` (destructive).
 *   - Manage-agents `Dialog` (quick-036): add an agent (picker of agents not already
 *     in this cohort) + remove current members. Membership is the denormalized
 *     `agentProfiles/{uid}.cohortId` written via setAgentCohort (admin-only, audited).
 *
 * All sensitive writes go through Server Actions via useTransition + sonner toast.
 * No bare confirm(). All strings via next-intl (adminCohorts.*).
 */

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Users, UserPlus, UserMinus } from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createCohort,
  updateCohort,
  deleteCohort,
  setAgentCohort,
  type CohortSummary,
} from './actions'
import { Paginator, usePagination } from '../../_components/paginator'

/** An agent in the roster, for the membership picker. */
export interface CohortAgent {
  id: string
  displayRef: string
  email: string | null
  role: string
}

interface CohortManagementProps {
  initialCohorts: CohortSummary[]
  /** Full user roster (for the add-agent picker + member display). */
  agents: CohortAgent[]
  /** Map of agent uid → cohort id (current membership). */
  initialCohortMap: Record<string, string>
  lang: string
}

export function CohortManagement({
  initialCohorts,
  agents,
  initialCohortMap,
}: CohortManagementProps) {
  const t = useTranslations('adminCohorts')

  const [cohorts, setCohorts] = useState<CohortSummary[]>(initialCohorts)
  const { page, setPage, pageItems, pageCount } = usePagination(cohorts)
  const [isPending, startTransition] = useTransition()

  // Membership map (uid → cohortId), updated live on add/remove (quick-036).
  const [cohortMap, setCohortMap] = useState<Record<string, string>>(initialCohortMap)

  // Create/edit dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CohortSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<CohortSummary | null>(null)

  // Manage-agents dialog state
  const [manageTarget, setManageTarget] = useState<CohortSummary | null>(null)
  const [agentToAdd, setAgentToAdd] = useState('')

  const agentLabel = (a: CohortAgent) => a.email ?? a.displayRef
  const memberCount = (cohortId: string) =>
    Object.values(cohortMap).filter((c) => c === cohortId).length

  // Members + available agents for the currently-managed cohort.
  const members = useMemo(
    () => (manageTarget ? agents.filter((a) => cohortMap[a.id] === manageTarget.id) : []),
    [agents, cohortMap, manageTarget],
  )
  const availableAgents = useMemo(
    () =>
      manageTarget
        ? agents.filter((a) => a.role === 'new-agent' && cohortMap[a.id] !== manageTarget.id)
        : [],
    [agents, cohortMap, manageTarget],
  )

  function openCreate() {
    setEditing(null)
    setName('')
    setDescription('')
    setFormOpen(true)
  }

  function openEdit(cohort: CohortSummary) {
    setEditing(cohort)
    setName(cohort.name)
    setDescription(cohort.description)
    setFormOpen(true)
  }

  function openManage(cohort: CohortSummary) {
    setManageTarget(cohort)
    setAgentToAdd('')
  }

  function closeManage() {
    setManageTarget(null)
    setAgentToAdd('')
  }

  function handleSubmit() {
    if (!name.trim()) return
    startTransition(async () => {
      const result = editing
        ? await updateCohort(editing.id, { name: name.trim(), description: description.trim() })
        : await createCohort({ name: name.trim(), description: description.trim() })

      if (result.ok) {
        toast.success(editing ? t('updated') : t('created'))
        if (editing) {
          setCohorts((prev) =>
            prev.map((c) =>
              c.id === editing.id ? { ...c, name: name.trim(), description: description.trim() } : c,
            ),
          )
        } else if (result.id) {
          setCohorts((prev) => [
            ...prev,
            { id: result.id!, name: name.trim(), description: description.trim(), createdBy: '' },
          ])
        }
        setFormOpen(false)
        setEditing(null)
        setName('')
        setDescription('')
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  function handleDeleteConfirm() {
    const target = deleteTarget
    if (!target) return
    startTransition(async () => {
      const result = await deleteCohort(target.id)
      if (result.ok) {
        toast.success(t('deleted'))
        setCohorts((prev) => prev.filter((c) => c.id !== target.id))
      } else {
        toast.error(result.error ?? t('genericError'))
      }
      setDeleteTarget(null)
    })
  }

  function handleAddAgent() {
    const target = manageTarget
    if (!target || !agentToAdd) return
    startTransition(async () => {
      const result = await setAgentCohort(agentToAdd, target.id)
      if (result.ok) {
        toast.success(t('agentAdded'))
        setCohortMap((prev) => ({ ...prev, [agentToAdd]: target.id }))
        setAgentToAdd('')
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  function handleRemoveAgent(uid: string) {
    startTransition(async () => {
      const result = await setAgentCohort(uid, null)
      if (result.ok) {
        toast.success(t('agentRemoved'))
        setCohortMap((prev) => {
          const next = { ...prev }
          delete next[uid]
          return next
        })
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar — single accent CTA (UI-SPEC: "Create cohort") */}
      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={isPending}>
          <Plus className="size-4" />
          {t('createCta')}
        </Button>
      </div>

      {/* Cohort list */}
      {cohorts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div>
          <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colDescription')}</TableHead>
                <TableHead className="w-20 text-right">{t('colMembers')}</TableHead>
                <TableHead className="w-64 text-right">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((cohort) => (
                <TableRow key={cohort.id}>
                  <TableCell className="text-sm font-medium">{cohort.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cohort.description || '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {memberCount(cohort.id)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openManage(cohort)}
                        disabled={isPending}
                      >
                        <Users className="size-4" />
                        {t('manageCta')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(cohort)}
                        disabled={isPending}
                        aria-label={t('editCta')}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(cohort)}
                        disabled={isPending}
                        aria-label={t('deleteCta')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('createTitle')}</DialogTitle>
            <DialogDescription>
              {editing ? t('editDescription') : t('createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label htmlFor="cohort-name" className="text-sm font-medium">
                {t('fieldName')}
              </label>
              <Input
                id="cohort-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fieldNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="cohort-description" className="text-sm font-medium">
                {t('fieldDescription')}
              </label>
              <Textarea
                id="cohort-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('fieldDescriptionPlaceholder')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isPending}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
              {isPending ? '…' : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage-agents dialog (quick-036) */}
      <Dialog open={manageTarget !== null} onOpenChange={(open) => { if (!open) closeManage() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('manageTitle')}</DialogTitle>
            <DialogDescription>
              {manageTarget ? t('manageDescription', { cohort: manageTarget.name }) : ''}
            </DialogDescription>
          </DialogHeader>

          {manageTarget && (
            <div className="space-y-5 py-2">
              {/* Add an agent */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('addAgentLabel')}</label>
                <div className="flex gap-2">
                  <Select value={agentToAdd} onValueChange={setAgentToAdd} disabled={isPending}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t('addAgentPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgents.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          {t('noAvailableAgents')}
                        </div>
                      ) : (
                        availableAgents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {agentLabel(a)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddAgent} disabled={!agentToAdd || isPending}>
                    <UserPlus className="size-4" />
                    {t('addCta')}
                  </Button>
                </div>
              </div>

              {/* Current members */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t('membersLabel')} ({members.length})
                </label>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noMembers')}</p>
                ) : (
                  <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                    {members.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="truncate text-sm">{agentLabel(a)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAgent(a.id)}
                          disabled={isPending}
                        >
                          <UserMinus className="size-4" />
                          {t('removeCta')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeManage} disabled={isPending}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm (destructive — UI-SPEC "Delete cohort?") */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
