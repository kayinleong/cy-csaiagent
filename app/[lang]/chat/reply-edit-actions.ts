'use server'

/**
 * app/[lang]/chat/reply-edit-actions.ts — the captureReplyEdit Server Action.
 *
 * REPLY-09 / ADMIN-06 (D-18/D-19). Writes ONE append-only `replyEdits` row via the
 * Admin SDK on every Copy of a Reply draft — clients can NEVER write `replyEdits`
 * directly (firestore.rules deny create/update/delete). A row is written even when
 * the draft is unchanged (`editRatio: 0`) so the dashboard's per-SOP edit-rate has a
 * denominator (Pitfall E). The optional `thumbsDown` is the ADMIN-06 KPI producer
 * (`count(thumbsDown==true) / count(all)`); it is written ONLY when present so an
 * omitted thumbs-down stays absent (never persisted as `false`).
 *
 * Security:
 *   - uid + role come from the verified `__session` token via requireUser, NEVER
 *     from the action arguments (T-02-31). Mirrors the getSessionUser pattern in
 *     (admin)/kb/actions.ts and (coach)/dashboard/actions.ts.
 *   - `seniorCoachId` is DENORMALIZED onto every row (looked up from
 *     agentProfiles/{agentUid}) so the coach downline read-rule can match
 *     `resource.data.seniorCoachId == request.auth.uid` (Pitfall D).
 *
 * PDPA (CLAUDE.md no-PII-in-logs):
 *   - originalDraft / editedFinal MAY carry residual content — they are STORED but
 *     MUST NEVER be logged. Only counts (e.g., a missing-profile warning count) may
 *     be logged. Next.js 16: cookies() is async — it is awaited.
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { replyEditsRef, agentProfilesRef, TENANT_ID } from '@/src/firebase/collections'
import { editRatio } from '@/src/reply/diff'

/** Input contract for a single Copy event. uid/role are NOT accepted here (T-02-31). */
export interface CaptureReplyEditInput {
  leadId: string
  draftId: string
  sopDocIds: string[]
  originalDraft: string
  editedFinal: string
  lang: 'en' | 'ms' | 'zh'
  /** Optional thumbs-down signal (ADMIN-06 producer); omit to leave the field absent. */
  thumbsDown?: boolean
}

export interface CaptureReplyEditResult {
  ok: boolean
  error?: string
}

/**
 * Read the __session cookie and verify it with requireUser.
 * Throws UnauthorizedError if the session is missing or invalid.
 * Same pattern as (admin)/kb/actions.ts and (coach)/dashboard/actions.ts.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/chat/reply-edit', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

/**
 * Capture one Reply edit-as-signal row (REPLY-09 / ADMIN-06).
 *
 * Computes `editRatio(originalDraft, editedFinal)`, denormalizes the agent's
 * `seniorCoachId`, and appends one `replyEdits` row via the Admin SDK. Append-only —
 * never updates an existing row. Returns `{ ok:false, error }` on any failure.
 *
 * @param input The Copy event (leadId, draftId, cited SOPs, draft pair, lang, thumbsDown?).
 */
export async function captureReplyEdit(
  input: CaptureReplyEditInput,
): Promise<CaptureReplyEditResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  try {
    const agentUid = user.uid // from the verified token, never the args (T-02-31)

    // Denormalize seniorCoachId so the coach downline read-rule can match (Pitfall D).
    let seniorCoachId = ''
    try {
      const profileSnap = await agentProfilesRef().doc(agentUid).get()
      const profile = profileSnap.data()
      seniorCoachId = profile?.seniorCoachId ?? ''
    } catch {
      // A missing/unreadable profile is not fatal — the row still writes with an
      // empty seniorCoachId (the coach read just won't surface it). Log a COUNT
      // only, never PII (CLAUDE.md). Keep it terse to avoid noisy logs.
      console.warn('[captureReplyEdit] agentProfile lookup failed; seniorCoachId left empty')
    }

    const ratio = editRatio(input.originalDraft, input.editedFinal)

    await replyEditsRef().add({
      // tenantId is also stamped by the converter — set explicitly to satisfy the
      // WithFieldValue<ReplyEditDoc> type (mirrors knowledgeGaps writer); idempotent.
      tenantId: TENANT_ID,
      leadId: input.leadId,
      draftId: input.draftId,
      sopDocIds: input.sopDocIds,
      originalDraft: input.originalDraft,
      editedFinal: input.editedFinal,
      editRatio: ratio,
      agentUid,
      seniorCoachId,
      lang: input.lang,
      // Write thumbsDown ONLY when present — an omitted value stays absent (not false).
      ...(input.thumbsDown !== undefined && { thumbsDown: input.thumbsDown }),
      timestamp: FieldValue.serverTimestamp(),
    })

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to capture reply edit'
    return { ok: false, error: msg }
  }
}
