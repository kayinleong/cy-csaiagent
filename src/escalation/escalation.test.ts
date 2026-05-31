/**
 * src/escalation/escalation.test.ts
 *
 * Unit tests for the escalation seam:
 *   - findStalled: queries agentProfiles.lastActiveAt > N days ago
 *   - emitHandoffSignal: creates an escalations row via escalationsRef()
 *   - Dedup: same agent+reason within window does not create duplicate
 *
 * Offline / mocked Firestore — no real Firebase credentials needed.
 * Clock is injectable for deterministic stale/active assertions.
 *
 * References:
 *   - TSD §3.2 escalation row + §4 escalations/{eid}
 *   - 01-11 PLAN.md Task 1 behaviors
 *   - T-01-35 (dedup guard)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── vi.hoisted mock variables ────────────────────────────────────────────────
// Must be hoisted so vi.mock factories can reference them.

const mockAgentProfilesWhere = vi.hoisted(() => vi.fn())
const mockAgentProfilesGet = vi.hoisted(() => vi.fn())
const mockEscalationsWhere = vi.hoisted(() => vi.fn())
const mockEscalationsWhereGet = vi.hoisted(() => vi.fn())
const mockEscalationsAdd = vi.hoisted(() => vi.fn())

// ─── Mock @/src/firebase/collections ──────────────────────────────────────────

vi.mock('@/src/firebase/collections', () => {
  // agentProfilesRef chain: .where().get()
  const agentProfilesQuery = {
    get: mockAgentProfilesGet,
  }
  const agentProfilesRef = vi.fn(() => ({
    where: mockAgentProfilesWhere.mockReturnValue(agentProfilesQuery),
  }))

  // escalationsRef chain: .where().get() for dedup check, and .add() for create
  const escalationsDedupQuery = {
    get: mockEscalationsWhereGet,
  }
  const escalationsRef = vi.fn(() => ({
    where: mockEscalationsWhere.mockReturnValue({
      where: vi.fn().mockReturnValue(escalationsDedupQuery),
    }),
    add: mockEscalationsAdd,
  }))

  return { agentProfilesRef, escalationsRef }
})

import { findStalled } from './detect'
import { emitHandoffSignal } from './handoff'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000)
}

function makeProfileDoc(uid: string, lastActiveAt: Date) {
  return {
    id: uid,
    data: () => ({
      lastActiveAt: { toDate: () => lastActiveAt },
      seniorCoachId: 'coach-001',
      journeyStage: 'onboarding',
      currentCheckpoint: 'cp1',
      activeLeadIds: [],
      tenantId: 'd2' as const,
    }),
  }
}

// ─── Test 1: findStalled returns agents stale > N days, excludes active ────────

describe('findStalled({ days })', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns agents whose lastActiveAt is older than `days` days (injected clock)', async () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const stalledAgent = makeProfileDoc('agent-stale-001', daysAgo(3, now))
    // Firestore where query returns only the stalled agent (the query filters them)
    mockAgentProfilesGet.mockResolvedValueOnce({
      empty: false,
      docs: [stalledAgent],
    })

    const result = await findStalled({ days: 2, now })
    expect(result).toHaveLength(1)
    expect(result[0].agentUid).toBe('agent-stale-001')
    expect(result[0].seniorCoachId).toBe('coach-001')
    expect(result[0].lastActiveAt).toBeInstanceOf(Date)
  })

  it('excludes active agents (lastActiveAt within the window)', async () => {
    const now = new Date('2026-06-01T10:00:00Z')
    // Firestore where with < threshold returns empty (active agents are excluded)
    mockAgentProfilesGet.mockResolvedValueOnce({
      empty: true,
      docs: [],
    })

    const result = await findStalled({ days: 2, now })
    expect(result).toHaveLength(0)
  })

  it('where() is called with lastActiveAt < threshold (not ">")', async () => {
    const now = new Date('2026-06-01T10:00:00Z')
    mockAgentProfilesGet.mockResolvedValueOnce({ empty: true, docs: [] })

    await findStalled({ days: 2, now })

    expect(mockAgentProfilesWhere).toHaveBeenCalledWith(
      'lastActiveAt',
      '<',
      expect.any(Date),
    )
    // The threshold should be 2 days before now
    const callArgs = mockAgentProfilesWhere.mock.calls[0]
    const threshold = callArgs[2] as Date
    const expectedThreshold = daysAgo(2, now)
    expect(threshold.getTime()).toBeCloseTo(expectedThreshold.getTime(), -3)
  })
})

// ─── Test 2: emitHandoffSignal creates an escalations row ─────────────────────

describe('emitHandoffSignal()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an escalations row with status:open, openedAt, seniorCoachId, and reason', async () => {
    // No existing open escalation → dedup check returns empty
    mockEscalationsWhereGet.mockResolvedValueOnce({ empty: true, docs: [] })
    mockEscalationsAdd.mockResolvedValueOnce({ id: 'esc-001' })

    await emitHandoffSignal({
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      reason: 'kb_miss',
      contextBundle: { conversationId: 'conv-123' },
    })

    expect(mockEscalationsAdd).toHaveBeenCalledOnce()
    const addedDoc = mockEscalationsAdd.mock.calls[0][0]
    expect(addedDoc.agentUid).toBe('agent-001')
    expect(addedDoc.seniorCoachId).toBe('coach-001')
    expect(addedDoc.reason).toBe('kb_miss')
    expect(addedDoc.status).toBe('open')
    expect(addedDoc.openedAt).toBeDefined()
    expect(addedDoc.contextBundle).toMatchObject({ conversationId: 'conv-123' })
  })

  it('creates a stall escalation row when reason is "stall"', async () => {
    mockEscalationsWhereGet.mockResolvedValueOnce({ empty: true, docs: [] })
    mockEscalationsAdd.mockResolvedValueOnce({ id: 'esc-002' })

    await emitHandoffSignal({
      agentUid: 'agent-002',
      seniorCoachId: 'coach-001',
      reason: 'stall',
      contextBundle: {},
    })

    const addedDoc = mockEscalationsAdd.mock.calls[0][0]
    expect(addedDoc.reason).toBe('stall')
    expect(addedDoc.status).toBe('open')
  })
})

// ─── Test 3: emitHandoffSignal dedup guard ─────────────────────────────────────

describe('emitHandoffSignal() — dedup guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT create a duplicate escalation when an open one already exists for same agent+reason', async () => {
    // An existing open escalation for agent-001 + kb_miss → dedup returns non-empty
    mockEscalationsWhereGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'esc-existing' }],
    })

    await emitHandoffSignal({
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      reason: 'kb_miss',
      contextBundle: {},
    })

    // escalationsRef().add() must NOT have been called
    expect(mockEscalationsAdd).not.toHaveBeenCalled()
  })

  it('does create a new escalation when the existing one is resolved (no open dedup hit)', async () => {
    // Dedup query returns empty (no open escalation for this agent+reason)
    mockEscalationsWhereGet.mockResolvedValueOnce({ empty: true, docs: [] })
    mockEscalationsAdd.mockResolvedValueOnce({ id: 'esc-new' })

    await emitHandoffSignal({
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      reason: 'kb_miss',
      contextBundle: {},
    })

    expect(mockEscalationsAdd).toHaveBeenCalledOnce()
  })
})
