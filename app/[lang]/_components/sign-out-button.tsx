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
 * ⚡ PERF — quick-kayinleong-046. The Firebase web SDK is imported DYNAMICALLY inside
 * the click handler, never at module scope. WHY: this file is the single transitive
 * edge that put Firebase on EVERY console page —
 *     sign-out-button.tsx → app-sidebar.tsx → console-shell.tsx
 * and ConsoleShell is rendered by (admin)/layout.tsx, (coach)/layout.tsx and
 * [lang]/page.tsx. Because `@/src/firebase/client` initializes app + auth + firestore
 * + storage at module scope, those four collapse into ONE ~461 KB client chunk, so a
 * page like (admin)/pdpa-settings shipped 461 KB of Firebase while importing zero
 * Firebase itself (762 KB total, ~60% waste). Deferring the import to the handler
 * removes that chunk from the FIRST LOAD of every console route; it is fetched only
 * when a user actually signs out.
 *
 * ⚠️ DO NOT re-add a module-scope `import … from 'firebase/*'` or
 * `from '@/src/firebase/client'` to this file (or to app-sidebar / console-shell) —
 * that silently regresses every console route by ~461 KB.
 *
 * Auth semantics are UNCHANGED: the same signOut() runs first, on the same Auth
 * instance (`initClient()` guards on getApps().length, so the dynamic import resolves
 * to the same singleton the chat/sign-in surfaces use), failures are still swallowed,
 * and the server cookie is still deleted afterwards. If the chunk itself fails to load
 * (offline), the catch below still falls through to the cookie deletion — the
 * fail-safe sign-out contract is preserved.
 *
 * SECURITY: never logs the session cookie / token. A client signOut failure is
 * swallowed so the server cookie is still cleared (fail-safe sign-out).
 */

import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useSignOut } from './use-sign-out'

export function SignOutButton() {
  const t = useTranslations('nav')
  // The sequence itself lives in useSignOut (quick-kayinleong-074) so the chat header can
  // offer sign-out without a second copy of it.
  const { signOut, isPending } = useSignOut()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={signOut} disabled={isPending} tooltip={t('signOut')}>
        <LogOut />
        <span>{t('signOut')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
