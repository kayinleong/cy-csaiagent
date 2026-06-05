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
import { ChatHeader, type LangOverride, type PillarOverride } from './chat-header'
import { DisclosureModal } from './disclosure-modal'
import { ConversationList } from './conversation-list'
import { LeadSelector } from './lead-selector'
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

  // ── Pillar override (FIND-11 / Phase 4 Surface 3) ───────────────────────────
  // undefined = Auto (routeAsync decides). 'coach' | 'finder' | 'reply' = pinned.
  const [pillarOverride, setPillarOverride] = useState<PillarOverride | undefined>(undefined)

  // ── Lead selection (D-07) ────────────────────────────────────────────────────
  // Reply turns REQUIRE a leadId. undefined = no active lead → the lead-selector
  // blocks dispatch until the agent picks one (HR-3, no auto-inference).
  const [leadId, setLeadId] = useState<string | undefined>(undefined)
  const [leadSelectorOpen, setLeadSelectorOpen] = useState(false)
  // True while a Reply dispatch is pending a lead pick — once the lead is chosen
  // we have the leadId in state and the agent re-sends (text is preserved in the
  // input). We do not auto-fire to avoid racing React state.
  const [pendingReplySend, setPendingReplySend] = useState(false)

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

  // ── Reply lead gate (D-07) ────────────────────────────────────────────────────
  // Return false to BLOCK dispatch: a Reply turn (override === 'reply') with no
  // active leadId opens the lead-selector before any send. All other turns proceed.
  const handleBeforeSend = (): boolean => {
    if (pillarOverride === 'reply' && !leadId) {
      setPendingReplySend(true)
      setLeadSelectorOpen(true)
      return false // block — dispatch resumes after the agent picks a lead
    }
    return true
  }

  const handleLeadPicked = (picked: string) => {
    setLeadId(picked)
    setLeadSelectorOpen(false)
    setPendingReplySend(false)
    // The blocked text is still in the ChatInput; the agent presses Send again
    // (now leadId is set, so handleBeforeSend returns true and dispatch proceeds).
  }

  const handleLeadSelectorCancel = () => {
    setLeadSelectorOpen(false)
    setPendingReplySend(false)
    // Cancel = no lead picked → no dispatch (the text remains in the input).
  }
  void pendingReplySend // reserved for an auto-resume affordance; currently re-send is manual

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

      {/* ── Reply lead-selector (D-07 / Surface 2) ──────────────────────────────
          Opens when a Reply dispatch is attempted with no active leadId. Picking
          a lead sets leadId; dismissing cancels (no dispatch). HR-3: explicit pick. */}
      <LeadSelector
        open={leadSelectorOpen}
        onCancel={handleLeadSelectorCancel}
        onPick={handleLeadPicked}
      />

      {/* ── Sticky chat header (CHAT-05/06/08/FIND-11) ─────────────────────── */}
      <ChatHeader
        conversationId={activeCid}
        langOverride={langOverride}
        onLangOverride={setLangOverride}
        pillarOverride={pillarOverride}
        onPillarOverride={setPillarOverride}
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
        pillarOverride={pillarOverride}
        leadId={leadId}
        onBeforeSend={handleBeforeSend}
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </>
  )
}
