/**
 * app/[lang]/(admin)/kb/[docId]/loading.tsx — fallback for the KB doc detail page.
 *
 * quick-kayinleong-046 (Track MOTION, task 6). This is one of the two eligible
 * list->detail descents identified in RESEARCH-motion §1 (kb -> kb/[docId]). React
 * <ViewTransition> is off the table (bare react@19.2.4 does not export it and it
 * breaks Vitest), and a browser view transition cannot be driven from CSS alone on
 * a Next client-side navigation — so the descent's feedback is this correctly
 * shaped fallback instead of a shared-element morph.
 *
 * The group-level (admin)/loading.tsx would otherwise stand in here with a
 * list-shaped skeleton, which "lies about the shape" of a detail page. Timing +
 * reduced-motion behaviour live on [data-slot='route-skeleton'] in globals.css.
 * No translatable copy by design.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function KbDocLoading() {
  return (
    <div
      data-slot="route-skeleton"
      role="status"
      aria-busy="true"
      className="container mx-auto max-w-4xl px-4 py-8"
    >
      {/* Back link */}
      <div className="mb-6">
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Doc header: title + meta line + id line */}
      <div className="mb-8">
        <Skeleton className="h-7 w-full max-w-md" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      {/* Version history rows */}
      <section className="mb-10">
        <Skeleton className="mb-3 h-5 w-40" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </section>

      {/* Body */}
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  )
}
