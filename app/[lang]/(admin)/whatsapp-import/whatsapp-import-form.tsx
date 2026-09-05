'use client'

/**
 * app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx
 *
 * Client island for the WhatsApp-import admin surface.
 *
 * Pipeline (all client-driven — no mega-request, no auto-send):
 *   1. PARSE   — user picks a WhatsApp export .zip; JSZip reads `_chat.txt`
 *                in-browser (parseWhatsApp) and enumerates media entries.
 *   2. CLASSIFY— send a bounded sample to classifyWhatsAppProjectAction; the LLM
 *                proposes an existing project match OR a new project.
 *   3. CONFIRM — operator confirms/overrides the target project + KB language.
 *   4. INGEST  — resolve the target project (createProjectAction for a new one,
 *                created HIDDEN so a placeholder never surfaces to Finder), ingest
 *                the transcript into the KB (createKbDocAction → poll
 *                /api/kb/ingest/process), then upload each media file to
 *                Firebase Storage and record it as collateral (attachCollateralAction).
 *
 * Every mutation goes through an existing, admin-gated Server Action — this form
 * adds no new privileged surface. Uploads are gated by storage.rules (admin only).
 *
 * References:
 *   - ./actions.ts (classifyWhatsAppProjectAction)
 *   - app/[lang]/(admin)/inventory/actions.ts (createProjectAction, attachCollateralAction)
 *   - app/[lang]/(admin)/kb/actions.ts (createKbDocAction)
 *   - src/whatsapp/parse.ts (parseWhatsApp, toTranscript, toClassificationSample)
 *   - app/[lang]/(admin)/inventory/import-form.tsx (client-island pattern)
 */

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import JSZip from 'jszip'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
// firebase/storage is imported lazily at the upload site below — it shares a ~353 KB
// chunk with firebase/firestore, which every route touching this module used to pay for
// on first load (quick-kayinleong-046). clientAuth stays eager (AUTH-05 timing).
import { clientAuth, getClientStorage, getFreshIdToken } from '@/src/firebase/client'
import { parseWhatsApp, toTranscript, toClassificationSample } from '@/src/whatsapp/parse'
import {
  classifyWhatsAppProjectAction,
  type ClassifyResult,
  type ProjectOption,
} from './actions'
import { createProjectAction, attachCollateralAction } from '@/app/[lang]/(admin)/inventory/actions'
import { createKbDocAction } from '@/app/[lang]/(admin)/kb/actions'

type Phase = 'idle' | 'parsed' | 'classified' | 'ingesting' | 'done'
type KbLang = 'en' | 'ms' | 'zh'

interface ParsedZip {
  groupName: string
  participantCount: number
  messageCount: number
  mediaEntries: string[] // filenames inside the zip (non-chat, non-directory)
  transcript: string
  sample: string
}

type StepStatus = 'pending' | 'running' | 'done' | 'error'

/**
 * Progress of archiving the RAW .zip to Storage (quick-kayinleong-088).
 *
 * Separate from `Progress` below because it is not part of the ingest pipeline: it runs at
 * parse time, before a target project even exists, and a failure here must not block the
 * operator from ingesting. `path` is the Storage object path, which the UI shows so it can
 * be quoted when asking for a re-ingest.
 */
interface ArchiveState {
  status: StepStatus
  path: string
  bytes: number
  /** 0–100, from the resumable upload's byte counters. */
  pct: number
  error?: string
}

interface Progress {
  projectStep: StepStatus
  kbStep: StepStatus
  mediaStep: StepStatus
  /** Basename of the file currently uploading (shown while mediaStep === 'running'). */
  mediaCurrent: string
  mediaDone: number
  mediaTotal: number
  mediaErrors: number
  log: string[]
}

const MAX_TRANSCRIPT_CHARS = 900_000 // soft guard against the Server Action body cap (~1 MB)
const POLL_LIMIT = 5
const POLL_MAX_ITERATIONS = 5_000
const UPLOAD_TIMEOUT_MS = 30_000 // a single media upload should never take longer; a hang → logged error
const MAX_CONSECUTIVE_MEDIA_FAILURES = 5 // fail-fast: stop after this many in a row (Storage misconfigured)

/** Reject after `ms` if `p` hasn't settled — turns a hanging upload into a surfaced error. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

/** Keep the basename and strip characters that would complicate a Storage path. */
function safeStorageName(name: string): string {
  const base = name.split('/').pop() ?? name
  return base.replace(/[^\w.\-() ]+/g, '_')
}

/** Human-readable byte size for the archive summary (locale-independent, so no ICU needed). */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

interface Props {
  lang: string
  projects: ProjectOption[]
}

export function WhatsAppImportForm({ lang, projects: initialProjects }: Props) {
  const t = useTranslations('adminWhatsapp')

  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState<ParsedZip | null>(null)
  const [classification, setClassification] = useState<ClassifyResult | null>(null)

  // Confirm/override state.
  const [projects, setProjects] = useState<ProjectOption[]>(initialProjects)
  const [mode, setMode] = useState<'match' | 'new'>('new')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [newName, setNewName] = useState<string>('')
  const [kbLang, setKbLang] = useState<KbLang>('en')

  const [progress, setProgress] = useState<Progress | null>(null)

  // The parsed JSZip is retained so media blobs can be pulled lazily at ingest time.
  const zipRef = useRef<JSZip | null>(null)
  // Raw-.zip archive to Storage (quick-kayinleong-088) — independent of ingest.
  const [archive, setArchive] = useState<ArchiveState | null>(null)

  // ── Step 1b: archive the RAW .zip to Storage ───────────────────────────────
  /**
   * Upload the untouched .zip to `whatsapp-imports/` (quick-kayinleong-088).
   *
   * WHY: the import previously kept only what it could parse. When chunking produced
   * nothing, the source was gone — 20 WhatsApp kbDocs currently hold zero chunks and
   * `KbDocDoc` stores no text, so there is nothing in Firestore to re-ingest from and the
   * operator has to locate the original export by hand. Keeping the archive makes a
   * re-ingest a server-side job instead of a request to the person who uploaded it.
   *
   * Deliberately NON-FATAL. It runs at parse time, before a target project exists, and a
   * Storage misconfiguration must not stop the operator ingesting — the archive is a
   * safety net, not a precondition. Failure is surfaced in the UI and logged, and the
   * pipeline continues.
   *
   * Uses `uploadBytesResumable`, not `uploadBytes` + a timeout like the media loop below:
   * a media file is small enough that a 30 s ceiling means "hung", but an export .zip can
   * be hundreds of MB where the same ceiling would abort a healthy upload. Resumable
   * gives real byte progress instead, so a slow upload is visibly slow rather than dead.
   */
  async function archiveZip(file: File) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `whatsapp-imports/${stamp}__${safeStorageName(file.name)}`
    setArchive({ status: 'running', path, bytes: file.size, pct: 0 })
    try {
      // Same lazy-import discipline as the media loop (quick-kayinleong-046): never hoist
      // `firebase/storage` to module scope — it is a ~353 KB chunk.
      const [{ ref: storageRef, uploadBytesResumable }, storage] = await Promise.all([
        import('firebase/storage'),
        getClientStorage(),
      ])
      // storage.rules gates this on the `admin` custom claim; refresh so a stale token
      // cannot fail the write with a misleading permission error.
      await getFreshIdToken()

      const task = uploadBytesResumable(storageRef(storage, path), file, {
        contentType: 'application/zip',
        // Metadata only — never message content. Enough to identify the archive later
        // without opening it.
        customMetadata: {
          originalName: file.name,
          uploadedBy: clientAuth.currentUser?.uid ?? 'unknown',
          uploadedAt: new Date().toISOString(),
        },
      })

      await new Promise<void>((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const pct = snap.totalBytes > 0 ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0
            setArchive((a) => (a ? { ...a, pct } : a))
          },
          reject,
          () => resolve(),
        )
      })

      setArchive({ status: 'done', path, bytes: file.size, pct: 100 })
      toast.success(t('archiveDone'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setArchive({ status: 'error', path, bytes: file.size, pct: 0, error: message })
      // Warning, not error: ingest is still fully available.
      toast.warning(`${t('archiveFailed')}: ${message}`)
    }
  }

  // ── Step 1: parse the uploaded zip in-browser ──────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setClassification(null)
    setProgress(null)
    setArchive(null)
    try {
      const zip = await JSZip.loadAsync(file)
      zipRef.current = zip

      const entries = Object.values(zip.files).filter((f) => !f.dir)
      const chatEntry =
        entries.find((f) => /_chat\.txt$/i.test(f.name)) ?? entries.find((f) => /\.txt$/i.test(f.name))
      if (!chatEntry) {
        toast.error(t('noChatFile'))
        setBusy(false)
        return
      }

      const raw = await chatEntry.async('string')
      const p = parseWhatsApp(raw)
      const transcript = toTranscript(p)
      const sample = toClassificationSample(p)
      const mediaEntries = entries.filter((f) => f.name !== chatEntry.name).map((f) => f.name)

      setParsed({
        groupName: p.groupName,
        participantCount: p.participants.length,
        messageCount: p.messages.length,
        mediaEntries,
        transcript,
        sample,
      })
      setNewName(p.groupName || '')
      setMode('new')
      setSelectedProjectId(initialProjects[0]?.id ?? '')
      setPhase('parsed')

      // Archive the raw .zip in the background. Deliberately not awaited: the operator can
      // classify and ingest while a large upload finishes, and only a VALID export is
      // archived because this runs after `_chat.txt` parsed successfully.
      void archiveZip(file)

      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        toast.warning(t('transcriptLarge'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('parseError'))
    } finally {
      setBusy(false)
    }
  }

  // ── Step 2: classify against the inventory ─────────────────────────────────
  async function handleClassify() {
    if (!parsed) return
    setBusy(true)
    try {
      const result = await classifyWhatsAppProjectAction({
        groupName: parsed.groupName,
        sample: parsed.sample,
      })
      if (!result.ok) {
        toast.error(result.error ?? t('classifyError'))
        setBusy(false)
        return
      }
      setClassification(result)
      if (result.projects) setProjects(result.projects)

      // Seed the confirm form from the model's decision.
      if (result.decision === 'match' && result.matchedProjectId) {
        setMode('match')
        setSelectedProjectId(result.matchedProjectId)
      } else {
        setMode('new')
        setNewName(result.suggestedName || parsed.groupName || '')
      }
      setPhase('classified')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('classifyError'))
    } finally {
      setBusy(false)
    }
  }

  // ── Step 4: run the ingest pipeline ────────────────────────────────────────
  async function handleIngest() {
    if (!parsed) return

    // Validate the target selection first.
    if (mode === 'match' && !selectedProjectId) {
      toast.error(t('pickProject'))
      return
    }
    if (mode === 'new' && !newName.trim()) {
      toast.error(t('nameRequired'))
      return
    }

    const token = await clientAuth.currentUser?.getIdToken()
    if (!token) {
      toast.error(t('signInAgain'))
      return
    }

    setBusy(true)
    setPhase('ingesting')
    const prog: Progress = {
      projectStep: 'pending',
      kbStep: 'pending',
      mediaStep: 'pending',
      mediaCurrent: '',
      mediaDone: 0,
      mediaTotal: parsed.mediaEntries.length,
      mediaErrors: 0,
      log: [],
    }
    const pushLog = (line: string) => {
      prog.log = [...prog.log, line]
      setProgress({ ...prog })
    }
    setProgress({ ...prog })

    try {
      // 4a. Resolve the target project.
      let projectId: string
      let projectName: string
      if (mode === 'new') {
        prog.projectStep = 'running'
        pushLog(t('logCreatingProject'))
        const created = await createProjectAction({
          name: newName.trim(),
          // Placeholder — created HIDDEN so a $0/blank project never surfaces to Finder.
          status: 'hidden',
          priceValue: 0,
          tenure: '',
          vpStatus: false,
          vpDate: null,
          bumiQuota: false,
          foreignEligible: false,
          description: `Imported from WhatsApp group "${parsed.groupName || newName.trim()}".`,
          locationText: '',
          bedrooms: 0,
        })
        if (!created.ok || !created.projectId) {
          throw new Error(created.error ?? t('createProjectFailed'))
        }
        projectId = created.projectId
        projectName = newName.trim()
        prog.projectStep = 'done'
        pushLog(t('logProjectCreated'))
      } else {
        projectId = selectedProjectId
        projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId
        prog.projectStep = 'done'
        pushLog(t('logProjectMatched', { name: projectName }))
      }

      // 4b. Ingest the transcript into the KB.
      prog.kbStep = 'running'
      pushLog(t('logIngestingKb'))
      const kb = await createKbDocAction({
        title: `WhatsApp — ${projectName}`,
        content: parsed.transcript,
        lang: kbLang,
        pillar: 'finder',
        category: projectName,
      })
      if (!kb.ok || !kb.jobId) {
        throw new Error(kb.error ?? t('kbIngestFailed'))
      }

      // Poll the chunked-ingest worker until every chunk is embedded.
      let remaining = kb.remaining ?? kb.total ?? 1
      let iterations = 0
      while (remaining > 0 && iterations < POLL_MAX_ITERATIONS) {
        const res = await fetch(
          `/api/kb/ingest/process?jobId=${encodeURIComponent(kb.jobId)}&limit=${POLL_LIMIT}`,
          // Re-read per poll (quick-kayinleong-058): a WhatsApp export is large enough
          // that this loop can outlive the 1-hour ID-token lifetime.
          { headers: { Authorization: `Bearer ${await getFreshIdToken()}` } },
        )
        if (!res.ok) {
          // Surface the route's error body (e.g. a Gemini embed failure) — not just the status.
          let detail = `HTTP ${res.status}`
          try {
            const errBody = (await res.json()) as { error?: string }
            if (errBody?.error) detail = errBody.error
          } catch {
            /* non-JSON error body — keep the status */
          }
          throw new Error(`${t('kbIngestFailed')}: ${detail}`)
        }
        const body = (await res.json()) as { remaining?: number }
        remaining = body.remaining ?? 0
        iterations += 1
      }
      prog.kbStep = 'done'
      pushLog(t('logKbDone', { chunks: kb.total ?? 0 }))

      // 4c. Upload media → Storage, record each as collateral.
      // This is the app's first browser→Storage upload path. A misconfigured bucket
      // (rules not deployed / CORS unset) makes uploadBytes HANG rather than fail fast,
      // which would freeze the bar at 0/total. Guard each upload with a timeout and
      // fail-fast after repeated failures so the step can never sit silently stuck.
      const zip = zipRef.current
      prog.mediaStep = parsed.mediaEntries.length > 0 ? 'running' : 'done'
      setProgress({ ...prog })
      // Surface the target bucket up front. A build inlined with the wrong
      // NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET points at a bucket that does not exist,
      // which makes uploadBytes 404-and-retry until the timeout instead of failing
      // loudly — logging the bucket makes that misconfiguration obvious immediately.
      // Lazy import kept deliberately (quick-kayinleong-046): `firebase/storage` is a
      // ~353 KB chunk and must stay off every route's critical path. Do NOT hoist this
      // to module scope. getDownloadURL comes from the same chunk, so it is free here.
      const [{ ref: storageRef, uploadBytes, getDownloadURL }, storage] = await Promise.all([
        import('firebase/storage'),
        getClientStorage(),
      ])
      const bucket = storage.app.options.storageBucket ?? '(unset)'
      if (parsed.mediaEntries.length > 0) {
        pushLog(t('logMediaTarget', { count: parsed.mediaEntries.length, bucket }))
      }
      let consecutiveFailures = 0
      for (const entryName of parsed.mediaEntries) {
        prog.mediaCurrent = entryName.split('/').pop() ?? entryName
        setProgress({ ...prog })
        try {
          const file = zip?.file(entryName)
          if (!file) {
            prog.mediaErrors += 1
            consecutiveFailures += 1
            pushLog(t('logMediaMissing', { name: entryName }))
          } else {
            const blob = await file.async('blob')
            const path = `collateral/${projectId}/whatsapp/${safeStorageName(entryName)}`
            // quick-kayinleong-050: keep the upload result. Its `ref` is what
            // getDownloadURL() needs. Discarding it was the root cause of 11,774
            // collateral docs holding a bucket key and no shareable link — the
            // Finder agent had nothing web-addressable to attach, so every
            // WhatsApp-ingested brochure rendered as dead text.
            const snap = await withTimeout(
              uploadBytes(storageRef(storage, path), blob),
              UPLOAD_TIMEOUT_MS,
              t('mediaTimedOut', { bucket }),
            )
            // Objects written by the web SDK carry a `firebaseStorageDownloadTokens`
            // metadata value, so this is a permanent, non-expiring URL — one metadata
            // read, no IAM signing, no expiry to re-break the link later.
            // Timed out like the upload: a misconfigured bucket makes this hang rather
            // than fail fast, and a rejection here must land in the catch below so it
            // increments mediaErrors / consecutiveFailures like any other failure.
            const downloadUrl = await withTimeout(
              getDownloadURL(snap.ref),
              UPLOAD_TIMEOUT_MS,
              t('mediaTimedOut', { bucket }),
            )
            const att = await attachCollateralAction(projectId, {
              type: 'whatsapp-media',
              lang: kbLang,
              // Both fields: storagePath stays the canonical object identity (used for
              // delete/overwrite), externalUrl is the web-addressable form the Finder
              // agent reads. attachCollateral requires at least one and permits both.
              storagePath: path,
              externalUrl: downloadUrl,
            })
            if (!att.ok) {
              prog.mediaErrors += 1
              consecutiveFailures += 1
              pushLog(t('logMediaError', { name: entryName, error: att.error ?? '' }))
            } else {
              prog.mediaDone += 1
              consecutiveFailures = 0
            }
          }
        } catch (err) {
          prog.mediaErrors += 1
          consecutiveFailures += 1
          pushLog(t('logMediaError', { name: entryName, error: err instanceof Error ? err.message : '' }))
        }
        setProgress({ ...prog })

        // Uploads are clearly not working — stop hammering (would be N × timeout) and
        // point the operator at the likely cause instead of grinding to a frozen halt.
        if (consecutiveFailures >= MAX_CONSECUTIVE_MEDIA_FAILURES) {
          prog.mediaStep = 'error'
          prog.mediaCurrent = ''
          pushLog(t('logMediaStopped', { n: consecutiveFailures }))
          setProgress({ ...prog })
          break
        }
      }
      if (prog.mediaStep === 'running') {
        prog.mediaStep = 'done'
        prog.mediaCurrent = ''
        setProgress({ ...prog })
      }

      setPhase('done')
      if (prog.mediaStep === 'error') {
        // KB (the primary value) succeeded; media upload is the secondary step that stalled.
        toast.warning(t('ingestKbOkMediaFailed'))
      } else if (prog.mediaErrors === 0) {
        toast.success(t('ingestSuccess'))
      } else {
        toast.warning(t('ingestPartial', { done: prog.mediaDone, errors: prog.mediaErrors }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (prog.kbStep === 'running') prog.kbStep = 'error'
      if (prog.projectStep === 'running') prog.projectStep = 'error'
      // Persist the failure in the log panel (the toast is transient) so it stays diagnosable.
      pushLog(`✗ ${msg}`)
      setProgress({ ...prog })
      toast.error(msg || t('ingestError'))
      setPhase('classified') // allow a retry from the confirm step
    } finally {
      setBusy(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Step 1 — upload */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">{t('uploadTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('uploadHint')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="wa-zip">{t('zipLabel')}</Label>
          <Input
            id="wa-zip"
            type="file"
            accept=".zip,application/zip"
            onChange={handleFile}
            disabled={busy}
          />

          {parsed && (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{t('detectedGroup')}</dt>
              <dd className="font-medium">{parsed.groupName || t('unknownGroup')}</dd>
              <dt className="text-muted-foreground">{t('participants')}</dt>
              <dd className="font-medium">{parsed.participantCount}</dd>
              <dt className="text-muted-foreground">{t('messages')}</dt>
              <dd className="font-medium">{parsed.messageCount}</dd>
              <dt className="text-muted-foreground">{t('mediaFiles')}</dt>
              <dd className="font-medium">{parsed.mediaEntries.length}</dd>
            </dl>
          )}

          {/* Raw-.zip archive (quick-kayinleong-088). Shown separately from the parse
              summary because it is not part of ingest — it can still be uploading, or have
              failed, while classify/ingest proceed normally. The path is rendered in full
              and selectable so it can be quoted when requesting a re-ingest. */}
          {archive && (
            <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t('archiveLabel')}</span>
                <span
                  className={
                    archive.status === 'done'
                      ? 'font-medium text-emerald-600 dark:text-emerald-400'
                      : archive.status === 'error'
                        ? 'font-medium text-destructive'
                        : 'font-medium text-muted-foreground'
                  }
                >
                  {archive.status === 'done'
                    ? t('archiveStatusDone', { size: formatBytes(archive.bytes) })
                    : archive.status === 'error'
                      ? t('archiveStatusError')
                      : t('archiveStatusRunning', { pct: archive.pct })}
                </span>
              </div>

              {archive.status === 'running' && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${archive.pct}%` }}
                  />
                </div>
              )}

              {archive.status === 'done' && (
                <p className="mt-2 font-mono text-xs break-all select-all text-muted-foreground">
                  {archive.path}
                </p>
              )}

              {archive.status === 'error' && (
                <p className="mt-2 text-xs text-destructive">{archive.error}</p>
              )}

              <p className="mt-2 text-xs text-muted-foreground">{t('archiveHint')}</p>
            </div>
          )}
        </CardContent>
        {parsed && phase === 'parsed' && (
          <CardFooter className="flex justify-end">
            <Button onClick={handleClassify} disabled={busy}>
              {busy ? t('analyzing') : t('analyzeButton')}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Step 2/3 — decision + confirm */}
      {classification && parsed && (phase === 'classified' || phase === 'ingesting' || phase === 'done') && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t('decisionTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('decisionSummary', {
                decision: classification.decision === 'match' ? t('decisionMatch') : t('decisionNew'),
                name: classification.suggestedName ?? '',
                confidence: Math.round((classification.confidence ?? 0) * 100) + '%',
              })}
            </p>
            {classification.reasoning && (
              <p className="mt-1 text-xs text-muted-foreground italic">{classification.reasoning}</p>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="wa-mode"
                  checked={mode === 'match'}
                  onChange={() => setMode('match')}
                  disabled={busy || projects.length === 0}
                />
                {t('modeMatch')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="wa-mode"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  disabled={busy}
                />
                {t('modeNew')}
              </label>
            </div>

            {mode === 'match' ? (
              <div className="space-y-2">
                <Label htmlFor="wa-project">{t('selectProject')}</Label>
                <select
                  id="wa-project"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={busy}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.status})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="wa-newname">{t('newProjectName')}</Label>
                <Input
                  id="wa-newname"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('newProjectPlaceholder')}
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">{t('newProjectHiddenNote')}</p>
              </div>
            )}

            {/* KB language */}
            <div className="space-y-2">
              <Label htmlFor="wa-lang">{t('kbLanguage')}</Label>
              <select
                id="wa-lang"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={kbLang}
                onChange={(e) => setKbLang(e.target.value as KbLang)}
                disabled={busy}
              >
                <option value="en">English</option>
                <option value="ms">Bahasa Melayu</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </CardContent>

          <CardFooter className="flex justify-end">
            <Button onClick={handleIngest} disabled={busy || phase === 'done'}>
              {phase === 'ingesting' ? t('ingesting') : t('ingestButton')}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 4 — progress */}
      {progress && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t('progressTitle')}</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>
                {t('stepProject')}: <StatusText status={progress.projectStep} t={t} />
              </li>
              <li>
                {t('stepKb')}: <StatusText status={progress.kbStep} t={t} />
              </li>
              <li>
                {t('stepMedia')}: <StatusText status={progress.mediaStep} t={t} /> — {progress.mediaDone}/
                {progress.mediaTotal}
                {progress.mediaErrors > 0 && ` (${progress.mediaErrors} ${t('errorsLabel')})`}
              </li>
              {progress.mediaStep === 'running' && progress.mediaCurrent && (
                <li className="truncate pl-4 text-xs text-muted-foreground">
                  {t('mediaUploadingNow', { name: progress.mediaCurrent })}
                </li>
              )}
            </ul>

            {progress.mediaTotal > 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round(
                      ((progress.mediaDone + progress.mediaErrors) / progress.mediaTotal) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}

            {progress.log.length > 0 && (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                {progress.log.join('\n')}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusText({
  status,
  t,
}: {
  status: 'pending' | 'running' | 'done' | 'error'
  t: ReturnType<typeof useTranslations>
}) {
  const label =
    status === 'done'
      ? t('statusDone')
      : status === 'running'
        ? t('statusRunning')
        : status === 'error'
          ? t('statusError')
          : t('statusPending')
  const cls =
    status === 'done'
      ? 'text-green-600'
      : status === 'error'
        ? 'text-destructive'
        : status === 'running'
          ? 'text-primary'
          : 'text-muted-foreground'
  return <span className={cls}>{label}</span>
}
