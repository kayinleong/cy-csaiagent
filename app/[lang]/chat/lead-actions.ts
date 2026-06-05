'use server'

/**
 * app/[lang]/chat/lead-actions.ts — downline-scoped lead listing for the Reply
 * lead-selector (Surface 2, D-07).
 *
 * Reply turns REQUIRE a leadId (D-07 / HR-3). When the agent has no active lead,
 * the UI surfaces a picker (cmdk Command in a bottom Sheet). This action supplies
 * the list. There is NO auto-inference of a lead — the agent always picks
 * explicitly (a wrong-lead reply is the worst Reply failure mode).
 *
 * Scope: an individual agent reads their OWN leads (`ownerUid == uid`). uid comes
 * from the verified `__session` token, never the args (T-02-31). The server fails
 * closed — the route also enforces required-leadId (Plan 06, HTTP 400) so the UI
 * gate is defence-in-depth, not the only guard.
 *
 * PDPA: `leads/{leadId}.name` is the pseudonymized-at-the-boundary label. This
 * action returns it verbatim for DISPLAY in the agent's own picker (the agent owns
 * these leads). It never logs lead content (CLAUDE.md no-PII-in-logs). Next.js 16:
 * cookies() is async — awaited.
 *
 * `lastTouchedAt` is the leadContext rolling-update epoch (when present) so the UI
 * can apply the "<24h recent" affordance (HR-3) — an affordance, NOT auto-select.
 */

import { cookies } from 'next/headers'
import { adminAuth } from '@/src/firebase/admin'
import { leadsRef, leadContextRef } from '@/src/firebase/collections'

const SESSION_COOKIE_NAME = '__session'

/** A single lead option for the selector (display-only; no PII beyond the pseudonym). */
export interface LeadOption {
  id: string
  /** Pseudonymized display name (leads/{id}.name). */
  name: string
  /** Epoch ms of the last leadContext update, or null if never touched. */
  lastTouchedAt: number | null
}

export interface ListLeadsResult {
  ok: boolean
  leads?: LeadOption[]
  error?: string
}

async function requireSessionUid(): Promise<string> {
  const cookieStore = await cookies()
  const idToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!idToken) throw new Error('Not authenticated')
  const decoded = await adminAuth.verifyIdToken(idToken)
  return decoded.uid
}

/**
 * List the current agent's leads for the Reply lead-selector (D-07).
 *
 * Returns leads owned by the verified uid, each with its pseudonymized display name
 * and a best-effort `lastTouchedAt` (from leadContext) for the recent-lead affordance.
 * Returns `{ ok:false, error }` on any failure — the UI keeps the picker open.
 */
export async function listLeadsForReply(): Promise<ListLeadsResult> {
  let uid: string
  try {
    uid = await requireSessionUid()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  try {
    const snap = await leadsRef().where('ownerUid', '==', uid).get()

    const leads: LeadOption[] = await Promise.all(
      snap.docs.map(async (doc) => {
        let lastTouchedAt: number | null = null
        try {
          const ctxSnap = await leadContextRef().doc(doc.id).get()
          const ctx = ctxSnap.data()
          // updatedAt may be a Firestore Timestamp; normalize to epoch ms.
          const updatedAt = ctx?.updatedAt as { toMillis?: () => number } | undefined
          if (updatedAt?.toMillis) {
            lastTouchedAt = updatedAt.toMillis()
          }
        } catch {
          // A missing/unreadable leadContext is not fatal — the lead is still
          // selectable; it just won't carry the recent affordance.
        }
        return { id: doc.id, name: doc.data().name, lastTouchedAt }
      }),
    )

    return { ok: true, leads }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list leads'
    return { ok: false, error: msg }
  }
}
