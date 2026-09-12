'use server'

/**
 * app/[lang]/(admin)/priority-list/actions.ts — Priority-List read + publish
 * Server Actions (quick-kayinleong-090).
 *
 * The Priority List is the singleton Firestore doc `appConfig/priorityList`: one
 * free-text ordering prompt, authored by an admin, injected into the Coach/Finder
 * system prompts as a RANKING preference over the projects `searchProjects`
 * already returned. These actions are the write/read half; the consumption half
 * lives in the agent prompt builders, which read the same doc.
 *
 * It is a tie-breaker, never a retrieval filter and never a source of fact: it
 * cannot surface a project the tools did not return, and it cannot override the
 * `status:'active'` guarantee (see src/firebase/collections.ts PriorityListDoc).
 * An empty string means the feature is OFF — the prompt builders omit the section
 * entirely rather than emit an empty header.
 *
 * Three-layer admin gate (mirrors model-config/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: priority-list/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-24).
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED token (never args, T-07-10).
 *
 * Security / correctness invariants:
 *   - READ + WRITE both go through priorityListRef() (Admin SDK; bypasses rules — the
 *     three-layer admin gate above is the authorization boundary).
 *   - publishPriorityList runs a Firestore transaction with an expected-current-value
 *     check: a stale read returns {ok:false,error:'conflict'}, never a blind
 *     overwrite of a concurrent publish (same posture as D-16).
 *   - The prompt is TRIMMED and length-capped (MAX_TEXT_LENGTH) before any write —
 *     an unbounded admin string lands verbatim in every Coach/Finder system prompt.
 *   - Raw Firestore error text is NEVER echoed to the client (may carry identifiers —
 *     PII/secrets hygiene); callers get a generic code + generic detail.
 *   - Every successful publish writes an audit row action:'priority_list_publish'
 *     (hashed text). A conflict or failure writes no audit row.
 *
 * References:
 *   - src/firebase/collections.ts (priorityListRef + PRIORITY_LIST_DOC_ID, collection 23)
 *   - model-config/actions.ts (the analog this mirrors verbatim)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminDb } from '@/src/firebase/admin'
import { priorityListRef, PRIORITY_LIST_DOC_ID } from '@/src/firebase/collections'
import * as audit from '@/src/audit'

// ─── Validation bound ─────────────────────────────────────────────────────────

/**
 * Maximum stored prompt length, in characters (post-trim). The published text is
 * concatenated into EVERY Coach/Finder system prompt, so an unbounded value is a
 * cost + context-window hazard, not just a storage one. Over-length input is
 * rejected outright rather than silently truncated — a silently clipped ordering
 * rule would change agent behavior without the admin knowing.
 */
const MAX_TEXT_LENGTH = 4000

// ─── Session helper (verbatim copy of model-config/actions.ts) ────────────────

async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/priority-list', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadPriorityListResult {
  ok: true
  /** The published prompt, or '' when nothing is published (feature off). */
  text: string
}

export type PublishPriorityListResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string }

// ─── readPriorityList ─────────────────────────────────────────────────────────

/**
 * Admin-only read of the published Priority List prompt from the singleton
 * Firestore doc `appConfig/priorityList` — the same doc the agent prompt builders
 * read.
 *
 * An unpublished doc (or a doc with no `text` field) returns '' — the UI renders
 * an empty Textarea and the feature is simply off.
 */
export async function readPriorityList(): Promise<ReadPriorityListResult | { ok: false; error: string }> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    const snap = await priorityListRef().doc(PRIORITY_LIST_DOC_ID).get()
    return { ok: true, text: snap.data()?.text ?? '' }
  } catch {
    // Generic code only — never echo the raw Firestore message to the client.
    return { ok: false, error: 'read-failed' }
  }
}

// ─── publishPriorityList — the Priority-List Firestore WRITE round-trip ───────

/**
 * Admin-only publish of the Priority List prompt into `appConfig/priorityList`.
 *
 * Flow:
 *   1. Assert role === 'admin' from the verified token (never args).
 *   2. Trim the input and enforce MAX_TEXT_LENGTH — reject over-length ('too-long').
 *      An EMPTY string is VALID: it is how an admin turns the feature off.
 *   3. Run a Firestore transaction: read the stored text; if it differs from
 *      `expectedCurrent` (what the admin saw when they opened the form), return
 *      {ok:false,error:'conflict'} and DO NOT write — never blind-overwrite a
 *      concurrent publish. Otherwise write the new doc.
 *   4. audit.log({ action:'priority_list_publish', raw:{ text } }) — hashed,
 *      success-only (a conflict or failure returns before this).
 *
 * @param text             The admin's ordering prompt. Trimmed before validation and
 *                         storage. '' = feature off.
 * @param expectedCurrent  The published value the admin saw when opening the form
 *                         ('' when nothing was published). Used for the
 *                         optimistic-concurrency check.
 */
export async function publishPriorityList(
  text: string,
  expectedCurrent: string,
): Promise<PublishPriorityListResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Admin-only gate — role from the verified token, never from args.
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  const trimmed = text.trim()

  // Bound the prompt. NOTE: '' is deliberately allowed — that is "feature off".
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: 'too-long',
      detail: `The priority list must be ${MAX_TEXT_LENGTH} characters or fewer.`,
    }
  }

  const docRef = priorityListRef().doc(PRIORITY_LIST_DOC_ID)
  let conflict = false

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(docRef)
      const current = snap.data()?.text ?? ''

      // Optimistic concurrency: the stored value changed since the admin opened
      // the form → surface a conflict, never blind-overwrite.
      if (current !== expectedCurrent) {
        conflict = true
        return
      }

      tx.set(docRef, {
        tenantId: 'd2' as const,
        text: trimmed,
        updatedBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  } catch {
    // Any Firestore failure (network, infra). Surface a generic code; do NOT echo
    // the raw error message (may carry identifiers — PII/secrets hygiene).
    return { ok: false, error: 'publish-failed', detail: 'Priority list publish failed.' }
  }

  if (conflict) {
    return { ok: false, error: 'conflict', detail: 'This setting changed since you opened it. Reload and retry.' }
  }

  // Audit (hashes-only) — log() sha256-hashes every value in `raw`.
  await audit.log({
    actorUid: user.uid,
    action: 'priority_list_publish',
    targetRef: `appConfig/${PRIORITY_LIST_DOC_ID}`,
    raw: { text: trimmed },
  })

  return { ok: true }
}
