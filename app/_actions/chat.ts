'use server'

/**
 * app/_actions/chat.ts — Server Actions for chat mutations (disclosure ack + handoff).
 *
 * WHY Server Actions (not Route Handlers):
 *   - Mutations (disclosure ack, handoff request) are NOT streaming — they are simple
 *     read-modify-write operations. Server Actions are the correct pattern here.
 *   - Streaming lives exclusively in /api/chat (Route Handler) — NEVER in Server Actions.
 *
 * Actions:
 *   - ackDisclosure(): marks the user's AI disclosure acknowledgement (CHAT-05, T-02-13)
 *   - requestHandoff(cid): bundles context and emits a handoff escalation (CHAT-06)
 *
 * Security:
 *   - Both actions re-verify the session cookie via adminAuth.verifyIdToken (fail-closed).
 *   - requestHandoff contextBundle: {conversationId, journeyStage, summary} — no raw PII
 *     (T-02-11). rollingSummary is a processed summary, not raw message content.
 *   - disclosureAckAt is write-once (second write is a no-op on the client side by
 *     localStorage gate, but the server doesn't block subsequent writes — defense-in-depth).
 *
 * References: TSD §3.2, D-04, D-05, T-02-11, T-02-13.
 */

import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/src/firebase/admin'
import { conversationsRef, agentProfilesRef } from '@/src/firebase/collections'
import { emitHandoffSignal } from '@/src/escalation'
import { FieldValue } from 'firebase-admin/firestore'

const SESSION_COOKIE_NAME = '__session'

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Verify the session cookie and return the uid.
 * Throws a string error message on any auth failure (safe to surface to the UI).
 */
async function requireSessionUid(): Promise<string> {
  const cookieStore = await cookies()
  const idToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!idToken) throw new Error('Not authenticated')
  const decoded = await adminAuth.verifyIdToken(idToken)
  return decoded.uid
}

// ─── ackDisclosure ────────────────────────────────────────────────────────────

/**
 * Persist AI disclosure acknowledgement for the current user (CHAT-05 / T-02-13).
 *
 * Defense-in-depth: the client also persists to localStorage, but a server-side
 * write to `users/{uid}.disclosureAckAt` provides audit-traceable evidence of consent.
 *
 * No return value — fire-and-forget from the client's perspective.
 * The action does not throw on duplicate acks (idempotent).
 */
export async function ackDisclosure(): Promise<void> {
  let uid: string
  try {
    uid = await requireSessionUid()
  } catch {
    // Unauthenticated — silently ignore (localStorage ack is sufficient for the modal)
    return
  }

  try {
    // Only set if not already present (idempotent)
    // Use adminDb directly (no typed converter) to write the disclosureAckAt field
    // which is not declared on UserDoc (disclosure is a runtime-only field, not in schema).
    // The typed usersRef() converter would fail on unknown fields.
    const userDocRef = adminDb.collection('users').doc(uid)
    const snap = await userDocRef.get()
    if (!snap.exists || !(snap.data() as Record<string, unknown>)?.disclosureAckAt) {
      await userDocRef.set(
        { disclosureAckAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    }
  } catch {
    // Best-effort — localStorage ack is the primary gate; server persistence is defence-in-depth
  }
}

// ─── requestHandoff ───────────────────────────────────────────────────────────

/**
 * Request a human handoff — bundles context and emits an escalation row (CHAT-06).
 *
 * Context bundle (T-02-11 — NO raw PII):
 *   - conversationId: the cid (reference, not content)
 *   - journeyStage: from agentProfiles (string label, not PII)
 *   - summary: the rolling summary from leadContext or conversation doc
 *     (this is a processed summary, not raw message content)
 *
 * The escalation is created via emitHandoffSignal which dedup-guards against
 * duplicate open escalations for the same agent+reason pair (T-01-35).
 *
 * @param cid  The current conversation ID (used in context bundle + audit).
 */
export async function requestHandoff(cid: string): Promise<{ ok: boolean; message?: string }> {
  let uid: string
  try {
    uid = await requireSessionUid()
  } catch {
    return { ok: false, message: 'Not authenticated' }
  }

  try {
    // Fetch agent profile for journeyStage + seniorCoachId
    const profileSnap = await agentProfilesRef().doc(uid).get()
    const profile = profileSnap.data()
    const seniorCoachId = profile?.seniorCoachId ?? ''
    const journeyStage = profile?.journeyStage ?? 'unknown'

    // Fetch rolling summary from conversation doc (not raw messages — PDPA safe)
    let summary = ''
    if (cid) {
      const convSnap = await conversationsRef().doc(cid).get()
      summary = convSnap.data()?.summary ?? ''
    }

    // Emit the handoff signal (dedup-guarded, T-01-35)
    await emitHandoffSignal({
      agentUid: uid,
      seniorCoachId,
      reason: 'stall',
      // T-02-11: contextBundle MUST contain only references/pseudonyms — no raw PII
      contextBundle: {
        conversationId: cid,
        journeyStage,
        summary,       // rolling summary (processed, not raw transcript)
      },
    })

    return { ok: true }
  } catch (err) {
    void err
    return { ok: false, message: 'Handoff failed' }
  }
}
