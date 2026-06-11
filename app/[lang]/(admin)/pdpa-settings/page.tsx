/**
 * app/[lang]/(admin)/pdpa-settings/page.tsx — PDPA-settings display (static RSC,
 * PDPA-01, D-25 System & Compliance).
 *
 * Admin-ONLY (D-19/D-24: 'read-only' is NOT in the allow-list → denied; widening
 * to read-only is an open Derek decision, not assumed here). A STATIC, read-only
 * policy display sourced ENTIRELY from src/pdpa/policy-constants.ts plus a link
 * to the existing admin erasure flow. ZERO editable inputs / knobs (D-18) — there
 * is no form, no Server Action, no toggle on this surface.
 *
 * Gate: requireRole({ allowed: ['admin'] }) — the single tested gate helper.
 *
 * References:
 *   - PDPA-01, D-18 (static, zero knobs), D-19/D-24 (admin-only)
 *   - src/pdpa/policy-constants.ts (single source for the display)
 *   - 07-UI-SPEC.md Surface 7 (card + dl-style rows + "Open erasure flow" link)
 *   - erasure/page.tsx (the link target — existing Phase-5 surface)
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PDPA_POLICY, PDPA_ERASURE_ROUTE } from '@/src/pdpa/policy-constants'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata() {
  return {
    title: 'PDPA Settings — D2 Admin',
  }
}

export default async function PdpaSettingsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-19/D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  const t = await getTranslations('adminPdpa')

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('policyTitle')}</CardTitle>
          <CardDescription>{t('policyDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Static definition list — read-only, no editable inputs (D-18). */}
          <dl className="divide-y divide-border">
            {PDPA_POLICY.map((item) => (
              <div
                key={item.key}
                className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4"
              >
                <dt className="text-sm font-medium text-muted-foreground">
                  {t(`policy.${item.key}`)}
                </dt>
                <dd className="text-sm sm:col-span-2">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Link to the existing erasure flow — the only interactive affordance. */}
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href={`/${lang}/${PDPA_ERASURE_ROUTE}`}>{t('openErasureCta')}</Link>
        </Button>
      </div>
    </div>
  )
}
