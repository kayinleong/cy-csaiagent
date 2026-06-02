/**
 * app/api/auth/session/route.ts — Session cookie management.
 *
 * POST: accepts { idToken } from the sign-in form, verifies it server-side via
 *   adminAuth.verifyIdToken, then sets an httpOnly session cookie so the session
 *   survives a page refresh (AUTH-05).
 *
 * DELETE: clears the session cookie (sign-out).
 *
 * Security:
 *   - `cookies()` is ASYNC in Next.js 16 — always `await cookies()` (Next.js 16 gotcha).
 *   - httpOnly + Secure + SameSite=Strict: session cookie is NOT readable from JS.
 *   - NEVER log the idToken, the verified decoded claims, or the session cookie value
 *     (CLAUDE.md secrets hygiene / T-01-12).
 *   - Returns 401 on any invalid token — fail closed (T-01-10).
 *
 * AUTH-05: Because the Firebase web SDK client uses LOCAL persistence (IndexedDB)
 *   AND this route sets a server session cookie, a page refresh re-hydrates the
 *   user from BOTH sources (defense-in-depth). The client recovers the Firebase
 *   Auth user from IndexedDB; the server reads the httpOnly cookie.
 */

export const runtime = 'nodejs'

import { cookies } from 'next/headers'
import { adminAuth } from '@/src/firebase/admin'

/** Session cookie name — shared constant so middleware/proxy can match it. */
export const SESSION_COOKIE_NAME = '__session'

/** Session duration (14 days in seconds — aligns with Firebase ID token refresh cycle). */
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14

// ─── POST /api/auth/session ───────────────────────────────────────────────────

/**
 * Establish a server-side session from the Firebase ID token.
 *
 * Body: { idToken: string }
 * Success: 200 + sets httpOnly __session cookie.
 * Failure: 401 on invalid token, 400 on malformed body.
 */
export async function POST(req: Request): Promise<Response> {
  let idToken: string
  try {
    const body = await req.json()
    idToken = body?.idToken
    if (!idToken || typeof idToken !== 'string') {
      return Response.json({ error: 'Missing idToken' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Verify the Firebase ID token server-side — fail closed on any error.
  // SECURITY: do NOT log `idToken` or the decoded claims (T-01-12).
  let role: string
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    // Read role from verified token claims only — never trust a client-supplied value.
    // Redirect is UX only; every Firestore read is independently rules-gated (T-02-02).
    role = (decoded.role as string) ?? 'new-agent'
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Next.js 16: cookies() is async — must await before calling .set()
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  })

  return Response.json({ ok: true, role }, { status: 200 })
}

// ─── DELETE /api/auth/session ─────────────────────────────────────────────────

/**
 * Clear the server-side session cookie (sign-out).
 *
 * The client-side Firebase Auth sign-out (`signOut(clientAuth)`) should be
 * called in addition to this endpoint to clear the LOCAL persistence state.
 */
export async function DELETE(): Promise<Response> {
  // Next.js 16: cookies() is async
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)

  return Response.json({ ok: true }, { status: 200 })
}
