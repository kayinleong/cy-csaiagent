/**
 * app/[lang]/_components/app-sidebar-nav.ts — the PURE, testable navigation model
 * for the 6-section console sidebar (IA-01).
 *
 * Phase 6 regroups the previously-flat 8-item sidebar into the SIX FIXED business
 * sections — over the EXISTING routes (no route folders moved, hrefs unchanged):
 *
 *   1. Home                        2. Knowledge Management
 *   3. Agents & Cohorts            4. Conversations & Escalations
 *   5. Analytics & Performance     6. System & Compliance
 *
 * This module owns ONLY the data + the pure role-filter so it is unit-testable
 * WITHOUT rendering JSX (@testing-library/react is not installed). The
 * `'use client'` `<AppSidebar>` component imports `buildSections` / the icon map
 * and renders one `SidebarGroup` per VISIBLE section.
 *
 * SECURITY (T-06-15): this role-filter is UX ONLY — it is NEVER the authorization
 * gate. The real boundary is the server-side route-group `layout.tsx` redirect
 * (Wave 3) + the Firestore rules (Wave 2). Hiding a nav item is never the gate;
 * read-only denial is proven by an integration/rules test, not by an absent link.
 *
 * Requirements: IA-01 (six fixed sections), RO-01 (least-privilege nav), I18N-01.
 */

import {
  Home,
  BookOpen,
  Building2,
  Users,
  MessagesSquare,
  BarChart3,
  ShieldCheck,
  Plug,
  Trash2,
  Boxes,
  UserCircle,
  UserCog,
  Flag,
  ScrollText,
  SlidersHorizontal,
  ShieldAlert,
} from 'lucide-react'
import type { Role } from '@/src/firebase/auth'

/** lucide icon component type (matches the vendored SidebarMenuButton usage). */
type IconComponent = typeof Home

/** The translatable nav-item keys (resolve under the `nav` i18n namespace). */
export type NavItemKey =
  | 'home'
  | 'kb'
  | 'inventory'
  | 'dashboard'
  | 'conversations'
  | 'usage'
  | 'roles'
  | 'integrations'
  | 'erasure'
  // ── Phase-7 net-new surfaces (NAV-01 / D-25) ──────────────────────────────
  | 'cohorts'
  | 'agentProfiles'
  | 'coachAssignment'
  | 'flags'
  | 'auditLog'
  | 'modelConfig'
  | 'pdpaSettings'

/** The six FIXED section keys (match the `nav.section*` i18n labels + the test). */
export type SectionKey =
  | 'home'
  | 'knowledge'
  | 'agents'
  | 'conversations'
  | 'analytics'
  | 'system'

export interface NavItem {
  key: NavItemKey
  href: string
  icon: IconComponent
  /** Roles that may SEE this item — UX filtering only, never the auth gate. */
  roles: Role[]
}

export interface Section {
  key: SectionKey
  /** i18n key for the section label, e.g. `nav.sectionHome`. */
  labelKey: string
  items: NavItem[]
}

/**
 * Build the full 6-section model for a given locale. Hrefs are byte-identical to
 * the existing v1 routes — this is a presentation regroup, NOT a route move. No
 * `/admin/` or `/coach/` route-group segment ever appears in an href (those are
 * Next.js route GROUPS, which never surface in the URL — Pitfall 1).
 *
 * The `dashboard` route surfaces the downline list, the stall inbox, and the coach
 * funnel/analytics panels on ONE page, reached via the single `dashboard` entry under
 * Agents & Cohorts. The earlier duplicate deep-link entries (Escalations → `#stalls`,
 * Coach Analytics → `/dashboard`) and the `daysToFirstClose` deep-link (→ the tile on
 * `/usage`) were removed from the nav per user IA feedback — each pointed at a page
 * already reachable elsewhere, so the nav now has one entry per destination page.
 */
export function buildSections(lang: string): Section[] {
  return [
    {
      key: 'home',
      labelKey: 'sectionHome',
      items: [
        { key: 'home', href: `/${lang}`, icon: Home, roles: ['admin', 'senior-coach', 'read-only'] },
      ],
    },
    {
      key: 'knowledge',
      labelKey: 'sectionKnowledge',
      items: [
        // read-only lands on the read-only version-history viewer; admin gets full edit.
        { key: 'kb', href: `/${lang}/kb`, icon: BookOpen, roles: ['admin', 'read-only'] },
        { key: 'inventory', href: `/${lang}/inventory`, icon: Building2, roles: ['admin'] },
      ],
    },
    {
      key: 'agents',
      labelKey: 'sectionAgents',
      items: [
        { key: 'dashboard', href: `/${lang}/dashboard`, icon: Users, roles: ['admin', 'senior-coach'] },
        // ── Phase-7 (D-25): cohorts (admin), agent profiles index (admin + coach),
        // coach-assignment (admin). read-only excluded from all (D-24).
        { key: 'cohorts', href: `/${lang}/cohorts`, icon: Boxes, roles: ['admin'] },
        // agentProfiles → the index route app/[lang]/(coach)/agents/page.tsx (07-03);
        // rows deep-link to agents/[uid]. NOT the [uid]-only drill-in.
        { key: 'agentProfiles', href: `/${lang}/agents`, icon: UserCircle, roles: ['admin', 'senior-coach'] },
        { key: 'coachAssignment', href: `/${lang}/coach-assignment`, icon: UserCog, roles: ['admin'] },
      ],
    },
    {
      key: 'conversations',
      labelKey: 'sectionConversations',
      items: [
        { key: 'conversations', href: `/${lang}/conversations`, icon: MessagesSquare, roles: ['admin'] },
        // ── Phase-7 (D-25): flagged-conversation review queue (admin + own-downline
        // coach). read-only excluded (D-24).
        // NOTE: the stall-inbox deep-link ('escalations' → /dashboard#stalls) was removed
        // from the nav — it pointed at the same page as the Agents→dashboard entry (the
        // dashboard surface already shows the stall inbox). Dedup per user IA feedback.
        { key: 'flags', href: `/${lang}/flags`, icon: Flag, roles: ['admin', 'senior-coach'] },
      ],
    },
    {
      key: 'analytics',
      labelKey: 'sectionAnalytics',
      items: [
        { key: 'usage', href: `/${lang}/usage`, icon: BarChart3, roles: ['admin', 'read-only'] },
        // NOTE: 'coachAnalytics' (→ /dashboard) and 'daysToFirstClose'
        // (→ /usage#days-to-first-close) were removed from the nav — both deep-linked
        // into pages already reachable elsewhere (the dashboard via Agents, and the
        // days-to-first-close tile lives ON the usage page). Dedup per user IA feedback.
      ],
    },
    {
      key: 'system',
      labelKey: 'sectionSystem',
      items: [
        { key: 'roles', href: `/${lang}/roles`, icon: ShieldCheck, roles: ['admin'] },
        // Integrations shell route is built in plan 06-07; the nav entry references it now.
        { key: 'integrations', href: `/${lang}/integrations`, icon: Plug, roles: ['admin'] },
        { key: 'erasure', href: `/${lang}/erasure`, icon: Trash2, roles: ['admin'] },
        // ── Phase-7 (D-25): audit-log viewer, model-config, PDPA settings — all
        // admin-only (D-24: read-only excluded).
        { key: 'auditLog', href: `/${lang}/audit-log`, icon: ScrollText, roles: ['admin'] },
        { key: 'modelConfig', href: `/${lang}/model-config`, icon: SlidersHorizontal, roles: ['admin'] },
        { key: 'pdpaSettings', href: `/${lang}/pdpa-settings`, icon: ShieldAlert, roles: ['admin'] },
      ],
    },
  ]
}

/**
 * The PURE role-filter (the testable seam). Returns the sections with each
 * section's items filtered to those the role may SEE, and any section with ZERO
 * visible items DROPPED entirely (no empty label is rendered — UI-SPEC §1).
 *
 * read-only sees EXACTLY: Home + Knowledge(kb viewer) + Analytics(usage).
 * senior-coach sees: Home + Agents(dashboard, agentProfiles) + Conversations(flags) —
 *   never roles/erasure/integrations/inventory. (The dashboard page still carries the
 *   stall inbox + coach analytics; their duplicate nav deep-links were removed.)
 * admin sees all six sections with all their items.
 *
 * UX ONLY — not the security gate (see file header / T-06-15).
 */
export function visibleSectionsForRole(role: Role, lang: string): Section[] {
  return buildSections(lang)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0)
}
