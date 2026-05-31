/**
 * Append-only, hashes-only audit writer.
 *
 * This module is the second half of the PDPA compliance spine (TSD §5.3).
 * It writes an immutable audit row to Firestore via the create-only auditLogs
 * collection. The row contains only sha256 hashes of raw values — never raw PII,
 * never a token, never message content in plaintext.
 *
 * Design:
 *   - Designed to be called inside Next.js after() (fire-and-forget, post-response).
 *   - Write failures are swallowed silently — never rethrown into the caller's hot path.
 *   - Uses Node crypto sha256 for deterministic, verifiable hashes.
 *   - Writes via auditLogsRef() from 01-03 (which stamps tenantId:'d2' via the converter).
 *
 * Usage in 01-11 chat route:
 *   after(() => audit.log({ actorUid: uid, action: 'chat', raw: { messageHash, leadRef } }))
 *
 * CRITICAL: Never pass raw PII into `raw`. Pass identifiers, refs, or values you
 * WANT hashed. The function hashes every value in `raw` — no raw value is stored.
 */

import { createHash } from 'crypto'
import { auditLogsRef } from '@/src/firebase/collections'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  /** UID of the authenticated user taking this action */
  actorUid: string
  /** Action label (e.g. 'chat', 'kb-view', 'login', 'escalate') */
  action: string
  /** Optional Firestore path of the target document (e.g. 'conversations/abc123') */
  targetRef?: string
  /**
   * Raw values to hash. EVERY value in this object is sha256-hashed before storage.
   * NEVER store the output of this hash in any log, session, or user-facing field.
   * This object is discarded immediately after hashing — it is never persisted.
   */
  raw: Record<string, unknown>
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Hash a single value with sha256. The value is JSON-stringified first to
 * ensure deterministic serialization of objects/arrays/booleans.
 */
function hashValue(value: unknown): string {
  const normalized = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Hash every value in a record. Returns a new record with the same keys
 * but sha256 hashes as values. The input record is not mutated.
 */
function hashAll(raw: Record<string, unknown>): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    hashes[key] = hashValue(value)
  }
  return hashes
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write an append-only audit row to Firestore.
 *
 * The row contains only hashes of the raw values — never raw PII.
 * Write failures are swallowed — this function is safe to call inside after().
 *
 * @param entry  { actorUid, action, targetRef?, raw }
 * @returns      Promise<void> — always resolves (never rejects)
 */
export async function log(entry: AuditEntry): Promise<void> {
  try {
    const hashes = hashAll(entry.raw)

    // Assemble the audit row — no raw values, only hashes
    const auditRow = {
      actorUid: entry.actorUid,
      action: entry.action,
      ...(entry.targetRef !== undefined && { targetRef: entry.targetRef }),
      hashes,
      ts: Date.now(), // epoch ms — sufficient for audit ordering; FieldValue.serverTimestamp() avoided to keep this unit-testable offline
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await auditLogsRef().add(auditRow as any)
  } catch {
    // Fire-and-forget: swallow the error silently.
    // The caller (running inside after()) must NOT be affected by audit failures.
    // Do NOT log the error here — error strings might contain PII from the entry.
    // A separate monitoring alert on auditLogs write failure rates handles this.
  }
}
