// Phase-7 Wave-0 RED stub — implementation lands in 07-03-PLAN.md

/**
 * app/[lang]/(coach)/agents/actions.test.ts — CLOSE-01 record-first-close idempotency.
 *
 * Lives under the (coach) route group: per the routing correction (07 CLAIM.md),
 * the (admin) group redirects senior-coach to /dashboard, so coach-or-admin
 * surfaces (record-first-close per D-21) MUST live under (coach), which admits
 * senior-coach + admin.
 *
 * Pins the secure behavior of recordFirstClose (D-21):
 *   1. IDEMPOTENT: sets firstCloseAt only when ABSENT. A SECOND call when
 *      firstCloseAt is already set does NOT overwrite it (records the FIRST close
 *      only — subsequent calls no-op).
 *   2. ACCESS (D-21): senior-coach (own-downline) + admin allowed; a non-downline
 *      coach → Forbidden (role + downline from the VERIFIED token, never args).
 *
 * RED-BY-DESIGN: ./actions does not exist until 07-03 → the import rejects.
 * No emulator needed — Firestore is mocked.
 *
 * Requirements: CLOSE-01, D-21.
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

// A mutable fake agentProfiles doc — the test toggles whether firstCloseAt is set.
let fakeProfileData: Record<string, unknown> = {}
const mockUpdate = vi.fn().mockResolvedValue(undefined)
const mockDocGet = vi.fn(async () => ({
  exists: true,
  data: () => fakeProfileData,
}))
const mockDoc = vi.fn(() => ({ get: mockDocGet, update: mockUpdate }))

vi.mock('@/src/firebase/collections', () => ({
  agentProfilesRef: vi.fn(() => ({ doc: mockDoc })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import FAILS until 07-03 creates the action module (Wave-0 red-bar intent):
import { recordFirstClose } from './actions'

const downlineCoach = { uid: 'coach-a', role: 'senior-coach', tenantId: 'd2' } as AuthenticatedUser

describe('CLOSE-01 recordFirstClose — idempotent set + downline gate (D-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeProfileData = {
      tenantId: 'd2',
      journeyStage: 'producing',
      currentCheckpoint: 'first-lead',
      lastActiveAt: new Date(),
      activeLeadIds: [],
      seniorCoachId: 'coach-a', // agent is in coach-a's downline
    }
  })

  it('sets firstCloseAt when ABSENT (the first close)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(downlineCoach)

    const result = await recordFirstClose('agent-uid')
    expect(result).toMatchObject({ ok: true })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ firstCloseAt: expect.anything() }),
    )
  })

  it('does NOT overwrite firstCloseAt on a SECOND call (idempotent — first close only)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(downlineCoach)
    // firstCloseAt already set → the action must no-op the write.
    fakeProfileData.firstCloseAt = new Date('2026-06-01T00:00:00Z')

    await recordFirstClose('agent-uid')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('allows an admin to record a close for any agent', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)
    fakeProfileData.seniorCoachId = 'some-other-coach' // not admin's downline — admin still allowed

    const result = await recordFirstClose('agent-uid')
    expect(result).toMatchObject({ ok: true })
  })

  it("returns {ok:false, error:'Forbidden'} for a NON-downline coach (D-21)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-b', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)
    fakeProfileData.seniorCoachId = 'coach-a' // belongs to coach-a, not coach-b

    const result = await recordFirstClose('agent-uid')
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
