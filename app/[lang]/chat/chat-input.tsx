'use client'

/**
 * app/[lang]/chat/chat-input.tsx — Client-side chat input island.
 *
 * "use client" — this component uses React state + browser APIs (Firebase Auth,
 * ReadableStream, fetch). It is the ONLY interactive leaf in the chat shell;
 * the page.tsx remains a server component.
 *
 * Chat protocol:
 *   1. User types a message and presses Send or Enter.
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
 * References: 01-PATTERNS.md Tier-A chat-input (lines 110-132).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { clientAuth } from '@/src/firebase/client'
import { onAuthStateChanged } from 'firebase/auth'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ChatMessage } from './message-list'
import { decodeReplyOutput, decodeFinderOutput } from './decode-structured-output'
import { parseTextDelta, isHandoffChunk } from './decode-stream-chunk'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  /** Callback: when messages update (the server page re-renders the list) */
  onMessagesChange: (messages: ChatMessage[]) => void
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
  onBeforeSend?: (text: string) => boolean
  /** i18n copy */
  placeholder?: string
  sendLabel?: string
}

// ─── useChatStream hook ───────────────────────────────────────────────────────

function useChatStream({
  onMessagesChange,
  initialMessages = [],
  conversationId,
  langOverride,
  pillarOverride,
  leadId,
  onBeforeSend,
}: Pick<ChatInputProps, 'onMessagesChange' | 'initialMessages' | 'conversationId' | 'langOverride' | 'pillarOverride' | 'leadId' | 'onBeforeSend'>) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    // Reply lead gate (D-07): give the parent a chance to BLOCK dispatch — e.g. a
    // Reply turn with no leadId opens the lead-selector instead of sending. The
    // input text is intentionally NOT cleared here so dispatch can resume after a
    // lead is picked.
    if (onBeforeSend && onBeforeSend(text) === false) {
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
      // Get a fresh Firebase ID token for the Bearer auth header
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
      if (pillarOverride) {
        requestBody.override = pillarOverride
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
          toast.warning("You've reached your hourly limit. Please wait a few minutes.")
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
      let handoffDetected = false
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

          // Check for handoff signal
          if (isHandoffChunk(dataLine)) {
            handoffDetected = true
          }

          // Extract text delta
          const delta = parseTextDelta(dataLine)
          if (delta) {
            assistantContent += delta
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + delta }
                  : m,
              ),
            )
          }
        }
      }

      // ── Decode structured pillar output → card variant (gap-closure) ─────────
      // Reply/Finder agents emit their output as a JSON object in the final text
      // (src/agents/*/prompt.ts "Output Format"); the route streams it as text. On
      // completion, decode the accumulated text and attach the structured output so
      // message-list renders the interactive card (ReplyDraftCard / MatchList) instead
      // of a raw-JSON bubble. Gated by pillarOverride — the UI reaches Reply/Finder only
      // via the header chip — so the shared clarifyingQuestion field never cross-renders.
      if (pillarOverride === 'reply') {
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
      } else if (pillarOverride === 'finder') {
        const finderOutput = decodeFinderOutput(assistantContent)
        if (finderOutput) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, finderOutput } : m,
            ),
          )
        }
      }

      // Surface KB-miss handoff as a toast (D-10)
      if (handoffDetected) {
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
  }, [input, isStreaming, messages, langOverride, pillarOverride, leadId, onBeforeSend])

  return { messages, isStreaming, input, setInput, sendMessage }
}

// ─── ChatInput component ──────────────────────────────────────────────────────

/**
 * Chat input component — the "use client" island for the chat surface.
 *
 * Composes vendored Textarea + Button; uses useIsMobile for responsive sizing.
 * Sends a POST to /api/chat with a Firebase Bearer token on submit.
 * Streams the response incrementally via ReadableStream.
 */
export function ChatInput({
  onMessagesChange,
  initialMessages,
  conversationId,
  langOverride,
  pillarOverride,
  leadId,
  onBeforeSend,
  placeholder = 'Ask anything about D2 properties, SOPs, or your onboarding journey…',
  sendLabel = 'Send',
}: ChatInputProps) {
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { input, setInput, sendMessage, isStreaming } = useChatStream({
    onMessagesChange,
    initialMessages,
    conversationId,
    langOverride,
    pillarOverride,
    leadId,
    onBeforeSend,
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
      className={cn(
        // shrink-0: the input bar must always reserve its full height at the
        // bottom of the chat column so the scroll area above can never grow into
        // it / paint the last message behind it (quick-022).
        'shrink-0 border-t bg-background/95 backdrop-blur px-3 py-3',
        'flex items-end gap-2 max-w-2xl mx-auto w-full',
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
          'flex-1 resize-none min-h-10 max-h-40 field-sizing-content',
          // Mobile-readable text size (per 01-PATTERNS.md textarea pattern)
          'text-base md:text-sm',
        )}
        aria-label="Chat message"
      />

      <Button
        data-slot="send-button"
        size={isMobile ? 'icon' : 'default'}
        onClick={() => void sendMessage()}
        disabled={isStreaming || !input.trim()}
        aria-label={sendLabel}
        className="shrink-0 self-end mb-0.5"
      >
        {isMobile ? (
          // Mobile: icon-only send button
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
        ) : (
          sendLabel
        )}
      </Button>
    </div>
  )
}
