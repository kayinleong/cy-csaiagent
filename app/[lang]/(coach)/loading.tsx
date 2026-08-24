/**
 * app/[lang]/(coach)/loading.tsx — Suspense fallback for the senior-coach console.
 *
 * quick-kayinleong-046 (Track MOTION, task 6). Same rationale as
 * app/[lang]/(admin)/loading.tsx: the coach pages are async server components
 * doing Firestore reads with no prior loading feedback.
 *
 * Shape mirrors the dashboard shell (`container mx-auto max-w-6xl px-4 py-8`,
 * header + metric row + sectioned tables) rather than the narrower admin shell.
 * Timing + reduced-motion behaviour live on [data-slot='route-skeleton'] in
 * app/globals.css. No translatable copy by design.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function CoachLoading() {
  return (
    <div
      data-slot="route-skeleton"
      role="status"
      aria-busy="true"
      className="container mx-auto max-w-6xl px-4 py-8"
    >
      {/* Page header */}
      <div className="mb-8">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-full max-w-sm" />
      </div>

      {/* Metrics row */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>

      {/* Two sectioned tables (downline, stall inbox) */}
      <div className="grid gap-8">
        {Array.from({ length: 2 }, (_, section) => (
          <section key={section}>
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
