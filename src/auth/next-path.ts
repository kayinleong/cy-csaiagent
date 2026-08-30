/**
 * src/auth/next-path.ts — validate a post-sign-in redirect target
 * (quick-kayinleong-073).
 *
 * The sign-in page accepts `?next=` so an agent bounced off /chat lands back on /chat.
 * That parameter is attacker-controllable and is read BEFORE the visitor is authenticated,
 * which makes it the textbook open-redirect surface: a link to
 * `…/sign-in?next=https://evil.example/login` would hand a phished agent a convincing hop
 * immediately after a real sign-in.
 *
 * So this allows exactly one shape — a same-origin absolute path inside the app — and
 * returns null for everything else. The caller falls back to its role-based default.
 *
 * Pure and framework-free: used by the server gate, the sign-in form, and the client's
 * expired-session handler, so all three agree on what is safe.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

/** Locales the app serves; a `next` must live under one of them. */
const LOCALES = ['en', 'ms', 'zh'] as const

/** Longest `next` worth honouring — anything larger is not a real destination. */
const MAX_LENGTH = 512

/**
 * ASCII control characters, written as escapes so they are visible in review.
 *
 * A raw tab or newline inside the value can smuggle a scheme past a browser's URL parser
 * (`/<TAB>javascript:…` is a real bypass), so they are rejected outright, never stripped.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Return `raw` if it is a safe in-app path, else null.
 *
 * Rejects, deliberately:
 *   - absolute URLs (`https://evil.test/x`) — off-origin
 *   - protocol-relative (`//evil.test`) — a browser treats this as off-origin
 *   - backslash variants (`/\evil.test`) — some parsers normalise these to
 *     protocol-relative
 *   - anything not starting with `/` — a relative path can escape via `../`
 *   - paths outside the known locales — nothing else is a real destination
 *   - `/{lang}/sign-in` itself — that is a redirect loop
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null

  // Percent-encoding can hide a second slash or a control character from the checks below.
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // A malformed escape sequence is not a destination anyone meant to reach.
    return null
  }

  if (value.length > MAX_LENGTH) return null
  if (CONTROL_CHARS.test(value)) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (value.includes('\\')) return null

  const [pathname] = value.split(/[?#]/)
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (!(LOCALES as readonly string[]).includes(segments[0])) return null
  if (segments[1] === 'sign-in') return null

  return value
}

/**
 * Build the sign-in URL that returns the visitor to `currentPath`.
 *
 * `currentPath` comes from the server, which knows where the visitor actually is, so it is
 * trusted here; it is encoded once so a query string on the original path survives intact.
 */
export function signInUrlFor(lang: string, currentPath: string): string {
  return `/${lang}/sign-in?next=${encodeURIComponent(currentPath)}`
}
