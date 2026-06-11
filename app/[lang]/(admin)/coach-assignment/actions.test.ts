// Phase-7 Wave-0 RED stub — implementation lands in 07-03-PLAN.md

/**
 * app/[lang]/(admin)/coach-assignment/actions.test.ts — ASSIGN-01 dual-write contract.
 *
 * Pins the secure behavior of assignCoach (D-06 / D-07):
 *   1. ADMIN-ONLY: a non-admin caller → {ok:false, error:'Forbidden'} (role read from
 *      the VERIFIED token, NEVER from args — T-02-31). Coaches cannot reassign downline.
 *   2. ATOMIC DUAL-WRITE (D-06): on admin success it uses adminDb.batch() to update
 *      BOTH agentProfilesRef().doc(uid) {seniorCoachId} AND usersRef().doc(uid)
 *      {uplineCoachId}, then commit() — one atomic batch, no schema change.
 *   3. AUDITED: writes an action:'coach-assign' audit row.
 *   (D-08: historical denormalized seniorCoachId rows are NOT backfilled — out of scope.)
 *
 * RED-BY-DESIGN: ./actions does not exist until 07-03 → the import below rejects
 * and every spec fails. No emulator needed — all dependencies mocked (unit test).
 *
 * Requirements: ASSIGN-01, D-06, D-07, D-08.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/audit', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// Capture batch() calls to prove the atomic dual-write (D-06).
// vi.hoisted() initializes these BEFORE the hoisted vi.mock() factories run —
// without it the factories below reference the consts in their TDZ (the vi.mock
// calls are hoisted above plain `const` declarations), throwing
// "Cannot access 'mockBatch' before initialization".
const {
  mockBatchUpdate,
  mockBatchCommit,
  mockBatch,
  mockAgentProfileDocRef,
  mockUsersDocRef,
} = vi.hoisted(() => {
  const mockBatchUpdate = vi.fn().mockReturnThis()
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined)
  const mockBatch = vi.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit }))
  const mockAgentProfileDocRef = { __ref: 'agentProfiles/doc' }
  const mockUsersDocRef = { __ref: 'users/doc' }
  return { mockBatchUpdate, mockBatchCommit, mockBatch, mockAgentProfileDocRef, mockUsersDocRef }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { batch: mockBatch },
}))

vi.mock('@/src/firebase/collections', () => ({
  agentProfilesRef: vi.fn(() => ({ doc: vi.fn(() => mockAgentProfileDocRef) })),
  usersRef: vi.fn(() => ({ doc: vi.fn(() => mockUsersDocRef) })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import FAILS until 07-03 creates the action module (Wave-0 red-bar intent):
import { assignCoach } from './actions'

describe('ASSIGN-01 assignCoach — admin-gate + atomic dual-write + audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns {ok:false, error:'Forbidden'} for a non-admin (senior-coach) caller (D-07)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await assignCoach('agent-uid', 'new-coach-uid')
    expect(result).toEqual({ ok: false, error: 'Forbidden' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it("returns {ok:false, error:'Forbidden'} for a read-only caller (D-24)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'ro-uid', role: 'read-only', tenantId: 'd2',
    } as unknown as AuthenticatedUser)

    const result = await assignCoach('agent-uid', 'new-coach-uid')
    expect(result).toEqual({ ok: false, error: 'Forbidden' })
  })

  it('on admin success: batches update on agentProfiles {seniorCoachId} AND users {uplineCoachId}, then commits (D-06)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await assignCoach('agent-uid', 'new-coach-uid')

    expect(result).toEqual({ ok: true })
    expect(mockBatch).toHaveBeenCalledTimes(1)
    // Atomic dual-write: agentProfiles.seniorCoachId + users.uplineCoachId
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      mockAgentProfileDocRef,
      expect.objectContaining({ seniorCoachId: 'new-coach-uid' }),
    )
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      mockUsersDocRef,
      expect.objectContaining({ uplineCoachId: 'new-coach-uid' }),
    )
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  it("writes an action:'coach-assign' audit row on admin success", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)
    const audit = await import('@/src/audit')

    await assignCoach('agent-uid', 'new-coach-uid')

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coach-assign' }),
    )
  })
})
