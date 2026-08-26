'use client'

/**
 * app/[lang]/_components/session-token-sync.tsx — mounts the __session cookie refresher
 * (quick-kayinleong-059).
 *
 * Renders nothing. See ./sync-session-cookie.ts for what this is fixing and why; the logic
 * lives there so it can be tested without initialising a Firebase app.
 *
 * Mounted in app/[lang]/layout.tsx, which covers the sign-in page too — that is deliberate
 * and harmless: with no signed-in user the listener is a no-op, and it means a session that
 * is restored from IndexedDB on a cold tab repairs its cookie before the user navigates
 * anywhere that needs it.
 */

import { useEffect } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import { clientAuth } from '@/src/firebase/client'
import { syncSessionCookie, type SyncState } from './sync-session-cookie'

export function SessionTokenSync() {
  useEffect(() => {
    // Per-mount dedupe. onIdTokenChanged fires on sign-in, on sign-out, and on every
    // background refresh; only a token the server has not seen is worth a round trip.
    const state: SyncState = { last: '' }
    return onIdTokenChanged(clientAuth, (user) => {
      void syncSessionCookie(user, state, fetch)
    })
  }, [])

  return null
}
