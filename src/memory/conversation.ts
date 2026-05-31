/**
 * src/memory/conversation.ts — Messages subcollection reader/writer.
 *
 * Messages MUST live in the subcollection `conversations/{cid}/messages/{mid}`.
 * NEVER push to an inline array on the conversation doc — 1 MB doc-size trap (Pitfall E).
 *
 * Security: loadRecent paginates to last-N (T-01-22 — no full-history over-read).
 *
 * Consumed by: src/memory/index.ts → chat route (01-11).
 * References: TSD §4, RESEARCH §Pitfall E, FND-05.
 */

import { messagesRef } from '@/src/firebase/collections'
import type { MessageDoc } from '@/src/firebase/collections'

/** A message retrieved from the subcollection, including its document ID. */
export interface MessageRecord {
  id: string
  data: MessageDoc
}

/**
 * Append a single message to the `conversations/{cid}/messages` subcollection.
 *
 * The typed `messagesRef(cid)` converter stamps `tenantId:'d2'` on write — no
 * caller can omit the tenant field (01-03 design).
 *
 * @param cid  The parent conversation document ID.
 * @param msg  The message to append (typed `MessageDoc`).
 * @returns    The new message document ID (`mid`).
 */
export async function appendMessage(cid: string, msg: MessageDoc): Promise<string> {
  // messagesRef(cid) returns the SUBCOLLECTION ref — not the parent conversation doc.
  // This is the critical distinction that prevents the 1 MB inline-array trap.
  const ref = await messagesRef(cid).add(msg)
  return ref.id
}

/**
 * Load the last-N messages from the `conversations/{cid}/messages` subcollection.
 *
 * Paginates — never loads the full conversation history (T-01-22 over-read mitigation).
 * Uses `limitToLast` so the most-recent messages are returned in ascending order.
 *
 * @param cid  The parent conversation document ID.
 * @param n    Max messages to return (default: 20).
 * @returns    Array of `{ id, data }` in ascending order (oldest first).
 */
export async function loadRecent(cid: string, n = 20): Promise<MessageRecord[]> {
  const snap = await messagesRef(cid)
    .orderBy('__name__')
    .limitToLast(n)
    .get()

  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}
