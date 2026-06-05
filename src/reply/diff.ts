/**
 * src/reply/diff.ts — dependency-free edit-as-signal metric (REPLY-09, D-18/D-20).
 *
 * The Reply edit-capture path (D-18) records the model's `originalDraft` vs the
 * agent's `editedFinal` on every Copy. The senior-coach / admin dashboard (D-20,
 * ADMIN-06) needs a NUMERIC edit-rate — NOT a visual diff — to compute per-SOP
 * edit-rate and thumbs-down rate via read-time Firestore aggregation. So this util
 * returns a single normalized `editRatio` in [0,1], not a rich diff structure.
 *
 * No diff library is installed (RESEARCH §Standard Stack "No Diff Library") and
 * none should be added: a ~bounded Levenshtein over the two short reply strings is
 * cheap and avoids a new dependency. The two raw strings are stored alongside the
 * ratio in the `replyEdits` row, so any future visual diff can be reconstructed.
 *
 * Core/shell rule (CLAUDE.md): this is portable application core — it MUST NOT
 * import from `app/` or `next`. Pure function, framework-free, unit-testable.
 */

/**
 * Normalized character-level edit distance between two strings, in [0,1].
 *
 * Returns the Levenshtein distance divided by the longer string's length:
 *   - identical strings        → 0   (no edit)
 *   - complete rewrite         → ~1  (every character changed)
 *   - a small in-place edit    → a small fraction in (0,1)
 *   - both empty               → 0   (no draft, no edit — the clean denominator)
 *
 * The result is clamped to [0,1] for safety (the raw distance can never exceed
 * `max(len)`, but clamping guards against any rounding surprise downstream).
 *
 * @param original The model's draft text (`originalDraft`).
 * @param edited   The agent's final text at Copy time (`editedFinal`).
 * @returns A normalized edit ratio in [0,1].
 */
export function editRatio(original: string, edited: string): number {
  if (original === edited) return 0

  const maxLen = Math.max(original.length, edited.length)
  if (maxLen === 0) return 0 // both empty

  const distance = levenshtein(original, edited)
  const ratio = distance / maxLen

  // Clamp to [0,1] — defensive normalization.
  return Math.min(1, Math.max(0, ratio))
}

/**
 * Levenshtein edit distance (insertions / deletions / substitutions).
 *
 * Single-row dynamic-programming implementation: O(n·m) time, O(min(n,m)) space.
 * Dependency-free by design (no `diff`/`diff-match-patch` package).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Iterate over the shorter string for the inner loop (smaller row).
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]

  // prev[j] holds the distance for the previous `long` prefix.
  let prev = new Array<number>(short.length + 1)
  for (let j = 0; j <= short.length; j++) prev[j] = j

  const curr = new Array<number>(short.length + 1)
  for (let i = 1; i <= long.length; i++) {
    curr[0] = i
    const longChar = long.charCodeAt(i - 1)
    for (let j = 1; j <= short.length; j++) {
      const cost = longChar === short.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      )
    }
    // Swap rows (reuse the arrays — avoids per-row allocation).
    prev = curr.slice()
  }

  return prev[short.length]
}
