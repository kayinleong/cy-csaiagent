'use client'

/**
 * app/[lang]/(coach)/_components/stall-inbox.tsx
 *
 * CDASH-02: Stall-alert inbox — open stall escalations for the coach's downline.
 *
 * Each alert is informative (plain-language reason + when it opened + agent ref)
 * and drillable: "View chat" opens the agent's recent AI-Coach training thread so
 * the coach can see WHAT the agent was asking — the context behind the escalation.
 *
 * Chat history is fetched via getAgentChatHistory (downline-scoped + audited,
 * coach-pillar thread only — no client PII). Resolve marks the escalation resolved.
 *
 * References:
 *   - CDASH-02 (stall-alert inbox + resolve) · AUTH-06 (downline scope)
 *   - CDASH-06 (working-hours gating on escalation delivery, handled in lazy-cron)
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  resolveStall,
  getAgentChatHistory,
  type ChatHistoryMessage,
} from '../dashboard/actions'

export interface StallItem {
  id: string
  agentUid: string
  reason: string
  openedAt: string // ISO string (serialized from RSC)
  contextBundle: Record<string, unknown>
}

interface StallInboxProps {
  stalls: StallItem[]
}

export function StallInbox({ stalls: initialStalls }: StallInboxProps) {
  const t = useTranslations('dashboard')
  const [stalls, setStalls] = useState<StallItem[]>(initialStalls)
  const [isPending, startTransition] = useTransition()

  // Chat-history drill-down state
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatHistoryMessage[] | null>(null)
  const [historyError, setHistoryError] = useState(false)

  function handleResolve(eid: string) {
    startTransition(async () => {
      const result = await resolveStall(eid)
      if (result.ok) {
        setStalls((prev) => prev.filter((s) => s.id !== eid))
        toast.success(t('stallResolved'))
      } else {
        toast.error(result.error ?? t('stallResolveError'))
      }
    })
  }

  async function openHistory(agentUid: string) {
    setHistoryFor(agentUid)
    setMessages(null)
    setHistoryError(false)
    const result = await getAgentChatHistory(agentUid)
    if (result.ok && result.messages) {
      setMessages(result.messages)
    } else {
      setHistoryError(true)
      toast.error(result.error ?? t('chatHistoryError'))
    }
  }

  function reasonLabel(reason: string): string {
    if (reason === 'kb_miss') return t('reasonKbMiss')
    if (reason === 'stall') return t('reasonStall')
    return reason
  }

  if (stalls.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noStalls')}</p>
  }

  return (
    <>
      <div className="space-y-3">
        {stalls.map((stall) => (
          <Card key={stall.id}>
            <CardContent className="flex items-start justify-between gap-4 py-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{stall.reason}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t('agentRef')}: {stall.agentUid.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {t('openedAt')} {formatRelativeTime(stall.openedAt)}
                  </span>
                </div>
                <p className="text-sm">{reasonLabel(stall.reason)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void openHistory(stall.agentUid)}
                >
                  {t('viewChat')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleResolve(stall.id)}
                >
                  {t('resolveStall')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={historyFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryFor(null)
            setMessages(null)
            setHistoryError(false)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('chatHistoryTitle')}</DialogTitle>
            <DialogDescription>{t('chatHistoryDescription')}</DialogDescription>
          </DialogHeader>

          {messages === null && !historyError && (
            <p className="py-6 text-sm text-muted-foreground">{t('chatHistoryLoading')}</p>
          )}
          {historyError && (
            <p className="py-6 text-sm text-destructive">{t('chatHistoryError')}</p>
          )}
          {messages !== null && messages.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">{t('chatHistoryEmpty')}</p>
          )}
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
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {roleLabel(m.role, t)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function roleLabel(
  role: ChatHistoryMessage['role'],
  t: ReturnType<typeof useTranslations>,
): string {
  if (role === 'user') return t('roleUser')
  if (role === 'assistant') return t('roleAssistant')
  return t('roleSystem')
}

/** Format an ISO date string as a relative time (e.g. "2 days ago"). */
function formatRelativeTime(iso: string): string {
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
