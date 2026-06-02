/**
 * app/[lang]/(coach)/layout.tsx — Senior-coach route group shell.
 *
 * This layout wraps all pages in the (coach) route group. It does NOT enforce
 * the role gate here — each individual page calls requireUser and redirects
 * if the role is insufficient. This keeps the pattern consistent with (admin).
 *
 * The layout provides a minimal shell that could be extended with a sidebar or
 * nav once more coach pages are added in Phase 3.
 *
 * References:
 *   - app/[lang]/(admin)/kb/page.tsx — the role-gate + RSC pattern to mirror
 *   - AUTH-06 (coach sees only downline)
 *   - D-10 (single focused dashboard)
 */

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  )
}
