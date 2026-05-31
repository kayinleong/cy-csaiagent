/**
 * src/ratelimit/window.ts — Rate-limit window math and budget constants.
 *
 * Defines:
 *   - Budget caps (request count + token count per window)
 *   - Window duration (daily rolling window)
 *   - `isWindowExpired(windowStart, now?)`: deterministic, clock-injectable check
 *
 * Kept pure (no Firestore calls) so it is fully unit-testable offline.
 * The Firestore reads/writes live in index.ts.
 *
 * Design:
 *   - WINDOW_MS: 24h daily window (simple, auditable)
 *   - REQUEST_CAP: max requests per agent per window
 *   - TOKEN_CAP: max tokens per agent per window (cost-DoS guard, T-01-20)
 *   - The clock is injectable (Date.now() by default) for deterministic tests.
 *
 * References: TSD §9, RESEARCH §Arch-Map rate-limiting row, D-02, QUAL-07.
 */

/** Duration of the rate-limit window in milliseconds (1 day). */
export const WINDOW_MS = 24 * 60 * 60 * 1000

/** Maximum API requests per agent per window. */
export const REQUEST_CAP = 100

/** Maximum tokens per agent per window (cost-DoS guard). */
export const TOKEN_CAP = 50_000

/**
 * Check whether a rate-limit window has expired.
 *
 * Pure function — no side effects, no Firestore. Injecting `nowMs` makes
 * window boundary tests deterministic.
 *
 * @param windowStart  The Date (or server timestamp) when the current window started.
 * @param nowMs        Optional: override for Date.now() (injection for tests).
 * @returns            `true` if the window has expired and the budget should reset.
 */
export function isWindowExpired(windowStart: Date | { toDate?: () => Date }, nowMs?: number): boolean {
  const now = nowMs ?? Date.now()

  // Handle Firestore Timestamp objects (toDate()) and plain Date objects
  let startMs: number
  if (windowStart instanceof Date) {
    startMs = windowStart.getTime()
  } else if (typeof (windowStart as { toDate?: () => Date }).toDate === 'function') {
    startMs = (windowStart as { toDate: () => Date }).toDate().getTime()
  } else {
    // Fallback: treat as a serialized number (serverTimestamp mock)
    startMs = Date.now() - WINDOW_MS - 1 // expired by default for unknown shapes
  }

  return now - startMs >= WINDOW_MS
}
