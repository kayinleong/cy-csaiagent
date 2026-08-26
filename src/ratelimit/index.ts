/**
 * src/ratelimit/index.ts — Per-agent rate-limit enforcer.
 *
 * Public API:
 *   - check(uid, action): reads the agent's rateBudgets/{uid} doc and THROWS
 *     RateLimitError if over the request or token cap. MUST be called BEFORE
 *     streamText() in the chat route (01-11) — this is the cost-DoS guard (T-01-20).
 *   - decrement(uid, tokens): atomically increments requestCount + tokenCount via
 *     FieldValue.increment() — also serves as the token-usage telemetry write (QUAL-07).
 *
 * IMPORTANT: This module CONSUMES `rateBudgetsRef()` from 01-03 collections.ts.
 * It does NOT declare a new collection ref — rateBudgets is owned and ruled by 01-03.
 *
 * References: TSD §9, D-02, QUAL-07, T-01-20.
 */

import { rateBudgetsRef, TENANT_ID } from '@/src/firebase/collections'
import type { RateBudgetDoc } from '@/src/firebase/collections'
import { FieldValue } from 'firebase-admin/firestore'
import { isWindowExpired, REQUEST_CAP, TOKEN_CAP } from './window'

// ─── Error class ──────────────────────────────────────────────────────────────

/** Thrown by check() when a conversation is over budget. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the agent has budget remaining for a chat action.
 *
 * Reads the agent's `rateBudgets/{uid}` doc via the typed ref from 01-03.
 * If no doc exists (first request), the agent has budget.
 * If the window has expired, the budget is treated as reset (the actual doc
 * reset write happens on the next decrement() call).
 *
 * THROWS `RateLimitError` if requestCount >= REQUEST_CAP OR tokenCount >= TOKEN_CAP.
 * Callers (chat route 01-11) MUST call this BEFORE invoking streamText().
 *
 * @param uid     The authenticated agent's UID.
 * @param action  The action type ('chat'). Extensible for future action types.
 * @throws {RateLimitError} When the agent is over budget.
 */
export async function check(uid: string, action: 'chat'): Promise<void> {
  void action // Reserved for per-action cap differentiation in the future

  const snap = await rateBudgetsRef().doc(uid).get()

  // No document → first request ever, budget is fresh
  if (!snap.exists) {
    return
  }

  const budget = snap.data() as RateBudgetDoc

  // If the window has expired, the budget effectively resets — allow the request.
  // The doc reset will be written on the next decrement() call.
  if (isWindowExpired(budget.windowStart as Date)) {
    return
  }

  // Check request cap
  if (budget.requestCount >= REQUEST_CAP) {
    throw new RateLimitError(
      `Rate limit exceeded: requestCount ${budget.requestCount} >= cap ${REQUEST_CAP} for uid ${uid}`
    )
  }

  // Check token cap
  if (budget.tokenCount >= TOKEN_CAP) {
    throw new RateLimitError(
      `Rate limit exceeded: tokenCount ${budget.tokenCount} >= cap ${TOKEN_CAP} for uid ${uid}`
    )
  }
}

/**
 * Decrement the agent's budget after a successful LLM call.
 *
 * Uses FieldValue.increment() for atomic writes — no read-modify-write race.
 * Also serves as the token-usage telemetry write (QUAL-07).
 *
 * If the window has expired, resets the document (new window) before incrementing.
 *
 * @param uid     The authenticated agent's UID.
 * @param tokens  The number of tokens consumed in this turn.
 */
export async function decrement(uid: string, tokens: number): Promise<void> {
  const ref = rateBudgetsRef().doc(uid)
  const snap = await ref.get()

  // (Re)initialize the window doc with this turn already counted when either:
  //   - no doc exists yet (the agent's first request — update() would throw
  //     NOT_FOUND because there is nothing to update), or
  //   - the current window has expired (budget resets).
  // set() creates-or-overwrites, so it covers both. RateBudgetDoc has exactly
  // these five fields, so an unmerged set() is a full, equivalent write.
  const needsInit =
    !snap.exists || isWindowExpired((snap.data() as RateBudgetDoc).windowStart as Date)

  if (needsInit) {
    await ref.set({
      requestCount: 1,
      tokenCount: tokens,
      windowStart: FieldValue.serverTimestamp(),
      tenantId: TENANT_ID,
      ownerUid: uid,
    } as RateBudgetDoc)
    return
  }

  // Normal case: atomically increment both counters via FieldValue.increment()
  // This is safe under concurrent requests (no read-modify-write race).
  await ref.update({
    requestCount: FieldValue.increment(1),
    tokenCount: FieldValue.increment(tokens),
  })
}

// ─── Admin budget reset ───────────────────────────────────────────────────────

/**
 * Read an agent's current budget counters (admin/diagnostic use).
 *
 * Returns null when no doc exists (the agent has never spent anything), and
 * `expired: true` when the stored window has already rolled over — in that case the
 * counters are stale and `check()` already treats the agent as having a fresh budget,
 * so there is nothing to reset.
 *
 * Read-only. Counts only — never message content, never PII.
 */
export async function readBudget(uid: string): Promise<{
  requestCount: number
  tokenCount: number
  expired: boolean
} | null> {
  const snap = await rateBudgetsRef().doc(uid).get()
  if (!snap.exists) return null

  const budget = snap.data() as RateBudgetDoc
  return {
    requestCount: budget.requestCount ?? 0,
    tokenCount: budget.tokenCount ?? 0,
    expired: isWindowExpired(budget.windowStart as Date),
  }
}

/**
 * Reset an agent's rate-limit budget, starting a fresh window from now
 * (quick-kayinleong-049).
 *
 * Why this exists: `check()` only clears once `isWindowExpired()` becomes true, so an
 * agent who hits TOKEN_CAP (300_000 tokens / 24h, raised from 50_000 in quick-050) is
 * locked out of chat for the remainder
 * of the day with no operator recourse. That cap is already flagged as low for a
 * multi-step + RAG turn, and quick-046's `consumeStream()` fix made previously-free
 * aborted turns count, so the budget burns sooner than it used to.
 *
 * Uses `set()` rather than deleting the doc: the reset stays observable, the doc keeps
 * its `tenantId`/`ownerUid` identity fields, and `set()` creates-or-overwrites so a
 * never-seen uid does not throw NOT_FOUND (the same reason `decrement()` uses `set()` on
 * init/expiry). RateBudgetDoc has exactly these five fields, so an unmerged `set()` is a
 * full, well-formed write — no stale keys survive.
 *
 * Callers MUST verify the caller is an admin BEFORE invoking this. This module does not
 * know who is asking; it is pure budget mechanics. The gate lives in
 * app/[lang]/(admin)/users/actions.ts.
 *
 * Idempotent: resetting an already-fresh budget is a no-op in effect.
 *
 * @param uid The agent whose budget should be cleared.
 */
export async function resetBudget(uid: string): Promise<void> {
  await rateBudgetsRef()
    .doc(uid)
    .set({
      requestCount: 0,
      tokenCount: 0,
      windowStart: FieldValue.serverTimestamp(),
      tenantId: TENANT_ID,
      ownerUid: uid,
    } as RateBudgetDoc)
}
