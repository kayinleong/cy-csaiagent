'use client'

/**
 * app/[lang]/_components/route-progress.tsx — global top progress bar for a pending
 * <Link> navigation.
 *
 * quick-kayinleong-048, completing the nav-feedback work started in quick-047.
 *
 * 047 added an inline spinner to the sidebar nav items (nav-pending.tsx). That is not
 * enough on its own, for two reasons:
 *   1. On mobile the sidebar is a Sheet (components/ui/sidebar.tsx uses useIsMobile +
 *      Sheet), so it is CLOSED during navigation — the inline spinner is invisible on a
 *      phone, and D2 agents are on phones.
 *   2. app/[lang]/_components/home-surface.tsx has its own <Link>s (the dashboard links
 *      and the quick-action launcher tiles) that never had any indicator at all.
 * A viewport-anchored bar is visible wherever the click came from.
 *
 * Rendered through a PORTAL to document.body, deliberately. `position: fixed` resolves
 * against the nearest ancestor that establishes a containing block — any ancestor with a
 * transform, filter, or will-change does — and the mobile Sheet animates with a
 * transform. Inside it, a plain fixed element would anchor to the drawer instead of the
 * viewport. The portal sidesteps that entirely.
 *
 * `useLinkStatus` must be called from a DESCENDANT of the <Link>, so this component is
 * placed inside each Link rather than mounted once at the layout level. Only the clicked
 * link is ever pending, so only one bar can be on screen.
 *
 * Motion (RESEARCH-motion.md): indeterminate, because the duration is genuinely unknown
 * — a sliding segment rather than a width-to-90% fake, which implies progress the app
 * cannot actually measure. Delayed ~180ms so a fast or prefetched navigation never
 * flashes it. The container animates opacity and the ::after segment animates transform,
 * kept on separate elements so the two never contend for the same property (the bug I
 * shipped and caught in 047's first draft).
 */

import { useLinkStatus } from 'next/link'
import { createPortal } from 'react-dom'

export function RouteProgress() {
  const { pending } = useLinkStatus()

  if (!pending || typeof document === 'undefined') return null

  return createPortal(
    <div data-slot="route-progress" aria-hidden="true" />,
    document.body,
  )
}
