/**
 * app/[lang]/_components/sync-session-cookie.ts — keep the __session cookie in step with
 * the live Firebase ID token (quick-kayinleong-059).
 *
 * `/api/auth/session` stores the ID token VERBATIM as the `__session` cookie with a 14-day
 * maxAge. A Firebase ID token is valid for ONE HOUR. Only the sign-in form ever posted one,
 * so an hour after signing in the cookie was still present, still sent, and no longer
 * verifiable — every Server Component and Server Action that authenticates from it failed
 * for the remaining 13 days and 23 hours.
 *
 * The Firebase SDK already refreshes the ID token by itself, shortly before it expires and
 * again when it re-initialises in a new tab. This module is only the other half: push the
 * refreshed token back to the server so the cookie tracks it.
 *
 * Pure and dependency-injected (no React, no Firebase import) so it is unit-testable —
 * importing the real client module would initialise a Firebase app in the test process.
 */

/** The subset of a Firebase User this needs. */
export interface TokenSource {
  getIdToken(): Promise<string>
}

/** Mutable dedupe cell — the last token successfully written to the cookie. */
export interface SyncState {
  last: string
}

export type SyncResult = 'signed-out' | 'unchanged' | 'synced' | 'failed'

/**
 * Push `user`'s current ID token to /api/auth/session when it differs from the last one
 * synced.
 *
 * - `signed-out`: no user. Does NOT clear the cookie — sign-out owns that (it DELETEs the
 *   session explicitly), and clearing here would race that flow on every listener teardown.
 * - `unchanged`: the SDK re-emitted a token already in the cookie. Common on mount; posting
 *   it again is harmless but pointless.
 * - `failed`: swallowed. Offline or a transient 5xx is not worth surfacing — the SDK fires
 *   again on the next refresh, and the cookie is still valid until its hour is up.
 */
export async function syncSessionCookie(
  user: TokenSource | null,
  state: SyncState,
  doFetch: typeof fetch,
): Promise<SyncResult> {
  if (!user) return 'signed-out'

  let idToken: string
  try {
    idToken = await user.getIdToken()
  } catch {
    return 'failed'
  }
  if (!idToken) return 'failed'
  if (idToken === state.last) return 'unchanged'

  try {
    const res = await doFetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) return 'failed'
  } catch {
    return 'failed'
  }

  // Only record it once the server has actually accepted it, so a failed write is retried
  // on the next emission rather than being deduped away.
  state.last = idToken
  return 'synced'
}
