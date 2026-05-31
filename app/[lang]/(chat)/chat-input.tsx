'use client'

/**
 * app/[lang]/(chat)/chat-input.tsx — Client-side chat input island.
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  /** Callback: when messages update (the server page re-renders the list) */
  onMessagesChange: (messages: ChatMessage[]) => void
  /** Initial messages (from server-loaded conversation history) */
  initialMessages?: ChatMessage[]
  /** The conversation ID for persistence */
  conversationId?: string
  /** i18n copy */
  placeholder?: string
  sendLabel?: string
}

// ─── UIMessageChunk parsing ───────────────────────────────────────────────────

/**
 * Parse a UIMessageStream SSE line and extract text delta content.
 * The AI SDK v5 UIMessageStream format uses data-stream chunks:
 *   `0:"token"` — text delta (part type 0)
 *   `e:{...}`   — finish event
 *   `d:{...}`   — done event
 */
function parseTextDelta(line: string): string | null {
  // Format: `0:"text content"` — part type 0 is text-start/text-delta
  const match = line.match(/^[0-9a-f]:"((?:[^"\\]|\\.)*)"\s*$/)
  if (match) {
    try {
      // The content is JSON-encoded within the double quotes
      return JSON.parse(`"${match[1]}"`) as string
    } catch {
      return match[1]
    }
  }
  return null
}

/**
 * Detect if the stream chunk contains a KB-miss handoff signal.
 * The Coach emits this as a tool result or finish event annotation.
 */
function isHandoffChunk(line: string): boolean {
  return line.includes('kb_miss') || line.includes('handoff')
}

// ─── useChatStream hook ───────────────────────────────────────────────────────

function useChatStream({
  onMessagesChange,
  initialMessages = [],
  conversationId,
}: Pick<ChatInputProps, 'onMessagesChange' | 'initialMessages' | 'conversationId'>) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [isStreaming, setIsStreaming] = useState(false)
  const [input, setInput] = useState('')
  const cidRef = useRef<string>(conversationId ?? '')
  // Initialize cidRef on mount only (avoid impure Date.now() during render)
  useEffect(() => {
    if (!cidRef.current) {
      cidRef.current = `conv-${Date.now()}`
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep parent in sync when messages update
  useEffect(() => {
    onMessagesChange(messages)
  }, [messages, onMessagesChange])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          cid: cidRef.current,
        }),
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
  }, [input, isStreaming, messages])

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
  placeholder = 'Ask anything about D2 properties, SOPs, or your onboarding journey…',
  sendLabel = 'Send',
}: ChatInputProps) {
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { input, setInput, sendMessage, isStreaming } = useChatStream({
    onMessagesChange,
    initialMessages,
    conversationId,
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
        'border-t bg-background/95 backdrop-blur px-3 py-3',
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
