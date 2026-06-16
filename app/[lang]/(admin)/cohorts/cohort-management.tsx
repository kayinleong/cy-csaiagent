'use client'

/**
 * app/[lang]/(admin)/cohorts/cohort-management.tsx — Cohort CRUD client island (COH-03).
 *
 * Three regions:
 *   - A `Table` listing cohorts (name, description, ref) with row Edit/Delete actions.
 *   - A create/edit `Dialog` with a `name`/`description` form.
 *   - A delete `AlertDialog` (variant="destructive") with the UI-SPEC "Delete cohort?" copy.
 *
 * All sensitive writes go through Server Actions (createCohort/updateCohort/deleteCohort)
 * via useTransition + sonner toast. No bare confirm(). All strings via next-intl
 * (adminCohorts.* — keys land in the catalogs in 07-06).
 *
 * References:
 *   - COH-03, 07-UI-SPEC.md Surface 1 (table + dialog + destructive delete confirm)
 *   - roles/role-assignment.tsx (useTransition + sonner + AlertDialog analog)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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
import { createCohort, updateCohort, deleteCohort, type CohortSummary } from './actions'
import { Paginator, usePagination } from '../../_components/paginator'

interface CohortManagementProps {
  initialCohorts: CohortSummary[]
  lang: string
}

export function CohortManagement({ initialCohorts, lang: _lang }: CohortManagementProps) {
  const t = useTranslations('adminCohorts')

  const [cohorts, setCohorts] = useState<CohortSummary[]>(initialCohorts)
  const { page, setPage, pageItems, pageCount } = usePagination(cohorts)
  const [isPending, startTransition] = useTransition()

  // Create/edit dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CohortSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<CohortSummary | null>(null)

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

  function handleSubmit() {
    if (!name.trim()) return
    startTransition(async () => {
      const result = editing
        ? await updateCohort(editing.id, { name: name.trim(), description: description.trim() })
        : await createCohort({ name: name.trim(), description: description.trim() })

      if (result.ok) {
        toast.success(editing ? t('updated') : t('created'))
        // Optimistic local update keyed by the returned id.
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
                <TableHead className="w-32 text-right">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((cohort) => (
                <TableRow key={cohort.id}>
                  <TableCell className="text-sm font-medium">{cohort.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cohort.description || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(cohort)}
                        disabled={isPending}
                      >
                        <Pencil className="size-4" />
                        {t('editCta')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(cohort)}
                        disabled={isPending}
                      >
                        <Trash2 className="size-4" />
                        {t('deleteCta')}
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
