'use client'

/**
 * app/[lang]/_components/app-sidebar.tsx — role-filtered console navigation.
 *
 * Rendered by ConsoleShell on the dashboard / KB / inventory surfaces. The link
 * set is filtered by the verified role passed down from the route-group layout
 * (the layout is the security gate; this is UX only):
 *   - senior-coach → Dashboard, Chat
 *   - admin        → Dashboard, KB, Inventory, Chat
 *   - new-agent    → never reaches a console surface (Chat is its own shell)
 *
 * Active state is derived from the current pathname (locale-prefixed).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, MessageSquare, BookOpen, Building2 } from 'lucide-react'
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

interface NavItem {
  key: 'dashboard' | 'kb' | 'inventory' | 'chat'
  href: string
  icon: typeof LayoutDashboard
  roles: Role[]
}

interface AppSidebarProps {
  role: Role
  lang: string
}

export function AppSidebar({ role, lang }: AppSidebarProps) {
  const t = useTranslations('nav')
  const tApp = useTranslations('app')
  const pathname = usePathname()

  const items: NavItem[] = [
    { key: 'dashboard', href: `/${lang}/dashboard`, icon: LayoutDashboard, roles: ['senior-coach', 'admin'] },
    { key: 'kb', href: `/${lang}/kb`, icon: BookOpen, roles: ['admin'] },
    { key: 'inventory', href: `/${lang}/inventory`, icon: Building2, roles: ['admin'] },
    { key: 'chat', href: `/${lang}/chat`, icon: MessageSquare, roles: ['new-agent', 'senior-coach', 'admin'] },
  ]

  const visible = items.filter((item) => item.roles.includes(role))

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
          {tApp('name')}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('console')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
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
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {t('signedInAs', { role })}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
