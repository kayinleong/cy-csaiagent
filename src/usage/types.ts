/**
 * src/usage/types.ts — Usage pipeline types (framework-free).
 *
 * UsageEventInput — the counts-only shape for recordUsageEvent.
 * dayKey() — formats a Date as 'YYYY-MM-DD' in Asia/Kuala_Lumpur, used by
 *   record.ts (capture) and rollup.ts (aggregation grouping).
 *
 * NO content fields — PII-safe by design (RESEARCH Anti-Pattern: "Storing
 * draft/message content in usageEvents"; PDPA: counts only, no text).
 *
 * Consumers:
 *   - src/usage/record.ts (recordUsageEvent)
 *   - src/usage/rollup.ts (rollupUsage)
 *   - app/api/chat/route.ts (single capture site, onFinish)
 *   - src/jobs/runDueJobs.ts (usage-rollup job)
 *
 * Requirements: QUAL-08, D-04, RESEARCH Pattern 1.
 */

// ─── TenantId ─────────────────────────────────────────────────────────────────

import { TENANT_ID } from '@/src/firebase/collections'

export type TenantId = typeof TENANT_ID

// ─── Pillar ───────────────────────────────────────────────────────────────────

export type Pillar = 'coach' | 'finder' | 'reply'

// ─── UsageEventInput ──────────────────────────────────────────────────────────

/**
 * The input shape for recordUsageEvent — counts only, ZERO PII.
 *
 * Fields:
 *   tenantId              — always TENANT_ID ('d2') — stamped by the caller for
 *                           explicit discipline (the converter also stamps it).
 *   uid                   — agent's uid (token count attribution, no display name)
 *   pillar                — 'coach' | 'finder' | 'reply' (cost by pillar)
 *   inputTokens           — total input tokens this turn (from final.totalUsage)
 *   outputTokens          — total output tokens this turn (from final.totalUsage)
 *   cachedInputTokens     — cache READ hit tokens (cost saved, from final.totalUsage)
 *   cacheCreationInputTokens — cache WRITE tokens (one-time setup cost,
 *                              from providerMetadata.anthropic.cacheCreationInputTokens)
 *   reads?                — optional Firestore read-unit count (future)
 *   writes?               — optional Firestore write-unit count (future)
 *   day                   — 'YYYY-MM-DD' in Asia/Kuala_Lumpur — rollup grouping key
 *
 * FORBIDDEN fields (must NEVER appear here):
 *   content, text, originalDraft, routeDecision — these are PII / message content.
 *   (Anti-Pattern: "Storing draft/message content in usageEvents" — RESEARCH §Anti-Patterns)
 */
export interface UsageEventInput {
  tenantId: TenantId
  uid: string
  pillar: Pillar
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  reads?: number
  writes?: number
  day: string // 'YYYY-MM-DD' (Asia/Kuala_Lumpur)
}

// ─── dayKey ───────────────────────────────────────────────────────────────────

/**
 * Format a Date as 'YYYY-MM-DD' in the Asia/Kuala_Lumpur timezone.
 *
 * This is the grouping key for usageEvents → usageRollups aggregation.
 * Using MYT (UTC+8) ensures D2's daily cost view aligns with business hours.
 *
 * @param d  Date to format (defaults to now; pass explicitly for testability)
 * @returns  'YYYY-MM-DD' string in Asia/Kuala_Lumpur
 */
export function dayKey(d: Date): string {
  // Intl.DateTimeFormat is available in Node ≥18 and all modern environments.
  // The 'sv-SE' locale produces YYYY-MM-DD natively, which is what we need.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
