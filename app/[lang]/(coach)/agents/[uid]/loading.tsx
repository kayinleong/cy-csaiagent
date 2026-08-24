/**
 * app/[lang]/(coach)/agents/[uid]/loading.tsx — fallback for the agent detail page.
 *
 * quick-kayinleong-046 (Track MOTION, task 6). The second eligible list->detail
 * descent from RESEARCH-motion §1 (agents -> agents/[uid]); see the sibling file
 * app/[lang]/(admin)/kb/[docId]/loading.tsx for why the descent gets a correctly
 * shaped fallback rather than a shared-element morph.
 *
 * Timing + reduced-motion behaviour live on [data-slot='route-skeleton'] in
 * app/globals.css. No translatable copy by design.
 */

import { Skeleton } from '@/components/ui/skeleton'

export default function AgentDetailLoading() {
  return (
    <div
      data-slot="route-skeleton"
      role="status"
      aria-busy="true"
      className="container mx-auto max-w-4xl px-4 py-8"
    >
      {/* Back link */}
      <div className="mb-6">
        <Skeleton className="h-4 w-36" />
      </div>

      {/* Agent header: name + meta */}
      <div className="mb-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      {/* Journey / progress panel */}
      <Skeleton className="mb-8 h-28 w-full rounded-lg" />

      {/* Activity rows */}
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
