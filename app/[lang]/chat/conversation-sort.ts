/**
 * app/[lang]/chat/conversation-sort.ts — Pure client-side conversation sort (CHAT-07).
 *
 * Shell-side, no React/firebase imports — a clean node import for unit tests.
 *
 * Sorts conversations by `createdAt` descending (newest first), treating a
 * missing/null `createdAt` as the NEWEST (sorted to the top). This is deliberate:
 * a freshly-created `coach-${uid}` thread is written with
 * `FieldValue.serverTimestamp()`, which a client read can briefly observe as
 * `null` while the server timestamp is still pending. If we dropped or buried
 * such docs we would hide the only thread on a fast reload — the exact bug this
 * sort exists to prevent (replaces a Firestore `orderBy('createdAt','desc')`
 * that silently excludes null-`createdAt` docs).
 *
 * References: quick-kayinleong-010, CHAT-07, D-01.
 */

/**
 * Return a NEW array sorted by `createdAt` descending, with null/unresolved
 * `createdAt` treated as the newest (sorted to the top). Does not mutate input.
 *
 * Comparator:
 *   - both dates → `b.createdAt.getTime() - a.createdAt.getTime()` (newer first)
 *   - one null   → the null ranks ahead of the non-null (null = newest)
 *   - two nulls  → 0 (stable)
 */
export function sortConversationsByCreatedAtDesc<T extends { createdAt: Date | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.createdAt === null && b.createdAt === null) return 0
    if (a.createdAt === null) return -1
    if (b.createdAt === null) return 1
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}
