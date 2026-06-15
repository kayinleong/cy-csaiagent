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
 *   flagConversation         — coach (own-downline) + admin; CONTENT-FREE flag write (FLAG-02 / D-10)
 *
 * READ-ONLY content surface: NO resolve/edit/delete/reply exported — HR-5.
 * flagConversation writes a conversationId REFERENCE only (no message content, D-10);
 * it is a triage marker, not a content mutation.
 *
 * References:
 *   - ADMIN-02 (admin conversation viewer)
 *   - HR-5 (audit-before-read, read-only)
 *   - FLAG-02 (content-free, denormalized, audited flag write — manual only, D-11)
 *   - D-09 (Admin-SDK-only flag writes), D-10 (conversationId reference only)
 *   - 05-PATTERNS.md §conversations/actions.ts
 *   - dashboard/actions.ts:80-89 (resolveStall coach-or-admin gate), :265-272 (own-downline assert)
 *   - T-05-ADMINGATE, T-05-UNAUDITED, T-05-RW, T-07-12, T-07-16
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { loadRecent } from '@/src/memory/conversation'
import { auditDrilldown, log as auditLog } from '@/src/audit/log'
import { conversationsRef, agentProfilesRef, conversationFlagsRef, TENANT_ID } from '@/src/firebase/collections'

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
  /**
   * Resolved Firebase Auth email of the conversation owner (`ownerUid`).
   * Null when the owner has no email (phone/anon auth) or was not found in Auth
   * (deleted, or email resolution failed). Resolved server-side only — only this
   * string crosses to the client (PII boundary; never logged/audited).
   */
  agentEmail: string | null
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
    // Resolve adminAuth the SAME inline way (NOT a top-level import) to preserve
    // the test-friendly module shape.
    const { adminDb, adminAuth } = await import('@/src/firebase/admin')

    // Three-branch snapshot selection on `query`:
    //   email (@-detection) → getUserByEmail → ownerUid query (reuses the existing
    //     (ownerUid ASC, createdAt DESC) composite index)
    //   prefix             → __name__ doc-ID prefix range (unchanged)
    //   recent             → bare limit(50) (unchanged)
    let snapshot
    if (query && query.includes('@')) {
      // Email branch — resolve email → uid server-side (PII never logged/audited).
      let uid: string
      try {
        const userRecord = await adminAuth.getUserByEmail(query.trim())
        uid = userRecord.uid
      } catch {
        // Unknown/malformed email (e.g. auth/user-not-found) → empty result,
        // NOT an error toast. Do NOT surface or log the offending query.
        return { ok: true, conversations: [] }
      }
      snapshot = await adminDb
        .collection('conversations')
        .where('ownerUid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    } else if (query) {
      // Prefix branch — doc-ID prefix range (unchanged).
      snapshot = await adminDb
        .collection('conversations')
        .orderBy('__name__')
        .startAt(query)
        .endAt(query + '￿')
        .limit(50)
        .get()
    } else {
      // Recent branch — bounded limit(50) most-recent (unchanged).
      snapshot = await adminDb.collection('conversations').limit(50).get()
    }

    // Resolve owner emails for the table server-side (quick-011 chunked pattern).
    // Resolution failure must NOT break the listing — on error the map stays empty
    // so every row falls back to a null agentEmail.
    const uids = [
      ...new Set(snapshot.docs.map((d) => d.data().ownerUid).filter(Boolean) as string[]),
    ]
    const emailByUid = new Map<string, string | null>()
    try {
      for (let i = 0; i < uids.length; i += 100) {
        const chunk = uids.slice(i, i + 100)
        const result = await adminAuth.getUsers(chunk.map((uid) => ({ uid })))
        for (const u of result.users) {
          emailByUid.set(u.uid, u.email ?? null)
        }
      }
    } catch {
      // Email resolution failed — leave the map empty; rows fall back to null.
    }

    const conversations: ConversationRef[] = snapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        cid: doc.id,
        pillar: (data.pillar as string | null) ?? (data.routeDecision as string | null) ?? null,
        agentRef: (data.ownerUid as string | null) ?? null,
        agentEmail: emailByUid.get(data.ownerUid as string) ?? null,
        leadRef: (data.leadId as string | null) ?? null,
        // WR-03 fix: ConversationDoc has no `lastMessageAt` field — nothing writes it.
        // Fall back to `createdAt` (which does exist) so the column shows meaningful data
        // rather than always "—".  The column header reflects this (see conversation-viewer.tsx).
        lastMessageAt:
          (data.lastMessageAt as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ??
          (data.createdAt as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ??
          null,
      }
    })

    return { ok: true, conversations }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to search conversations'
    return { ok: false, error: msg }
  }
}

// ─── flagConversation ───────────────────────────────────────────────────────────

export interface FlagConversationResult {
  ok: boolean
  flagId?: string
  error?: string
}

/**
 * Raise a CONTENT-FREE flag on a conversation for coach/admin review (FLAG-02).
 *
 * Manual flagging only — there is no AI auto-flag path (D-11). The flag stores a
 * `conversationId` REFERENCE only; NO message content is ever written onto the flag
 * (D-10, T-07-12). The flagged queue (07-04 Task 2) deep-links back to the EXISTING
 * audited conversation viewer for content — the flag is a triage marker, not a copy.
 *
 * Security:
 *   - Role gate: senior-coach OR admin from the VERIFIED token, never from args
 *     (mirror resolveStall :80-89; T-02-31).
 *   - Own-downline enforcement at write time (T-07-16): the conversation's owning
 *     agent is resolved (conversations/{cid}.ownerUid), their
 *     agentProfiles/{ownerUid}.seniorCoachId is looked up, and — for a COACH — we
 *     assert that seniorCoachId === the verified coach uid. An admin may flag any.
 *   - Denormalized seniorCoachId is stamped on the flag so the coach read-rule
 *     (resource.data.seniorCoachId == request.auth.uid) matches (Pitfall D).
 *   - Written via conversationFlagsRef() (Admin SDK) — ALL client writes are DENIED
 *     in firestore.rules (D-09). The converter stamps tenantId.
 *   - Audited (audit.log hashes only — never raw content; the conversationId is the
 *     only raw value passed and it is hashed).
 *
 * @param conversationId  The conversation document ID to flag (reference only).
 * @param reason          Free-text reason the conversation was flagged.
 */
export async function flagConversation(
  conversationId: string,
  reason: string,
): Promise<FlagConversationResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Coach-or-admin gate (FLAG-02 / D-11 — manual flagging by a reviewer only).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    // Resolve the conversation's owning agent (the flag's downline anchor).
    const convSnap = await conversationsRef().doc(conversationId).get()
    const conv = convSnap.data()
    if (!conv) {
      return { ok: false, error: 'Conversation not found' }
    }
    const ownerUid = conv.ownerUid

    // Look up the owning agent's senior coach (denormalized onto the flag, Pitfall D).
    const profileSnap = await agentProfilesRef().doc(ownerUid).get()
    const profile = profileSnap.data()
    // The agent's senior coach uid; '' when the agent has no assigned coach yet.
    const seniorCoachId = profile?.seniorCoachId ?? ''

    // T-07-16: a coach may only flag an OWN-DOWNLINE conversation (write-time assert).
    // Admin may flag any conversation in the tenant.
    if (user.role !== 'admin' && seniorCoachId !== user.uid) {
      return { ok: false, error: 'Forbidden: conversation is not in your downline' }
    }

    // Content-free write (D-10): conversationId reference ONLY, no message content.
    const flagRef = await conversationFlagsRef().add({
      // The converter stamps tenantId on every write; set it explicitly too to
      // satisfy WithFieldValue<ConversationFlagDoc> (mirrors cohorts/actions.ts:92).
      tenantId: TENANT_ID,
      conversationId,
      flaggedByUid: user.uid,
      reason,
      status: 'open',
      seniorCoachId,
      createdAt: FieldValue.serverTimestamp(),
    })

    // Audit (hashes only — the raw conversationId is hashed, never stored plain).
    await auditLog({
      actorUid: user.uid,
      action: 'flag-conversation',
      targetRef: `conversationFlags/${flagRef.id}`,
      raw: { conversationId },
    })

    return { ok: true, flagId: flagRef.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to flag conversation'
    return { ok: false, error: msg }
  }
}
