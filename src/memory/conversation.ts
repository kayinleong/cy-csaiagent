/**
 * src/memory/conversation.ts — Conversation lifecycle + messages subcollection.
 *
 * Messages MUST live in the subcollection `conversations/{cid}/messages/{mid}`.
 * NEVER push to an inline array on the conversation doc — 1 MB doc-size trap (Pitfall E).
 *
 * Security: loadRecent paginates to last-N (T-01-22 — no full-history over-read).
 *
 * 02-03 additions (CHAT-01/02/07):
 *   - ensurePrimaryThread(uid, lang): deterministic cid `coach-${uid}`, idempotent create
 *   - listConversations(uid, n): ordered by createdAt DESC for history drawer (CHAT-07)
 *   - searchConversations(threads, term): pure client-side substring match on summary
 *
 * Consumed by: src/memory/index.ts → chat route, chat-shell, chat-header.
 * References: TSD §4, RESEARCH §Pitfall E + Pitfall 2, D-01, FND-05.
 */

import { messagesRef, conversationsRef } from '@/src/firebase/collections'
import type { MessageDoc, ConversationDoc } from '@/src/firebase/collections'
import { FieldValue } from 'firebase-admin/firestore'

/** A message retrieved from the subcollection, including its document ID. */
export interface MessageRecord {
  id: string
  data: MessageDoc
}

/** A conversation document with its ID. */
export interface ConversationRecord {
  id: string
  data: ConversationDoc
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
  //
  // Stamp createdAt at this single write site (quick-018) so EVERY persisted
  // message carries a server timestamp without any caller change — this is the
  // sort key a reloaded transcript is ordered by. A caller-supplied createdAt is
  // respected if present; otherwise the server clock is used.
  const ref = await messagesRef(cid).add({
    ...msg,
    createdAt: msg.createdAt ?? FieldValue.serverTimestamp(),
  })
  return ref.id
}

/**
 * Replace the body of a message already appended to `conversations/{cid}/messages`.
 *
 * Exists for exactly one caller (quick-kayinleong-057): /api/chat may persist a PARTIAL
 * assistant reply when a turn looks like it is dying, and then the turn finishes anyway
 * with the complete text. Without this the partial permanently shadows the real answer,
 * which is a quieter version of the bug it was added to prevent.
 *
 * `createdAt` is deliberately NOT touched — the message keeps its original position in the
 * transcript, which is the sort key mapConversationMessages() orders by.
 *
 * @param cid  The parent conversation document ID.
 * @param mid  The message document ID returned by appendMessage.
 * @param msg  The replacement message body.
 */
export async function updateMessage(cid: string, mid: string, msg: MessageDoc): Promise<void> {
  await messagesRef(cid).doc(mid).set(msg, { merge: true })
}

/**
 * Ensure the primary "Coach" thread for an agent exists.
 *
 * The thread has a deterministic cid = `coach-${uid}` (D-01 — ONE persistent
 * primary Coach thread per agent). Uses get-then-set(merge:true) to be
 * idempotent: if the doc already exists WITH a createdAt, it is NOT overwritten —
 * preserving the existing `summary` field (rolling summary updated by memory module).
 *
 * Defensive backfill (quick-010, H1 subcase 2): if the doc exists but is missing
 * `createdAt`, only `createdAt`/`ownerUid`/`tenantId` are merged in to repair it.
 * `summary` (and `pillar`/`lang`) are NOT written, so the rolling summary is
 * preserved (D-01 contract). A doc with no `createdAt` is otherwise permanently
 * invisible to a createdAt-ordered history listing.
 *
 * @param uid   The authenticated agent's UID.
 * @param lang  The language for this thread (from request or user profile).
 * @returns     The stable cid (`coach-${uid}`).
 */
export async function ensurePrimaryThread(
  uid: string,
  lang: 'en' | 'ms' | 'zh',
): Promise<string> {
  const cid = `coach-${uid}`
  const docRef = conversationsRef().doc(cid)
  const snap = await docRef.get()

  if (!snap.exists) {
    // Create the conversation doc — tenantId stamped by the converter
    await docRef.set(
      {
        ownerUid: uid,
        pillar: 'coach',
        lang,
        createdAt: FieldValue.serverTimestamp(),
        summary: '',
        // tenantId stamped by converter — never omitted
        tenantId: 'd2' as const,
      },
      { merge: true },
    )
  } else if (snap.data()?.createdAt == null) {
    // Doc exists but lacks createdAt (H1 subcase 2) — repair only the
    // visibility/ownership/tenant fields. Do NOT write summary (preserve the
    // rolling summary, D-01) or pillar/lang.
    await docRef.set(
      {
        createdAt: FieldValue.serverTimestamp(),
        ownerUid: uid,
        tenantId: 'd2' as const,
      },
      { merge: true },
    )
  }

  return cid
}

/**
 * Truncate a first-message string into a short, single-line thread title.
 * Owner-facing display only (quick-033). Collapses whitespace; ellipsizes at `max`.
 */
export function truncateTitle(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/**
 * Resolve the conversation thread to write to for a chat turn (quick-033).
 *
 * This is what makes "New conversation" a SEPARATE thread instead of concatenating
 * into the single primary thread:
 *   - `cid` empty  → the stable primary thread (`ensurePrimaryThread`, D-01). Preserves
 *     the default-thread behavior for first-ever / cid-less turns.
 *   - `cid` given, doc MISSING → a brand-new session: create the conversation doc owned
 *     by the caller (so the thread is listable in history AND its messages are
 *     client-readable — the messages rules key on the PARENT doc's ownerUid). Sets a
 *     `title` from the first user message when provided.
 *   - `cid` given, doc owned by CALLER → use it (history navigation / continued session).
 *   - `cid` given, doc owned by SOMEONE ELSE (or an ownerless non-primary doc) → NEVER
 *     write into it; fall back to the caller's primary thread (server-side ownership
 *     hardening — the streaming route uses the Admin SDK, which bypasses Firestore rules).
 *
 * @param uid       Authenticated agent UID.
 * @param cid       Client-supplied conversation id (may be empty).
 * @param lang      Language for a newly-created thread.
 * @param pillar    Pillar label for a newly-created thread (default 'coach').
 * @param titleHint First user message — used to set the new thread's title.
 * @returns         The conversation id to persist this turn under.
 */
export async function ensureConversationOwned(
  uid: string,
  cid: string,
  lang: 'en' | 'ms' | 'zh',
  pillar: ConversationDoc['pillar'] = 'coach',
  titleHint?: string,
): Promise<string> {
  if (!cid) return ensurePrimaryThread(uid, lang)

  const docRef = conversationsRef().doc(cid)
  const snap = await docRef.get()

  if (!snap.exists) {
    // Brand-new session — create it owned by the caller.
    const title = titleHint ? truncateTitle(titleHint) : ''
    await docRef.set(
      {
        ownerUid: uid,
        pillar,
        lang,
        createdAt: FieldValue.serverTimestamp(),
        summary: '',
        ...(title ? { title } : {}),
        tenantId: 'd2' as const,
      },
      { merge: true },
    )
    return cid
  }

  // Existing doc: only the owner may write into it. Anything else falls back to the
  // caller's own primary thread (never leak/append into another agent's transcript).
  if (snap.data()?.ownerUid === uid) return cid
  return ensurePrimaryThread(uid, lang)
}

/**
 * List the agent's conversations, ordered by createdAt DESC (most recent first).
 *
 * Uses the composite index `(ownerUid, createdAt DESC)` declared in
 * firestore.indexes.json.  Paginates to n (default 50).
 *
 * @param uid  The authenticated agent's UID.
 * @param n    Max conversations to return (default: 50).
 * @returns    Array of `{ id, data }` in createdAt DESC order.
 */
export async function listConversations(uid: string, n = 50): Promise<ConversationRecord[]> {
  const snap = await conversationsRef()
    .where('ownerUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get()

  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}

/**
 * Pure client-side substring search over conversation summaries.
 *
 * Firestore has no native full-text search; this helper is the accepted MVP
 * per Don't-Hand-Roll (RESEARCH.md §Alternatives). The caller passes the already-
 * loaded thread list (from listConversations) and a search term.
 *
 * Case-insensitive. Returns all threads when `term` is empty.
 *
 * @param threads  Conversations to filter (pre-loaded from listConversations).
 * @param term     The substring to match against `data.summary`.
 * @returns        Matching conversations, order preserved.
 */
export function searchConversations(
  threads: ConversationRecord[],
  term: string,
): ConversationRecord[] {
  if (!term) return threads
  const lower = term.toLowerCase()
  return threads.filter((t) => t.data.summary?.toLowerCase().includes(lower))
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
