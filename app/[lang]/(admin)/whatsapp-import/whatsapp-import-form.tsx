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
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { clientAuth, clientStorage } from '@/src/firebase/client'
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

interface Progress {
  projectStep: 'pending' | 'running' | 'done' | 'error'
  kbStep: 'pending' | 'running' | 'done' | 'error'
  mediaDone: number
  mediaTotal: number
  mediaErrors: number
  log: string[]
}

const MAX_TRANSCRIPT_CHARS = 900_000 // soft guard against the Server Action body cap (~1 MB)
const POLL_LIMIT = 5
const POLL_MAX_ITERATIONS = 5_000

/** Keep the basename and strip characters that would complicate a Storage path. */
function safeStorageName(name: string): string {
  const base = name.split('/').pop() ?? name
  return base.replace(/[^\w.\-() ]+/g, '_')
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

  // ── Step 1: parse the uploaded zip in-browser ──────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setClassification(null)
    setProgress(null)
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
          { headers: { Authorization: `Bearer ${token}` } },
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
      const zip = zipRef.current
      for (const entryName of parsed.mediaEntries) {
        try {
          const file = zip?.file(entryName)
          if (!file) {
            prog.mediaErrors += 1
            pushLog(t('logMediaMissing', { name: entryName }))
            continue
          }
          const blob = await file.async('blob')
          const path = `collateral/${projectId}/whatsapp/${safeStorageName(entryName)}`
          await uploadBytes(storageRef(clientStorage, path), blob)
          const att = await attachCollateralAction(projectId, {
            type: 'whatsapp-media',
            lang: kbLang,
            storagePath: path,
          })
          if (!att.ok) {
            prog.mediaErrors += 1
            pushLog(t('logMediaError', { name: entryName, error: att.error ?? '' }))
          } else {
            prog.mediaDone += 1
          }
        } catch (err) {
          prog.mediaErrors += 1
          pushLog(t('logMediaError', { name: entryName, error: err instanceof Error ? err.message : '' }))
        }
        setProgress({ ...prog })
      }

      setPhase('done')
      if (prog.mediaErrors === 0) {
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
                {t('stepMedia')}: {progress.mediaDone}/{progress.mediaTotal}
                {progress.mediaErrors > 0 && ` (${progress.mediaErrors} ${t('errorsLabel')})`}
              </li>
            </ul>

            {progress.mediaTotal > 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.mediaDone / progress.mediaTotal) * 100)}%` }}
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
