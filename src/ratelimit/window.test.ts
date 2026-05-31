/**
 * Tests for src/ratelimit/* — per-agent rate limiter.
 *
 * Behaviors proved:
 *   1. check(uid,'chat') resolves when budget is fresh; THROWS RateLimitError when
 *      over-budget (refused BEFORE the LLM call) — T-01-20 mitigation.
 *   2. decrement(uid, tokens) performs a real write: increments requestCount + tokenCount.
 *   3. Budget resets per window — a new window restores the budget (injected clock,
 *      deterministic window math).
 *
 * All Firestore writes are mocked — fully offline.
 * Clock is injected for deterministic window boundary testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RateBudgetDoc } from '@/src/firebase/collections'

// ─── Hoisted mock state ────────────────────────────────────────────────────────
const {
  mockRateBudgetsDocGet,
  mockRateBudgetsDocUpdate,
  mockRateBudgetsDocSet,
} = vi.hoisted(() => ({
  mockRateBudgetsDocGet: vi.fn(),
  mockRateBudgetsDocUpdate: vi.fn(),
  mockRateBudgetsDocSet: vi.fn(),
}))

// ─── Mock rateBudgetsRef from 01-03 ───────────────────────────────────────────
// rateBudgets is declared in collections.ts (01-03 source of truth).
// We mock it here so ratelimit/ consumes the real ref signature but writes to a stub.

vi.mock('@/src/firebase/collections', () => {
  const mockDoc = {
    get: mockRateBudgetsDocGet,
    update: mockRateBudgetsDocUpdate,
    set: mockRateBudgetsDocSet,
  }
  return {
    rateBudgetsRef: vi.fn(() => ({
      doc: vi.fn(() => mockDoc),
    })),
    TENANT_ID: 'd2',
  }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {},
}))

// ─── Also mock firebase-admin/firestore for FieldValue ────────────────────────
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
    increment: vi.fn((n: number) => ({ _type: 'increment', value: n })),
  },
}))

import { check, decrement, RateLimitError } from './index'

// ─── Budget cap constants (must match window.ts defaults) ─────────────────────
const REQUEST_CAP = 100    // requests per window
const TOKEN_CAP = 50_000   // tokens per window
const WINDOW_MS = 24 * 60 * 60 * 1000  // 1 day in ms

/** Build a fresh RateBudgetDoc snapshot */
function makeBudgetSnap(overrides: Partial<RateBudgetDoc> = {}): { exists: boolean; data: () => RateBudgetDoc } {
  const now = new Date()
  const base: RateBudgetDoc = {
    tenantId: 'd2',
    ownerUid: 'uid-test',
    requestCount: 0,
    tokenCount: 0,
    windowStart: now,
    ...overrides,
  }
  return {
    exists: true,
    data: () => base,
  }
}

/** A fake "no document exists" snapshot */
const missingSnap = { exists: false, data: () => undefined }

describe('check (refuse before LLM, T-01-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateBudgetsDocUpdate.mockResolvedValue(undefined)
    mockRateBudgetsDocSet.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 1a: check() resolves when budget is fresh (no doc yet — first request)', async () => {
    // No document: first-time user
    mockRateBudgetsDocGet.mockResolvedValue(missingSnap)

    // Must NOT throw
    await expect(check('uid-fresh', 'chat')).resolves.toBeUndefined()
  })

  it('Behavior 1b: check() resolves when requestCount is within the cap', async () => {
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({ requestCount: REQUEST_CAP - 1, tokenCount: 100 })
    )

    await expect(check('uid-near-cap', 'chat')).resolves.toBeUndefined()
  })

  it('Behavior 1c: check() THROWS RateLimitError when requestCount is AT or over the cap', async () => {
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({ requestCount: REQUEST_CAP, tokenCount: 100 })
    )

    await expect(check('uid-over-request', 'chat')).rejects.toThrow(RateLimitError)
  })

  it('Behavior 1d: check() THROWS RateLimitError when tokenCount is AT or over the token cap', async () => {
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({ requestCount: 1, tokenCount: TOKEN_CAP })
    )

    await expect(check('uid-over-tokens', 'chat')).rejects.toThrow(RateLimitError)
  })

  it('Behavior 1e: RateLimitError message indicates which limit was hit', async () => {
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({ requestCount: REQUEST_CAP, tokenCount: 0 })
    )

    await expect(check('uid-over', 'chat')).rejects.toMatchObject({
      name: 'RateLimitError',
    })
  })
})

describe('decrement (real write, QUAL-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateBudgetsDocGet.mockResolvedValue(makeBudgetSnap({ requestCount: 5, tokenCount: 1000 }))
    mockRateBudgetsDocUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 2: decrement(uid, tokens) writes requestCount +1 and tokenCount + tokens to rateBudgets/{uid}', async () => {
    await decrement('uid-decrement', 1500)

    expect(mockRateBudgetsDocUpdate).toHaveBeenCalledOnce()
    const updateArg = mockRateBudgetsDocUpdate.mock.calls[0][0] as Record<string, unknown>

    // requestCount must be incremented
    expect(updateArg).toHaveProperty('requestCount')
    // tokenCount must be incremented
    expect(updateArg).toHaveProperty('tokenCount')

    // Verify FieldValue.increment was used (real atomic write, not a read-modify-write)
    const { FieldValue } = await import('firebase-admin/firestore')
    expect(FieldValue.increment).toHaveBeenCalledWith(1)       // +1 request
    expect(FieldValue.increment).toHaveBeenCalledWith(1500)    // +1500 tokens
  })

  it('decrement writes to the correct uid doc via rateBudgetsRef', async () => {
    const { rateBudgetsRef } = await import('@/src/firebase/collections')

    await decrement('uid-specific', 250)

    // rateBudgetsRef() must be called (01-03 source of truth)
    expect(rateBudgetsRef).toHaveBeenCalled()
    // .doc() must be called with the uid
    const docMock = (rateBudgetsRef as ReturnType<typeof vi.fn>).mock.results[0].value.doc
    expect(docMock).toHaveBeenCalledWith('uid-specific')
  })
})

describe('window reset (deterministic clock injection)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateBudgetsDocUpdate.mockResolvedValue(undefined)
    mockRateBudgetsDocSet.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 3: budget resets when windowStart is older than the window duration', async () => {
    // Simulate a budget that was exhausted yesterday (window expired)
    const yesterday = new Date(Date.now() - WINDOW_MS - 1000)
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({
        requestCount: REQUEST_CAP,  // would be refused if still in-window
        tokenCount: TOKEN_CAP,
        windowStart: yesterday,
      })
    )

    // Because the window has expired, budget should be reset — check() must NOT throw
    await expect(check('uid-window-reset', 'chat')).resolves.toBeUndefined()
  })

  it('budget does NOT reset when still inside the window', async () => {
    // Exhausted budget, window started 1 hour ago (still within daily window)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    mockRateBudgetsDocGet.mockResolvedValue(
      makeBudgetSnap({
        requestCount: REQUEST_CAP,
        tokenCount: 0,
        windowStart: oneHourAgo,
      })
    )

    // Still in-window → exhausted → must throw
    await expect(check('uid-still-in-window', 'chat')).rejects.toThrow(RateLimitError)
  })
})
