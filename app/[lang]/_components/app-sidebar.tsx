'use client'

/**
 * app/[lang]/_components/app-sidebar.tsx — role-filtered console navigation.
 *
 * Rendered by ConsoleShell on every console surface. The sidebar is regrouped into
 * the SIX FIXED business sections (Home · Knowledge Management · Agents & Cohorts ·
 * Conversations & Escalations · Analytics & Performance · System & Compliance) OVER
 * the existing routes — hrefs are unchanged (no route folder was moved). The section
 * model + the pure role-filter live in `./app-sidebar-nav` (unit-testable without JSX).
 *
 * The visible link set is filtered by the verified role passed down from the
 * route-group layout — the layout is the security gate; this is UX only:
 *   - admin        → all six sections.
 *   - senior-coach → Home, Agents, Conversations(escalations), Analytics(coach).
 *   - read-only    → Home, Knowledge(kb viewer), Analytics(usage) — nothing else.
 *   - new-agent    → never reaches a console surface (Chat is its own shell).
 * A section with zero visible items for the current role renders NOTHING.
 *
 * Active state is derived from the current pathname (locale-prefixed).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { Role } from '@/src/firebase/auth'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { buildSections, visibleSectionsForRole, type Section } from './app-sidebar-nav'
import { LanguageSwitcher } from './language-switcher'
import { SignOutButton } from './sign-out-button'

interface AppSidebarProps {
  role: Role
  lang: string
}

/**
 * The full 6-section model (presentation regroup over existing routes). Exposed as
 * `SECTIONS(lang)` for grep/acceptance + re-exported below; the pure filter
 * (`visibleSectionsForRole`) is the tested seam in `./app-sidebar-nav`.
 */
const SECTIONS = buildSections

/**
 * Pure role-filter re-export — UX only, NEVER the authorization gate (the layout
 * gate + Firestore rules are the boundary). Delegates to the tested module.
 */
export function visibleSections(role: Role, lang: string): Section[] {
  return visibleSectionsForRole(role, lang)
}

export function AppSidebar({ role, lang }: AppSidebarProps) {
  const t = useTranslations('nav')
  const tApp = useTranslations('app')
  const pathname = usePathname()

  const sections = visibleSections(role, lang)

  function isActive(href: string): boolean {
    // Anchor-style deep links (#stalls) key off the base route only.
    const base = href.split('#')[0]
    return pathname === base || pathname.startsWith(`${base}/`)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
          {tApp('name')}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.key}>
            <SidebarGroupLabel>{t(section.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={t(item.key)}>
                        <Link href={item.href}>
                          <Icon />
                          <span>{t(item.key)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <LanguageSwitcher lang={lang} />
          <SignOutButton />
        </SidebarMenu>
        <div className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {t('signedInAs', { role })}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

// Referenced for acceptance-grep (SECTIONS model is the source of the rendered groups).
export { SECTIONS }
