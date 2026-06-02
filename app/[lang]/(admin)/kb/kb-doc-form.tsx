'use client'

/**
 * app/[lang]/(admin)/kb/kb-doc-form.tsx
 *
 * Minimal authenticated KB CRUD form — admin only.
 *
 * This is a "use client" island that:
 *   1. Uses vendored shadcn Field/FieldGroup/FieldLabel/FieldError + Card (PATTERNS Tier-A).
 *   2. Validates with a Zod ^4 schema (FieldError renders Zod issues).
 *   3. Supports two submit paths:
 *      a) FILE UPLOAD: builds FormData and POSTs to /api/kb/ingest/upload (Route Handler)
 *         — bypasses the 1 MB Server Action body limit.
 *      b) TEXT CONTENT: submits via Server Actions (NOT a fetch to a Route Handler
 *         — mutations are Server Actions).
 *   4. On either path: after sharding, polls /api/kb/ingest/process until remaining:0.
 *   5. Surfaces ingestion progress via sonner toast.
 *
 * File vs. text decision:
 *   - If a file is selected → use the file upload path; content textarea becomes optional.
 *   - If no file is selected → use the text path; content textarea requires ≥10 chars.
 *   - Neither file NOR content → validation error shown in the content field.
 *
 * Mutation flow — FILE path:
 *   file selected → POST /api/kb/ingest/upload (FormData + Bearer token)
 *   → createDocFromFile() → shardJob() → returns { jobId, total }
 *   → browser polls GET /api/kb/ingest/process?jobId=&limit=5 until remaining:0
 *   → toast "Document processed and indexed"
 *
 * Mutation flow — TEXT path (unchanged):
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

import { useState, useRef, useTransition } from 'react'
import { z } from 'zod'
import { toast } from 'sonner'

import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createKbDocAction, updateKbDocAction } from './actions'

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt']
const SUPPORTED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]
const FILE_ACCEPT = [...SUPPORTED_EXTENSIONS, ...SUPPORTED_MIMES].join(',')

// ─── Zod schema ───────────────────────────────────────────────────────────────

// Base schema (title, lang, pillar always required)
const KbDocBaseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  lang: z.enum(['en', 'ms', 'zh'], { error: 'Language must be en, ms, or zh' }),
  pillar: z.enum(['coach', 'finder', 'reply'], { error: 'Pillar must be coach, finder, or reply' }),
})

// Full schema when no file is selected (content required)
const KbDocTextSchema = KbDocBaseSchema.extend({
  content: z.string().min(10, 'Content must be at least 10 characters'),
})

type KbDocTextData = z.infer<typeof KbDocTextSchema>
type KbDocBaseData = z.infer<typeof KbDocBaseSchema>

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
  initialValues?: Partial<KbDocTextData>
  /** Callback after successful create/update */
  onSuccess?: (docId: string) => void
  /** Firebase ID token for the ingest poll (injected from the parent page) */
  idToken?: string
}

type ValidationErrors = Partial<Record<keyof KbDocTextData | 'file', { message?: string }[]>>

// ─── Component ────────────────────────────────────────────────────────────────

export function KbDocForm({ docId, initialValues, onSuccess, idToken }: KbDocFormProps) {
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [ingestProgress, setIngestProgress] = useState<{ remaining: number; total: number } | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEdit = !!docId

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    // Clear file-related errors when user selects/clears a file
    setErrors((prev) => {
      const next = { ...prev }
      delete next.file
      delete next.content
      return next
    })
  }

  function handleRemoveFile() {
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setErrors((prev) => {
      const next = { ...prev }
      delete next.file
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const title = formData.get('title') as string
    const lang = formData.get('lang') as string
    const pillar = formData.get('pillar') as string
    const content = formData.get('content') as string

    // ── Validate base fields (title, lang, pillar) ──────────────────────────
    const baseParsed = KbDocBaseSchema.safeParse({ title, lang, pillar })
    if (!baseParsed.success) {
      const fieldErrors: ValidationErrors = {}
      for (const issue of baseParsed.error.issues) {
        const field = issue.path[0] as keyof KbDocBaseData
        if (!fieldErrors[field]) fieldErrors[field] = []
        fieldErrors[field]!.push({ message: issue.message })
      }
      setErrors(fieldErrors)
      return
    }

    const baseData = baseParsed.data

    // ── Decide path: file vs. text content ──────────────────────────────────
    if (selectedFile) {
      // FILE UPLOAD PATH
      startTransition(async () => {
        try {
          const uploadForm = new FormData()
          uploadForm.set('file', selectedFile)
          uploadForm.set('title', baseData.title)
          uploadForm.set('lang', baseData.lang)
          uploadForm.set('pillar', baseData.pillar)
          // In edit mode, pass the old docId so the upload route creates a new
          // versioned doc that supersedes the existing one (02-02 supersede cascade)
          if (isEdit && docId) {
            uploadForm.set('supersedesId', docId)
          }

          const token = idToken ?? ''
          const response = await fetch('/api/kb/ingest/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: uploadForm,
          })

          const result = await response.json() as {
            ok: boolean
            error?: string
            docId?: string
            jobId?: string
            total?: number
          }

          if (!result.ok) {
            toast.error(result.error ?? 'Upload failed')
            return
          }

          if (result.jobId && result.total != null && result.total > 0) {
            setIngestProgress({ remaining: result.total, total: result.total })
            toast.info(`Indexing "${selectedFile.name}"… (${result.total} chunks)`)

            try {
              await pollIngestion(result.jobId, token, result.total, (remaining) => {
                setIngestProgress({ remaining, total: result.total! })
              })
              setIngestProgress(null)
              toast.success(
                isEdit
                  ? 'New version published; old version superseded.'
                  : 'Document processed and indexed.',
              )
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
    } else {
      // TEXT CONTENT PATH (Server Action)
      const textParsed = KbDocTextSchema.safeParse({ title, lang, pillar, content })
      if (!textParsed.success) {
        const fieldErrors: ValidationErrors = {}
        for (const issue of textParsed.error.issues) {
          const field = issue.path[0] as keyof KbDocTextData
          if (!fieldErrors[field]) fieldErrors[field] = []
          fieldErrors[field]!.push({ message: issue.message })
        }
        // If content failed, surface a helpful hint that file upload is also an option
        if (fieldErrors.content && !selectedFile) {
          fieldErrors.content = [
            ...(fieldErrors.content ?? []),
            { message: 'Or upload a file above instead of typing content.' },
          ]
        }
        setErrors(fieldErrors)
        return
      }

      const data: KbDocTextData = textParsed.data

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

          if (result.jobId && result.total != null && result.total > 0) {
            setIngestProgress({ remaining: result.total, total: result.total })

            const token = idToken ?? ''
            toast.info(`Indexing document… (${result.total} chunks)`)

            try {
              await pollIngestion(result.jobId, token, result.total, (remaining) => {
                setIngestProgress({ remaining, total: result.total! })
              })
              setIngestProgress(null)
              toast.success(
                isEdit
                  ? 'New version published; old version superseded.'
                  : 'Document processed and indexed.',
              )
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
            : 'Create a new KB document. Upload a file or paste text — content will be chunked and indexed for RAG retrieval.'}
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

            {/* File upload — available in both create and edit modes */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="file-upload">
                Upload file{isEdit ? ' (replaces content — creates new version)' : ' (optional)'}
              </FieldLabel>
              <div className="space-y-2">
                {selectedFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm">
                    <span className="flex-1 truncate text-foreground">{selectedFile.name}</span>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={isSubmitting}
                      className="shrink-0 text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                      aria-label="Remove selected file"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <Input
                    id="file-upload"
                    ref={fileInputRef}
                    type="file"
                    accept={FILE_ACCEPT}
                    disabled={isSubmitting}
                    onChange={handleFileChange}
                    className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                  />
                )}
                <FieldDescription>
                  Supported formats: PDF, DOCX, DOC, XLSX, PPTX, TXT. Max 20 MB.
                  {selectedFile
                    ? ' File selected — the content field below is optional.'
                    : ' Or type/paste content below instead.'}
                </FieldDescription>
              </div>
              <FieldError errors={errors.file} />
            </Field>

            {/* Content */}
            <Field orientation="vertical">
              <FieldLabel htmlFor="content">
                Content{selectedFile ? ' (optional when file is uploaded)' : ''}
              </FieldLabel>
              <Textarea
                id="content"
                name="content"
                placeholder={
                  selectedFile
                    ? 'Leave blank to extract text from the uploaded file…'
                    : 'Paste or type the KB document content here…'
                }
                rows={10}
                defaultValue={initialValues?.content ?? ''}
                disabled={isSubmitting}
                aria-invalid={!!errors.content?.length}
                className="min-h-[200px] font-mono text-sm"
              />
              <FieldDescription>
                {selectedFile
                  ? 'Content is extracted automatically from the uploaded file. You may also type supplemental text here.'
                  : 'Plain text content. This will be chunked into ~400-token passages and embedded for vector retrieval.'}
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
