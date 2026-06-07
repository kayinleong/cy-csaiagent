'use server'

/**
 * app/[lang]/(admin)/conversations/actions.ts — Admin conversation viewer Server Actions (ADMIN-02).
 *
 * Three-layer admin gate:
 *   Layer 1: (admin)/layout.tsx redirects non-admins.
 *   Layer 2: conversations/page.tsx (RSC) re-checks role.
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED TOKEN (never from args).
 *
 * STRIDE: T-05-ADMINGATE, T-05-UNAUDITED, T-05-RW.
 * Role is read from the verified Firebase ID token via requireUser, NEVER from action args (T-02-31).
 *
 * Actions exported:
 *   getConversationForReview — admin-only, audited BEFORE data returned (HR-5 / PDPA)
 *   searchConversations      — admin-only bounded lookup of conversation refs
 *
 * READ-ONLY surface: NO resolve/edit/delete/reply exported — HR-5.
 *
 * References:
 *   - ADMIN-02 (admin conversation viewer)
 *   - HR-5 (audit-before-read, read-only)
 *   - 05-PATTERNS.md §conversations/actions.ts
 *   - dashboard/actions.ts:237-276 (getAgentChatHistory — audited drilldown seam, widened)
 *   - T-05-ADMINGATE, T-05-UNAUDITED, T-05-RW
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { loadRecent } from '@/src/memory/conversation'
import { auditDrilldown } from '@/src/audit/log'

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Verbatim copy of dashboard/actions.ts:40-52 (getSessionUser pattern).
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/conversations', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string
  role: string
  content: string
  redacted: boolean
  pillar: string | null
}

export interface GetConversationResult {
  ok: true
  messages: ConversationMessage[]
}

export type GetConversationError = {
  ok: false
  error: string
}

export interface ConversationRef {
  cid: string
  pillar: string | null
  agentRef: string | null
  leadRef: string | null
  lastMessageAt: string | null
}

export interface SearchConversationsResult {
  ok: true
  conversations: ConversationRef[]
}

export type SearchConversationsError = {
  ok: false
  error: string
}

// ─── getConversationForReview ─────────────────────────────────────────────────

/**
 * Admin-only, audited read of any pillar's conversation thread (ADMIN-02).
 *
 * Security:
 *   - Requires role === 'admin' from the verified token (T-05-ADMINGATE).
 *   - Calls auditDrilldown BEFORE returning any messages (HR-5 / PDPA).
 *   - Read-only: no mutation path exists (T-05-RW).
 *
 * Pattern: dashboard/actions.ts:237-276 (getAgentChatHistory), widened:
 *   - Gate changed from senior-coach||admin → admin only.
 *   - Downline scoping (lines 258-264) dropped — admin reads any conversation.
 *   - cid is taken directly (any pillar), not prefixed with 'coach-'.
 *   - auditDrilldown called with conversations/${cid} (per HR-5 / RESEARCH Code Examples).
 *
 * @param cid  Any conversation document ID (cross-pillar).
 */
export async function getConversationForReview(
  cid: string
): Promise<GetConversationResult | GetConversationError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // ADMIN-02: admin-only gate (not senior-coach + admin; admin exclusive).
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // HR-5 / PDPA: audit the drilldown BEFORE returning any conversation data.
    // This is the CRITICAL ordering invariant — audit event is written first.
    await auditDrilldown(user.uid, `conversations/${cid}`)

    // Bounded read — loadRecent uses limitToLast (T-01-22 over-read mitigation).
    const records = await loadRecent(cid, 100)

    return {
      ok: true,
      messages: records.map((r) => ({
        id: r.id,
        role: r.data.role as string,
        content: r.data.content as string,
        redacted: (r.data.redacted as boolean) ?? false,
        // routeDecision holds the pillar name (coach/finder/reply) — use it as the pillar field.
        pillar: r.data.routeDecision ?? null,
      })),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load conversation'
    return { ok: false, error: msg }
  }
}

// ─── searchConversations ──────────────────────────────────────────────────────

/**
 * Admin-only bounded search of conversations (conversation refs for the viewer table).
 *
 * Returns conversation refs (cid, pillar, agentRef, leadRef, lastMessageAt) for
 * the search/browse UI. Bounded query — never fetch-all.
 *
 * @param query  Optional filter string (conversation ID prefix or empty for recent).
 */
export async function searchConversations(
  query: string
): Promise<SearchConversationsResult | SearchConversationsError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Admin-only gate (ADMIN-02)
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // Import inline to avoid admin SDK at module load time in test environments.
    const { adminDb } = await import('@/src/firebase/admin')

    // Bounded query: limit to 50 most-recent conversations (never fetch-all).
    let q = adminDb.collection('conversations').limit(50)

    // If a query was provided that looks like a doc ID, order and bound by it.
    const snapshot = await (query
      ? adminDb
          .collection('conversations')
          .orderBy('__name__')
          .startAt(query)
          .endAt(query + '￿')
          .limit(50)
          .get()
      : q.get())

    const conversations: ConversationRef[] = snapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        cid: doc.id,
        pillar: (data.pillar as string | null) ?? (data.routeDecision as string | null) ?? null,
        agentRef: (data.ownerUid as string | null) ?? null,
        leadRef: (data.leadId as string | null) ?? null,
        lastMessageAt: (data.lastMessageAt as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? null,
      }
    })

    return { ok: true, conversations }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to search conversations'
    return { ok: false, error: msg }
  }
}
