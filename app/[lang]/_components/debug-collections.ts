/**
 * app/[lang]/_components/debug-collections.ts — clear-list for the admin debug tool.
 *
 * The authoritative set of top-level Firestore collections the "Clear all data"
 * debug action deletes. PRESERVE is intentionally excluded: `users` (don't lock
 * the org out) and `appConfig` (holds the `modelConfig` source of truth).
 *
 * Kept as a plain (non-`'use server'`) module so both the Server Action and the
 * unit test can import the same list. Mirrors src/firebase/collections.ts — keep
 * in sync if a collection is added there. `conversations` covers its `messages`
 * subcollection automatically via Admin SDK recursiveDelete (no separate entry).
 */

/** Collections the debug clear MUST NOT touch. */
export const PRESERVE_COLLECTIONS = ['users', 'appConfig'] as const

/**
 * Every top-level collection in src/firebase/collections.ts EXCEPT PRESERVE_COLLECTIONS.
 * `conversations` recursively deletes its `messages` subcollection.
 */
export const CLEAR_COLLECTIONS = [
  'agentProfiles',
  'conversations',
  'leads',
  'leadContext',
  'projects',
  'collateral',
  'kbDocs',
  'kbChunks',
  'kbIngestionJobs',
  'escalations',
  'auditLogs',
  'evals',
  'rateBudgets',
  'knowledgeGaps',
  'replyEdits',
  'usageEvents',
  'usageRollups',
  'erasureRequests',
  'cohorts',
  'conversationFlags',
] as const
