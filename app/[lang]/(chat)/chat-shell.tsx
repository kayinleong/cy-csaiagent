'use client'

/**
 * app/[lang]/(chat)/chat-shell.tsx — Client island bridging message list and input.
 *
 * This thin client component owns the chat state (messages) so both the
 * MessageList and ChatInput can share it without prop-drilling through the
 * server page.tsx.
 *
 * Layout:
 *   - MessageList: flex-1, scrollable, renders streamed tokens + citation badges
 *   - ChatInput: sticky bottom, fires POST /api/chat with Bearer token
 *
 * This pattern keeps page.tsx as a server component (for metadata, i18n, etc.)
 * while the interactive islands are client components.
 */

import { useState } from 'react'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import type { ChatMessage } from './message-list'

interface ChatShellProps {
  placeholder: string
  sendLabel: string
  emptyStateMessage: string
}

export function ChatShell({ placeholder, sendLabel, emptyStateMessage }: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const isStreaming = messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === ''

  return (
    <>
      {/* Empty state overlay — shown when no messages exist */}
      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-muted-foreground text-sm max-w-xs">
            {emptyStateMessage}
          </p>
        </div>
      )}

      {/* Message list — renders streamed tokens + citation badges */}
      {messages.length > 0 && (
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          className="flex-1"
        />
      )}

      {/* Chat input — sticky at the bottom of the flex column */}
      <ChatInput
        onMessagesChange={setMessages}
        placeholder={placeholder}
        sendLabel={sendLabel}
      />
    </>
  )
}
