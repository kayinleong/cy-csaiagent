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
