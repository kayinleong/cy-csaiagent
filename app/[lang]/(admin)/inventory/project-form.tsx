'use client'

/**
 * app/[lang]/(admin)/inventory/project-form.tsx
 *
 * Client island for adding or editing a project (ADMIN-04, FIND-02).
 *
 * Fields collected from the admin:
 *   name, status, priceValue, tenure, bedrooms, locationText, description,
 *   vpStatus, vpDate (only when vpStatus=true), bumiQuota, foreignEligible.
 *
 * NOT collected: the discrete band label (derived server-side from priceValue),
 *               nor the embedding vector (computed in createProject/updateProject via Gemini).
 *
 * On submit:
 *   - Add mode → createProjectAction(input) → toast success/error → page reload
 *   - Edit mode → updateProjectAction(projectId, patch) → toast → onSuccess()
 *
 * Reuses vendored shadcn: Card, Input, Textarea, Button, Field/FieldGroup/FieldLabel/FieldError.
 * All labels via useTranslations('inventory') (trilingual).
 *
 * References:
 *   - 03-08-PLAN.md Task 2
 *   - app/[lang]/(admin)/kb/kb-doc-form.tsx (the form island pattern)
 *   - src/firebase/collections.ts (ProjectDoc — fields the form edits)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createProjectAction, updateProjectAction } from './actions'
import type { CreateProjectInput, UpdateProjectPatch } from '@/src/inventory/crud'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectFormProps {
  /** If provided, the form is in edit mode */
  projectId?: string
  /** Initial values for edit mode */
  initialValues?: Partial<CreateProjectInput>
  /** Callback after successful create/update */
  onSuccess?: () => void
  /** Callback to cancel edit mode */
  onCancel?: () => void
}

type FieldErrors = Partial<Record<string, string[]>>

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectForm({ projectId, initialValues, onSuccess, onCancel }: ProjectFormProps) {
  const t = useTranslations('inventory')
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [vpStatus, setVpStatus] = useState(initialValues?.vpStatus ?? false)

  const isEdit = !!projectId

  function validateForm(data: Record<string, unknown>): boolean {
    const newErrors: FieldErrors = {}
    if (!data.name || String(data.name).trim() === '') {
      newErrors.name = ['Project name is required']
    }
    const price = Number(data.priceValue)
    if (!data.priceValue || isNaN(price) || price <= 0) {
      newErrors.priceValue = ['A valid asking price (RM) is required']
    }
    if (!data.tenure || String(data.tenure).trim() === '') {
      newErrors.tenure = ['Tenure is required']
    }
    const beds = Number(data.bedrooms)
    if (!data.bedrooms || isNaN(beds) || beds <= 0) {
      newErrors.bedrooms = ['Number of bedrooms is required']
    }
    if (!data.locationText || String(data.locationText).trim() === '') {
      newErrors.locationText = ['Location is required']
    }
    if (!data.description || String(data.description).trim() === '') {
      newErrors.description = ['Description is required']
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const raw = {
      name: formData.get('name') as string,
      status: formData.get('status') as 'active' | 'sold_out' | 'hidden',
      priceValue: formData.get('priceValue'),
      tenure: formData.get('tenure') as string,
      bedrooms: formData.get('bedrooms'),
      locationText: formData.get('locationText') as string,
      description: formData.get('description') as string,
      vpStatus: formData.get('vpStatus') === 'true',
      vpDate: formData.get('vpDate') ? new Date(formData.get('vpDate') as string) : null,
      bumiQuota: formData.get('bumiQuota') === 'true',
      foreignEligible: formData.get('foreignEligible') === 'true',
    }

    if (!validateForm(raw)) return

    const input: CreateProjectInput = {
      ...raw,
      priceValue: Number(raw.priceValue),
      bedrooms: Number(raw.bedrooms),
    }

    startTransition(async () => {
      let result
      if (isEdit && projectId) {
        const patch: UpdateProjectPatch = { ...input }
        result = await updateProjectAction(projectId, patch)
      } else {
        result = await createProjectAction(input)
      }

      if (!result.ok) {
        toast.error(result.error ?? t('saveError'))
        return
      }

      toast.success(t('saved'))
      if (onSuccess) {
        onSuccess()
      } else {
        window.location.reload()
      }
    })
  }

  const selectClass =
    'flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">
          {isEdit ? t('editProject') : t('addProject')}
        </h2>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {/* Name */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="name">{t('fieldName')}</FieldLabel>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Sky Residences"
                defaultValue={initialValues?.name ?? ''}
                disabled={isPending}
                aria-invalid={!!errors.name?.length}
              />
              <FieldError errors={errors.name?.map((m) => ({ message: m }))} />
            </Field>

            {/* Status */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="status">{t('fieldStatus')}</FieldLabel>
              <select
                id="status"
                name="status"
                defaultValue={initialValues?.status ?? 'active'}
                disabled={isPending}
                className={selectClass}
              >
                <option value="active">{t('statusActive')}</option>
                <option value="sold_out">{t('statusSoldOut')}</option>
                <option value="hidden">{t('statusHidden')}</option>
              </select>
              <FieldError errors={errors.status?.map((m) => ({ message: m }))} />
            </Field>

            {/* Price + Tenure row */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="priceValue">{t('fieldPrice')}</FieldLabel>
                <Input
                  id="priceValue"
                  name="priceValue"
                  type="number"
                  min={1}
                  step={1000}
                  placeholder="650000"
                  defaultValue={initialValues?.priceValue ?? ''}
                  disabled={isPending}
                  aria-invalid={!!errors.priceValue?.length}
                />
                <FieldError errors={errors.priceValue?.map((m) => ({ message: m }))} />
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="tenure">{t('fieldTenure')}</FieldLabel>
                <Input
                  id="tenure"
                  name="tenure"
                  placeholder="Leasehold / Freehold"
                  defaultValue={initialValues?.tenure ?? ''}
                  disabled={isPending}
                  aria-invalid={!!errors.tenure?.length}
                />
                <FieldError errors={errors.tenure?.map((m) => ({ message: m }))} />
              </Field>
            </div>

            {/* Bedrooms + Location row */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="bedrooms">{t('fieldBedrooms')}</FieldLabel>
                <Input
                  id="bedrooms"
                  name="bedrooms"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="3"
                  defaultValue={initialValues?.bedrooms ?? ''}
                  disabled={isPending}
                  aria-invalid={!!errors.bedrooms?.length}
                />
                <FieldError errors={errors.bedrooms?.map((m) => ({ message: m }))} />
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="locationText">{t('fieldLocation')}</FieldLabel>
                <Input
                  id="locationText"
                  name="locationText"
                  placeholder="Cheras, Kuala Lumpur — near LRT"
                  defaultValue={initialValues?.locationText ?? ''}
                  disabled={isPending}
                  aria-invalid={!!errors.locationText?.length}
                />
                <FieldError errors={errors.locationText?.map((m) => ({ message: m }))} />
              </Field>
            </div>

            {/* Description */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="description">{t('fieldDescription')}</FieldLabel>
              <Textarea
                id="description"
                name="description"
                placeholder="Plain-language project description…"
                rows={4}
                defaultValue={initialValues?.description ?? ''}
                disabled={isPending}
                aria-invalid={!!errors.description?.length}
                className="min-h-[100px]"
              />
              <FieldError errors={errors.description?.map((m) => ({ message: m }))} />
            </Field>

            {/* VP Status + VP Date */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="vpStatus">{t('fieldVpStatus')}</FieldLabel>
                <select
                  id="vpStatus"
                  name="vpStatus"
                  value={vpStatus ? 'true' : 'false'}
                  onChange={(e) => setVpStatus(e.target.value === 'true')}
                  disabled={isPending}
                  className={selectClass}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="vpDate">{t('vpDateLabel')}</FieldLabel>
                <Input
                  id="vpDate"
                  name="vpDate"
                  type="date"
                  disabled={isPending || !vpStatus}
                  defaultValue={
                    initialValues?.vpDate instanceof Date
                      ? initialValues.vpDate.toISOString().split('T')[0]
                      : ''
                  }
                />
              </Field>
            </div>

            {/* Bumi quota + Foreign eligible row */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="bumiQuota">{t('fieldBumi')}</FieldLabel>
                <select
                  id="bumiQuota"
                  name="bumiQuota"
                  defaultValue={initialValues?.bumiQuota ? 'true' : 'false'}
                  disabled={isPending}
                  className={selectClass}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="foreignEligible">{t('fieldForeign')}</FieldLabel>
                <select
                  id="foreignEligible"
                  name="foreignEligible"
                  defaultValue={initialValues?.foreignEligible ? 'true' : 'false'}
                  disabled={isPending}
                  className={selectClass}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </Field>
            </div>
          </FieldGroup>
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
              {t('cancel')}
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? t('saving') : t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
