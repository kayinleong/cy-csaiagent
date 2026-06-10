/**
 * app/[lang]/_lib/require-role.ts — centralized server-side role gate (RO-01).
 *
 * Factors out the verbatim Pattern A gate that is copy-pasted across every gated
 * page and route-group layout (06-PATTERNS.md "Pattern A"; the ~24 role-branch sites
 * in 06-RESEARCH.md "Role-branch sites"). Routing all gates through ONE tested helper
 * lowers the risk that a read-only edit misses a site (Pitfall 4) and keeps the
 * server-side denial of the read-only role in a single, regression-covered place.
 *
 * THIS IS A SHELL HELPER (lives under app/). Per the core/shell split (CLAUDE.md):
 *   - app/ MAY import from src/ (this file imports requireUser from src/firebase/auth).
 *   - src/ MUST NEVER import from app/ — so this helper is consumed by RSC pages/layouts
 *     under app/ only, never by the portable core.
 *
 * Security invariants:
 *   - The role is read from the VERIFIED token (via requireUser → verifyIdToken) ONLY,
 *     never from args/body (T-06-04 Spoofing/EoP). The caller passes the allow-list, not
 *     the role.
 *   - Gate fails CLOSED: a non-Unauthorized error from requireUser is rethrown, not
 *     swallowed into a default-allow.
 *
 * Pitfall 6 (CRITICAL): redirect() throws NEXT_REDIRECT. The role is resolved INSIDE the
 * try/catch; EVERY redirect() is called OUTSIDE it (mirrors app/[lang]/page.tsx:6-8). A
 * redirect inside the try that catches requireUser errors would swallow the NEXT_REDIRECT.
 *
 * Next 16 gotchas: cookies() is async — awaited (CLAUDE.md / AGENTS.md).
 *
 * Usage (Wave 3 will rewire existing gates through this; no gate is rewired yet):
 *   const user = await requireRole({ lang, allowed: ['admin'] })                 // admin-only
 *   const user = await requireRole({ lang, allowed: ['admin', 'read-only'] })    // analytics
 *   const user = await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  requireUser,
  UnauthorizedError,
  type AuthenticatedUser,
  type Role,
} from '@/src/firebase/auth'

export interface RequireRoleOptions {
  /** Active locale segment — used to build the sign-in / fallback redirect paths. */
  lang: string
  /** Roles permitted on this surface. The verified role must be one of these. */
  allowed: Role[]
  /**
   * Where to send a verified-but-disallowed caller. Defaults to the chat surface
   * (`/${lang}/chat`) to match the existing Pattern A gate (inventory/page.tsx:69).
   * Read-only surfaces typically pass `/${lang}` (Home).
   */
  fallback?: string
}

/**
 * Resolve the verified user and assert their role is in `allowed`.
 *
 * @returns the AuthenticatedUser when allowed.
 * @remarks On a missing/invalid session or a disallowed role this NEVER returns —
 *   it calls redirect(), which throws NEXT_REDIRECT (caught by the Next runtime).
 */
export async function requireRole({
  lang,
  allowed,
  fallback,
}: RequireRoleOptions): Promise<AuthenticatedUser> {
  // ── Read the session cookie (Next 16: cookies() is async) ──────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  // No cookie → not signed in. redirect() is OUTSIDE any try/catch (Pitfall 6).
  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  // ── Verify the token; resolve the role INSIDE the try/catch (Pitfall 6) ────
  // We only set redirect *intent* here — we do NOT call redirect() inside the
  // try, or its NEXT_REDIRECT would be swallowed by this very catch.
  let user: AuthenticatedUser
  let unauthorized = false
  try {
    const syntheticReq = new Request('https://d2.app/_gate/require-role', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      unauthorized = true
    } else {
      // Fail closed: an unexpected error is rethrown, never swallowed into allow.
      throw err
    }
  }

  // ── All redirect() calls happen OUTSIDE the try/catch (Pitfall 6) ──────────
  if (unauthorized) {
    redirect(`/${lang}/sign-in`)
  }

  // `user` is definitely assigned here: the only paths that skip assignment set
  // `unauthorized` (→ redirected above) or rethrow.
  if (!allowed.includes(user!.role)) {
    redirect(fallback ?? `/${lang}/chat`)
  }

  return user!
}
