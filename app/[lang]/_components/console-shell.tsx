'use client'

/**
 * app/[lang]/_components/console-shell.tsx — sidebar layout for the coach/admin
 * console surfaces (dashboard, KB, inventory).
 *
 * Wraps children in the vendored shadcn SidebarProvider + AppSidebar + inset. The
 * role is the VERIFIED role resolved server-side by the route-group layout — this
 * component is presentation only. The mobile header exposes the sidebar trigger.
 */

import type { Role } from '@/src/firebase/auth'
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from './app-sidebar'

interface ConsoleShellProps {
  role: Role
  lang: string
  children: React.ReactNode
}

export function ConsoleShell({ role, lang, children }: ConsoleShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar role={role} lang={lang} />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
