'use client'

/**
 * app/[lang]/_components/sign-out-button.tsx — console sidebar sign-out control.
 *
 * Signs the user out of BOTH halves of the session (AUTH-05 defense-in-depth):
 *   1. signOut(clientAuth) — clears the Firebase web SDK LOCAL persistence (IndexedDB).
 *   2. DELETE /api/auth/session — clears the httpOnly server session cookie.
 * Then redirects to the locale sign-in page and refreshes RSC state.
 *
 * Rendered inside <SidebarMenu> in the AppSidebar footer, so it inherits the
 * sidebar's icon-collapse + tooltip behavior like the nav items above it.
 *
 * SECURITY: never logs the session cookie / token. A client signOut failure is
 * swallowed so the server cookie is still cleared (fail-safe sign-out).
 */

import { useTransition } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { clientAuth } from '@/src/firebase/client'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

export function SignOutButton() {
  const t = useTranslations('nav')
  const router = useRouter()
  const params = useParams()
  const lang = (params?.lang as string) ?? 'en'
  const [isPending, startTransition] = useTransition()

  function handleSignOut() {
    startTransition(async () => {
      // Clear the client (IndexedDB) auth state. Swallow failure — the server
      // cookie deletion below is what actually ends the privileged session.
      try {
        await signOut(clientAuth)
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

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={handleSignOut} disabled={isPending} tooltip={t('signOut')}>
        <LogOut />
        <span>{t('signOut')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
