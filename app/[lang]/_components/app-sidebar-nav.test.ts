/**
 * app/[lang]/_components/app-sidebar-nav.test.ts — 6-section role-filtered nav (IA-01, RED scaffold).
 *
 * Phase 6 regroups the flat 8-item sidebar into the SIX FIXED business sections
 * (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations ·
 * Analytics & Performance · System & Compliance) OVER the existing routes (no route
 * folders moved). Wave 4 extracts the section definitions + the role-filter into a
 * PURE, testable module `./app-sidebar-nav` (the `'use client'` component imports it),
 * so this logic-only test can assert the per-role visibility WITHOUT rendering JSX
 * (@testing-library/react is NOT installed — PATTERNS.md "No Analog Found").
 *
 * Per-role visibility (06-CONTEXT lock + RESEARCH sidebar example):
 *   - admin      → sees ALL 6 sections.
 *   - senior-coach → Home + Agents & Cohorts (+ Conversations escalations + coach
 *                    Analytics); NOT roles/erasure/integrations.
 *   - read-only  → EXACTLY Home + Analytics (usage) + KB version-history read;
 *                  NOT inventory/conversations/roles/erasure/integrations/dashboard.
 *   - the sidebar is UX-only; it is NEVER the security gate (the layout + rules are).
 *
 * RED-BY-DESIGN: `./app-sidebar-nav` does not exist yet (today the sidebar inlines a
 * flat NavItem[] with no SECTIONS export) → the dynamic import rejects / resolves to
 * undefined and these specs fail. Turns GREEN when Wave 4 extracts the pure module.
 *
 * Requirements: IA-01, RO-01 (least-privilege nav), Pitfall (nav-hiding ≠ authz).
 */

import { describe, it, expect } from 'vitest'
import type { Role } from '@/src/firebase/auth'

interface NavItemShape {
  key: string
  href: string
  roles: Role[]
}
interface SectionShape {
  key: string
  items: NavItemShape[]
}

const LANG = 'en'

/** The six FIXED section keys (must match the i18n SECTIONS[].key + nav labels). */
const EXPECTED_SECTION_KEYS = [
  'home',
  'knowledge',
  'agents',
  'conversations',
  'analytics',
  'system',
]

/**
 * Load the not-yet-existing Wave-4 pure nav module. Resolves to `{}` if the module
 * is absent so the assertions below fail cleanly — the intended Wave-0 red bar.
 */
async function loadNav(): Promise<{
  buildSections?: (lang: string) => SectionShape[]
  visibleSectionsForRole?: (role: Role, lang: string) => SectionShape[]
}> {
  // Variable specifier so TS does NOT statically resolve the (Wave-4) module that
  // does not exist yet — the import rejects at runtime → caller fails (the red bar).
  const specifier = './app-sidebar-nav'
  try {
    return (await import(/* @vite-ignore */ specifier)) as {
      buildSections?: (lang: string) => SectionShape[]
      visibleSectionsForRole?: (role: Role, lang: string) => SectionShape[]
    }
  } catch {
    return {}
  }
}

/** Collect the item keys a role can see across all visible sections. */
function visibleItemKeys(sections: SectionShape[]): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.key))
}

describe('app-sidebar 6-section IA — section definitions (IA-01)', () => {
  it('exposes exactly the six FIXED business sections in order', async () => {
    const { buildSections } = await loadNav()
    // RED today: buildSections is undefined (no SECTIONS export yet).
    const sections = buildSections!(LANG)
    expect(sections.map((s) => s.key)).toEqual(EXPECTED_SECTION_KEYS)
  })

  it('keeps existing route hrefs unchanged (no route folders moved)', async () => {
    const { buildSections } = await loadNav()
    const sections = buildSections!(LANG)
    const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href))
    // Regroup-over-existing-routes: hrefs are locale-prefixed, never `/admin/` or `/coach/`.
    for (const href of allHrefs) {
      expect(href).not.toMatch(/\/(admin|coach)\//)
      expect(href.startsWith(`/${LANG}`)).toBe(true)
    }
  })
})

describe('app-sidebar role-filter — per-role visibility (RO-01 least-privilege)', () => {
  it('admin sees all six sections', async () => {
    const { visibleSectionsForRole } = await loadNav()
    const sections = visibleSectionsForRole!('admin', LANG)
    expect(sections.map((s) => s.key)).toEqual(EXPECTED_SECTION_KEYS)
  })

  it('senior-coach sees Home + Agents but NOT system/roles/erasure', async () => {
    const { visibleSectionsForRole } = await loadNav()
    const sections = visibleSectionsForRole!('senior-coach', LANG)
    const keys = visibleItemKeys(sections)
    expect(keys).toContain('home')
    expect(keys).toContain('dashboard')
    expect(keys).not.toContain('roles')
    expect(keys).not.toContain('erasure')
    expect(keys).not.toContain('integrations')
  })

  it('read-only sees EXACTLY Home + Analytics(usage) + KB version-history; nothing else', async () => {
    const { visibleSectionsForRole } = await loadNav()
    // RED today: no read-only filtering exists. 'read-only' joins Role in Wave 1.
    const sections = visibleSectionsForRole!('read-only' as unknown as Role, LANG)
    const keys = visibleItemKeys(sections)

    // ALLOWED for read-only
    expect(keys).toContain('home')
    expect(keys).toContain('usage')

    // DENIED for read-only (least-privilege — these carry write/admin or PII)
    expect(keys).not.toContain('inventory')
    expect(keys).not.toContain('conversations')
    expect(keys).not.toContain('roles')
    expect(keys).not.toContain('erasure')
    expect(keys).not.toContain('integrations')
    expect(keys).not.toContain('dashboard')
  })
})

// ─── Phase-7 NAV-01: 8 net-new nav items, section placement + read-only blindness ──
//
// Phase 7 adds net-new nav items across 3 of the existing Phase-6 sections
// (D-25): cohorts + agentProfiles + coachAssignment → Agents & Cohorts; flags →
// Conversations & Escalations; auditLog + modelConfig + pdpaSettings → System &
// Compliance. (daysToFirstClose has NO nav row — its tile lives on /usage.)
//
// CRITICAL (D-24): read-only sees NONE of the 8 new items — Phase 7 adds NO new
// read-only-visible surface (preserves the LOCKED Phase-6 least-privilege allow-list).
// Coach-visible items (flags, agentProfiles) list ['admin','senior-coach'];
// the rest are ['admin']. Nav filtering is UX-only — the server gate is the boundary.
//
// RED-BY-DESIGN: these 8 keys are not in the nav model until 07-06 ships them.

// NOTE: 'daysToFirstClose' was REMOVED from the nav model (user IA dedup) — its
// aggregate tile lives ON the /usage page, so the standalone deep-link nav entry was
// redundant. The metric still renders on the usage dashboard; it just has no nav row.
const PHASE7_NAV_KEYS = [
  'cohorts',
  'agentProfiles',
  'coachAssignment',
  'flags',
  'auditLog',
  'modelConfig',
  'pdpaSettings',
] as const

const PHASE7_SECTION_PLACEMENT: Record<string, string> = {
  cohorts: 'agents',
  agentProfiles: 'agents',
  coachAssignment: 'agents',
  flags: 'conversations',
  auditLog: 'system',
  modelConfig: 'system',
  pdpaSettings: 'system',
}

/** Map item key → its containing section key for a given role's visible sections. */
function itemSectionMap(sections: SectionShape[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const section of sections) {
    for (const item of section.items) map[item.key] = section.key
  }
  return map
}

describe('Phase-7 nav — 8 net-new items, placement + read-only blindness (NAV-01 / D-25 / D-24)', () => {
  it('admin sees all net-new items, each under its D-25 section', async () => {
    const { visibleSectionsForRole } = await loadNav()
    const sections = visibleSectionsForRole!('admin', LANG)
    const map = itemSectionMap(sections)

    for (const key of PHASE7_NAV_KEYS) {
      expect(map[key]).toBe(PHASE7_SECTION_PLACEMENT[key])
    }
  })

  it('senior-coach sees the coach-visible items (flags, agentProfiles) but NOT the admin-only ones', async () => {
    const { visibleSectionsForRole } = await loadNav()
    const keys = visibleItemKeys(visibleSectionsForRole!('senior-coach', LANG))

    // Coach-visible (own-downline flags + agent profiles)
    expect(keys).toContain('flags')
    expect(keys).toContain('agentProfiles')

    // Admin-only Phase-7 surfaces — never visible to a coach
    expect(keys).not.toContain('cohorts')
    expect(keys).not.toContain('coachAssignment')
    expect(keys).not.toContain('auditLog')
    expect(keys).not.toContain('modelConfig')
    expect(keys).not.toContain('pdpaSettings')
  })

  it('read-only sees NONE of the 8 new Phase-7 items (D-24 — least-privilege LOCKED)', async () => {
    const { visibleSectionsForRole } = await loadNav()
    const keys = visibleItemKeys(visibleSectionsForRole!('read-only' as unknown as Role, LANG))

    for (const key of PHASE7_NAV_KEYS) {
      expect(keys).not.toContain(key)
    }
  })
})
