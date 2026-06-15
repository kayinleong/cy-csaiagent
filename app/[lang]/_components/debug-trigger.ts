/**
 * app/[lang]/_components/debug-trigger.ts — easter-egg unlock logic for the debug sidebar.
 *
 * Pure (no React/DOM imports) so it is node-testable. The DebugSidebar mounts a
 * window keydown listener and uses isUnlockKeypress() to decide whether a press
 * counts toward the unlock burst — pressing the unlock key DEBUG_UNLOCK_COUNT
 * times within rolling DEBUG_UNLOCK_WINDOW_MS gaps reveals the panel.
 */

/** The key that unlocks the debug sidebar. */
export const DEBUG_UNLOCK_KEY = 'e'

/** Number of presses required to unlock. */
export const DEBUG_UNLOCK_COUNT = 5

/** Max gap (ms) between presses before the burst counter resets. */
export const DEBUG_UNLOCK_WINDOW_MS = 1500

/** Minimal shape we read off a keydown target — keeps this DOM-free for tests. */
export interface KeypressTarget {
  tagName?: string
  isContentEditable?: boolean
}

/**
 * True when a keydown should count toward the unlock burst: the unlock key was
 * pressed (case-insensitive) AND the user is not typing into a form field. This
 * stops a literal "e" typed into a KB/cohort/search input from triggering it.
 */
export function isUnlockKeypress(key: string, target: KeypressTarget | null): boolean {
  if (key.toLowerCase() !== DEBUG_UNLOCK_KEY) return false
  if (target) {
    const tag = target.tagName?.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
    if (target.isContentEditable) return false
  }
  return true
}
