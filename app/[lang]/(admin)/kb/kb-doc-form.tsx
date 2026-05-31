'use client'

/**
 * app/[lang]/(admin)/kb/kb-doc-form.tsx
 *
 * Minimal authenticated KB CRUD form — admin only.
 *
 * This is a "use client" island that:
 *   1. Uses vendored shadcn Field/FieldGroup/FieldLabel/FieldError + Card (PATTERNS Tier-A).
 *   2. Validates with a Zod ^4 schema (FieldError renders Zod issues).
 *   3. Submits via Server Actions (NOT a fetch to a Route Handler — mutations are Server Actions).
 *   4. On PDF attachment: kicks off the chunked-poll ingestion loop
 *      (polls /api/kb/ingest/process until remaining:0).
 *   5. Surfaces ingestion progress via sonner toast.
 *
 * Mutation flow (PATTERNS Tier-A KB CRUD analog):
 *   KB form submit → Server Action (createKbDocAction / updateKbDocAction)
 *   → shardJob() → returns jobId + total
 *   → browser polls GET /api/kb/ingest/process?jobId=&limit=5 until remaining:0
 *   → toast "Document processed and indexed"
 *
 * References:
 *   - PATTERNS Tier-A lines 151-177 (shadcn Field/FieldGroup/FieldLabel/FieldError + Card)
 *   - TSD §3.4 (Server Action for mutation; Route Handler for the process poll loop)
 *   - T-01-30 (admin gate via Server Action + requireUser re-check)
 *   - 01-10-PLAN.md Task 2 action
 */

import { useState, useTransition } from 'react'
import { z } from 'zod'
import { toast } from 'sonner'

import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createKbDocAction, updateKbDocAction } from './actions'

// ─── Zod schema ───────────────────────────────────────────────────────────────

const KbDocSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  content: z.string().min(10, 'Content must be at least 10 characters'),
  lang: z.enum(['en', 'ms', 'zh'], { error: 'Language must be en, ms, or zh' }),
  pillar: z.enum(['coach', 'finder', 'reply'], { error: 'Pillar must be coach, finder, or reply' }),
})

type KbDocFormData = z.infer<typeof KbDocSchema>

// ─── Ingestion poll helpers ───────────────────────────────────────────────────

const POLL_LIMIT = 5
const POLL_INTERVAL_MS = 1500

/**
 * Poll /api/kb/ingest/process until remaining === 0.
 * Updates progress via onProgress callback.
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

    const data = await response.json()
    remaining = data.remaining ?? 0
    onProgress(remaining)

    if (remaining > 0) {
      // Wait before next poll to avoid hammering the server
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface KbDocFormProps {
  /** If provided, the form is in edit mode */
  docId?: string
  /** Initial values for edit mode */
  initialValues?: Partial<KbDocFormData>
  /** Callback after successful create/update */
  onSuccess?: (docId: string) => void
  /** Firebase ID token for the ingest poll (injected from the parent page) */
  idToken?: string
}

type ValidationErrors = Partial<Record<keyof KbDocFormData, { message?: string }[]>>

// ─── Component ────────────────────────────────────────────────────────────────

export function KbDocForm({ docId, initialValues, onSuccess, idToken }: KbDocFormProps) {
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [ingestProgress, setIngestProgress] = useState<{ remaining: number; total: number } | null>(null)

  const isEdit = !!docId

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const rawData = {
      title: formData.get('title') as string,
      content: formData.get('content') as string,
      lang: formData.get('lang') as string,
      pillar: formData.get('pillar') as string,
    }

    // Validate with Zod
    const parsed = KbDocSchema.safeParse(rawData)
    if (!parsed.success) {
      const fieldErrors: ValidationErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof KbDocFormData
        if (!fieldErrors[field]) fieldErrors[field] = []
        fieldErrors[field]!.push({ message: issue.message })
      }
      setErrors(fieldErrors)
      return
    }

    const data: KbDocFormData = parsed.data

    startTransition(async () => {
      try {
        let result
        if (isEdit && docId) {
          result = await updateKbDocAction(docId, data)
        } else {
          result = await createKbDocAction(data)
        }

        if (!result.ok) {
          toast.error(result.error ?? 'Failed to save document')
          return
        }

        // If a job was created, kick off the poll loop
        if (result.jobId && result.total != null && result.total > 0) {
          setIngestProgress({ remaining: result.total, total: result.total })

          const token = idToken ?? ''
          toast.info(`Indexing document… (${result.total} chunks)`)

          try {
            await pollIngestion(result.jobId, token, result.total, (remaining) => {
              setIngestProgress({ remaining, total: result.total! })
            })
            setIngestProgress(null)
            toast.success('Document processed and indexed.')
          } catch (pollErr) {
            const msg = pollErr instanceof Error ? pollErr.message : 'Ingestion failed'
            toast.error(msg)
            return
          }
        } else {
          toast.success('Document saved.')
        }

        if (result.docId && onSuccess) {
          onSuccess(result.docId)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        toast.error(msg)
      }
    })
  }

  const ingesting = ingestProgress !== null && ingestProgress.remaining > 0
  const isSubmitting = isPending || ingesting

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">{isEdit ? 'Edit document' : 'Add document'}</h2>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? 'Update the KB document. Changing content will re-index all chunks.'
            : 'Create a new KB document. Content will be chunked and indexed for RAG retrieval.'}
        </p>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent>
          <FieldGroup>
            {/* Title */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input
                id="title"
                name="title"
                placeholder="e.g. D2 New Agent Onboarding Guide"
                defaultValue={initialValues?.title ?? ''}
                disabled={isSubmitting}
                aria-invalid={!!errors.title?.length}
              />
              <FieldDescription>A descriptive title for this KB document.</FieldDescription>
              <FieldError errors={errors.title} />
            </Field>

            {/* Language + Pillar row */}
            <div className="grid grid-cols-2 gap-4">
              <Field orientation="vertical">
                <FieldLabel htmlFor="lang">Language</FieldLabel>
                <select
                  id="lang"
                  name="lang"
                  defaultValue={initialValues?.lang ?? 'en'}
                  disabled={isSubmitting}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="en">English (EN)</option>
                  <option value="ms">Bahasa Melayu (MS)</option>
                  <option value="zh">Chinese (ZH)</option>
                </select>
                <FieldError errors={errors.lang} />
              </Field>

              <Field orientation="vertical">
                <FieldLabel htmlFor="pillar">Pillar</FieldLabel>
                <select
                  id="pillar"
                  name="pillar"
                  defaultValue={initialValues?.pillar ?? 'coach'}
                  disabled={isSubmitting}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="coach">Onboarding Coach</option>
                  <option value="finder">Property Finder</option>
                  <option value="reply">Reply Assistant</option>
                </select>
                <FieldError errors={errors.pillar} />
              </Field>
            </div>

            {/* Content */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="content">Content</FieldLabel>
              <Textarea
                id="content"
                name="content"
                placeholder="Paste or type the KB document content here…"
                rows={10}
                defaultValue={initialValues?.content ?? ''}
                disabled={isSubmitting}
                aria-invalid={!!errors.content?.length}
                className="min-h-[200px] font-mono text-sm"
              />
              <FieldDescription>
                Plain text content. This will be chunked into ~400-token passages and embedded
                for vector retrieval.
              </FieldDescription>
              <FieldError errors={errors.content} />
            </Field>

            {/* Ingestion progress indicator */}
            {ingestProgress && (
              <div className="text-sm text-muted-foreground">
                {ingestProgress.remaining > 0
                  ? `Indexing… ${ingestProgress.total - ingestProgress.remaining} / ${ingestProgress.total} chunks done`
                  : 'Indexing complete.'}
              </div>
            )}
          </FieldGroup>
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (ingesting ? 'Indexing…' : 'Saving…') : isEdit ? 'Update' : 'Save'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
