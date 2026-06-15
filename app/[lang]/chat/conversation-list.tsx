'use client'

/**
 * app/[lang]/chat/conversation-list.tsx — Conversation history drawer with search (CHAT-07).
 *
 * Renders a Sheet (drawer) listing the agent's past conversations with client-side
 * substring search on `summary`. Selecting a thread sets the active cid in ChatShell.
 *
 * Data loading:
 *   - Conversations are loaded via the client Firestore SDK (read-only from the client,
 *     gated by Firestore rules: owner-only + same-tenant reads on conversations/{cid}).
 *   - On open, runs an EQUALITY-ONLY query: `conversations` where
 *     ownerUid == currentUser.uid AND tenantId == 'd2', limit 50 (no orderBy).
 *     Both equality filters are mandatory: the `list` rule requires `sameTenant()`,
 *     and Firestore rules are not filters — a query must constrain every
 *     resource.data field the rule references or the whole query is denied
 *     (quick-016). The result is sorted client-side by createdAt DESC via
 *     sortConversationsByCreatedAtDesc, with a null/unresolved createdAt treated
 *     as the newest. This avoids depending on the (ownerUid, createdAt) composite
 *     index and no longer drops a freshly-created thread whose serverTimestamp()
 *     has not yet resolved (quick-010).
 *
 * Search:
 *   - Client-side substring filter over `summary` (Firestore has no native full-text).
 *   - Acceptable for the MVP pilot size (RESEARCH Don't-Hand-Roll table).
 *
 * References: D-01, CHAT-07, TSD §4 conversations collection, RESEARCH §Pitfall 2.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { clientAuth, clientDb } from '@/src/firebase/client'
import { sortConversationsByCreatedAtDesc } from './conversation-sort'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationItem {
  id: string
  summary: string
  lang: string
  createdAt: Date | null
}

interface ConversationListProps {
  /** Whether the drawer is open. */
  open: boolean
  /** Callback: close the drawer. */
  onClose: () => void
  /** Callback: user selected a conversation thread (sets active cid). */
  onSelectConversation: (cid: string) => void
  /** Callback: start a new conversation (clear active cid). */
  onNewConversation: () => void
}

// ─── ConversationList component ───────────────────────────────────────────────

/**
 * Conversation history drawer with search.
 *
 * Uses the client Firestore SDK with an equality-only query on `ownerUid` AND
 * `tenantId` (limit 50, no orderBy), then sorts client-side by createdAt DESC
 * with a null/unresolved createdAt treated as newest. The owner-only + same-tenant
 * read rule is enforced by Firestore rules (conversations/{cid}); the tenantId
 * filter is what makes that `list` rule satisfiable (quick-016).
 */
export function ConversationList({
  open,
  onClose,
  onSelectConversation,
  onNewConversation,
}: ConversationListProps) {
  const t = useTranslations('chat')
  const [threads, setThreads] = useState<ConversationItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Load conversations when the drawer opens
  const loadConversations = useCallback(async () => {
    const currentUser = clientAuth.currentUser
    if (!currentUser) return

    setIsLoading(true)
    try {
      const q = query(
        collection(clientDb, 'conversations'),
        where('ownerUid', '==', currentUser.uid),
        // tenantId is REQUIRED here, not optional: the conversations `list` rule
        // grants reads only when `sameTenant()` holds (resource.data.tenantId ==
        // request.auth.token.tenantId). Firestore rules are not filters — a query
        // must CONSTRAIN every resource.data field the rule references, or the
        // whole query is denied (permission-denied). Without this clause the
        // drawer always fails to load. 'd2' is the single tenant (TENANT_ID is
        // server-only in collections.ts, so the literal is inlined here). Two
        // equality filters need no composite index. quick-016.
        where('tenantId', '==', 'd2'),
        limit(50),
      )
      const snap = await getDocs(q)
      const items: ConversationItem[] = snap.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          summary: (data.summary as string) || '',
          lang: (data.lang as string) || 'en',
          createdAt: data.createdAt?.toDate?.() ?? null,
        }
      })
      setThreads(sortConversationsByCreatedAtDesc(items))
    } catch (err) {
      // Load failure is non-fatal — the user can still chat in the current thread.
      // Log the error OBJECT only (Firestore error carries a code like
      // permission-denied / failed-precondition) — never PII. quick-010.
      console.error('[conversation-list] failed to load history', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Open-driven one-shot data fetch + search reset. The setState here runs when the
  // drawer opens (not every render) — intentional, not a cascading-render risk.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      void loadConversations()
      setSearchTerm('')
    }
  }, [open, loadConversations])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Client-side substring search (CHAT-07)
  const filteredThreads = searchTerm
    ? threads.filter((t) => t.summary.toLowerCase().includes(searchTerm.toLowerCase()))
    : threads

  const handleSelect = (cid: string) => {
    onSelectConversation(cid)
    onClose()
  }

  const handleNew = () => {
    onNewConversation()
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent
        side="left"
        data-slot="conversation-list"
        className="w-80 flex flex-col p-0"
      >
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-sm font-semibold">{t('history')}</SheetTitle>
        </SheetHeader>

        {/* Search input */}
        <div className="px-3 py-2 border-b">
          <Input
            data-slot="conversation-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 text-sm"
            aria-label={t('searchPlaceholder')}
          />
        </div>

        {/* New conversation button */}
        <div className="px-3 py-2 border-b">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-sm h-8"
            onClick={handleNew}
          >
            + {t('newConversation')}
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground animate-pulse">
              {t('thinking')}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('historyEmpty')}
            </div>
          ) : (
            <ul className="py-1">
              {filteredThreads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors group"
                    onClick={() => handleSelect(thread.id)}
                  >
                    <p className="text-sm font-medium truncate group-hover:text-accent-foreground">
                      {thread.summary || thread.id}
                    </p>
                    {thread.createdAt && (
                      <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                        {thread.createdAt.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
