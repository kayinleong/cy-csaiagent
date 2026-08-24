/**
 * app/[lang]/(admin)/loading.tsx — Suspense fallback for every admin console page.
 *
 * quick-kayinleong-046 (Track MOTION, task 6). The app previously had ZERO
 * loading.tsx files, so every admin navigation blocked on verifyIdToken + a
 * Firestore read with no feedback at all.
 *
 * Scope note: a loading.tsx wraps the segment's *page*, not its own layout — so
 * this covers each page's Firestore reads. On client-side navigation between
 * sibling admin pages the (admin) layout is reused and its verifyIdToken does not
 * re-run, which is exactly the wait this fallback covers. Deliberately NOT added
 * at app/[lang]/ level: that boundary also wraps /[lang]/chat, which agents open
 * 100+ times a day and which does no auth or Firestore work — a skeleton there
 * would only ever flash.
 *
 * Shape mirrors the shared admin page shell (`container mx-auto max-w-4xl px-4
 * py-8` + `mb-8` header + content), so the skeleton does not lie about the layout
 * it is standing in for. The 180ms anti-flash delay and the reduced-motion
 * behaviour live on [data-slot='route-skeleton'] in app/globals.css.
 *
 * No copy: this file carries no translatable strings by design (Track LEADS owns
 * src/i18n/messages/*). An sr-only "Loading…" string is the one follow-up needed.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function AdminLoading() {
  return (
    <div
      data-slot="route-skeleton"
      role="status"
      aria-busy="true"
      className="container mx-auto max-w-4xl px-4 py-8"
    >
      {/* Page header: h1 (text-2xl) + subtitle (text-sm) */}
      <div className="mb-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-sm" />
      </div>

      {/* Toolbar / primary action row */}
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-24 shrink-0" />
      </div>

      {/* Content rows — the shape every admin surface resolves to (list or table) */}
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
