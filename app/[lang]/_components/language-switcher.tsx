'use client'

/**
 * app/[lang]/_components/language-switcher.tsx — console sidebar locale switcher.
 *
 * The app is `/[lang]/…` segment-routed (next-intl, locales en/ms/zh). Switching
 * language = navigate to the same path with the leading locale segment swapped,
 * and persist the choice in the NEXT_LOCALE cookie next-intl reads on the next
 * request (so locale-less entry points resolve to the chosen language too).
 *
 * Rendered inside <SidebarMenu> in the AppSidebar footer (icon-collapse + tooltip
 * behavior inherited). Language names are shown in their OWN language (English,
 * Bahasa Melayu, 中文) — endonyms are not translated.
 */

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Languages, Check } from 'lucide-react'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Supported locales (must match src/i18n/routing.ts). Labels are endonyms. */
const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'zh', label: '中文' },
] as const

interface LanguageSwitcherProps {
  lang: string
}

export function LanguageSwitcher({ lang }: LanguageSwitcherProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const router = useRouter()

  function switchTo(code: string) {
    if (code === lang) return

    // pathname is locale-prefixed (e.g. "/en/dashboard"). Swap the first segment
    // when it is a known locale; otherwise insert the locale at the front.
    const segments = pathname.split('/')
    if (segments.length > 1 && LOCALES.some((l) => l.code === segments[1])) {
      segments[1] = code
    } else {
      segments.splice(1, 0, code)
    }
    const next = segments.join('/') || `/${code}`

    // Navigate to the locale-swapped path. next-intl's proxy middleware detects
    // the new locale segment on the resulting request and persists the
    // NEXT_LOCALE cookie, so locale-less entry points resolve here too.
    router.push(next)
    router.refresh()
  }

  const currentLabel = LOCALES.find((l) => l.code === lang)?.label ?? lang

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={t('language')}>
            <Languages />
            <span>{currentLabel}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-40">
          {LOCALES.map((l) => (
            <DropdownMenuItem
              key={l.code}
              onClick={() => switchTo(l.code)}
              className="justify-between"
            >
              <span className={l.code === lang ? 'font-medium' : undefined}>{l.label}</span>
              {l.code === lang && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
