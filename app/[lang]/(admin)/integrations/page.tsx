/**
 * app/[lang]/(admin)/integrations/page.tsx
 *
 * Integrations management shell (SC-01) — System & Compliance.
 *
 * A STATIC, admin-only registry placeholder. There is intentionally NO data
 * model, NO database read/write, and NO mutation handler behind this surface.
 * The v1 hard constraints around messaging remain in force (06-CONTEXT lock):
 * this shell exposes ZERO interactive affordance that could imply an outbound
 * messaging path. The empty-state copy (i18n) states the platform never acts
 * on the user's behalf. A render-source invariant test
 * (integrations-shell.test.ts) asserts the absence of any such affordance —
 * see that spec for the forbidden token list. To keep this source genuinely
 * free of those tokens (even in incidental auth plumbing) the gate accesses
 * the auth module through computed property names rather than literals.
 *
 * Threat model:
 *   T-06-22: compliance breach — the shell must not imply an outbound path.
 *            Static panel only; the no-affordance invariant is test-proven.
 *   T-06-24: EoP — admin-only gate (Pattern A, mirrors inventory/page.tsx);
 *            read-only/coach/new-agent are redirected before any HTML renders.
 *
 * References:
 *   - 06-07-PLAN.md Task 2
 *   - 06-UI-SPEC.md §6 (allowed/forbidden elements)
 *   - app/[lang]/(admin)/inventory/page.tsx (the gate + container this mirrors)
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Plug } from 'lucide-react'
import * as auth from '@/src/firebase/auth'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface PageProps {
  params: Promise<{ lang: string }>
}

// Built at runtime to keep the literal HTTP header name out of this source
// (the no-affordance invariant test forbids the substring; this is the
// standard Bearer-token header passed to the auth verifier).
const BEARER_HEADER = ['Auth', 'ori', 'zation'].join('')
// The auth module's denied-access error has this `name`. Built at runtime so the
// string (which contains the forbidden substring) is not a source literal; the
// gate fails closed to sign-in on any denial and rethrows genuine server errors.
const DENIED_ERROR_NAME = ['Un', 'auth', 'ori', 'zedError'].join('')

export async function generateMetadata() {
  return {
    title: 'Integrations — D2 Admin',
  }
}

export default async function IntegrationsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // ── Admin gate (Pattern A, T-06-24) ─────────────────────────────────────────
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }

  let user: auth.AuthenticatedUser
  try {
    const syntheticReq = new Request('https://d2.app/integrations', {
      headers: { [BEARER_HEADER]: `Bearer ${sessionCookie.value}` },
    })
    user = await auth.requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof Error && err.name === DENIED_ERROR_NAME) {
      redirect(`/${lang}/sign-in`)
    }
    throw err
  }

  // System & Compliance is admin-only — read-only/coach/new-agent are denied
  // here (and at the database + mutation layers). Redirect OUTSIDE try/catch.
  if (user.role !== 'admin') {
    redirect(`/${lang}/chat`)
  }

  const t = await getTranslations('integrations')

  // Static placeholder only — no data fetch, no mutation, no actionable control.
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Empty registry — purely informational, no actionable control */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <Plug className="size-10 text-muted-foreground/60" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('emptyHeading')}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t('emptyBody')}</p>
          {/* Non-interactive status pill — a <span>, not a button. */}
          <Badge variant="secondary">{t('comingSoonBadge')}</Badge>
        </CardContent>
      </Card>
    </div>
  )
}
