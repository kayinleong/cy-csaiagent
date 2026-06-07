'use client'

/**
 * app/[lang]/(admin)/conversations/conversation-viewer.tsx — Read-only conversation viewer (ADMIN-02).
 *
 * Client island for the admin conversation log surface. Provides:
 *   1. Search/browse entry: Input + table of conversation refs (cid, pillar Badge, agentRef, lastMessageAt).
 *   2. Dialog + ScrollArea thread viewer on selection — EXACT stall-inbox bubble styling.
 *   3. Audited-access Alert banner at the top of the dialog (adminConversations.auditNotice).
 *   4. Per-message pillar Badge.
 *
 * READ-ONLY — no resolve/reply/delete affordance. Footer = close only (HR-5).
 * All strings from adminConversations.* namespace (HR-2).
 *
 * Analog: stall-inbox.tsx:137-184 (Dialog+ScrollArea drilldown — verbatim bubble styling).
 *
 * References:
 *   - ADMIN-02 (read-only, cross-pillar, audited conversation viewer)
 *   - HR-2 (trilingual copy), HR-5 (read-only, audit-before-read)
 *   - 05-UI-SPEC.md §Surface 2
 *   - 05-PATTERNS.md §conversation-viewer.tsx
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getConversationForReview, searchConversations } from './actions'
import type { ConversationMessage, ConversationRef } from './actions'

interface ConversationViewerProps {
  lang: string
}

/** Format an ISO date string as a relative time (e.g. "2 days ago"). */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'just now'
  } catch {
    return iso
  }
}

/** Pillar badge variant mapping. */
function pillarBadgeVariant(pillar: string | null): 'default' | 'secondary' | 'outline' {
  if (!pillar) return 'outline'
  if (pillar === 'coach') return 'secondary'
  if (pillar === 'finder') return 'default'
  return 'outline'
}

export function ConversationViewer({ lang: _lang }: ConversationViewerProps) {
  const t = useTranslations('adminConversations')

  // Search state
  const [query, setQuery] = useState('')
  const [conversations, setConversations] = useState<ConversationRef[] | null>(null)
  const [searched, setSearched] = useState(false)

  // Thread viewer state
  const [selectedCid, setSelectedCid] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null)
  const [threadError, setThreadError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const [isSearchPending, startSearchTransition] = useTransition()
  const [isLoadPending, startLoadTransition] = useTransition()

  function handleSearch() {
    startSearchTransition(async () => {
      const result = await searchConversations(query)
      if (result.ok) {
        setConversations(result.conversations)
        setSearched(true)
      } else {
        toast.error(result.error ?? t('error'))
      }
    })
  }

  function openConversation(cid: string) {
    setSelectedCid(cid)
    setMessages(null)
    setThreadError(false)
    setDialogOpen(true)

    startLoadTransition(async () => {
      const result = await getConversationForReview(cid)
      if (result.ok) {
        setMessages(result.messages)
      } else {
        setThreadError(true)
        toast.error(result.error ?? t('error'))
      }
    })
  }

  function closeDialog() {
    setDialogOpen(false)
    setSelectedCid(null)
    setMessages(null)
    setThreadError(false)
  }

  return (
    <div className="space-y-6">
      {/* Search entry */}
      <div className="flex gap-2">
        <Input
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={isSearchPending}>
          {isSearchPending ? '…' : 'Search'}
        </Button>
      </div>

      {/* Results table */}
      {!searched && (
        <p className="text-sm text-muted-foreground">{t('idle')}</p>
      )}

      {searched && conversations !== null && conversations.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('noResults')}</p>
      )}

      {searched && conversations !== null && conversations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colConversation')}</TableHead>
              <TableHead>{t('colPillar')}</TableHead>
              <TableHead>{t('colAgent')}</TableHead>
              <TableHead>{t('colLead')}</TableHead>
              <TableHead>{t('colLastMessage')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((conv) => (
              <TableRow key={conv.cid}>
                <TableCell className="font-mono text-xs">{conv.cid.slice(0, 12)}…</TableCell>
                <TableCell>
                  <Badge variant={pillarBadgeVariant(conv.pillar)}>
                    {conv.pillar ?? '—'}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {conv.agentRef ? `${conv.agentRef.slice(0, 8)}…` : '—'}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {conv.leadRef ? `${conv.leadRef.slice(0, 8)}…` : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelativeTime(conv.lastMessageAt)}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openConversation(conv.cid)}
                    disabled={isLoadPending && selectedCid === conv.cid}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Thread viewer dialog — READ-ONLY (HR-5) */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pageTitle')}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {selectedCid}
            </DialogDescription>
          </DialogHeader>

          {/* Audited-access compliance banner (adminConversations.auditNotice) */}
          <Alert>
            <AlertDescription>{t('auditNotice')}</AlertDescription>
          </Alert>

          {/* Loading state */}
          {messages === null && !threadError && (
            <p className="py-6 text-sm text-muted-foreground">{t('loading')}</p>
          )}

          {/* Error state */}
          {threadError && (
            <p className="py-6 text-sm text-destructive">{t('error')}</p>
          )}

          {/* Empty state */}
          {messages !== null && messages.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">{t('threadEmpty')}</p>
          )}

          {/* Thread — verbatim stall-inbox bubble styling (stall-inbox.tsx:163-181) */}
          {messages !== null && messages.length > 0 && (
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.role === 'user'
                        ? 'ml-8 rounded-lg bg-primary/10 px-3 py-2'
                        : 'mr-8 rounded-lg bg-muted px-3 py-2'
                    }
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground capitalize">
                        {m.role}
                      </span>
                      {m.pillar && (
                        <Badge variant={pillarBadgeVariant(m.pillar)} className="text-xs px-1 py-0">
                          {m.pillar}
                        </Badge>
                      )}
                      {m.redacted && (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          redacted
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Footer: close only (HR-5 — no reply/resolve/delete) */}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
