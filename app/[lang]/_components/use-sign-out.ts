'use client'

/**
 * app/[lang]/_components/use-sign-out.ts — the sign-out sequence, in one place
 * (quick-kayinleong-074).
 *
 * Extracted from sign-out-button.tsx so the chat header can offer sign-out too. The chat
 * surface renders no sidebar, and `SignOutButton` returns `<SidebarMenuItem>`, so it cannot
 * be dropped in — but copying the sequence into a second component is worse. Ending a
 * privileged session correctly is security-relevant, and two hand-maintained copies drift:
 * one gets a fix, the other quietly keeps signing people out halfway.
 *
 * The order matters and is preserved exactly:
 *   1. Clear the client (IndexedDB) auth state. Failure is swallowed — the server cookie
 *      below is what actually ends the privileged session.
 *   2. DELETE the server cookie. Failure is swallowed too; it is httpOnly and expires.
 *   3. Redirect to sign-in and refresh, so no RSC payload for the signed-in view survives
 *      in the router cache.
 *
 * The Firebase SDK is imported ON DEMAND here, not at module scope, so a surface that never
 * signs out does not pay for auth + app in its bundle. A chunk-load failure lands in the
 * same catch as a signOut() failure, which is why step 1 cannot be trusted alone.
 */

import { useTransition } from 'react'
import { useRouter, useParams } from 'next/navigation'

export interface SignOut {
  signOut: () => void
  isPending: boolean
}

export function useSignOut(): SignOut {
  const router = useRouter()
  const params = useParams()
  const lang = (params?.lang as string) ?? 'en'
  const [isPending, startTransition] = useTransition()

  function signOut() {
    startTransition(async () => {
      try {
        const [{ clientAuth }, { signOut: firebaseSignOut }] = await Promise.all([
          import('@/src/firebase/client'),
          import('firebase/auth'),
        ])
        await firebaseSignOut(clientAuth)
      } catch {
        // ignore — still clear the server cookie
      }
      try {
        await fetch('/api/auth/session', { method: 'DELETE' })
      } catch {
        // ignore — redirect regardless; the cookie is httpOnly + expires
      }
      router.push(`/${lang}/sign-in`)
      router.refresh()
    })
  }

  return { signOut, isPending }
}
