'use client'

/**
 * app/[lang]/_components/nav-pending.tsx — inline pending affordance for a nav <Link>.
 *
 * quick-kayinleong-047. Clicking a console nav item left the user on the OLD page for
 * a second or more with no feedback at all, so the app felt unresponsive or broken.
 *
 * Why loading.tsx did not already cover this: a `loading.tsx` fallback only renders for
 * the segment being ENTERED. Every console page shares the `(admin)` / `(coach)` route
 * group boundary, so navigating between two sibling pages (e.g. /kb → /users) never
 * re-suspends that boundary — there is no fallback to show, and the router blocks on the
 * server round-trip while the old page stays painted. The Next docs call this out as the
 * exact case for `useLinkStatus`: "the destination route is dynamic and doesn't include a
 * loading.js file that would allow an instant navigation"
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md).
 * Every console route is dynamic (`ƒ` in the build output).
 *
 * `useLinkStatus` MUST be called from a DESCENDANT of the <Link>, which is why this is a
 * separate component rather than a hook call inside app-sidebar.tsx.
 *
 * Motion (per RESEARCH-motion.md): the indicator is delayed ~180ms before it fades in, so
 * a fast/prefetched navigation never flashes a spinner — the single most common
 * loading-affordance smell the `review-animations` skill flags. It animates opacity and
 * transform only (compositor-only), and the global prefers-reduced-motion guard in
 * globals.css collapses the spin to a static glyph while leaving it visible.
 *
 * aria-hidden matches the pattern in the Next docs' own example: this is a decorative
 * affordance, and the navigation itself announces the new page to assistive tech.
 */

import { useLinkStatus } from 'next/link'
import { Loader2Icon } from 'lucide-react'

export function NavPending() {
  const { pending } = useLinkStatus()

  if (!pending) return null

  return (
    <Loader2Icon
      data-slot="nav-pending"
      aria-hidden="true"
      className="ml-auto size-3.5 shrink-0"
    />
  )
}
