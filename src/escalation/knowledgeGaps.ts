/**
 * src/escalation/knowledgeGaps.ts — PDPA-safe knowledge-gap signal store
 *
 * `recordKnowledgeGap` upserts a `knowledgeGaps/{topicHash}` document that
 * the senior-coach dashboard reads as its knowledge-gap feed (CDASH-03).
 *
 * PDPA compliance (T-02-19):
 *   - NEVER store the raw query string (that is an agent's training question
 *     which may contain client names or other contextual PII).
 *   - Store a SHORT, human-readable `topicLabel` (≤120 chars, first N words of
 *     the normalized topic, no raw query text).
 *   - Store a stable `topicHash` = sha256(normalize(topic)) as the dedup key.
 *   - The dashboard reads the label + hash; it never exposes raw queries.
 *
 * Dedup + aggregation:
 *   - Each miss for the same (seniorCoachId, topicHash) increments `count`
 *     and updates `lastSeenAt` via `set({...}, {merge: true})`.
 *   - The Firestore document ID is the `topicHash` itself, giving O(1) upsert.
 *   - Dashboard query: `knowledgeGapsRef().where('seniorCoachId','==',coach.uid)
 *       .orderBy('lastSeenAt','desc')` (index declared in 02-01).
 *
 * Where to call this:
 *   - Call from `emitHandoffSignal` (src/escalation/handoff.ts) at the kb_miss
 *     site so a miss atomically records BOTH the escalation signal AND the
 *     PDPA-safe gap count.
 *   - Do NOT call from inside an AI SDK tool (tools are read-only, client-side).
 *
 * References:
 *   - 02-05 PLAN.md Task 2 (CDASH-03 gap store)
 *   - TSD §4 knowledgeGaps/{gapId} (KnowledgeGapDoc schema)
 *   - T-02-19 (info-disclosure mitigation)
 *   - CDASH-03 (knowledge-gap feed)
 */

import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { knowledgeGapsRef, TENANT_ID } from '@/src/firebase/collections'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordKnowledgeGapInput {
  /** UID of the senior coach whose downline triggered this miss. */
  seniorCoachId: string
  /** UID of the agent who asked (stored as pseudonymized reference). */
  agentUid: string
  /**
   * The topic / query that resulted in a KB miss.
   *
   * This is NEVER stored verbatim — it is normalized and hashed before storage.
   * A short redacted `topicLabel` (≤120 chars, no PII) is derived from it.
   */
  topic: string
  /** Language the question was asked in. */
  lang: 'en' | 'ms' | 'zh'
  /**
   * Optional pillar discriminator (D-11). Reply `no_sop_match` misses set 'reply' so
   * Derek's dashboard can separate Coach training gaps from Reply SOP gaps. Existing
   * Coach callers (emitHandoffSignal → kb_miss) omit it — when absent it is NOT written
   * onto the upsert object, so pre-Phase-4 gap rows stay byte-for-byte unchanged (the
   * dashboard treats an absent pillar as 'coach' for backward compatibility).
   */
  pillar?: 'coach' | 'reply'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize a topic string to a canonical form for hashing.
 *
 * Normalization: lowercase + trim + collapse internal whitespace.
 * This ensures "OC bumiputera quota" and "  OC Bumiputera Quota  " hash identically.
 */
function normalizeTopic(topic: string): string {
  return topic.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Derive a PDPA-safe short label from the topic (≤120 chars, first N words).
 *
 * This is NOT the raw query — it is the first few words truncated at a word
 * boundary, used only as a human-readable hint for the dashboard.
 *
 * Long queries are truncated; any text beyond 120 chars is dropped silently.
 */
function deriveTopicLabel(normalized: string): string {
  if (normalized.length <= 120) return normalized
  // Truncate at the last word boundary before 120 chars
  const truncated = normalized.slice(0, 120)
  const lastSpace = truncated.lastIndexOf(' ')
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
}

/**
 * Compute the stable sha256 hex hash of the normalized topic.
 *
 * Used as the Firestore document ID for dedup / upsert-or-increment.
 */
function topicHashOf(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a knowledge-gap signal for a KB miss.
 *
 * Upserts `knowledgeGaps/{topicHash}` with:
 *   - `count: FieldValue.increment(1)` — increments on every call
 *   - `lastSeenAt: FieldValue.serverTimestamp()` — updated on every call
 *   - Other fields only written on first creation (merge:true skips them on upsert)
 *
 * NEVER stores the raw `topic` string — only the normalized `topicHash` and a
 * short `topicLabel` derived from the normalized form.
 *
 * @param input - { seniorCoachId, agentUid, topic, lang }
 */
export async function recordKnowledgeGap(input: RecordKnowledgeGapInput): Promise<void> {
  const { seniorCoachId, agentUid, topic, lang, pillar } = input

  const normalized = normalizeTopic(topic)
  const topicHash = topicHashOf(normalized)
  const topicLabel = deriveTopicLabel(normalized)

  // Write to knowledgeGaps/{topicHash}
  // merge:true makes this an upsert — count increments, lastSeenAt updates,
  // other fields (seniorCoachId, agentUid, topicLabel, lang) written on first creation.
  // The pillar discriminator (D-11) is included ONLY when provided — omitting it keeps
  // existing Coach gap rows unchanged (absent ⇒ treated as 'coach' by the dashboard).
  await knowledgeGapsRef().doc(topicHash).set(
    {
      tenantId: TENANT_ID,
      seniorCoachId,
      agentUid,
      topicHash,
      topicLabel, // SHORT label — never the raw query (T-02-19)
      lang,
      count: FieldValue.increment(1),
      lastSeenAt: FieldValue.serverTimestamp(),
      ...(pillar && { pillar }),
    },
    { merge: true },
  )
}
