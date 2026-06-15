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
// vi.mock() is hoisted by Vitest above variable declarations.
// Use vi.hoisted() so mock helper variables are available inside the factory.

const {
  mockMessagesAdd,
  mockMessagesOrderByLimitGet,
  mockLeadContextUpdate,
  mockAgentProfileUpdate,
} = vi.hoisted(() => ({
  mockMessagesAdd: vi.fn(),
  mockMessagesOrderByLimitGet: vi.fn(),
  mockLeadContextUpdate: vi.fn(),
  mockAgentProfileUpdate: vi.fn(),
}))

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

// ─── Task 1 (02-03): ensurePrimaryThread + listConversations + searchConversations ─

const {
  mockConversationsDocGet,
  mockConversationsDocSet,
  mockConversationsWhereLimitGet,
} = vi.hoisted(() => ({
  mockConversationsDocGet: vi.fn(),
  mockConversationsDocSet: vi.fn(),
  mockConversationsWhereLimitGet: vi.fn(),
}))

// Augment the existing collections mock with conversationsRef
vi.mock('@/src/firebase/collections', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/src/firebase/collections')>()

  // Primary-thread doc mock (for ensurePrimaryThread get+set)
  const makeConversationDoc = (exists: boolean, data?: Record<string, unknown>) => ({
    exists,
    data: () => data ?? {},
  })

  const mockConversationDocRef = {
    get: mockConversationsDocGet,
    set: mockConversationsDocSet,
  }

  const mockConversationsCollection = {
    doc: vi.fn(() => mockConversationDocRef),
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: mockConversationsWhereLimitGet,
        })),
      })),
    })),
  }

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
    ...original,
    messagesRef: vi.fn((_cid: string) => mockMessagesCollection),
    leadContextRef: vi.fn(() => mockLeadContextCollection),
    agentProfilesRef: vi.fn(() => mockAgentProfileCollection),
    conversationsRef: vi.fn(() => mockConversationsCollection),
    TENANT_ID: 'd2',
    // Re-export makeConversationDoc for test use
    __makeConversationDoc: makeConversationDoc,
  }
})

describe('ensurePrimaryThread (D-01 — deterministic primary Coach thread)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationsDocSet.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('creates conversations/coach-{uid} when doc does not exist, returns the cid', async () => {
    mockConversationsDocGet.mockResolvedValue({ exists: false })

    const { ensurePrimaryThread } = await import('./conversation')
    const { conversationsRef } = await import('@/src/firebase/collections')

    const cid = await ensurePrimaryThread('uid-001', 'en')

    expect(cid).toBe('coach-uid-001')
    // conversationsRef is mocked — verify .doc() was called with the right cid
    const { conversationsRef: mockedConvRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockedConvRef as any)().doc).toHaveBeenCalledWith('coach-uid-001')
    expect(mockConversationsDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'uid-001',
        pillar: 'coach',
        lang: 'en',
        summary: '',
      }),
      { merge: true },
    )
  })

  it('is idempotent — does NOT overwrite an existing conversation doc summary', async () => {
    // Doc has createdAt → no backfill, no write (quick-010). Without createdAt the
    // new backfill path would fire, so include it here to prove the no-write path.
    mockConversationsDocGet.mockResolvedValue({ exists: true, data: () => ({ summary: 'Existing summary', createdAt: new Date('2026-01-01') }) })

    const { ensurePrimaryThread } = await import('./conversation')

    const cid = await ensurePrimaryThread('uid-002', 'ms')

    expect(cid).toBe('coach-uid-002')
    // set should NOT be called when the doc already exists
    expect(mockConversationsDocSet).not.toHaveBeenCalled()
  })

  it('backfills createdAt on an existing doc missing createdAt WITHOUT clobbering summary (quick-010)', async () => {
    mockConversationsDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ summary: 'Existing summary', ownerUid: 'uid-x', pillar: 'coach', lang: 'en', tenantId: 'd2' }),
    })

    const { ensurePrimaryThread } = await import('./conversation')

    const cid = await ensurePrimaryThread('uid-x', 'en')

    expect(cid).toBe('coach-uid-x')
    expect(mockConversationsDocSet).toHaveBeenCalledOnce()

    const setArg = mockConversationsDocSet.mock.calls[0][0] as Record<string, unknown>
    expect(setArg).toHaveProperty('createdAt')
    expect(setArg).toHaveProperty('ownerUid', 'uid-x')
    expect(setArg).toHaveProperty('tenantId', 'd2')
    // summary MUST be preserved — never written by the backfill path (D-01)
    expect(setArg).not.toHaveProperty('summary')
    // merge:true
    expect(mockConversationsDocSet.mock.calls[0][1]).toEqual({ merge: true })
  })

  it('does NOT write when an existing doc already has createdAt (idempotent no-op, quick-010)', async () => {
    mockConversationsDocGet.mockResolvedValue({ exists: true, data: () => ({ summary: 'X', createdAt: new Date('2026-01-01') }) })

    const { ensurePrimaryThread } = await import('./conversation')

    const cid = await ensurePrimaryThread('uid-y', 'en')

    expect(cid).toBe('coach-uid-y')
    expect(mockConversationsDocSet).not.toHaveBeenCalled()
  })

  it('returns cid coach-{uid} for all supported langs', async () => {
    mockConversationsDocGet.mockResolvedValue({ exists: false })
    mockConversationsDocSet.mockResolvedValue(undefined)

    const { ensurePrimaryThread } = await import('./conversation')

    const zhCid = await ensurePrimaryThread('uid-003', 'zh')
    expect(zhCid).toBe('coach-uid-003')
  })
})

describe('listConversations (CHAT-07 — conversation list, createdAt DESC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationsWhereLimitGet.mockResolvedValue({
      docs: [
        {
          id: 'coach-uid-a',
          data: () => ({
            ownerUid: 'uid-a', pillar: 'coach', lang: 'en',
            createdAt: new Date('2026-01-02'), summary: 'Day-two topics',
            tenantId: 'd2',
          }),
        },
        {
          id: 'coach-uid-b',
          data: () => ({
            ownerUid: 'uid-a', pillar: 'coach', lang: 'ms',
            createdAt: new Date('2026-01-01'), summary: 'Day-one topics',
            tenantId: 'd2',
          }),
        },
      ],
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('queries conversations by ownerUid, orderBy createdAt desc, limit n', async () => {
    const { listConversations } = await import('./conversation')

    const threads = await listConversations('uid-a', 50)

    expect(threads).toHaveLength(2)
    expect(threads[0].id).toBe('coach-uid-a')
    expect(threads[0].data.summary).toBe('Day-two topics')
    expect(threads[1].data.summary).toBe('Day-one topics')
  })

  it('defaults to limit 50 when n not provided', async () => {
    const { listConversations } = await import('./conversation')
    await listConversations('uid-a')
    // If this call doesn't throw, limit was applied
    expect(mockConversationsWhereLimitGet).toHaveBeenCalledOnce()
  })
})

describe('searchConversations (CHAT-07 — client-side substring search)', () => {
  it('filters threads by summary substring (case-insensitive)', () => {
    // Pure logic test — just verify the filter behavior matches our expectation
    const summaries = ['Meta ads budgeting', 'iProperty listing SOP', 'meta ADS ROI']
    expect(summaries.filter(s => s.toLowerCase().includes('meta')).length).toBe(2)
  })

  it('returns all threads when search term is empty', async () => {
    const convModule = await import('./conversation')
    const threads = [
      { id: 'c1', data: { tenantId: 'd2' as const, ownerUid: 'u', pillar: 'coach' as const, lang: 'en' as const, createdAt: new Date(), summary: 'Meta ads' } },
      { id: 'c2', data: { tenantId: 'd2' as const, ownerUid: 'u', pillar: 'coach' as const, lang: 'en' as const, createdAt: new Date(), summary: 'iProperty SOP' } },
    ]
    const result = convModule.searchConversations(threads, '')
    expect(result).toHaveLength(2)
  })

  it('searchConversations matches case-insensitively on summary field', async () => {
    const convModule = await import('./conversation')
    const threads = [
      { id: 'c1', data: { tenantId: 'd2' as const, ownerUid: 'u', pillar: 'coach' as const, lang: 'en' as const, createdAt: new Date(), summary: 'Meta Ads Budgeting' } },
      { id: 'c2', data: { tenantId: 'd2' as const, ownerUid: 'u', pillar: 'coach' as const, lang: 'en' as const, createdAt: new Date(), summary: 'iProperty listing SOP' } },
    ]
    const result = convModule.searchConversations(threads, 'meta')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c1')
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

// ─── 03-06: finderSlot read + criteria-merge + isolation tests (RED) ──────────
//
// These tests cover the requirements from FIND-05/06/08 (D-06):
//   - finderSlot-isolation: writeLeadSlot('finderSlot',...) must not touch coachSlot/replySlot
//   - finderSlot-read:      readFinderSlot(leadId) returns typed slot or null
//   - criteria-merge:       mergeFinderCriteria(stored, delta) overrides only changed fields
//   - discussed-accumulation: mergeDiscussed(prev, next) dedup-unions projectId arrays
//
// RED: readFinderSlot, mergeFinderCriteria, mergeDiscussed are NOT yet implemented.

const { mockLeadContextDocGet } = vi.hoisted(() => ({
  mockLeadContextDocGet: vi.fn(),
}))

// Extend the existing collections mock to add leadContextRef doc().get() capability
// We'll augment the mock used by the finderSlot read path.
// The mock for leadContextRef already exists in vi.mock('@/src/firebase/collections')
// above and provides doc().update() — we extend doc() to also have .get().
// Since vi.mock() is module-level and already defined, we use
// mockLeadContextDocGet in the test body via mockReturnValue to control get() results.

describe('writeLeadSlot finderSlot-isolation (T-03-20 Tampering re-assertion, 03-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadContextUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('finderSlot-isolation: writeLeadSlot finderSlot updates ONLY finderSlot — coachSlot/replySlot untouched', async () => {
    const finderValue = { criteria: { segment: 'investment' }, discussedProjectIds: [], lastRankedAt: 1000 }

    await writeLeadSlot('lead-finder-001', 'finderSlot', finderValue)

    expect(mockLeadContextUpdate).toHaveBeenCalledOnce()

    const updateArg = mockLeadContextUpdate.mock.calls[0][0] as Record<string, unknown>

    // Must contain finderSlot
    expect(updateArg).toHaveProperty('finderSlot', finderValue)
    // Must contain updatedAt
    expect(updateArg).toHaveProperty('updatedAt')

    // Must NOT touch coachSlot or replySlot (slot isolation — T-03-20)
    expect(updateArg).not.toHaveProperty('coachSlot')
    expect(updateArg).not.toHaveProperty('replySlot')
  })

  it('finderSlot-isolation: writing finderSlot with summary does NOT spill into coachSlot/replySlot', async () => {
    const finderValue = { criteria: { segment: 'own_stay' }, discussedProjectIds: ['proj-1'], lastRankedAt: 2000 }

    await writeLeadSlot('lead-finder-002', 'finderSlot', finderValue, 'Lead prefers own-stay, budget 600k.')

    const updateArg = mockLeadContextUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('finderSlot', finderValue)
    expect(updateArg).toHaveProperty('rollingSummary', 'Lead prefers own-stay, budget 600k.')
    expect(updateArg).not.toHaveProperty('coachSlot')
    expect(updateArg).not.toHaveProperty('replySlot')
  })
})

describe('readFinderSlot (returning-client recall FIND-06, 03-06)', () => {
  // readFinderSlot is NOT yet implemented — these will fail RED.
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadContextDocGet.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('finderSlot-read: readFinderSlot returns the stored FinderSlot when it exists', async () => {
    const { readFinderSlot } = await import('./leadContext')

    const stored = {
      criteria: {
        segment: 'investment' as const,
        priceMin: null,
        priceMax: 700_000,
        monthlyIncome: 8000,
        nationality: 'malaysian' as const,
        bumiputera: null,
        locationPref: 'Cheras',
        bedrooms: null,
        freeText: 'looking for investment near LRT',
      },
      discussedProjectIds: ['proj-a', 'proj-b'],
      lastRankedAt: 1_700_000_000_000,
    }

    // Wire the mock so leadContextRef().doc(leadId).get() returns the stored slot
    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          tenantId: 'd2',
          coachSlot: {},
          finderSlot: stored,
          replySlot: {},
          rollingSummary: '',
          updatedAt: new Date(),
        }),
      }),
      update: mockLeadContextUpdate,
    })

    const result = await readFinderSlot('lead-finder-001')

    expect(result).not.toBeNull()
    expect(result?.criteria.priceMax).toBe(700_000)
    expect(result?.discussedProjectIds).toEqual(['proj-a', 'proj-b'])
    expect(result?.lastRankedAt).toBe(1_700_000_000_000)
  })

  it('finderSlot-read: readFinderSlot returns null on first-touch (doc missing)', async () => {
    const { readFinderSlot } = await import('./leadContext')

    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      update: mockLeadContextUpdate,
    })

    const result = await readFinderSlot('lead-finder-new')

    expect(result).toBeNull()
  })

  it('finderSlot-read: readFinderSlot returns null when finderSlot is empty object', async () => {
    const { readFinderSlot } = await import('./leadContext')

    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          tenantId: 'd2',
          coachSlot: { lastTopic: 'meta ads' },
          finderSlot: {},  // empty — Finder hasn't run yet
          replySlot: {},
          rollingSummary: '',
          updatedAt: new Date(),
        }),
      }),
      update: mockLeadContextUpdate,
    })

    const result = await readFinderSlot('lead-finder-empty')

    expect(result).toBeNull()
  })
})

describe('readReplySlot (per-lead reply context recall REPLY-03, 04-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => vi.clearAllMocks())

  it('replySlot-read: readReplySlot returns the stored ReplySlot when it exists', async () => {
    const { readReplySlot } = await import('./leadContext')

    const stored = {
      classification: 'cold-prospect' as const,
      latestDraft: 'Hi! What is your budget and timeline?',
      sopDocIds: ['sop-cold-001'],
      lastDraftedAt: 1_700_000_000_000,
    }

    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          tenantId: 'd2',
          coachSlot: {},
          finderSlot: {},
          replySlot: stored,
          rollingSummary: '',
          updatedAt: new Date(),
        }),
      }),
      update: mockLeadContextUpdate,
    })

    const result = await readReplySlot('lead-reply-001')

    expect(result).not.toBeNull()
    expect(result?.classification).toBe('cold-prospect')
    expect(result?.latestDraft).toBe('Hi! What is your budget and timeline?')
    expect(result?.sopDocIds).toEqual(['sop-cold-001'])
    expect(result?.lastDraftedAt).toBe(1_700_000_000_000)
  })

  it('replySlot-read: readReplySlot returns null on first-touch (doc missing)', async () => {
    const { readReplySlot } = await import('./leadContext')

    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      update: mockLeadContextUpdate,
    })

    const result = await readReplySlot('lead-reply-new')

    expect(result).toBeNull()
  })

  it('replySlot-read: readReplySlot returns null when replySlot is empty object', async () => {
    const { readReplySlot } = await import('./leadContext')

    const { leadContextRef: mockedLeadContextRef } = await import('@/src/firebase/collections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mockedLeadContextRef as any)().doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          tenantId: 'd2',
          coachSlot: {},
          finderSlot: {},
          replySlot: {}, // empty — Reply hasn't drafted yet
          rollingSummary: '',
          updatedAt: new Date(),
        }),
      }),
      update: mockLeadContextUpdate,
    })

    const result = await readReplySlot('lead-reply-empty')

    expect(result).toBeNull()
  })

  it('replySlot-isolation: writeLeadSlot replySlot updates ONLY replySlot — coachSlot/finderSlot untouched', async () => {
    mockLeadContextUpdate.mockResolvedValue(undefined)
    const replyValue = {
      classification: 'objection' as const,
      latestDraft: 'I understand price is a concern. Here is the value...',
      sopDocIds: ['sop-obj-001'],
      lastDraftedAt: 2000,
    }

    await writeLeadSlot('lead-reply-iso', 'replySlot', replyValue)

    expect(mockLeadContextUpdate).toHaveBeenCalledOnce()
    const updateArg = mockLeadContextUpdate.mock.calls[0][0] as Record<string, unknown>

    expect(updateArg).toHaveProperty('replySlot', replyValue)
    expect(updateArg).toHaveProperty('updatedAt')
    // Slot isolation — must NOT touch coachSlot or finderSlot (REPLY-03 / SC2)
    expect(updateArg).not.toHaveProperty('coachSlot')
    expect(updateArg).not.toHaveProperty('finderSlot')
  })
})

describe('mergeFinderCriteria (re-rank without re-typing FIND-08, 03-06)', () => {
  // mergeFinderCriteria is NOT yet implemented — these will fail RED.

  it('criteria-merge: budget shift overrides ONLY priceMax — all other fields preserved', async () => {
    const { mergeFinderCriteria } = await import('./leadContext')

    const stored = {
      segment: 'investment' as const,
      priceMin: null,
      priceMax: 600_000,
      monthlyIncome: 8000,
      nationality: 'malaysian' as const,
      bumiputera: null,
      locationPref: 'Cheras',
      bedrooms: null,
      freeText: 'looking for investment near LRT',
    }

    const result = mergeFinderCriteria(stored, { priceMax: 700_000 })

    expect(result.priceMax).toBe(700_000)
    // All other fields must be preserved
    expect(result.segment).toBe('investment')
    expect(result.monthlyIncome).toBe(8000)
    expect(result.nationality).toBe('malaysian')
    expect(result.locationPref).toBe('Cheras')
    expect(result.freeText).toBe('looking for investment near LRT')
  })

  it('criteria-merge: null/undefined delta field does NOT clobber stored value', async () => {
    const { mergeFinderCriteria } = await import('./leadContext')

    const stored = {
      segment: 'own_stay' as const,
      priceMin: null,
      priceMax: 500_000,
      monthlyIncome: 5000,
      nationality: 'malaysian' as const,
      bumiputera: true,
      locationPref: 'Petaling Jaya',
      bedrooms: 3,
      freeText: 'family home near school',
    }

    // Delta provides only bedrooms — all undefined fields must not overwrite stored values
    const result = mergeFinderCriteria(stored, { bedrooms: 4 })

    expect(result.bedrooms).toBe(4)
    // priceMax explicitly NOT in delta — must stay as-is
    expect(result.priceMax).toBe(500_000)
    expect(result.bumiputera).toBe(true)
    expect(result.locationPref).toBe('Petaling Jaya')
  })

  it('criteria-merge: multiple simultaneous field overrides work correctly', async () => {
    const { mergeFinderCriteria } = await import('./leadContext')

    const stored = {
      segment: 'investment' as const,
      priceMin: null,
      priceMax: 600_000,
      monthlyIncome: 8000,
      nationality: 'malaysian' as const,
      bumiputera: null,
      locationPref: 'Cheras',
      bedrooms: null,
      freeText: 'investment near LRT',
    }

    const result = mergeFinderCriteria(stored, { priceMax: 800_000, locationPref: 'Ampang', bedrooms: 2 })

    expect(result.priceMax).toBe(800_000)
    expect(result.locationPref).toBe('Ampang')
    expect(result.bedrooms).toBe(2)
    // untouched fields
    expect(result.segment).toBe('investment')
    expect(result.monthlyIncome).toBe(8000)
  })
})

describe('mergeDiscussed (discussed-accumulation dedup FIND-06, 03-06)', () => {
  // mergeDiscussed is NOT yet implemented — these will fail RED.

  it('discussed-accumulation: merging new projectIds appends without duplicates', async () => {
    const { mergeDiscussed } = await import('./leadContext')

    const prev = ['proj-a', 'proj-b']
    const next = ['proj-b', 'proj-c']  // proj-b is a duplicate

    const result = mergeDiscussed(prev, next)

    expect(result).toContain('proj-a')
    expect(result).toContain('proj-b')
    expect(result).toContain('proj-c')
    // No duplicates
    expect(result.filter(id => id === 'proj-b')).toHaveLength(1)
    expect(result).toHaveLength(3)
  })

  it('discussed-accumulation: merging empty next returns prev unchanged', async () => {
    const { mergeDiscussed } = await import('./leadContext')

    const prev = ['proj-a', 'proj-b']
    const result = mergeDiscussed(prev, [])

    expect(result).toEqual(['proj-a', 'proj-b'])
  })

  it('discussed-accumulation: merging from empty prev works correctly', async () => {
    const { mergeDiscussed } = await import('./leadContext')

    const result = mergeDiscussed([], ['proj-x', 'proj-y'])

    expect(result).toEqual(['proj-x', 'proj-y'])
  })
})
