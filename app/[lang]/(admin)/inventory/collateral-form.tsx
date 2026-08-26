'use client'

/**
 * app/[lang]/(admin)/inventory/collateral-form.tsx
 *
 * Collateral attach form + badge chip list (ADMIN-04, FIND-04).
 *
 * Accepts EITHER a Firebase Storage path OR a plain external URL — exactly one.
 * No Google Drive API picker is used or referenced (D-09 / C2 / T-03-24).
 *
 * The admin chooses a type (poster/video/fact_sheet), a language, and either:
 *   storagePath: "collateral/project-id/poster.pdf"  — Firebase Storage
 *   externalUrl: "https://…"                          — any plain URL
 *
 * On submit → attachCollateralAction(projectId, { type, lang, storagePath?, externalUrl? })
 *
 * Reuses vendored shadcn: Card, Input, Button, Badge, Field/FieldGroup/FieldLabel/FieldError.
 * All labels via useTranslations('inventory') (trilingual).
 *
 * References:
 *   - 03-08-PLAN.md Task 2
 *   - src/inventory/crud.ts (AttachCollateralInput — storagePath | externalUrl, never Drive)
 *   - T-03-24: no Drive API integration — collateral is Storage path or plain URL only
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { attachCollateralAction } from './actions'

// ─── Collateral reference type (for display chips) ────────────────────────────

interface CollateralRef {
  id: string
  type: string
  lang: string
  storagePath?: string
  externalUrl?: string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CollateralFormProps {
  projectId: string
  /** Existing collateral to render as badge chips (optional — passed from parent if available) */
  existing?: CollateralRef[]
  /** Callback when the user closes / finishes attaching */
  onDone?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CollateralForm({ projectId, existing = [], onDone }: CollateralFormProps) {
  const t = useTranslations('inventory')
  const [isPending, startTransition] = useTransition()
  const [useStoragePath, setUseStoragePath] = useState(true)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const selectClass =
    'flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

  function validate(data: {
    type: string
    lang: string
    path: string
  }): boolean {
    const newErrors: Record<string, string[]> = {}
    if (!data.type) newErrors.type = ['Type is required']
    if (!data.lang) newErrors.lang = ['Language is required']
    if (!data.path.trim()) {
      newErrors.path = [
        useStoragePath
          ? 'Firebase Storage path is required'
          : 'External URL is required',
      ]
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const type = formData.get('type') as string
    const lang = formData.get('lang') as 'en' | 'ms' | 'zh'
    const path = (formData.get('path') as string) ?? ''

    if (!validate({ type, lang, path })) return

    startTransition(async () => {
      const collateral = {
        type,
        lang,
        ...(useStoragePath
          ? { storagePath: path.trim() }
          : { externalUrl: path.trim() }),
      }

      const result = await attachCollateralAction(projectId, collateral)

      if (!result.ok) {
        toast.error(result.error ?? t('collateralError'))
        return
      }

      toast.success(t('collateralAttached'))
      // Reset the form
      const form = e.target as HTMLFormElement
      form.reset()
    })
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">{t('collateralSection')}</h3>
        <p className="text-sm text-muted-foreground">{t('collateralDescription')}</p>
      </CardHeader>

      {/* Existing collateral chips */}
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-2">
          {existing.map((item) => (
            <Badge key={item.id} variant="secondary" className="gap-1">
              <span className="font-medium">{item.type}</span>
              <span className="text-muted-foreground">[{item.lang}]</span>
              {item.externalUrl ? (
                <a
                  href={item.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  link
                </a>
              ) : (
                // quick-kayinleong-050: a storagePath alone is NOT web-addressable, so
                // this is deliberately not an anchor. Label it so an admin can see the
                // asset is unreachable rather than reading a path as if it were a link.
                <span className="opacity-60" title={item.storagePath}>
                  no link
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}
      {existing.length === 0 && (
        <p className="px-6 pb-2 text-sm text-muted-foreground">{t('collateralNoItems')}</p>
      )}

      {/* Attach form */}
      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {/* Type + Lang row */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="col-type">{t('collateralType')}</FieldLabel>
                <select
                  id="col-type"
                  name="type"
                  defaultValue="poster"
                  disabled={isPending}
                  className={selectClass}
                >
                  <option value="poster">{t('collateralTypePoster')}</option>
                  <option value="video">{t('collateralTypeVideo')}</option>
                  <option value="fact_sheet">{t('collateralTypeFactSheet')}</option>
                </select>
                <FieldError errors={errors.type?.map((m) => ({ message: m }))} />
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="col-lang">{t('collateralLang')}</FieldLabel>
                <select
                  id="col-lang"
                  name="lang"
                  defaultValue="en"
                  disabled={isPending}
                  className={selectClass}
                >
                  <option value="en">English (EN)</option>
                  <option value="ms">Bahasa Melayu (BM)</option>
                  <option value="zh">中文 (ZH)</option>
                </select>
                <FieldError errors={errors.lang?.map((m) => ({ message: m }))} />
              </Field>
            </div>

            {/* Storage path vs external URL toggle */}
            <Field orientation="vertical">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="_pathType"
                    value="storage"
                    checked={useStoragePath}
                    onChange={() => setUseStoragePath(true)}
                    disabled={isPending}
                  />
                  {t('collateralStoragePath')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="_pathType"
                    value="external"
                    checked={!useStoragePath}
                    onChange={() => setUseStoragePath(false)}
                    disabled={isPending}
                  />
                  {t('collateralExternalUrl')}
                </label>
              </div>
              <Input
                id="col-path"
                name="path"
                placeholder={
                  useStoragePath
                    ? t('collateralStoragePathPlaceholder')
                    : t('collateralExternalUrlPlaceholder')
                }
                disabled={isPending}
                aria-invalid={!!errors.path?.length}
              />
              <FieldError errors={errors.path?.map((m) => ({ message: m }))} />
            </Field>
          </FieldGroup>
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          {onDone && (
            <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
              {t('cancel')}
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? t('collateralAttaching') : t('collateralAttach')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
