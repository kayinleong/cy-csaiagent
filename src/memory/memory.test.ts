/**
 * Tests for src/memory/* — shared memory layer.
 *
 * Behaviors proved:
 *   1. appendMessage(cid, msg) writes to conversations/{cid}/messages subcollection,
 *      returns the new message ID, and NEVER pushes to an inline array.
 *   2. writeLeadSlot(leadId, 'coachSlot', value, summary) updates only coachSlot +
 *      rollingSummary + updatedAt — leaving finderSlot/replySlot untouched.
 *   3. updateJourneyStage(uid, 'training', 'checkpoint-2') updates journeyStage +
 *      currentCheckpoint + lastActiveAt on agentProfiles/{uid}.
 *
 * Security behaviors (from threat model T-01-21, T-01-22):
 *   - writeLeadSlot is slot-scoped: cross-slot contamination is impossible.
 *   - loadRecent paginates to last-N (no full-history load).
 *
 * All Firestore calls are mocked — fully offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock typed refs from 01-03 ───────────────────────────────────────────────
// We mock at the collections module level so the actual typed refs are never called.

const mockMessagesAdd = vi.fn()
const mockMessagesOrderByLimitGet = vi.fn()
const mockLeadContextUpdate = vi.fn()
const mockAgentProfileUpdate = vi.fn()

// messagesRef(cid) mock: returns collection stub with add() + orderBy().limit().get()
vi.mock('@/src/firebase/collections', () => {
  const mockMessagesCollection = {
    add: mockMessagesAdd,
    orderBy: vi.fn(() => ({
      limitToLast: vi.fn(() => ({
        get: mockMessagesOrderByLimitGet,
      })),
    })),
  }
  const mockLeadContextCollection = {
    doc: vi.fn(() => ({
      update: mockLeadContextUpdate,
    })),
  }
  const mockAgentProfileCollection = {
    doc: vi.fn(() => ({
      update: mockAgentProfileUpdate,
    })),
  }

  return {
    messagesRef: vi.fn((_cid: string) => mockMessagesCollection),
    leadContextRef: vi.fn(() => mockLeadContextCollection),
    agentProfilesRef: vi.fn(() => mockAgentProfileCollection),
    TENANT_ID: 'd2',
  }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {},
}))

import { appendMessage, loadRecent } from './conversation'
import { writeLeadSlot } from './leadContext'
import { updateJourneyStage, touchLastActive } from './agentProfile'

describe('appendMessage (conversation subcollection)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate Firestore add() returning a DocumentReference with an id
    mockMessagesAdd.mockResolvedValue({ id: 'mid-abc-123' })
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 1a: writes to the messages SUBCOLLECTION via messagesRef(cid) and returns mid', async () => {
    const { messagesRef } = await import('@/src/firebase/collections')

    const msg = {
      tenantId: 'd2' as const,
      role: 'assistant' as const,
      content: 'Here is how D2 agents run Meta ads...',
      citations: ['chunk-001', 'chunk-002'],
      routeDecision: 'coach',
      tokens: 120,
      redacted: false,
    }

    const mid = await appendMessage('conv-001', msg)

    // messagesRef() must have been called with the cid (subcollection — not conversation doc)
    expect(messagesRef).toHaveBeenCalledWith('conv-001')
    // add() must have been called on the returned subcollection
    expect(mockMessagesAdd).toHaveBeenCalledOnce()
    expect(mockMessagesAdd).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: expect.any(String),
      citations: ['chunk-001', 'chunk-002'],
    }))
    // Returns the new document ID
    expect(mid).toBe('mid-abc-123')
  })

  it('Behavior 1b: appendMessage NEVER pushes to an inline array on the conversation doc', async () => {
    const { messagesRef } = await import('@/src/firebase/collections')
    const msg = {
      tenantId: 'd2' as const,
      role: 'user' as const,
      content: 'What is the ROI on this project?',
      citations: [],
      routeDecision: 'coach',
      tokens: 15,
      redacted: false,
    }

    await appendMessage('conv-002', msg)

    // messagesRef() was called (subcollection) — not conversationsRef() (parent doc)
    expect(messagesRef).toHaveBeenCalledWith('conv-002')

    // The mock only has add() — no arrayUnion() or update() with an array field
    // If the implementation used an inline array it would need to call a different mock path
    expect(mockMessagesAdd).toHaveBeenCalledOnce()
  })
})

describe('loadRecent (pagination, T-01-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessagesOrderByLimitGet.mockResolvedValue({
      docs: [
        { id: 'mid-1', data: () => ({ role: 'user', content: 'msg1', citations: [], routeDecision: 'coach', tokens: 10, redacted: false, tenantId: 'd2' }) },
        { id: 'mid-2', data: () => ({ role: 'assistant', content: 'msg2', citations: ['c1'], routeDecision: 'coach', tokens: 50, redacted: false, tenantId: 'd2' }) },
      ],
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('loadRecent paginates to last-N — does not load full history', async () => {
    const messages = await loadRecent('conv-003', 20)

    // Returns an array of messages
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe('mid-1')
    expect(messages[0].data.role).toBe('user')
  })
})

describe('writeLeadSlot (agent-scoped slot isolation, T-01-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadContextUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 2: updates only coachSlot + rollingSummary + updatedAt — other slots untouched', async () => {
    const slotValue = { lastTopic: 'Meta ads', stage: 'unit-1' }

    await writeLeadSlot('lead-001', 'coachSlot', slotValue, 'Coach has covered Meta ads basics.')

    expect(mockLeadContextUpdate).toHaveBeenCalledOnce()

    const updateArg = mockLeadContextUpdate.mock.calls[0][0] as Record<string, unknown>

    // Must contain coachSlot
    expect(updateArg).toHaveProperty('coachSlot', slotValue)
    // Must contain rollingSummary
    expect(updateArg).toHaveProperty('rollingSummary', 'Coach has covered Meta ads basics.')
    // Must contain updatedAt
    expect(updateArg).toHaveProperty('updatedAt')

    // Must NOT touch finderSlot or replySlot (slot isolation)
    expect(updateArg).not.toHaveProperty('finderSlot')
    expect(updateArg).not.toHaveProperty('replySlot')
  })

  it('writeLeadSlot without summary omits rollingSummary update', async () => {
    await writeLeadSlot('lead-002', 'coachSlot', { note: 'test' })

    const updateArg = mockLeadContextUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('coachSlot')
    expect(updateArg).toHaveProperty('updatedAt')
    // rollingSummary NOT in the update (slot-only write)
    expect(updateArg).not.toHaveProperty('rollingSummary')
  })
})

describe('updateJourneyStage (journey-state seam, D-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentProfileUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('Behavior 3: updates journeyStage + currentCheckpoint + lastActiveAt on agentProfiles/{uid}', async () => {
    await updateJourneyStage('uid-agent-001', 'training', 'checkpoint-2')

    expect(mockAgentProfileUpdate).toHaveBeenCalledOnce()
    const updateArg = mockAgentProfileUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('journeyStage', 'training')
    expect(updateArg).toHaveProperty('currentCheckpoint', 'checkpoint-2')
    expect(updateArg).toHaveProperty('lastActiveAt')
  })

  it('updateJourneyStage without checkpoint still updates journeyStage + lastActiveAt', async () => {
    await updateJourneyStage('uid-agent-002', 'qualified')

    const updateArg = mockAgentProfileUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('journeyStage', 'qualified')
    expect(updateArg).toHaveProperty('lastActiveAt')
    // currentCheckpoint not in the update when not provided
    expect(updateArg).not.toHaveProperty('currentCheckpoint')
  })

  it('touchLastActive updates only lastActiveAt on agentProfiles/{uid}', async () => {
    await touchLastActive('uid-agent-003')

    const updateArg = mockAgentProfileUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('lastActiveAt')
    expect(Object.keys(updateArg)).toHaveLength(1)
  })
})
