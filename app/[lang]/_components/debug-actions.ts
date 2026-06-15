'use server'

/**
 * app/[lang]/_components/debug-actions.ts — admin-only debug Server Action.
 *
 * clearAllData() is a DESTRUCTIVE debug utility: it deletes every top-level
 * Firestore collection in CLEAR_COLLECTIONS, preserving only `users` and
 * `appConfig` (the model-config source of truth). Surfaced from the hidden
 * DebugSidebar (unlocked by the e×5 easter egg) for admins only.
 *
 * Security (Layer-3 re-check, mirrors roles/actions.ts):
 *   - Role is read from the VERIFIED Firebase ID token (requireUser), never from
 *     the client. The action re-asserts role === 'admin' itself — the easter-egg
 *     gating in the UI is convenience only, not the security boundary.
 *   - Audited with action 'debug-clear-all-data' (no PII; counts only). NOTE: this
 *     wipes `auditLogs` too, so the audit row lands as the first post-wipe entry.
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminDb } from '@/src/firebase/admin'
import * as audit from '@/src/audit'
import { CLEAR_COLLECTIONS } from './debug-collections'

export type ClearAllDataResult =
  | { ok: true; cleared: number }
  | { ok: false; error: string }

/**
 * Read the __session cookie and verify it with requireUser.
 * Same pattern as roles/actions.ts:44-57 (the sanctioned Server-Action gate).
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/debug', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

/**
 * Delete every collection in CLEAR_COLLECTIONS (preserving users + appConfig).
 *
 * Admin-only. recursiveDelete handles the `conversations/{cid}/messages`
 * subcollection automatically. Not transactional across collections — a mid-way
 * failure leaves some collections wiped; the error is surfaced to the caller.
 */
export async function clearAllData(): Promise<ClearAllDataResult> {
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
    for (const name of CLEAR_COLLECTIONS) {
      // Raw collection ref — converters are irrelevant for deletes.
      await adminDb.recursiveDelete(adminDb.collection(name))
    }

    // Audit AFTER the wipe so the row survives the auditLogs delete.
    await audit.log({
      actorUid: user.uid,
      action: 'debug-clear-all-data',
      raw: { op: 'clear-all-data', cleared: CLEAR_COLLECTIONS.length },
    })

    return { ok: true, cleared: CLEAR_COLLECTIONS.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to clear data'
    return { ok: false, error: msg }
  }
}
