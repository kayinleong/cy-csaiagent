// proxy.ts — Next.js 16 Proxy (replaces middleware.ts in Next.js 16+)
// Source: node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
//         node_modules/next/dist/docs/01-app/02-guides/internationalization.md
//
// THREAT MODEL (T-01-18, T-01-19):
//   This proxy performs two things:
//   1. Locale-prefix redirect — any path without /en|/ms|/zh is redirected.
//   2. Optimistic auth check (detect obviously unauthenticated users).
//
//   IMPORTANT: This is NOT the real authorization boundary.
//   The HARD auth gate is `requireUser()` (adminAuth.verifyIdToken) on every
//   privileged Route Handler (01-04/01-12). Proxy-level checks are spoofable —
//   they provide UX convenience only, not security guarantees.
//
// Q2 RESOLUTION (next-intl v4 + proxy.ts):
//   next-intl v4 ships `createMiddleware` from 'next-intl/middleware'.
//   Its own docs show the `proxy` named export with `createMiddleware` called
//   inside — compatible with Next.js 16's proxy.ts convention.
//   We use createMiddleware(routing) for locale negotiation (Accept-Language,
//   cookie) and let next-intl handle the /en|/ms|/zh redirect logic.
//   See: https://next-intl.dev/docs/routing/middleware

import createMiddleware from 'next-intl/middleware'
import { routing } from '@/src/i18n/routing'

// next-intl createMiddleware handles:
//   - locale detection from Accept-Language header
//   - redirect of locale-less paths to /{locale}{pathname}
//   - locale cookie persistence
const handleI18nRouting = createMiddleware(routing)

/**
 * proxy — Next.js 16 Proxy entry point (named export per proxy.md convention).
 *
 * Applies locale routing via next-intl, then passes through.
 * No hard authentication decision is made here — see requireUser() in route handlers.
 */
export function proxy(request: import('next/server').NextRequest) {
  return handleI18nRouting(request)
}

// Alternatively accepted as default export too, but named export is canonical.
// Matcher: skip _next static, API routes, and files with a dot (favicon, etc.)
export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)', '/'],
}
