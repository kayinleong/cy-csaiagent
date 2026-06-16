'use client'

/**
 * app/[lang]/(admin)/erasure/erasure-request-form.tsx
 *
 * PDPA data-erasure request form — client island.
 *
 * SAFETY-CRITICAL: This is the most safety-critical UI in the platform.
 * Implements HR-8…HR-12 from 05-UI-SPEC.md:
 *
 *   HR-8: TWO gates before erasure fires — subject selection + type-to-confirm.
 *   HR-9: AlertDialogAction variant="destructive" DISABLED until typed === subjectRef.
 *   HR-10: Irreversibility stated in words (from i18n — adminErasure.confirmBody).
 *   HR-11: No bulk/multi-select — exactly one subject per request.
 *   HR-12: UI renders only after the three-layer admin gate (layer 1+2 = page/layout).
 *
 * Stage A — Subject selection:
 *   - RadioGroup: lead | agent (HR-11: no multi-select)
 *   - Input + search (subject id input)
 *   - Blast-radius preview (read-only counts from getBlastRadius)
 *
 * Stage B — Type-to-confirm AlertDialog (the destructive gate):
 *   - AlertDialogMedia: Trash2 destructive icon
 *   - AlertDialogTitle: adminErasure.confirmTitle
 *   - AlertDialogDescription: adminErasure.confirmBody (HR-10 irreversibility copy)
 *   - Input: "Type {ref} to confirm"
 *   - AlertDialogAction variant="destructive" DISABLED until typed === ref (HR-9)
 *   - AlertDialogCancel variant="outline" (always enabled — the safe choice)
 *
 * On confirm: calls eraseDataSubjectAction via useTransition; toast.success(requestQueued).
 * The "Erase…" button ONLY OPENS the dialog — it never erases (HR-8).
 *
 * Pattern: stall-inbox.tsx useTransition+sonner plumbing + alert-dialog.tsx destructive gate.
 *
 * References:
 *   - 05-UI-SPEC.md §Surface 5 Stages A/B
 *   - 05-PATTERNS.md §erasure-request-form.tsx
 *   - components/ui/alert-dialog.tsx
 *   - _components/stall-inbox.tsx:55-72
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { eraseDataSubjectAction, getBlastRadius, type BlastRadiusResult } from './actions'

/** An agent the admin can find by email in the lookup dropdown (agent subject only). */
export interface AgentLookupOption {
  id: string
  email: string | null
  displayRef: string
}

interface ErasureRequestFormProps {
  lang: string
  /** Roster for the agent email-lookup dropdown. Empty disables the dropdown. */
  agentOptions: AgentLookupOption[]
}

type SubjectType = 'lead' | 'agent'

export function ErasureRequestForm({ lang: _lang, agentOptions }: ErasureRequestFormProps) {
  const t = useTranslations('adminErasure')

  // Stage A state
  const [subjectType, setSubjectType] = useState<SubjectType>('lead')
  const [subjectId, setSubjectId] = useState('')
  const [blastRadius, setBlastRadius] = useState<BlastRadiusResult | null>(null)
  const [isLoadingBlast, setIsLoadingBlast] = useState(false)

  // Stage B state (dialog)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [typedToken, setTypedToken] = useState('')
  const [isPending, startTransition] = useTransition()

  // The confirmation token is the subject ID — admin must type it exactly (HR-9)
  const subjectRef = subjectId.trim()
  const tokenMatches = typedToken === subjectRef && subjectRef.length > 0

  // The email of the currently-selected agent (for the "selected" hint). The
  // subject id is still the UID — the type-to-confirm gate is unchanged (HR-9).
  const selectedAgentEmail =
    subjectType === 'agent'
      ? (agentOptions.find((a) => a.id === subjectRef)?.email ?? null)
      : null

  // Accepts an explicit id so a dropdown pick can search immediately (the
  // subjectId state update is async and not yet visible in this tick).
  function handleSearch(idArg?: string) {
    const ref = (idArg ?? subjectId).trim()
    if (!ref) return
    setIsLoadingBlast(true)
    setBlastRadius(null)
    void (async () => {
      const result = await getBlastRadius({ subjectType, id: ref })
      setBlastRadius(result)
      setIsLoadingBlast(false)
    })()
  }

  // Pick an agent from the email-lookup dropdown: the subject id becomes the
  // agent's UID (what erasure keys on), then load the blast-radius preview.
  function handlePickAgent(uid: string) {
    setSubjectId(uid)
    setBlastRadius(null)
    handleSearch(uid)
  }

  function handleOpenDialog() {
    // Reset the typed token each time the dialog opens (HR-9 fresh gate)
    setTypedToken('')
    setDialogOpen(true)
  }

  function handleConfirmErase() {
    // Only callable when token matches (HR-9 — AlertDialogAction disabled until match)
    startTransition(async () => {
      const result = await eraseDataSubjectAction({ subjectType, id: subjectRef })
      if (result.ok) {
        toast.success(t('requestQueued'))
        // Reset form after successful queuing
        setSubjectId('')
        setBlastRadius(null)
        setTypedToken('')
        setDialogOpen(false)
      } else {
        toast.error(result.error ?? t('statusFailed'))
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Stage A: Subject selection (HR-11: no multi-select — one subject at a time) */}
      <Card>
        <CardContent className="pt-6">
          {/* Subject type selector */}
          <div className="mb-4">
            <Label className="mb-2 block text-sm font-medium">Subject type</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSubjectType('lead'); setSubjectId(''); setBlastRadius(null) }}
                className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                  subjectType === 'lead'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                {t('subjectTypeLead')}
              </button>
              <button
                type="button"
                onClick={() => { setSubjectType('agent'); setSubjectId(''); setBlastRadius(null) }}
                className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                  subjectType === 'agent'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent'
                }`}
              >
                {t('subjectTypeAgent')}
              </button>
            </div>
          </div>

          {/* Agent email lookup (suggestion dropdown). Agents have an email in
              Firebase Auth; leads do not — so this shows for the agent subject only.
              Picking sets the subject id to the agent's UID and loads the preview;
              the type-to-confirm gate still types that UID (HR-9 unchanged). */}
          {subjectType === 'agent' && agentOptions.length > 0 && (
            <div className="mb-4 space-y-2">
              <Label className="block text-sm font-medium">{t('agentLookupLabel')}</Label>
              <Command className="rounded-md border">
                <CommandInput placeholder={t('agentLookupPlaceholder')} />
                <CommandList className="max-h-56">
                  <CommandEmpty>{t('agentLookupEmpty')}</CommandEmpty>
                  <CommandGroup>
                    {agentOptions.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={`${a.email ?? ''} ${a.id}`}
                        onSelect={() => handlePickAgent(a.id)}
                      >
                        <span className={a.email ? 'truncate' : 'truncate font-mono text-xs'}>
                          {a.email ?? `${a.displayRef}…`}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
              {selectedAgentEmail && (
                <p className="text-xs text-muted-foreground">
                  {t('agentLookupSelected', { email: selectedAgentEmail })}
                </p>
              )}
            </div>
          )}

          {/* Subject ID search (lead id, or the agent UID populated by the lookup) */}
          <div className="flex gap-2">
            <Input
              value={subjectId}
              onChange={(e) => { setSubjectId(e.target.value); setBlastRadius(null) }}
              placeholder={t('searchPlaceholder')}
              className="flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            />
            <Button
              variant="secondary"
              onClick={() => handleSearch()}
              disabled={!subjectRef || isLoadingBlast}
            >
              Search
            </Button>
          </div>

          {/* Idle state */}
          {!subjectRef && !blastRadius && (
            <p className="mt-3 text-sm text-muted-foreground">{t('idle')}</p>
          )}

          {/* Loading blast radius */}
          {isLoadingBlast && (
            <p className="mt-3 text-sm text-muted-foreground">Loading preview…</p>
          )}

          {/* Blast-radius preview (read-only, HR-8 — no deletion yet) */}
          {blastRadius && blastRadius.ok && blastRadius.counts && (
            <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="size-4 text-destructive" />
                <span className="text-sm font-medium text-destructive">{t('blastRadiusTitle')}</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{t('blastRadiusHint')}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {Object.entries(blastRadius.counts).map(([col, count]) => (
                  <div key={col} className="flex items-center justify-between rounded bg-background px-2 py-1">
                    <span className="font-mono text-xs text-muted-foreground">{col}</span>
                    <Badge variant="secondary" className="text-xs">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error state */}
          {blastRadius && !blastRadius.ok && (
            <p className="mt-3 text-sm text-destructive">{blastRadius.error}</p>
          )}

          {/* Stage B trigger: "Erase…" button OPENS the dialog only (HR-8 — never erases) */}
          {subjectRef && blastRadius && (
            <div className="mt-4">
              <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    onClick={handleOpenDialog}
                    className="w-full sm:w-auto"
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t('eraseButton')}
                  </Button>
                </AlertDialogTrigger>

                {/* Stage B: Type-to-confirm destructive gate (HR-8/HR-9/HR-10) */}
                <AlertDialogContent>
                  <AlertDialogHeader>
                    {/* AlertDialogMedia slot: destructive icon (05-UI-SPEC.md §Surface 5 Stage B) */}
                    <AlertDialogMedia className="bg-destructive/10">
                      <Trash2 className="size-6 text-destructive" />
                    </AlertDialogMedia>

                    {/* Title */}
                    <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>

                    {/* HR-10: Irreversibility stated in words (all 3 languages via i18n) */}
                    <AlertDialogDescription>
                      {t('confirmBody', { ref: subjectRef })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  {/* Type-to-confirm input (HR-9) */}
                  <div className="px-0 py-2">
                    <Label htmlFor="confirm-token" className="mb-1.5 block text-sm font-medium">
                      {t('typeToConfirmLabel', { ref: subjectRef })}
                    </Label>
                    <Input
                      id="confirm-token"
                      value={typedToken}
                      onChange={(e) => setTypedToken(e.target.value)}
                      placeholder={subjectRef}
                      className="font-mono text-base"
                      autoComplete="off"
                      autoFocus
                    />
                    {typedToken.length > 0 && !tokenMatches && (
                      <p className="mt-1 text-xs text-destructive">{t('typeToConfirmMismatch')}</p>
                    )}
                  </div>

                  <AlertDialogFooter>
                    {/* Cancel — always enabled, the visually safe choice (HR-9) */}
                    <AlertDialogCancel variant="outline">
                      {t('cancel')}
                    </AlertDialogCancel>

                    {/* Destructive confirm — DISABLED until typed token matches (HR-9) */}
                    <AlertDialogAction
                      variant="destructive"
                      disabled={!tokenMatches || isPending}
                      onClick={(e) => {
                        e.preventDefault() // prevent default dialog close; we close on success
                        handleConfirmErase()
                      }}
                    >
                      {isPending ? 'Erasing…' : t('confirmErase')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
