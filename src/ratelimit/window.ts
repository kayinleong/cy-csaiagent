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

/**
 * Maximum tokens per agent per window (cost-DoS guard).
 *
 * Sized from MEASURED usage, not guessed (quick-kayinleong-050). Over 58 real recorded
 * turns in `usageEvents`:
 *   mean 5,812 · p50 3,422 · p90 14,703 · p99 23,455 tokens per turn
 *   (Finder is the costly pillar at mean 7,209; Coach 3,273.)
 *
 * The previous cap of 50_000 therefore bought roughly EIGHT average turns, and 4 of the 8
 * real user-days on record were already at or over it. Two separate testers hit the wall
 * mid-session — the second after about ten questions. quick-049 added an admin reset as an
 * escape hatch, but an escape hatch that has to be pulled on half of all working days is
 * not a working limit.
 *
 * 300_000 ≈ 50 turns at the mean, ≈ 20 even at the p90 — a full working day for a pilot
 * agent — while still bounding a runaway loop, which is what this guard exists for
 * (T-01-20).
 *
 * NOTE: `app/api/chat/route.ts` decrements `final.usage.totalTokens`, which is the LAST
 * STEP only, so the limiter still undercounts multi-step turns (documented as a
 * REGRESSION-NOTE at that call site). That errs generous — the safe direction — and was
 * deliberately left alone when this cap was raised, so the two changes could not compound.
 */
export const TOKEN_CAP = 300_000

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
