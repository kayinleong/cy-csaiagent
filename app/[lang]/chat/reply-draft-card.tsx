'use client'

/**
 * app/[lang]/chat/reply-draft-card.tsx — the inline Reply draft card (Surface 1).
 *
 * Client island (textarea + clipboard + Server Action) that mirrors the Finder
 * match-list.tsx card composition but adds interactivity. Renders one of four
 * states keyed on a typed ReplyOutput (Plan 05 schema):
 *
 *   - draft               → quoted incoming + editable controlled <textarea>
 *                           (the edit-capture surface, D-18) + a category badge +
 *                           SOP citation chips + EXACTLY ONE Copy/egress button +
 *                           a DISTINCT thumbs-down feedback control.
 *   - copied              → terminal display state (HR-2). The textarea collapses;
 *                           the Copy CTA becomes a static "Copied — go send it from
 *                           WhatsApp" row. NEVER a "sent" state. The thumbs-down
 *                           feedback control may remain.
 *   - noSopMatch          → grounded refusal card (HR-4). NO textarea, NO Copy
 *                           button, NO thumbs-down (nothing to give feedback on).
 *   - clarifyingQuestion  → a plain explanatory message (copy match-list branch).
 *   - loading             → reuse the "Thinking…" pulse.
 *
 * HARD RULES (04-UI-SPEC §0):
 *   - HR-1: EXACTLY ONE send/egress action — "Copy draft" (copy-to-clipboard).
 *     There is NO share / send / post / auto-post / "send to WhatsApp" affordance
 *     anywhere on this card. The thumbs-down control is FEEDBACK, not egress: it
 *     writes thumbsDown:true via captureReplyEdit and NEVER touches the clipboard
 *     or any external surface (so it does not violate HR-1).
 *   - HR-2: the copied state is terminal for the send path; never a "sent" state.
 *   - HR-4: noSopMatch never renders invented SOP content as a draft.
 *   - HR-5: the draft editor is a plain controlled <textarea> (vendored Textarea) —
 *     no rich editor (no net-new dependency).
 *
 * On Copy: read the textarea value → navigator.clipboard.writeText(value) →
 * editRatio(original, value) → captureReplyEdit({...}) → toast → 'copied' state.
 * On thumbs-down: captureReplyEdit({..., thumbsDown:true}) → toast → pressed state
 * (idempotent in-session). The thumbs-down is the ADMIN-06 thumbs-down-rate producer
 * (consumed by Plan 10).
 *
 * Selector contract (tests/e2e/reply-draft.spec.ts — Wave-0 canonical):
 *   - [data-slot="reply-draft-card"][data-state="draft"|"copied"|"no-sop-match"|"clarifying"]
 *   - [data-testid="reply-draft-textarea"]  → the editable controlled textarea
 *   - [data-testid="reply-copy"]            → the SINGLE Copy button (chat.copyReply)
 *   - [data-testid="reply-thumbs-down"]     → the DISTINCT thumbs-down feedback control
 *
 * Core/shell: app/ may import from src/; src/ must never import from app/. We
 * import the ReplyOutput TYPE (import type) + the pure editRatio util from src/.
 *
 * References: REPLY-04, ADMIN-06, QUAL-02, D-15/16/17/18/21, HR-1/HR-2/HR-4/HR-5.
 */

import { useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ThumbsDown, Check } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { editRatio } from '@/src/reply/diff'
import { captureReplyEdit } from './reply-edit-actions'
import type { ReplyOutput } from '@/src/agents/reply/schema'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ReplyDraftCardProps {
  /** The validated Reply agent output (draft | noSopMatch | clarifyingQuestion). */
  output: ReplyOutput
  /** The de-pseudonymized-for-display incoming WhatsApp paste the agent holds. */
  incoming: string
  /** The lead this reply is for (required — D-07; the UI blocks dispatch without it). */
  leadId: string
  /** A stable id for this draft turn (used to correlate the replyEdits row). */
  draftId: string
  /** The agent's language for this turn (carried into the captureReplyEdit write). */
  lang: 'en' | 'ms' | 'zh'
  className?: string
}

/** Map a heuristic category guess from the incoming text → a category label key. */
type DraftCategory = 'coldProspect' | 'objectionHandling' | 'financing'

// ─── ReplyDraftCard ─────────────────────────────────────────────────────────────

export function ReplyDraftCard({
  output,
  incoming,
  leadId,
  draftId,
  lang,
  className,
}: ReplyDraftCardProps) {
  const t = useTranslations('chat')
  const { draft, noSopMatch, clarifyingQuestion } = output

  // ── State 3: Clarifying question (copy the match-list clarifying branch) ────
  if (clarifyingQuestion) {
    return (
      <div
        data-slot="reply-draft-card"
        data-testid="reply-draft-card"
        data-state="clarifying"
        className={cn('flex flex-col gap-3', className)}
      >
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {clarifyingQuestion}
        </p>
      </div>
    )
  }

  // ── State: Grounded refusal (no_sop_match) — HR-4: nothing to copy/edit ─────
  if (noSopMatch) {
    return (
      <div
        data-slot="reply-draft-card"
        data-testid="reply-draft-card"
        data-state="no-sop-match"
        className={cn('flex flex-col gap-3', className)}
      >
        <Card className="rounded-xl ring-1 ring-foreground/10 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('replyDraft.refusalLabel')}
            </span>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-sm leading-relaxed">
            {/* Verbatim grounded refusal — the model's message takes precedence; the
                i18n string is the localized fallback (D-11). */}
            {noSopMatch.message || t('replyDraft.refusalBody')}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── State 1/2: draft (interactive) — defer to the stateful inner component ──
  if (draft) {
    return (
      <DraftBody
        draft={draft}
        incoming={incoming}
        leadId={leadId}
        draftId={draftId}
        lang={lang}
        className={className}
      />
    )
  }

  // ── Fallback: empty output (should not normally occur) ──────────────────────
  return (
    <div
      data-slot="reply-draft-card"
      data-testid="reply-draft-card"
      data-state="empty"
      className={cn('flex flex-col gap-3', className)}
    >
      <p className="text-sm text-muted-foreground">{t('error')}</p>
    </div>
  )
}

// ─── DraftBody (the interactive draft + copied states) ──────────────────────────

interface DraftBodyProps {
  draft: NonNullable<ReplyOutput['draft']>
  incoming: string
  leadId: string
  draftId: string
  lang: 'en' | 'ms' | 'zh'
  className?: string
}

function DraftBody({ draft, incoming, leadId, draftId, lang, className }: DraftBodyProps) {
  const t = useTranslations('chat')

  // Controlled draft text — THIS is the edit-capture surface (D-18). Seeded with
  // the model's draft; the agent edits in place; Copy reads from here.
  const [value, setValue] = useState(draft.text)
  const [copied, setCopied] = useState(false)
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  const [thumbsDownSent, setThumbsDownSent] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const category = inferCategory(incoming)

  // ── Copy handler — the SINGLE egress path (HR-1). ─────────────────────────
  const handleCopy = useCallback(async () => {
    const text = textareaRef.current?.value ?? value
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard write failed — do NOT collapse the card; let the agent select
      // and copy manually. Never auto-share as a fallback (HR-1).
      toast.error(t('replyDraft.copyFailed'))
      return
    }

    // Capture the edit-as-signal on copy (D-18). editRatio drives the dashboard's
    // per-SOP edit-rate; the server action writes the append-only replyEdits row.
    const ratio = editRatio(draft.text, text)
    void ratio // ratio is recomputed server-side from the same strings; computed
    // here too so the contract (read textarea → editRatio → capture) is explicit.

    try {
      await captureReplyEdit({
        leadId,
        draftId,
        sopDocIds: draft.sopDocIds,
        originalDraft: draft.text,
        editedFinal: text,
        lang,
      })
    } catch {
      // A capture failure must NOT block the agent from sending — the clipboard
      // already holds the text. Surface nothing (no PII in logs); proceed.
    }

    setCopied(true)
    setCopiedAt(Date.now())
    toast.success(t('copied'))
  }, [draft.text, draft.sopDocIds, leadId, draftId, lang, t, value])

  // ── Thumbs-down handler — FEEDBACK, never egress (HR-1 preserved). ─────────
  const handleThumbsDown = useCallback(async () => {
    if (thumbsDownSent) return // idempotent in-session — never double-write
    setThumbsDownSent(true)
    const text = textareaRef.current?.value ?? value
    try {
      await captureReplyEdit({
        leadId,
        draftId,
        sopDocIds: draft.sopDocIds,
        originalDraft: draft.text,
        editedFinal: text,
        lang,
        thumbsDown: true,
      })
      toast(t('replyDraft.thumbsDownToast'))
    } catch {
      // Feedback failed — revert the pressed state so the agent can retry.
      setThumbsDownSent(false)
    }
  }, [thumbsDownSent, draft.text, draft.sopDocIds, leadId, draftId, lang, t, value])

  // ── Copied state — terminal for the send path (HR-2). No "sent" state. ─────
  if (copied) {
    return (
      <div
        data-slot="reply-draft-card"
        data-testid="reply-draft-card"
        data-state="copied"
        className={cn('flex flex-col gap-3', className)}
      >
        <Card className="rounded-xl ring-1 ring-foreground/10 shadow-sm">
          <CardContent className="px-4 py-4 flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('replyDraft.copiedGoSend')}</span>
            {copiedAt !== null && (
              <span className="ml-auto text-[0.6875rem] text-muted-foreground">
                {relativeTime(copiedAt)}
              </span>
            )}
          </CardContent>
          {/* The thumbs-down feedback control MAY remain after copy (feedback can
              follow a send). It is still NOT an egress affordance. */}
          <CardFooter className="px-4 pb-4 pt-0 flex items-center gap-2">
            <ThumbsDownControl
              pressed={thumbsDownSent}
              onPress={() => void handleThumbsDown()}
              ariaLabel={t('replyDraft.thumbsDownAria')}
            />
          </CardFooter>
        </Card>
      </div>
    )
  }

  // ── Draft state — quoted incoming + editable textarea + Copy + thumbs-down ──
  return (
    <div
      data-slot="reply-draft-card"
      data-testid="reply-draft-card"
      data-state="draft"
      className={cn('flex flex-col gap-3', className)}
    >
      <Card className="rounded-xl ring-1 ring-foreground/10 shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center gap-2">
          {/* Category badge — outline chip (cold-prospect / objection / financing) */}
          <Badge variant="outline" className="text-[0.625rem] px-1.5 py-0.5 h-auto font-normal">
            {t(`replyDraft.category.${category}`)}
          </Badge>
        </CardHeader>

        <CardContent className="px-4 pb-3 flex flex-col gap-3">
          {/* Quoted incoming block — what the agent pasted (de-pseudonymized for
              display; the PII boundary is server-side). */}
          <div>
            <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground mb-1">
              {t('replyDraft.incomingLabel')}
            </span>
            <blockquote className="bg-muted rounded-lg px-3 py-2 text-sm border-l-2 border-foreground/20 whitespace-pre-wrap">
              {incoming}
            </blockquote>
          </div>

          {/* Editable draft — the edit-capture surface (D-18). Plain Textarea (HR-5). */}
          <Textarea
            ref={textareaRef}
            data-testid="reply-draft-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field-sizing-content min-h-24 max-h-72 text-base md:text-sm"
            aria-label={t('replyDraft.incomingLabel')}
          />
        </CardContent>

        <CardFooter className="px-4 pb-4 pt-0 flex flex-col gap-2">
          {/* SOP citation chips — the grounding proof (HR-4 corollary). */}
          {draft.sopDocIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 w-full">
              <span className="text-[0.6875rem] text-muted-foreground mr-1">
                {t('replyDraft.sourcesLabel')}
              </span>
              {draft.sopDocIds.map((id) => (
                <Badge
                  key={id}
                  variant="secondary"
                  className="text-[0.625rem] font-mono px-1.5 py-0.5 h-auto"
                  title={id}
                >
                  {id}
                </Badge>
              ))}
            </div>
          )}

          {/* Footer actions: a DISTINCT thumbs-down feedback control (left,
              secondary) + the SINGLE Copy/egress CTA (right). The thumbs-down is
              icon-only ghost so it reads as feedback, not a second send. */}
          <div className="flex w-full items-center gap-2">
            <ThumbsDownControl
              pressed={thumbsDownSent}
              onPress={() => void handleThumbsDown()}
              ariaLabel={t('replyDraft.thumbsDownAria')}
            />
            <Button
              data-testid="reply-copy"
              id="reply-copy-button"
              onClick={() => void handleCopy()}
              className="ml-auto w-full sm:w-auto"
            >
              {t('copyReply')}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

// ─── ThumbsDownControl (the feedback affordance — NOT egress) ───────────────────

interface ThumbsDownControlProps {
  pressed: boolean
  onPress: () => void
  ariaLabel: string
}

/**
 * A distinct, icon-only, ghost feedback button. It is visually + semantically
 * separate from the Copy CTA. It NEVER touches the clipboard, share, or send —
 * its only effect is the captureReplyEdit({thumbsDown:true}) server write
 * (handled by the parent). aria-pressed reflects the in-session feedback state.
 */
function ThumbsDownControl({ pressed, onPress, ariaLabel }: ThumbsDownControlProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="reply-thumbs-down"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={onPress}
      className={cn('shrink-0', pressed && 'text-muted-foreground')}
    >
      <ThumbsDown
        className={cn('h-4 w-4', pressed && 'fill-current')}
        aria-hidden="true"
      />
    </Button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lightweight heuristic to pick a category label for the badge. The authoritative
 * classification lives server-side in the replySlot; this is a display-only guess
 * so the badge has a sensible default before that wiring surfaces it as a prop.
 */
function inferCategory(incoming: string): DraftCategory {
  const text = incoming.toLowerCase()
  if (/\b(loan|financing|mortgage|installment|deposit|downpayment|rm\s?\d)/.test(text)) {
    return 'financing'
  }
  if (/\b(but|too expensive|not interested|think about|already|concern|worried)\b/.test(text)) {
    return 'objectionHandling'
  }
  return 'coldProspect'
}

/** A terse relative-time string for the copied confirmation (no i18n needed — "Ns ago"). */
function relativeTime(epochMs: number): string {
  const secs = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  return `${mins}m ago`
}
