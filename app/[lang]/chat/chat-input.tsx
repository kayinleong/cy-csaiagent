'use client'

/**
 * app/[lang]/chat/chat-input.tsx — Client-side chat input island.
 *
 * "use client" — this component uses React state + browser APIs (Firebase Auth,
 * ReadableStream, fetch). It is the ONLY interactive leaf in the chat shell;
 * the page.tsx remains a server component.
 *
 * Chat protocol:
 *   1. User types a message and presses Send or Enter (or taps a suggestion card).
 *   2. The ID token is fetched from Firebase Auth (getIdToken()).
 *   3. A POST request is sent to /api/chat with Bearer auth + messages array.
 *   4. The response body is a ReadableStream; tokens are decoded and appended
 *      incrementally to the assistant message (SSE proof).
 *   5. On a handoff signal in the response, a sonner toast is shown (D-10).
 *
 * AI SDK v5 note: useChat is not exported from ai@5.0.193.
 * This component implements the same chat-state pattern using React useState
 * + fetch + ReadableStream. The stream protocol parses UIMessageChunk format
 * by extracting text delta events from the SSE data lines.
 *
 * Redesign (quick-kayinleong-032): unified rounded input + lime icon send button
 * + footer AI-disclosure microcopy; `submittedSuggestion` seeds+sends a hero card.
 *
 * References: 01-PATTERNS.md Tier-A chat-input (lines 110-132).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { clientAuth } from '@/src/firebase/client'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatMessage } from './message-list'
import { decodeReplyOutput, decodeFinderOutput } from './decode-structured-output'
import {
  parseTextChunk,
  parseStreamError,
  parseMessageMetadata,
  TEXT_BLOCK_SEPARATOR,
} from './decode-stream-chunk'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A one-shot suggestion send from the hero cards. `id` de-dupes re-fires. */
export interface SubmittedSuggestion {
  id: number
  text: string
  /**
   * Pillar this card is FOR, applied to this dispatch only (quick-kayinleong-046).
   *
   * Hero cards used to call setPillarOverride, which pinned the pillar for the rest of
   * the session and was never cleared — so after tapping a Finder card, a follow-up
   * coaching question ("walk me through my first Meta ad") was still routed to Finder
   * and answered with "that's outside what I'm set up to assist with". Carrying the
   * pillar on the suggestion keeps the card deterministic without making it sticky.
   */
  pillar?: 'coach' | 'finder' | 'reply'
}

interface ChatInputProps {
  /** Callback: when messages update (the server page re-renders the list) */
  onMessagesChange: (messages: ChatMessage[]) => void
  /**
   * Report the REAL streaming state upward (quick-kayinleong-048).
   *
   * chat-shell used to infer it as "last message is an assistant with content === ''",
   * which goes false the instant the first token lands — so the whole tool-call
   * round-trip mid-turn (e.g. Finder's searchProjects) showed no indicator at all and
   * the bubble appeared frozen half-written. Only this hook knows when the turn is
   * actually still in flight.
   */
  onStreamingChange?: (isStreaming: boolean) => void
  /** Initial messages (from server-loaded conversation history) */
  initialMessages?: ChatMessage[]
  /** The conversation ID for persistence */
  conversationId?: string
  /**
   * Language override from the chat-header ToggleGroup chip (CHAT-08).
   * When set, overrides per-message auto-detect in the route handler.
   */
  langOverride?: 'en' | 'ms' | 'zh'
  /**
   * Pillar override from the chat-header pillar chip (FIND-11 / Phase 4 Surface 3).
   * When set, skips the heuristic/LLM router and forces the named pillar.
   * Undefined = Auto (router decides). Reply added Phase 4 (D-02).
   */
  pillarOverride?: 'coach' | 'finder' | 'reply'
  /**
   * The current lead ID — threaded into the POST body for Finder finderSlot
   * persistence (FIND-05/08) and required for the Reply path (D-07).
   */
  leadId?: string
  /**
   * Reply lead gate (D-07). Called BEFORE dispatch with the trimmed text. Return
   * `false` to BLOCK dispatch (e.g. a Reply turn with no leadId → chat-shell opens
   * the lead-selector). Return `true` (or omit the prop) to proceed. The blocked
   * text is preserved in the input so dispatch can resume after a lead is picked.
   */
  onBeforeSend?: (text: string, pillar?: 'coach' | 'finder' | 'reply') => boolean
  /**
   * One-shot suggestion send (redesign). When this changes to a new id, the input
   * seeds the text and dispatches it (subject to the same onBeforeSend gate).
   */
  submittedSuggestion?: SubmittedSuggestion
  /** i18n copy */
  placeholder?: string
  sendLabel?: string
}

// ─── useChatStream hook ───────────────────────────────────────────────────────

function useChatStream({
  onMessagesChange,
  onStreamingChange,
  initialMessages = [],
  conversationId,
  langOverride,
  pillarOverride,
  leadId,
  onBeforeSend,
  submittedSuggestion,
}: Pick<
  ChatInputProps,
  | 'onMessagesChange'
  | 'onStreamingChange'
  | 'initialMessages'
  | 'conversationId'
  | 'langOverride'
  | 'pillarOverride'
  | 'leadId'
  | 'onBeforeSend'
  | 'submittedSuggestion'
>) {
  // Localized copy for the failed-turn bubble. Reuses the existing `chat.error` key
  // rather than adding one, so this claim does not touch the i18n catalogs.
  const t = useTranslations('chat')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [isStreaming, setIsStreaming] = useState(false)
  const [input, setInput] = useState('')
  const cidRef = useRef<string>(conversationId ?? '')
  // Initialize cidRef on mount; update when conversationId prop changes
  // (happens when user selects a thread from the history drawer — CHAT-07).
  useEffect(() => {
    if (conversationId) {
      // New thread selected from history — use it directly
      cidRef.current = conversationId
    } else if (!cidRef.current) {
      // No cid yet and no prop — leave empty; ensurePrimaryThread on the server
      // will create/look up the stable coach-${uid} thread (D-01 / Pitfall 2 fix).
      cidRef.current = ''
    }
  }, [conversationId])

  // Re-seed the visible transcript when the SELECTED conversation changes —
  // history select loads a thread's persisted messages, New conversation clears
  // them (quick-018). chat-shell sets historyMessages + activeCid together, so
  // both deps update in one commit. These deps only change on select/new (never
  // during a stream — onMessagesChange feeds back into chat-shell's own mirror,
  // not historyMessages), so this re-seed never clobbers an in-flight response.
  // setState-in-effect is intentional here (same pattern as conversation-list.tsx).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMessages(initialMessages ?? [])
  }, [conversationId, initialMessages])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep parent in sync when messages update
  useEffect(() => {
    onMessagesChange(messages)
  }, [messages, onMessagesChange])

  // Keep parent in sync with the real streaming state (quick-kayinleong-048).
  useEffect(() => {
    onStreamingChange?.(isStreaming)
  }, [isStreaming, onStreamingChange])

  const sendMessage = useCallback(async (
    textOverride?: string,
    pillarForTurn?: 'coach' | 'finder' | 'reply',
  ) => {
    // textOverride lets a suggestion card dispatch its prompt without waiting on
    // the async setInput state to settle (avoids a stale-input race).
    const text = (textOverride ?? input).trim()
    if (!text || isStreaming) return

    // Pillar for THIS dispatch only: a hero card's pillar wins for its own send, then
    // routing reverts to the header chip (or Auto). quick-kayinleong-046 — see
    // SubmittedSuggestion.pillar.
    const effectivePillar = pillarForTurn ?? pillarOverride

    // Reply lead gate (D-07): give the parent a chance to BLOCK dispatch — e.g. a
    // Reply turn with no leadId opens the lead-selector instead of sending. The
    // input text is intentionally NOT cleared here so dispatch can resume after a
    // lead is picked. The effective pillar is passed so the gate sees the pillar this
    // turn will ACTUALLY use, not just the persistent chip.
    if (onBeforeSend && onBeforeSend(text, effectivePillar) === false) {
      return
    }

    // Optimistically add the user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setIsStreaming(true)

    try {
      // Get a fresh Firebase ID token for the Bearer auth header.
      // authStateReady() first (quick-kayinleong-046 / RC-5): Firebase restores LOCAL
      // persistence asynchronously, so immediately after a page reload `currentUser` is
      // still null for a beat. Reading it synchronously made the FIRST send after a
      // refresh bail out with a bogus "You are not signed in" — one of the two halves of
      // the reported "refreshed and it stopped responding".
      await clientAuth.authStateReady()
      const currentUser = clientAuth.currentUser
      if (!currentUser) {
        toast.error('You are not signed in. Please sign in to continue.')
        setIsStreaming(false)
        return
      }
      const idToken = await currentUser.getIdToken()

      // POST to /api/chat with Bearer auth
      // langOverride: passed when the user has pinned a language via the header chip (CHAT-08)
      // override:     pillar override from the header chip (FIND-11) — 'coach' | 'finder' | undefined
      // leadId:       current lead ID for Finder finderSlot persistence (FIND-05/08)
      const requestBody: {
        messages: Array<{ role: string; content: string }>
        cid: string
        langOverride?: 'en' | 'ms' | 'zh'
        override?: 'coach' | 'finder' | 'reply'
        leadId?: string
      } = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        cid: cidRef.current,
      }
      if (langOverride) {
        requestBody.langOverride = langOverride
      }
      if (effectivePillar) {
        requestBody.override = effectivePillar
      }
      if (leadId) {
        requestBody.leadId = leadId
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const status = response.status
        if (status === 401) {
          toast.error('Session expired. Please sign in again.')
        } else if (status === 429) {
          // TOKEN_CAP is a 24-HOUR window (src/ratelimit/window.ts), not hourly — the
          // old copy told agents to "wait a few minutes" for a limit that resets
          // tomorrow (quick-kayinleong-046).
          toast.warning("You've reached your daily usage limit. It resets in 24 hours.")
        } else {
          toast.error('Something went wrong. Please try again.')
        }
        setIsStreaming(false)
        return
      }

      // Add a placeholder assistant message to stream tokens into
      const assistantMsgId = `assistant-${Date.now()}`
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        citations: [],
      }
      setMessages((prev) => [...prev, assistantMsg])

      // Read the SSE stream incrementally
      const reader = response.body?.getReader()
      if (!reader) {
        setIsStreaming(false)
        return
      }

      const decoder = new TextDecoder()
      // Server-authoritative per-turn signal (quick-kayinleong-046). The client used to
      // infer all of this itself and got it wrong in Auto mode.
      let serverPillar: 'coach' | 'finder' | 'reply' | undefined
      let serverCitations: string[] = []
      let kbMiss = false
      let streamError: string | null = null
      // Which text block the deltas are currently landing in. A multi-step turn opens a
      // NEW block per step, and the boundary is where the paragraph break belongs
      // (quick-kayinleong-048).
      let currentTextBlockId: string | null = null
      let buffer = ''
      // Accumulate the full assistant text so we can decode a Reply/Finder turn's
      // structured-output JSON on completion (the card-variant decode bridge).
      let assistantContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines from the buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // Keep the incomplete last line in the buffer

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue // SSE comment / heartbeat

          // Strip "data: " prefix if present (SSE format)
          const dataLine = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed

          // Server-reported metadata: pillar arrives on the `start` chunk (before any
          // text, so the decoder below is never a guess); citations + kbMiss arrive on
          // `finish`. Replaces the old isHandoffChunk substring sniff, which only
          // worked while the Coach's JSON envelope was leaking as literal text.
          const meta = parseMessageMetadata(dataLine)
          if (meta) {
            if (meta.pillar) serverPillar = meta.pillar
            if (meta.citations) serverCitations = meta.citations
            if (meta.kbMiss !== undefined) kbMiss = meta.kbMiss
          }

          // A mid-stream failure arrives as an `error` chunk on an already-200 response.
          // Capturing it is what turns "empty bubble, spinner stuck forever" into a real
          // error state (RC-3).
          const errText = parseStreamError(dataLine)
          if (errText) streamError = errText

          // Extract text delta, separating step boundaries.
          const textChunk = parseTextChunk(dataLine)
          if (textChunk) {
            // A new block id mid-turn means the model finished a step (usually to call a
            // tool) and has started writing again. Without this the two steps weld
            // together: "Let me search now.The search returned results…". Only inserted
            // when there is already text, so a turn never opens with a blank line.
            const isNewBlock =
              currentTextBlockId !== null && textChunk.id !== currentTextBlockId
            currentTextBlockId = textChunk.id
            const addition =
              isNewBlock && assistantContent.length > 0
                ? TEXT_BLOCK_SEPARATOR + textChunk.delta
                : textChunk.delta

            assistantContent += addition
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + addition }
                  : m,
              ),
            )
          }
        }
      }

      // ── Stream-level failure → visible error state (RC-3) ────────────────────
      // Must run BEFORE the decoders: a failed turn has no structured output to decode,
      // and leaving the placeholder bubble empty is what latched chat-shell's
      // `isStreaming` derivation (last message is an assistant with content === '').
      if (streamError || assistantContent.length === 0) {
        toast.error('The assistant could not finish that response. Please try again.')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.content.length === 0
              ? { ...m, content: t('error') }
              : m,
          ),
        )
        return
      }

      // ── Decode structured pillar output → card variant (gap-closure) ─────────
      // Reply/Finder agents emit their output as a JSON object in the final text
      // (src/agents/*/prompt.ts "Output Format"); the route streams it as text. On
      // completion, decode the accumulated text and attach the structured output so
      // message-list renders the interactive card (ReplyDraftCard / MatchList) instead
      // of a raw-JSON bubble.
      //
      // Gated on the SERVER's pillar (quick-kayinleong-046). It used to be gated on
      // `pillarOverride`, which is `undefined` in Auto mode — so in Auto NO decoder ran
      // and the Finder/Reply JSON envelope rendered raw in the bubble; and it was stale
      // after a hero-card tap, so a coach turn could render as a Finder card. The
      // if/else-if chain is deliberately exclusive (never "try every decoder"), because
      // ReplyOutput and FinderOutput share an all-optional `clarifyingQuestion` field
      // that would otherwise let one pillar's output render as the other's card.
      const decodePillar = serverPillar ?? effectivePillar
      if (decodePillar === 'reply') {
        const replyOutput = decodeReplyOutput(assistantContent)
        if (replyOutput) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    replyOutput,
                    replyIncoming: text,
                    replyLeadId: leadId ?? '',
                    replyLang: langOverride ?? 'en',
                  }
                : m,
            ),
          )
        }
      } else if (decodePillar === 'finder') {
        const finderOutput = decodeFinderOutput(assistantContent)
        if (finderOutput) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, finderOutput } : m,
            ),
          )
        }
      }

      // Attach the server's citation chunk IDs to the rendered message (grounding
      // mandate, D-09). These come from the real retrieval tool results, not from the
      // model restating them — see app/api/chat/route.ts messageMetadata.
      if (serverCitations.length > 0) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, citations: serverCitations.map((chunkId) => ({ chunkId })) }
              : m,
          ),
        )
      }

      // Surface KB-miss as a toast (D-10). Now driven by the server's tool-result-derived
      // signal instead of a substring match on the leaked JSON envelope.
      if (kbMiss) {
        toast.info(
          "I couldn't find a D2 knowledge base article for this. Your senior coach has been notified.",
          { duration: 6000 },
        )
      }
    } catch (err) {
      void err
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, messages, langOverride, pillarOverride, leadId, onBeforeSend, t])

  // ── Suggestion-card dispatch (redesign) ──────────────────────────────────────
  // When a hero card is tapped, chat-shell pins the pillar override then bumps
  // submittedSuggestion. Seed the input (so a blocked Reply keeps its text for
  // re-send after a lead is picked) and dispatch with an explicit text argument.
  const lastSuggestionId = useRef<number>(0)
  useEffect(() => {
    if (submittedSuggestion && submittedSuggestion.id !== lastSuggestionId.current) {
      lastSuggestionId.current = submittedSuggestion.id
      setInput(submittedSuggestion.text)
      // Pass the card's pillar for THIS dispatch only — it is deliberately not pinned
      // into pillarOverride (quick-kayinleong-046).
      void sendMessage(submittedSuggestion.text, submittedSuggestion.pillar)
    }
  }, [submittedSuggestion, sendMessage])

  return { messages, isStreaming, input, setInput, sendMessage }
}

// ─── ChatInput component ──────────────────────────────────────────────────────

/**
 * Chat input component — the "use client" island for the chat surface.
 *
 * Composes the vendored Textarea + Button into a single rounded input bar with a
 * lime icon send button, plus a persistent AI-disclosure microcopy line.
 */
export function ChatInput({
  onMessagesChange,
  onStreamingChange,
  initialMessages,
  conversationId,
  langOverride,
  pillarOverride,
  leadId,
  onBeforeSend,
  submittedSuggestion,
  placeholder = 'Ask anything about D2 properties, SOPs, or your onboarding journey…',
  sendLabel = 'Send',
}: ChatInputProps) {
  const t = useTranslations('chat')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { input, setInput, sendMessage, isStreaming } = useChatStream({
    onMessagesChange,
    onStreamingChange,
    initialMessages,
    conversationId,
    langOverride,
    pillarOverride,
    leadId,
    onBeforeSend,
    submittedSuggestion,
  })

  // Handle keyboard submit: Enter = send (Shift+Enter = new line)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div
      data-slot="chat-input-bar"
      className="shrink-0 bg-background px-3 pb-3 pt-2"
    >
      <div className="mx-auto w-full max-w-2xl">
        {/* Unified rounded input surface — textarea + lime send button */}
        <div
          className={cn(
            'flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm',
            'transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/40',
          )}
        >
          <Textarea
            ref={textareaRef}
            data-slot="chat-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming}
            rows={1}
            className={cn(
              'flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none',
              'min-h-9 max-h-40 field-sizing-content',
              'focus-visible:border-0 focus-visible:ring-0',
              // Mobile-readable text size (per 01-PATTERNS.md textarea pattern)
              'text-base md:text-sm',
            )}
            aria-label="Chat message"
          />

          <Button
            data-slot="send-button"
            size="icon"
            onClick={() => void sendMessage()}
            disabled={isStreaming || !input.trim()}
            aria-label={sendLabel}
            className="size-9 shrink-0 self-end rounded-xl"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </Button>
        </div>

        {/* Persistent AI-disclosure microcopy (CHAT-05) */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t('footerDisclosure')}
        </p>
      </div>
    </div>
  )
}
