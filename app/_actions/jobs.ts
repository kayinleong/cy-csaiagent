'use server'

/**
 * app/_actions/jobs.ts — Server Action: trigger due background jobs on page visit.
 *
 * Replaces the QStash-scheduled /api/jobs/* routes with an on-visit lazy-cron
 * pattern (decision override 2026-06-01).
 *
 * Auth gate:
 *   - Reads the __session cookie (httpOnly ID token set by /api/auth/session).
 *   - Verifies it via adminAuth.verifyIdToken — unauthenticated visits are
 *     silently swallowed (no job runs, no error surfaced to the page).
 *
 * Fire-and-forget semantics:
 *   - The chat page RSC triggers this action but does NOT block rendering on
 *     it. The last-run guard in runDueJobs() makes the typical cost just one
 *     Firestore doc read per job when nothing is due.
 *   - All errors are caught and logged — this function never throws.
 *
 * References:
 *   - src/jobs/runDueJobs.ts — concurrency-safe job runner
 *   - app/api/auth/session/route.ts — SESSION_COOKIE_NAME
 *   - TSD §3.4 scheduled jobs
 */

import { cookies } from 'next/headers'
import { adminAuth } from '@/src/firebase/admin'
import { runDueJobs } from '@/src/jobs/runDueJobs'

/** Cookie name must match app/api/auth/session/route.ts SESSION_COOKIE_NAME. */
const SESSION_COOKIE_NAME = '__session'

/**
 * Trigger due background jobs for the authenticated page visitor.
 *
 * Safe to call from any Server Component or Server Action. Never throws.
 */
export async function triggerDueJobs(): Promise<void> {
  try {
    // Next.js 16: cookies() is async — await before reading
    const cookieStore = await cookies()
    const idToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

    // No session cookie → unauthenticated visit → skip all jobs silently
    if (!idToken) return

    // Verify the token — fail closed on any invalid/expired token
    // SECURITY: do NOT log idToken or decoded claims (T-01-12)
    try {
      await adminAuth.verifyIdToken(idToken)
    } catch {
      // Token invalid or expired — not an error worth surfacing
      return
    }

    // Run all due jobs. runDueJobs() is internally error-safe per job.
    await runDueJobs()
  } catch {
    // Swallow any unexpected top-level failure — job runner errors must never
    // break page rendering (TSD §3.4 resilience requirement).
    // Individual job errors are already logged inside runDueJobs().
  }
}
