/**
 * src/escalation/escalation.test.ts
 *
 * Unit tests for the escalation seam:
 *   - findStalled: queries agentProfiles.lastActiveAt > N days ago
 *   - emitHandoffSignal: creates an escalations row via escalationsRef()
 *   - Dedup: same agent+reason within window does not create duplicate
 *   - recordKnowledgeGap: upserts knowledgeGaps/{topicHash}, PDPA-safe
 *   - handoff kb_miss: calls both emitHandoffSignal AND recordKnowledgeGap atomically
 *
 * Offline / mocked Firestore — no real Firebase credentials needed.
 * Clock is injectable for deterministic stale/active assertions.
 *
 * References:
 *   - TSD §3.2 escalation row + §4 escalations/{eid}
 *   - 01-11 PLAN.md Task 1 behaviors
 *   - T-01-35 (dedup guard)
 *   - T-02-19 (knowledgeGaps PDPA: topicHash + short label, no raw query)
 *   - CDASH-03 (knowledge-gap feed source)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── vi.hoisted mock variables ────────────────────────────────────────────────
// Must be hoisted so vi.mock factories can reference them.

const mockAgentProfilesWhere = vi.hoisted(() => vi.fn())
const mockAgentProfilesGet = vi.hoisted(() => vi.fn())
const mockEscalationsWhere = vi.hoisted(() => vi.fn())
const mockEscalationsWhereGet = vi.hoisted(() => vi.fn())
const mockEscalationsAdd = vi.hoisted(() => vi.fn())
const mockKnowledgeGapsDoc = vi.hoisted(() => vi.fn())
const mockKnowledgeGapsSet = vi.hoisted(() => vi.fn())

// ─── Mock @/src/firebase/collections ──────────────────────────────────────────

vi.mock('@/src/firebase/collections', () => {
  // agentProfilesRef chain: .where().get()
  const agentProfilesQuery = {
    get: mockAgentProfilesGet,
  }
  const agentProfilesRef = vi.fn(() => ({
    where: mockAgentProfilesWhere.mockReturnValue(agentProfilesQuery),
  }))

  // escalationsRef chain: .where().where().where().get() for dedup check, and .add() for create
  // The dedup chain is: ref.where(agentUid).where(reason).where(status).get()
  const escalationsDedupQuery = {
    get: mockEscalationsWhereGet,
  }
  // Build a chainable where mock that returns itself (supporting N chained .where() calls)
  // The final .where() returns the query with .get()
  const chainableWhere = {
    where: vi.fn(),
    get: mockEscalationsWhereGet,
  }
  // Make chainableWhere.where return itself for infinite chaining
  chainableWhere.where.mockReturnValue(chainableWhere)

  const escalationsRef = vi.fn(() => ({
    where: mockEscalationsWhere.mockReturnValue(chainableWhere),
    add: mockEscalationsAdd,
  }))

  // knowledgeGapsRef: .doc(topicHash).set({...}, {merge: true})
  const knowledgeGapsRef = vi.fn(() => ({
    doc: mockKnowledgeGapsDoc.mockReturnValue({
      set: mockKnowledgeGapsSet,
    }),
  }))

  // Unused but referenced — suppress lint
  void escalationsDedupQuery

  return { agentProfilesRef, escalationsRef, knowledgeGapsRef, TENANT_ID: 'd2' }
})

// ─── Mock firebase-admin/firestore for FieldValue ─────────────────────────────

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: vi.fn((n: number) => ({ _increment: n })),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}))

import { findStalled } from './detect'
import { emitHandoffSignal } from './handoff'
import { recordKnowledgeGap } from './knowledgeGaps'

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

// ─── Test 4: recordKnowledgeGap ──────────────────────────────────────────────

describe('recordKnowledgeGap()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKnowledgeGapsDoc.mockReturnValue({ set: mockKnowledgeGapsSet })
    mockKnowledgeGapsSet.mockResolvedValue(undefined)
  })

  it('upserts knowledgeGaps/{topicHash} with count incremented and lastSeenAt updated', async () => {
    await recordKnowledgeGap({
      seniorCoachId: 'coach-001',
      agentUid: 'agent-001',
      topic: 'bumiputera quota rules',
      lang: 'en',
    })

    expect(mockKnowledgeGapsDoc).toHaveBeenCalledOnce()
    expect(mockKnowledgeGapsSet).toHaveBeenCalledOnce()

    const [setData, setOpts] = mockKnowledgeGapsSet.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(setOpts).toMatchObject({ merge: true })
    expect(setData).toHaveProperty('topicHash')
    expect(setData).toHaveProperty('topicLabel')
    expect(setData.count).toMatchObject({ _increment: 1 }) // FieldValue.increment(1)
    expect(setData).toHaveProperty('lastSeenAt')
    expect(setData.seniorCoachId).toBe('coach-001')
    expect(setData.agentUid).toBe('agent-001')
    expect(setData.lang).toBe('en')
    expect(setData.tenantId).toBe('d2')
  })

  it('uses the topicHash as the document ID key (stable sha256 dedup)', async () => {
    const topic = 'meta ads budget allocation'

    await recordKnowledgeGap({ seniorCoachId: 'c1', agentUid: 'a1', topic, lang: 'en' })
    await recordKnowledgeGap({ seniorCoachId: 'c1', agentUid: 'a1', topic, lang: 'en' })

    // Both calls should target the SAME document ID (same topicHash for same topic)
    const [call1DocId] = mockKnowledgeGapsDoc.mock.calls[0] as [string]
    const [call2DocId] = mockKnowledgeGapsDoc.mock.calls[1] as [string]
    expect(call1DocId).toBe(call2DocId)
    expect(call1DocId).toBeTruthy()
    // The doc ID must be a hex string (sha256)
    expect(call1DocId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('NEVER stores the raw query topic string verbatim in the document', async () => {
    const rawTopic = 'How do I apply for a bumiputera discount on OC Tower Phase 2?'

    await recordKnowledgeGap({
      seniorCoachId: 'coach-001',
      agentUid: 'agent-001',
      topic: rawTopic,
      lang: 'en',
    })

    expect(mockKnowledgeGapsSet).toHaveBeenCalledOnce()
    const [setData] = mockKnowledgeGapsSet.mock.calls[0] as [Record<string, unknown>]

    // None of the stored fields should equal the raw topic string verbatim
    for (const [key, value] of Object.entries(setData)) {
      if (typeof value === 'string') {
        expect(value, `Field "${key}" must NOT contain the raw query verbatim`).not.toBe(rawTopic)
      }
    }
    // topicLabel should be a shorter truncated descriptor, not the full query
    expect(typeof setData.topicLabel).toBe('string')
    expect((setData.topicLabel as string).length).toBeLessThanOrEqual(120)
  })

  it('topicHash is stable sha256 of normalized topic (lowercase trimmed)', async () => {
    const topicA = 'OC bumiputera quota'
    const topicB = '  OC Bumiputera Quota  ' // different casing/whitespace

    await recordKnowledgeGap({ seniorCoachId: 'c1', agentUid: 'a1', topic: topicA, lang: 'en' })
    await recordKnowledgeGap({ seniorCoachId: 'c1', agentUid: 'a1', topic: topicB, lang: 'en' })

    const [idA] = mockKnowledgeGapsDoc.mock.calls[0] as [string]
    const [idB] = mockKnowledgeGapsDoc.mock.calls[1] as [string]
    // Normalized forms should produce the same hash
    expect(idA).toBe(idB)
  })
})

// ─── Test 5: handoff.ts kb_miss records knowledgeGap atomically ──────────────

describe('emitHandoffSignal(reason:kb_miss) + recordKnowledgeGap atomic wire', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEscalationsWhereGet.mockResolvedValue({ empty: true, docs: [] })
    mockEscalationsAdd.mockResolvedValue({ id: 'esc-kb-001' })
    mockKnowledgeGapsDoc.mockReturnValue({ set: mockKnowledgeGapsSet })
    mockKnowledgeGapsSet.mockResolvedValue(undefined)
  })

  it('calls both emitHandoffSignal and recordKnowledgeGap for a kb_miss', async () => {
    // Import handoff directly to confirm the wire-in
    const { emitHandoffSignal: emit } = await import('./handoff')
    await emit({
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      reason: 'kb_miss',
      contextBundle: { topic: 'bumiputera discount', lang: 'en' },
    })

    // escalation row written
    expect(mockEscalationsAdd).toHaveBeenCalledOnce()
    // knowledgeGap also written (via recordKnowledgeGap called from handoff)
    expect(mockKnowledgeGapsSet).toHaveBeenCalledOnce()
  })
})
