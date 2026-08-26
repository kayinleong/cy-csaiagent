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
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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

type ValidationErrors = Partial<Record<'content', { message?: string }[]>>

import { getFreshIdToken } from '@/src/firebase/client'

// ─── Poll helper ─────────────────────────────────────────────────────────────

/**
 * Poll /api/kb/ingest/process until remaining === 0.
 * Reuses the exact poll pattern from kb-doc-form.tsx (established in 02-08).
 */
async function pollIngestion(
  jobId: string,
  total: number,
  onProgress: (remaining: number) => void,
): Promise<void> {
  let remaining = total

  while (remaining > 0) {
    const url = `/api/kb/ingest/process?jobId=${encodeURIComponent(jobId)}&limit=${POLL_LIMIT}`
    // Per-poll, never captured (quick-kayinleong-058). The dialog used to receive this as
    // a prop that the dashboard filled with the SESSION COOKIE value — a session cookie is
    // not an ID token, verifyIdToken rejects it, and every correction 401'd.
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${await getFreshIdToken()}` },
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

/** The KB document being corrected, selected from the explorer. */
export interface CorrectionTarget {
  id: string
  title: string
}

interface InlineCorrectionDialogProps {
  /** The document to correct (null = dialog closed). Selected in the KB explorer. */
  doc: CorrectionTarget | null
  /** Controlled close handler — clears the selected doc in the parent. */
  onClose: () => void
}

export function InlineCorrectionDialog({
  doc,
  onClose,
}: InlineCorrectionDialogProps) {
  const t = useTranslations('dashboard')
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [ingestProgress, setIngestProgress] = useState<{
    remaining: number
    total: number
  } | null>(null)

  const ingesting = ingestProgress !== null && ingestProgress.remaining > 0
  const isSubmitting = isPending || ingesting
  const open = doc !== null

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isSubmitting) {
      // Reset state when dialog closes
      setErrors({})
      setIngestProgress(null)
      onClose()
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    if (!doc) return

    const formData = new FormData(e.currentTarget)
    const content = formData.get('content') as string

    // Validate (docId comes from the selected document, not user-typed)
    const parsed = CorrectionSchema.safeParse({ docId: doc.id, content })
    if (!parsed.success) {
      const fieldErrors: ValidationErrors = {}
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'content') {
          if (!fieldErrors.content) fieldErrors.content = []
          fieldErrors.content.push({ message: issue.message })
        }
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
            await pollIngestion(result.jobId, result.total, (remaining) => {
              setIngestProgress({ remaining, total: result.total! })
            })
            setIngestProgress(null)
            toast.success(t('correctionSuccess'))
            onClose()
          } catch (pollErr) {
            const msg = pollErr instanceof Error ? pollErr.message : t('correctionError')
            toast.error(msg)
            setIngestProgress(null)
          }
        } else {
          toast.success(t('correctionSuccess'))
          onClose()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('correctionError')
        toast.error(msg)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('correctionDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('correctionDialogDescription')} ({t('correctionCorrectedBy')})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4">
          <FieldGroup>
            {/* Selected document (no raw doc ID — picked in the explorer) */}
            <Field orientation="vertical">
              <FieldLabel>{t('correctionSelectedDoc')}</FieldLabel>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                {doc?.title}
              </div>
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
