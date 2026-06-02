/**
 * src/escalation/handoff.ts — Handoff signal writer for escalations
 *
 * `emitHandoffSignal` creates an `escalations` row via `escalationsRef()`.
 * It includes a dedup guard: if an open escalation already exists for the
 * same (agentUid, reason) pair, no duplicate is created (T-01-35 mitigation).
 *
 * Phase 1: the thin receiving side — the senior-coach dashboard is Phase 2.
 * Consumed by: /api/jobs/stall-detect (reason:'stall') and coach agent
 * KB-miss path (reason:'kb_miss') via the escalation index.
 *
 * References:
 *   - TSD §3.2 escalation row + §4 escalations/{eid}
 *   - 01-11 PLAN.md Task 1 (emitHandoffSignal — deduped escalation row)
 *   - T-01-35 (dedup guard — no spam)
 *   - D-10 (KB-miss emits handoff signal)
 *   - T-01-36 (contextBundle stores references/pseudonyms only — no raw PII)
 *
 * Export: emitHandoffSignal({ agentUid, seniorCoachId, reason, contextBundle })
 * Consumers: stall-detect job, 01-12 coach agent KB-miss path
 */

import { escalationsRef } from '@/src/firebase/collections'
import { FieldValue } from 'firebase-admin/firestore'
import { recordKnowledgeGap } from '@/src/escalation/knowledgeGaps'

export type EscalationReason = 'kb_miss' | 'stall'

export interface HandoffSignalInput {
  agentUid: string
  seniorCoachId: string
  reason: EscalationReason
  /**
   * Contextual bundle attached to the escalation.
   * MUST contain only pseudonymized references — no raw PII (T-01-36 / PDPA).
   * e.g. { conversationId: '...', kbQueryHash: '...' }
   */
  contextBundle: Record<string, unknown>
}

/**
 * Emit a handoff signal by creating an `escalations` row.
 *
 * Dedup guard: queries for an existing `status:'open'` escalation for the
 * same (agentUid, reason) pair before writing.  If one exists, no duplicate
 * is created — the function returns early.
 *
 * This keeps the senior-coach queue clean and prevents alert spam for a
 * single persistently-stalled agent (T-01-35).
 *
 * @param input - agentUid, seniorCoachId, reason ('kb_miss'|'stall'), contextBundle
 */
export async function emitHandoffSignal(input: HandoffSignalInput): Promise<void> {
  const { agentUid, seniorCoachId, reason, contextBundle } = input

  const ref = escalationsRef()

  // ── Dedup check ─────────────────────────────────────────────────────────────
  // Do not create a duplicate open escalation for the same agent+reason.
  const existing = await ref
    .where('agentUid', '==', agentUid)
    .where('reason', '==', reason)
    .where('status', '==', 'open')
    .get()

  if (!existing.empty) {
    // An open escalation already exists for this agent+reason — skip.
    return
  }

  // ── Create escalation row ────────────────────────────────────────────────────
  await ref.add({
    agentUid,
    seniorCoachId,
    reason,
    contextBundle,
    status: 'open',
    openedAt: FieldValue.serverTimestamp(),
    // tenantId is stamped by the collection converter (never omitted)
    tenantId: 'd2' as const,
  })

  // ── KB-miss: record a PDPA-safe knowledge-gap signal atomically ──────────────
  // When the reason is 'kb_miss', a miss atomically records BOTH the escalation
  // signal (above) AND a PDPA-safe gap count in knowledgeGaps/{topicHash}.
  // This gives the senior-coach dashboard (CDASH-03) a queryable gap feed.
  //
  // The `topic` and `lang` are expected in the contextBundle for kb_miss events.
  // The raw topic is NEVER stored verbatim — knowledgeGaps.ts derives a short
  // topicLabel + topicHash (T-02-19 / PDPA).
  if (reason === 'kb_miss') {
    const topic =
      typeof contextBundle.topic === 'string' ? contextBundle.topic : 'unknown'
    const lang =
      contextBundle.lang === 'en' || contextBundle.lang === 'ms' || contextBundle.lang === 'zh'
        ? (contextBundle.lang as 'en' | 'ms' | 'zh')
        : 'en'

    await recordKnowledgeGap({ seniorCoachId, agentUid, topic, lang })
  }
}
