'use client'

/**
 * app/[lang]/chat/load-conversation-messages.ts — Client-side transcript loader (quick-018).
 *
 * Reads a conversation's `messages` subcollection via the client Firestore SDK
 * (the same read-only client pattern as conversation-list.tsx) and returns the
 * renderable `ChatMessage[]`, ordered by the pure `mapConversationMessages`.
 *
 * Why no Firestore `orderBy('createdAt')`: that silently drops messages whose
 * `createdAt` is null (legacy pre-quick-018 messages, or an unresolved
 * serverTimestamp()). Instead the read is bounded by `limit` and ordering is done
 * client-side so no message is ever dropped (quick-010 lesson).
 *
 * Rules: the conversations/{cid}/messages read rule keys on the PARENT doc's
 * ownerUid (get(parent).ownerUid == request.auth.uid), not a message field, so an
 * owner can list a thread's messages without a per-field query constraint.
 *
 * References: quick-018, CHAT-07, firestore.rules messages block.
 */

// firebase/firestore is imported lazily inside the function below — it compiles into a
// ~353 KB chunk that the chat route would otherwise pay for on first load
// (quick-kayinleong-046). `import type` erases, so these cost nothing.
import { getClientDb } from '@/src/firebase/client'
import type { ChatMessage } from './message-list'
import { mapConversationMessages, type RawMessageRecord } from './conversation-messages-map'

/** Upper bound on messages loaded per thread (over-read guard, T-01-22). */
const MAX_MESSAGES = 200

/**
 * Load and order a conversation's persisted transcript for display.
 *
 * @param cid The conversation document id (e.g. `coach-${uid}`).
 * @returns ChatMessages oldest → newest. Empty array on any read failure
 *          (non-fatal — the caller can still start a fresh exchange).
 */
export async function loadConversationMessages(cid: string): Promise<ChatMessage[]> {
  if (!cid) return []
  try {
    const [{ collection, query, limit, getDocs }, db] = await Promise.all([
      import('firebase/firestore'),
      getClientDb(),
    ])
    const q = query(
      collection(db, 'conversations', cid, 'messages'),
      limit(MAX_MESSAGES),
    )
    const snap = await getDocs(q)
    const records: RawMessageRecord[] = snap.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        role: data.role as string | undefined,
        content: data.content as string | undefined,
        citations: (data.citations as string[] | undefined) ?? [],
        createdAt: data.createdAt?.toDate?.() ?? null,
      }
    })
    return mapConversationMessages(records)
  } catch (err) {
    // Non-fatal: log the error OBJECT only (Firestore code, no PII) and return
    // empty so the user can still chat. Mirrors conversation-list.tsx (quick-010).
    console.error('[load-conversation-messages] failed to load transcript', err)
    return []
  }
}
