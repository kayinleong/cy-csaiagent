'use client'

/**
 * app/[lang]/chat/chat-shell.tsx — Client island bridging all chat surface components.
 *
 * This is the root client component for the chat surface. It owns:
 *   - Disclosure modal gate (first-run AI disclosure — CHAT-05)
 *   - Active conversation ID (cid) state (D-01 / CHAT-02 / CHAT-07)
 *   - Language override state (CHAT-08 — propagated to ChatInput → POST body)
 *   - Conversation history drawer (CHAT-07)
 *   - Chat header (CHAT-05/06/08 — AI badge, handoff button, lang chip)
 *   - MessageList (renders streamed tokens + citations)
 *   - ChatInput (sticky bottom, fires POST /api/chat with Bearer token)
 *
 * Layout:
 *   - ChatHeader: sticky top (z-10)
 *   - DisclosureModal: overlays the whole surface on first visit
 *   - ConversationList: Sheet/drawer (from the left)
 *   - MessageList: flex-1, scrollable
 *   - ChatInput: sticky bottom
 *
 * Core/shell rule: this file is in app/ — it may import from src/ but src/ must
 * never import from app/.
 */

import { useState } from 'react'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { ChatHeader, type LangOverride } from './chat-header'
import { DisclosureModal } from './disclosure-modal'
import { ConversationList } from './conversation-list'
import type { ChatMessage } from './message-list'

interface ChatShellProps {
  placeholder: string
  sendLabel: string
  emptyStateMessage: string
}

export function ChatShell({ placeholder, sendLabel, emptyStateMessage }: ChatShellProps) {
  // ── Disclosure gate (CHAT-05) ────────────────────────────────────────────────
  // disclosureAcked: starts false; set to true once the modal is dismissed or
  // localStorage already contains the ack flag (handled inside DisclosureModal).
  const [disclosureAcked, setDisclosureAcked] = useState(false)

  // ── Conversation state (D-01 / CHAT-07) ─────────────────────────────────────
  // activeCid: empty string = use the server-resolved primary thread (coach-${uid}).
  // When the user selects a thread from history, this is set to that thread's cid.
  const [activeCid, setActiveCid] = useState<string>('')

  // ── Language override (CHAT-08) ──────────────────────────────────────────────
  // undefined = auto-detect (franc-min per-message detection in the route).
  // 'en' | 'ms' | 'zh' = pinned language from the header chip.
  const [langOverride, setLangOverride] = useState<LangOverride | undefined>(undefined)

  // ── Conversation history drawer (CHAT-07) ────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false)

  // ── Messages state (shared between MessageList and ChatInput) ────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const isStreaming = messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === ''

  const handleSelectConversation = (cid: string) => {
    setActiveCid(cid)
    setMessages([]) // clear current messages; ChatInput will use new cid
  }

  const handleNewConversation = () => {
    setActiveCid('')
    setMessages([])
  }

  return (
    <>
      {/* ── First-run AI disclosure modal (CHAT-05) ──────────────────────────── */}
      {!disclosureAcked && (
        <DisclosureModal onAck={() => setDisclosureAcked(true)} />
      )}

      {/* ── Conversation history drawer (CHAT-07) ────────────────────────────── */}
      <ConversationList
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />

      {/* ── Sticky chat header (CHAT-05/06/08) ──────────────────────────────── */}
      <ChatHeader
        conversationId={activeCid}
        langOverride={langOverride}
        onLangOverride={setLangOverride}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {/* ── Message list — flex-1, scrollable ───────────────────────────────── */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-muted-foreground text-sm max-w-xs">
            {emptyStateMessage}
          </p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          className="flex-1"
        />
      )}

      {/* ── Chat input — sticky bottom ───────────────────────────────────────── */}
      <ChatInput
        onMessagesChange={setMessages}
        conversationId={activeCid || undefined}
        langOverride={langOverride}
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </>
  )
}
