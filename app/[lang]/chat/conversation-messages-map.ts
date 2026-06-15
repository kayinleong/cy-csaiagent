/**
 * app/[lang]/chat/conversation-messages-map.ts — Pure transcript mapper (quick-018).
 *
 * Shell-side, no React/firebase imports (only an erased `import type`) — a clean
 * node import for unit tests, mirroring conversation-sort.ts.
 *
 * Turns raw `conversations/{cid}/messages` docs into the `ChatMessage[]` the
 * MessageList renders, ordered oldest → newest by `createdAt`. A message with a
 * missing/unresolved `createdAt` (legacy messages predate quick-018, or a
 * serverTimestamp() not yet resolved) is treated as the OLDEST and kept — never
 * dropped (the quick-010 lesson: a Firestore `orderBy('createdAt')` silently
 * excludes null-timestamp docs). `system` turns are filtered (the UI shows only
 * user/assistant); citation chunk-id strings become the ChatMessage citation
 * objects.
 *
 * References: quick-018, CHAT-02/07, D-01.
 */

import type { ChatMessage } from './message-list'

/** A raw message record read from the messages subcollection (pre-mapping). */
export interface RawMessageRecord {
  id: string
  role?: string
  content?: string
  citations?: string[]
  /** Resolved client-side from the Firestore Timestamp; null if missing/unresolved. */
  createdAt: Date | null
}

/**
 * Map + order raw message records into renderable ChatMessages.
 *
 * Sort is ascending by `createdAt` (oldest first), with null treated as oldest
 * and kept. `Array.prototype.sort` is stable (ES2019+), so equal/both-null
 * records preserve their input order. Returns a NEW array; does not mutate input.
 */
export function mapConversationMessages(records: RawMessageRecord[]): ChatMessage[] {
  const sorted = [...records].sort((a, b) => {
    if (a.createdAt === null && b.createdAt === null) return 0
    if (a.createdAt === null) return -1 // null = oldest → first (ascending)
    if (b.createdAt === null) return 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  return sorted
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content ?? '',
      citations: (r.citations ?? []).map((chunkId) => ({ chunkId })),
    }))
}
