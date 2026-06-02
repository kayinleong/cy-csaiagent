'use client'

/**
 * app/[lang]/(coach)/_components/inline-correction-dialog.tsx
 *
 * CDASH-04: Inline AI correction dialog.
 *
 * A coach selects/enters the KB doc ID behind a bad answer (e.g. from a
 * knowledge-gap row or an escalation's cited docId) and submits corrected
 * plain-language content. The correction:
 *   1. Calls Server Action submitCorrection(docId, content) → correctKbDoc().
 *   2. correctKbDoc creates a new attributed version (correctedBy: coach.uid,
 *      supersedesId: oldDocId) and shards a re-ingest job.
 *   3. The dialog polls /api/kb/ingest/process until remaining === 0.
 *      (Reuses the kb-doc-form poll pattern established in 02-08.)
 *   4. Toast: "Correction published; v{n-1} superseded."
 *
 * Attribution: correctKbDoc already stamps correctedBy (02-02). The dialog
 * surfaces this as "corrected by you" in the description.
 *
 * Security (T-02-30): content goes through the same chunker/pipeline as any
 * other ingest — no privileged bypass. Admin oversight via versioning.
 *
 * References:
 *   - CDASH-04 (inline correction → attributed KB re-ingest)
 *   - D-12 (correction → versioned KB re-ingest)
 *   - src/kb/crud.ts correctKbDoc (backend — already built in 02-02)
 *   - app/[lang]/(admin)/kb/kb-doc-form.tsx (pollIngestion pattern to reuse)
 *   - T-02-30 (inline correction tamper mitigation)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { submitCorrection } from '../dashboard/actions'

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_LIMIT = 5
const POLL_INTERVAL_MS = 1500

// ─── Zod schema ───────────────────────────────────────────────────────────────

const CorrectionSchema = z.object({
  docId: z.string().min(1, 'KB document ID is required'),
  content: z.string().min(10, 'Corrected content must be at least 10 characters'),
})

type CorrectionData = z.infer<typeof CorrectionSchema>

type ValidationErrors = Partial<Record<keyof CorrectionData, { message?: string }[]>>

// ─── Poll helper ─────────────────────────────────────────────────────────────

/**
 * Poll /api/kb/ingest/process until remaining === 0.
 * Reuses the exact poll pattern from kb-doc-form.tsx (established in 02-08).
 */
async function pollIngestion(
  jobId: string,
  token: string,
  total: number,
  onProgress: (remaining: number) => void,
): Promise<void> {
  let remaining = total

  while (remaining > 0) {
    const url = `/api/kb/ingest/process?jobId=${encodeURIComponent(jobId)}&limit=${POLL_LIMIT}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `Ingestion poll failed (HTTP ${response.status})`)
    }

    const data = await response.json() as { remaining?: number }
    remaining = data.remaining ?? 0
    onProgress(remaining)

    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InlineCorrectionDialogProps {
  /** Firebase ID token for authenticating the ingest poll (from the RSC session cookie). */
  idToken: string
  /** Optional: pre-populate the KB doc ID (e.g. from a knowledge-gap or escalation row). */
  initialDocId?: string
}

export function InlineCorrectionDialog({
  idToken,
  initialDocId,
}: InlineCorrectionDialogProps) {
  const t = useTranslations('dashboard')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [ingestProgress, setIngestProgress] = useState<{
    remaining: number
    total: number
  } | null>(null)

  const ingesting = ingestProgress !== null && ingestProgress.remaining > 0
  const isSubmitting = isPending || ingesting

  function handleOpenChange(nextOpen: boolean) {
    if (!isSubmitting) {
      setOpen(nextOpen)
      if (!nextOpen) {
        // Reset state when dialog closes
        setErrors({})
        setIngestProgress(null)
      }
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const docId = (formData.get('docId') as string).trim()
    const content = formData.get('content') as string

    // Validate
    const parsed = CorrectionSchema.safeParse({ docId, content })
    if (!parsed.success) {
      const fieldErrors: ValidationErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof CorrectionData
        if (!fieldErrors[field]) fieldErrors[field] = []
        fieldErrors[field]!.push({ message: issue.message })
      }
      setErrors(fieldErrors)
      return
    }

    const data: CorrectionData = parsed.data

    startTransition(async () => {
      try {
        const result = await submitCorrection(data.docId, data.content)

        if (!result.ok) {
          toast.error(result.error ?? t('correctionError'))
          return
        }

        // If a re-ingest job was started, poll until complete
        if (result.jobId && result.total != null && result.total > 0) {
          setIngestProgress({ remaining: result.total, total: result.total })
          toast.info(t('correctionIndexing'))

          try {
            await pollIngestion(result.jobId, idToken, result.total, (remaining) => {
              setIngestProgress({ remaining, total: result.total! })
            })
            setIngestProgress(null)
            toast.success(t('correctionSuccess'))
            setOpen(false)
          } catch (pollErr) {
            const msg = pollErr instanceof Error ? pollErr.message : t('correctionError')
            toast.error(msg)
            setIngestProgress(null)
          }
        } else {
          toast.success(t('correctionSuccess'))
          setOpen(false)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('correctionError')
        toast.error(msg)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('correctionOpenButton')}</Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('correctionDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('correctionDialogDescription')} ({t('correctionCorrectedBy')})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4">
          <FieldGroup>
            {/* KB Document ID */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="docId">{t('correctionDocIdLabel')}</FieldLabel>
              <Input
                id="docId"
                name="docId"
                placeholder={t('correctionDocIdPlaceholder')}
                defaultValue={initialDocId ?? ''}
                disabled={isSubmitting}
                aria-invalid={!!errors.docId?.length}
                className="font-mono text-sm"
              />
              <FieldDescription>
                The Firestore document ID of the KB document to correct.
              </FieldDescription>
              <FieldError errors={errors.docId} />
            </Field>

            {/* Corrected content */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="content">{t('correctionContentLabel')}</FieldLabel>
              <Textarea
                id="content"
                name="content"
                placeholder={t('correctionContentPlaceholder')}
                rows={8}
                disabled={isSubmitting}
                aria-invalid={!!errors.content?.length}
                className="min-h-[160px] font-mono text-sm"
              />
              <FieldDescription>
                Plain-text correction. Will be re-chunked and embedded to supersede the old version.
              </FieldDescription>
              <FieldError errors={errors.content} />
            </Field>

            {/* Ingest progress */}
            {ingestProgress && (
              <div className="text-sm text-muted-foreground">
                {ingestProgress.remaining > 0
                  ? `${t('correctionIndexing')} ${ingestProgress.total - ingestProgress.remaining} / ${ingestProgress.total} chunks done`
                  : 'Indexing complete.'}
              </div>
            )}
          </FieldGroup>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? ingesting
                  ? t('correctionIndexing')
                  : t('correctionSubmitting')
                : t('correctionSubmit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
