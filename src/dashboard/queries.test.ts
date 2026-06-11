// Phase-7 Wave-0 RED stub — implementation lands in 07-03-PLAN.md

/**
 * src/dashboard/queries.test.ts — PROF-02 + CLOSE-02 RED contracts.
 *
 * Extends the dashboard query surface (queries.ts) with the two Phase-7 read-time
 * additions. OFFLINE — Firestore + audit are mocked; no emulator.
 *
 * Test F (PROF-02): getAgentProfile(coachUid, agentUid) calls
 *   auditDrilldown(coachUid, 'agentProfiles') BEFORE returning data (PDPA
 *   write-on-read, mirrors getDownline); a non-downline coach read is DENIED.
 *
 * Test E (CLOSE-02): daysToFirstClose = firstCloseAt − onboarding start (the
 *   agentProfiles doc createTime; AgentProfileDoc has no createdAt — NEVER
 *   lastActiveAt). An ABSENT firstCloseAt → excluded/null. Computed read-time
 *   (no stored metric).
 *
 * RED-BY-DESIGN: getAgentProfile / daysToFirstClose are not exported from
 * queries.ts until 07-03 → the imports below are undefined and the specs fail.
 *
 * Requirements: PROF-01, PROF-02, CLOSE-02, D-04, D-05, D-22.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock firebase/admin (no real SDK init) ──────────────────────────────────
vi.mock('@/src/firebase/admin', () => ({
  adminDb: {},
}))

// ─── Mock audit/log — capture auditDrilldown ordering ────────────────────────
// vi.hoisted() initializes the capture spy BEFORE the hoisted vi.mock() factory
// runs — a plain `const` is in its TDZ when the hoisted factory references it
// ("Cannot access 'mockAuditDrilldown' before initialization").
const { mockAuditDrilldown } = vi.hoisted(() => ({
  mockAuditDrilldown: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/src/audit/log', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  auditDrilldown: mockAuditDrilldown,
}))

// ─── Mock collections — a single agentProfiles doc fetch ─────────────────────
// `fakeProfile` stays a mutable module-scope `let` (the spies close over it and
// read it at call time, after each test mutates it). The capture spies are
// vi.hoisted() so the hoisted vi.mock() factory can reference them (TDZ-safe).
let fakeProfile: { exists: boolean; createTime?: { toDate: () => Date }; data: () => Record<string, unknown> }
const { mockProfileDocGet, mockProfileDoc } = vi.hoisted(() => {
  const mockProfileDocGet = vi.fn()
  const mockProfileDoc = vi.fn(() => ({ get: mockProfileDocGet }))
  return { mockProfileDocGet, mockProfileDoc }
})
mockProfileDocGet.mockImplementation(async () => fakeProfile)

vi.mock('@/src/firebase/collections', () => ({
  agentProfilesRef: vi.fn(() => ({ doc: mockProfileDoc })),
  escalationsRef: vi.fn(() => ({ where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ docs: [] }) })),
  knowledgeGapsRef: vi.fn(() => ({ where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ docs: [] }) })),
  usageRollupsRef: vi.fn(() => ({ where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ docs: [] }) })),
}))

// These imports are undefined until 07-03 adds the exports (Wave-0 red-bar intent):
import * as queries from './queries'

const COACH_A = 'coach-a-uid'

describe('PROF-02 getAgentProfile — audit-before-read + downline gate (D-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeProfile = {
      exists: true,
      createTime: { toDate: () => new Date('2026-06-01T00:00:00Z') },
      data: () => ({
        tenantId: 'd2',
        journeyStage: 'producing',
        currentCheckpoint: 'first-close',
        lastActiveAt: new Date('2026-06-20T00:00:00Z'),
        activeLeadIds: [],
        seniorCoachId: COACH_A,
        firstCloseAt: new Date('2026-06-11T00:00:00Z'),
      }),
    }
  })

  it('calls auditDrilldown(coachUid, "agentProfiles") BEFORE returning (PROF-02)', async () => {
    const getAgentProfile = (queries as Record<string, unknown>).getAgentProfile as
      (coachUid: string, agentUid: string, opts?: { adminAll?: boolean }) => Promise<unknown>

    await getAgentProfile(COACH_A, 'agent-uid')
    expect(mockAuditDrilldown).toHaveBeenCalledWith(COACH_A, 'agentProfiles')
    // audit must precede the doc read (ordering, T-02-29)
    const auditOrder = mockAuditDrilldown.mock.invocationCallOrder[0]
    const readOrder = mockProfileDocGet.mock.invocationCallOrder[0]
    expect(auditOrder).toBeLessThan(readOrder)
  })

  it('denies a non-downline coach (seniorCoachId != coachUid) (D-05)', async () => {
    fakeProfile.data = () => ({
      tenantId: 'd2', journeyStage: 'producing', currentCheckpoint: 'x',
      lastActiveAt: new Date(), activeLeadIds: [],
      seniorCoachId: 'a-different-coach', // NOT coach-a's downline
    })
    const getAgentProfile = (queries as Record<string, unknown>).getAgentProfile as
      (coachUid: string, agentUid: string, opts?: { adminAll?: boolean }) => Promise<unknown>

    await expect(getAgentProfile(COACH_A, 'agent-uid')).rejects.toThrow()
  })
})

describe('CLOSE-02 daysToFirstClose — close − onboarding start (D-22)', () => {
  it('computes (firstCloseAt − onboardingStart) in whole days', () => {
    const daysToFirstClose = (queries as Record<string, unknown>).daysToFirstClose as
      (onboardingStart: Date, firstCloseAt?: Date) => number | null

    const start = new Date('2026-06-01T00:00:00Z')
    const close = new Date('2026-06-11T00:00:00Z') // 10 days later
    expect(daysToFirstClose(start, close)).toBe(10)
  })

  it('returns null when firstCloseAt is ABSENT (no close yet → excluded)', () => {
    const daysToFirstClose = (queries as Record<string, unknown>).daysToFirstClose as
      (onboardingStart: Date, firstCloseAt?: Date) => number | null

    const start = new Date('2026-06-01T00:00:00Z')
    expect(daysToFirstClose(start, undefined)).toBeNull()
  })
})
