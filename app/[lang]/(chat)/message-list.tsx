/**
 * app/[lang]/(chat)/message-list.tsx — Streamed message list with citations.
 *
 * RSC-by-default (no "use client" needed — render-only component).
 * Composes vendored ScrollArea + Card from @/components/ui (do NOT re-add shadcn).
 *
 * Renders:
 *   - User messages: right-aligned bubble
 *   - Assistant messages: Card with answer text + citations as badge row (grounding proof)
 *   - Streaming indicator: "Thinking..." text while streaming
 *
 * Citations (chunk IDs) are displayed as badge chips in the CardFooter.
 * This is the visible grounding proof — users see which KB chunks were cited.
 *
 * References: 01-PATTERNS.md Tier-A (lines 82-107), TSD §6 grounding mandate.
 */

import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** KB chunk IDs cited in this response (grounding mandate — visible proof) */
  citations?: Array<{ chunkId: string; docId?: string; snippet?: string }>
}

interface MessageListProps {
  messages: ChatMessage[]
  /** True while the assistant is streaming a response */
  isStreaming?: boolean
  className?: string
}

/**
 * Scrollable message list with citation badges on assistant turns.
 *
 * The list auto-scrolls via a ref scroll-into-view (handled in the parent
 * client island chat-input.tsx where the ref updates on message change).
 */
export function MessageList({ messages, isStreaming, className }: MessageListProps) {
  return (
    <ScrollArea
      data-slot="chat-message-list"
      className={cn('flex-1 px-3 py-4', className)}
    >
      <div className="flex flex-col gap-4 max-w-2xl mx-auto">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground text-sm py-8">
            {/* Empty state copy is injected by the server page via messages[] */}
          </div>
        )}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            // User bubble — right-aligned, background accent
            <div
              key={msg.id}
              className="flex justify-end"
              data-role="user"
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5',
                  'bg-primary text-primary-foreground text-sm md:text-[0.8125rem]',
                )}
              >
                {msg.content}
              </div>
            </div>
          ) : (
            // Assistant turn — Card with answer + citations footer
            <div
              key={msg.id}
              className="flex justify-start"
              data-role="assistant"
            >
              <Card
                data-slot="assistant-message"
                data-size="sm"
                className={cn(
                  'max-w-[90%] rounded-2xl rounded-bl-md',
                  'bg-card ring-1 ring-foreground/10 shadow-sm',
                )}
              >
                <CardContent
                  data-slot="card-content"
                  className="px-4 py-3 text-sm md:text-[0.8125rem] leading-relaxed whitespace-pre-wrap"
                >
                  {msg.content}
                </CardContent>

                {/* Citations footer — the visible grounding proof (D-09) */}
                {msg.citations && msg.citations.length > 0 && (
                  <CardFooter
                    data-slot="card-footer"
                    className="px-4 pb-3 pt-0 flex flex-wrap gap-1.5"
                  >
                    <span className="text-[0.6875rem] text-muted-foreground mr-1">
                      Sources:
                    </span>
                    {msg.citations.map((c) => (
                      <Badge
                        key={c.chunkId}
                        variant="secondary"
                        className="text-[0.625rem] font-mono px-1.5 py-0.5 h-auto"
                        title={c.snippet ?? c.chunkId}
                      >
                        {c.chunkId}
                      </Badge>
                    ))}
                  </CardFooter>
                )}
              </Card>
            </div>
          ),
        )}

        {/* Streaming indicator — shown while the assistant is responding */}
        {isStreaming && (
          <div className="flex justify-start" data-streaming="true">
            <div className="text-muted-foreground text-sm animate-pulse px-1">
              Thinking…
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
