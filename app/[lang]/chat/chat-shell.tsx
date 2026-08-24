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

import { useState, useEffect, useRef } from 'react'
import { MessageList } from './message-list'
import { ChatInput, type SubmittedSuggestion } from './chat-input'
import { ChatHeader, type LangOverride, type PillarOverride } from './chat-header'
import { DisclosureModal } from './disclosure-modal'
import { ConversationList } from './conversation-list'
import { LeadSelector } from './lead-selector'
import { HeroEmptyState } from './hero-empty-state'
import { loadConversationMessages } from './load-conversation-messages'
import { clientAuth } from '@/src/firebase/client'
import type { ChatMessage } from './message-list'

/**
 * localStorage key holding the agent's current thread id (quick-kayinleong-046).
 *
 * Chosen over a `?c=` search param for the minimal fix: reading `useSearchParams()`
 * would force a <Suspense> boundary around this shell. A shareable URL is the better
 * long-term shape and is filed as a follow-up.
 */
const ACTIVE_CID_KEY = 'd2-active-cid'

/** Generate a unique conversation id for a brand-new session (quick-033). */
function newConversationId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `chat-${rand}`
}

interface ChatShellProps {
  placeholder: string
  sendLabel: string
}

export function ChatShell({ placeholder, sendLabel }: ChatShellProps) {
  // ── Disclosure gate (CHAT-05) ────────────────────────────────────────────────
  // disclosureAcked: starts false; set to true once the modal is dismissed or
  // localStorage already contains the ack flag (handled inside DisclosureModal).
  const [disclosureAcked, setDisclosureAcked] = useState(false)

  // ── Conversation state (CHAT-07 / quick-033 / quick-035) ────────────────────
  // activeCid starts as a fresh chat-<uuid> session so EVERY conversation is a
  // chat-* thread — never the legacy empty-cid → coach-${uid} primary thread.
  // Lazy initializer: runs once; the id is internal state (not rendered), so the
  // server/client values differ harmlessly with no hydration mismatch.
  const [activeCid, setActiveCid] = useState<string>(() => newConversationId())

  // Read the persisted thread id ONCE, during the first client render — before any
  // effect can run. Doing this in an effect instead would race the persist effect
  // below, which would have already overwritten the stored value with the fresh uuid.
  // Guarded for SSR (no window on the server).
  const [storedCid] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage.getItem(ACTIVE_CID_KEY)
    } catch {
      return null // private mode / storage disabled — fall back to a new thread
    }
  })

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

  // Transcript loaded from history when a past conversation is selected (CHAT-07 /
  // quick-018). Passed to ChatInput as `initialMessages`; ChatInput re-seeds its
  // canonical message state from it whenever the selected conversationId changes.
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])

  // ── Suggestion-card dispatch (redesign quick-032) ────────────────────────────
  // A hero card tap pins its pillar then bumps this one-shot signal; ChatInput
  // seeds the text and sends. A monotonic id de-dupes React re-renders.
  const [submittedSuggestion, setSubmittedSuggestion] =
    useState<SubmittedSuggestion | undefined>(undefined)

  // ── Persist the active thread id ─────────────────────────────────────────────
  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_CID_KEY, activeCid)
    } catch {
      // Storage unavailable — refresh-restore degrades, nothing else breaks.
    }
  }, [activeCid])

  // ── Restore the previous thread on mount (quick-kayinleong-046) ──────────────
  // activeCid was minted fresh on EVERY mount, and loadConversationMessages had
  // exactly one call site — the history-drawer click handler. So nothing loaded a
  // transcript at mount: a browser refresh silently began a brand-new empty thread and
  // the conversation the agent was in the middle of appeared to be gone. That is the
  // reported "refreshed the chat history and it went missing".
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !storedCid) return
    restoredRef.current = true
    let cancelled = false
    void (async () => {
      try {
        // Wait for Firebase to rehydrate LOCAL persistence: the transcript read is
        // rules-gated on ownerUid, so reading it before auth settles is denied and the
        // fresh empty thread silently wins.
        await clientAuth.authStateReady()
        if (cancelled || !clientAuth.currentUser) return
        const history = await loadConversationMessages(storedCid)
        if (cancelled) return
        // Set the transcript and the cid together, in one commit — ChatInput's re-seed
        // effect keys on [conversationId, initialMessages], so splitting them across
        // commits can clobber an in-flight stream.
        setHistoryMessages(history)
        setMessages(history)
        setActiveCid(storedCid)
      } catch {
        // Denied/offline read: stay on the fresh thread rather than showing a
        // half-restored surface.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storedCid])

  const isStreaming = messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === ''

  // Selecting a past thread (quick-018): load its persisted transcript, then set
  // activeCid + the loaded messages together so ChatInput re-seeds with history.
  // Previously this only cleared messages and never fetched the transcript, so the
  // selected conversation rendered empty.
  const handleSelectConversation = async (cid: string) => {
    const history = await loadConversationMessages(cid)
    setHistoryMessages(history)
    setMessages(history) // show immediately; ChatInput converges via onMessagesChange
    setActiveCid(cid)
  }

  // New conversation = a genuinely SEPARATE session (quick-033). Generate a fresh
  // unique cid and switch to it; the route creates the owned thread doc on the first
  // message. Previously this set activeCid='' which re-resolved to the single primary
  // thread (coach-${uid}), so "new" chats concatenated into the previous one.
  const handleNewConversation = () => {
    setActiveCid(newConversationId())
    setHistoryMessages([])
    setMessages([])
    // Clear the pinned pillar (quick-kayinleong-046). It used to survive into the new
    // conversation, so a session that had once touched Finder kept routing every later
    // question — including onboarding questions — to Finder.
    setPillarOverride(undefined)
  }

  // Tapping a hero suggestion card: pin the card's pillar, then dispatch its
  // prompt. Reply cards with no active lead flow through the lead-selector gate.
  const handleSuggestion = (prompt: string, pillar: PillarOverride) => {
    // Carry the pillar ON the suggestion instead of pinning it into pillarOverride
    // (quick-kayinleong-046). Pinning made the card's pillar sticky for the rest of the
    // session with nothing ever clearing it: tap a Finder card, then ask "walk me
    // through running my first Meta ad" and Finder answered "that falls outside what
    // I'm set up to assist with" — the reported broken onboarding. The card is still
    // deterministic for its own send; it just no longer hijacks later turns.
    setSubmittedSuggestion({ id: Date.now(), text: prompt, pillar })
  }

  // ── Reply lead gate (D-07) ────────────────────────────────────────────────────
  // Return false to BLOCK dispatch: a Reply turn (override === 'reply') with no
  // active leadId opens the lead-selector before any send. All other turns proceed.
  const handleBeforeSend = (_text: string, pillar?: PillarOverride): boolean => {
    // `pillar` is the pillar THIS dispatch will actually use (a hero card's pillar, or
    // the header chip). Falls back to the chip for direct sends.
    const effective = pillar ?? pillarOverride
    if (effective === 'reply' && !leadId) {
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

      {/* ── Message list — flex-1, scrollable (hero when empty) ─────────────── */}
      {messages.length === 0 && !isStreaming ? (
        <HeroEmptyState onSuggestion={handleSuggestion} />
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
        initialMessages={historyMessages}
        conversationId={activeCid || undefined}
        langOverride={langOverride}
        pillarOverride={pillarOverride}
        leadId={leadId}
        onBeforeSend={handleBeforeSend}
        submittedSuggestion={submittedSuggestion}
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </>
  )
}
