/**
 * app/[lang]/chat/conversation-messages-map.ts — Pure transcript mapper (quick-018).
 *
 * Shell-side, no React/firebase imports — a clean node import for unit tests, mirroring
 * conversation-sort.ts. It does now take one VALUE import (the pure structured-output
 * decoders, which pull only zod schemas), so the module is still React- and
 * Firebase-free and still unit-testable without a browser.
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
import { decodeFinderOutput, decodeReplyOutput } from './decode-structured-output'

/** A raw message record read from the messages subcollection (pre-mapping). */
export interface RawMessageRecord {
  id: string
  role?: string
  content?: string
  citations?: string[]
  /**
   * `${pillar}:${reason}` as persisted on MessageDoc (D-02). Load-bearing for rendering
   * (quick-kayinleong-050): without it a restored Finder/Reply turn has no pillar for the
   * decoder to gate on and its raw JSON envelope renders verbatim in the bubble.
   */
  routeDecision?: string
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
    .map((r) => {
      const base: ChatMessage = {
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content ?? '',
        citations: (r.citations ?? []).map((chunkId) => ({ chunkId })),
      }

      if (base.role !== 'assistant' || !base.content) return base

      // The live path decodes structured output using the pillar the SERVER reported
      // (quick-046). History had no equivalent, so a restored Finder/Reply turn fell
      // through to the plain-text branch and rendered its JSON envelope raw — one of the
      // "raw unprocessed output" reports. routeDecision was already persisted on every
      // message; it just was not carried through here.
      const pillar = r.routeDecision?.split(':')[0]

      if (pillar === 'finder') {
        const finderOutput = decodeFinderOutput(base.content)
        // MatchList is self-contained (output + className), so a restored Finder turn
        // renders identically to a live one.
        return finderOutput ? { ...base, finderOutput } : base
      }

      if (pillar === 'reply') {
        // Deliberately NOT rendering ReplyDraftCard from history: it requires a non-
        // optional leadId that history does not carry, and its edit-capture would then
        // write rows against an empty lead. Surfacing the readable draft text fixes the
        // raw-JSON symptom without inventing data.
        const replyOutput = decodeReplyOutput(base.content)
        if (!replyOutput) return base
        const readable = replyOutput.draft?.text
          ?? replyOutput.noSopMatch?.message
          ?? replyOutput.clarifyingQuestion
        return readable ? { ...base, content: readable } : base
      }

      return base
    })
}
