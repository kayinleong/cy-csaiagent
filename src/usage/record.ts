/**
 * src/usage/record.ts — Fire-and-forget counts-only usage event appender.
 *
 * Mirrors src/audit/log.ts:76-97 (the EXACT same fire-and-forget, swallow-errors
 * contract). Designed to be called inside Next.js after() on the chat route's
 * onFinish path — any Firestore write failure is caught and silently discarded
 * so the caller's hot path is never affected.
 *
 * PDPA discipline (Anti-Pattern guard):
 *   - The persisted payload is COUNTS ONLY — no content, no text, no originalDraft,
 *     no routeDecision. Only token counts + pillar + uid + day.
 *   - tenantId is stamped by the usageEventConverter (makeConverter) automatically.
 *     We also pass it explicitly in the input for discipline + type safety.
 *
 * Single capture point:
 *   The ONLY call site is app/api/chat/route.ts onFinish — one after() call
 *   alongside the existing audit.log after(). NEVER add a second capture site.
 *   (Anti-Pattern: "Two usage pipelines" — RESEARCH §Anti-Patterns.)
 *
 * Requirements: QUAL-08, D-04, RESEARCH Pattern 1, 05-PATTERNS.md §record.ts.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { usageEventsRef } from '@/src/firebase/collections'
import type { UsageEventInput } from '@/src/usage/types'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a counts-only usageEvent document to Firestore.
 *
 * Fire-and-forget: write failures are SWALLOWED silently — this function always
 * resolves without throwing. Mirror contract of src/audit/log.ts:76-97.
 *
 * Persisted payload (no content, no PII):
 *   tenantId (auto-stamped by converter), uid, pillar, inputTokens, outputTokens,
 *   cachedInputTokens, cacheCreationInputTokens, reads?, writes?, day, createdAt.
 *
 * @param input  UsageEventInput — the counts-only turn summary (no PII fields)
 * @returns      Promise<void> — always resolves (never rejects)
 */
export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  try {
    // Build the write payload — COUNTS ONLY.
    // Destructure explicitly to ensure no forbidden content keys slip through.
    // (This acts as a compile-time + runtime anti-PII guard.)
    const {
      tenantId,
      uid,
      pillar,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      day,
      reads,
      writes,
    } = input

    const doc = {
      tenantId,
      uid,
      pillar,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      day,
      // Optional fields — only include when provided
      ...(reads !== undefined && { reads }),
      ...(writes !== undefined && { writes }),
      createdAt: FieldValue.serverTimestamp(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await usageEventsRef().add(doc as any)
  } catch {
    // Fire-and-forget: swallow the error silently.
    // The caller (running inside after()) must NOT be affected by usageEvents write failures.
    // WR-06 fix: emit a lightweight non-PII warning so write failures are not invisible.
    // No token, uid, or content is logged here — only the module identifier.
    // (The original comment claimed "a separate monitoring alert" that does not exist.)
    console.warn('[usage] recordUsageEvent write failed — usageEvents Firestore write error')
  }
}
