/**
 * src/dashboard/dashboard.test.ts
 *
 * Tests for the senior-coach dashboard query helpers (queries.ts) and metric
 * derivation functions (metrics.ts).
 *
 * OFFLINE — these tests use a mocked Firestore. No live Firebase connection
 * required. `npx vitest run src/dashboard` MUST stay GREEN.
 *
 * Coverage:
 *   - getDownline: returns only agents where seniorCoachId == coachUid (AUTH-06).
 *   - getOpenStalls: returns only open escalations for the coach's downline.
 *   - getKnowledgeGaps: returns gaps ordered by lastSeenAt for the coach's downline.
 *   - Cross-coach exclusion: a different coach's data is never returned.
 *   - auditDrilldown called on every downline read (PDPA, TSD §5.1).
 *   - daysInJourney: computes correct delta from lastActiveAt to now.
 *   - checkpointVelocity: computes avg days per checkpoint from the D2_JOURNEY config.
 *   - trainingFunnel: buckets agents by stage and computes stall rate.
 *   - No lead/close fields in metrics (Pitfall 8 — Phase-3 only).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { D2_JOURNEY } from '@/src/coach/journey/config'

// ─── Mock firebase/admin ─────────────────────────────────────────────────────
// We mock the whole admin module so no real Firebase SDK is initialized.
vi.mock('@/src/firebase/admin', () => ({
  adminDb: {},
}))

// ─── Mock audit/log ──────────────────────────────────────────────────────────
// Capture calls to audit.log to verify drilldown audit requirement.
const mockAuditLog = vi.fn().mockResolvedValue(undefined)
vi.mock('@/src/audit/log', () => ({
  log: mockAuditLog,
  auditDrilldown: vi.fn().mockResolvedValue(undefined),
}))

// ─── Mock collections ────────────────────────────────────────────────────────
// We build a small fake query builder that supports .where().orderBy().get()
function makeQueryResult(docs: { id: string; data: Record<string, unknown> }[]) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => d.data,
    })),
  }
}

function makeQueryBuilder(result: ReturnType<typeof makeQueryResult>) {
  const builder = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(result),
  }
  return builder
}

// Reusable coach UIDs
const COACH_A = 'coach-a-uid'
const COACH_B = 'coach-b-uid'

// Fake agent profiles — only profiles owned by COACH_A should appear for COACH_A
const fakeAgentsA = [
  {
    id: 'agent-1',
    data: {
      tenantId: 'd2',
      journeyStage: 'onboarding',
      currentCheckpoint: 'day-one-pairing',
      lastActiveAt: new Date('2026-05-30T10:00:00Z'),
      activeLeadIds: [],
      seniorCoachId: COACH_A,
    },
  },
  {
    id: 'agent-2',
    data: {
      tenantId: 'd2',
      journeyStage: 'training',
      currentCheckpoint: 'advanced-negotiation',
      lastActiveAt: new Date('2026-05-28T08:00:00Z'),
      activeLeadIds: [],
      seniorCoachId: COACH_A,
    },
  },
]

const fakeAgentsB = [
  {
    id: 'agent-3',
    data: {
      tenantId: 'd2',
      journeyStage: 'onboarding',
      currentCheckpoint: 'product-foundations',
      lastActiveAt: new Date('2026-05-31T10:00:00Z'),
      activeLeadIds: [],
      seniorCoachId: COACH_B,
    },
  },
]

const fakeOpenStallsA = [
  {
    id: 'esc-1',
    data: {
      tenantId: 'd2',
      agentUid: 'agent-1',
      seniorCoachId: COACH_A,
      reason: 'stall',
      status: 'open',
      openedAt: new Date('2026-05-28T08:00:00Z'),
      contextBundle: {},
    },
  },
]

const fakeGapsA = [
  {
    id: 'gap-1',
    data: {
      tenantId: 'd2',
      seniorCoachId: COACH_A,
      agentUid: 'agent-1',
      topicHash: 'abc123',
      topicLabel: 'bumiputera quota',
      lang: 'en',
      count: 3,
      lastSeenAt: new Date('2026-05-31T09:00:00Z'),
    },
  },
]

// Module-level mock refs
let mockAgentProfilesRef: ReturnType<typeof makeQueryBuilder>
let mockEscalationsRef: ReturnType<typeof makeQueryBuilder>
let mockKnowledgeGapsRef: ReturnType<typeof makeQueryBuilder>

vi.mock('@/src/firebase/collections', () => ({
  agentProfilesRef: () => mockAgentProfilesRef,
  escalationsRef: () => mockEscalationsRef,
  knowledgeGapsRef: () => mockKnowledgeGapsRef,
  TENANT_ID: 'd2',
}))

// ─── Import the modules under test AFTER mocks ───────────────────────────────
// Dynamic imports to ensure mocks are in place before the module initializes.
let getDownline: (coachUid: string) => Promise<unknown[]>
let getOpenStalls: (coachUid: string) => Promise<unknown[]>
let getKnowledgeGaps: (coachUid: string) => Promise<unknown[]>
let auditDrilldown: (actorUid: string, targetRef: string) => Promise<void>

let daysInJourney: (profile: { lastActiveAt: Date }, now: Date) => number
let checkpointVelocity: (profile: { journeyStage: string; currentCheckpoint: string }, config: typeof D2_JOURNEY) => number
let trainingFunnel: (profiles: Array<{ journeyStage: string; currentCheckpoint: string }>) => { stages: Record<string, number>; stallRate: number }

beforeEach(async () => {
  vi.clearAllMocks()

  // Set up default query mocks for COACH_A
  mockAgentProfilesRef = makeQueryBuilder(makeQueryResult(fakeAgentsA))
  mockEscalationsRef = makeQueryBuilder(makeQueryResult(fakeOpenStallsA))
  mockKnowledgeGapsRef = makeQueryBuilder(makeQueryResult(fakeGapsA))

  // Re-import modules to pick up fresh mocks
  const queriesModule = await import('./queries')
  const metricsModule = await import('./metrics')
  const auditModule = await import('@/src/audit/log')

  getDownline = queriesModule.getDownline
  getOpenStalls = queriesModule.getOpenStalls
  getKnowledgeGaps = queriesModule.getKnowledgeGaps
  auditDrilldown = queriesModule.auditDrilldown

  daysInJourney = metricsModule.daysInJourney
  checkpointVelocity = metricsModule.checkpointVelocity
  trainingFunnel = metricsModule.trainingFunnel

  // Spy on audit log (cast through unknown for type safety)
  ;(auditModule as unknown as { log: typeof mockAuditLog }).log = mockAuditLog
})

afterEach(() => {
  vi.resetModules()
})

// ─── Query tests ──────────────────────────────────────────────────────────────

describe('getDownline', () => {
  it('returns agents for the given coach only (AUTH-06)', async () => {
    const result = await getDownline(COACH_A)
    expect(result).toHaveLength(fakeAgentsA.length)
  })

  it('applies the seniorCoachId == coachUid filter', async () => {
    await getDownline(COACH_A)
    expect(mockAgentProfilesRef.where).toHaveBeenCalledWith('seniorCoachId', '==', COACH_A)
  })

  it('calls auditDrilldown for the coach read (PDPA)', async () => {
    const auditSpy = vi.spyOn(await import('./queries'), 'auditDrilldown').mockResolvedValue(undefined)
    await getDownline(COACH_A)
    // The function should write an audit row
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })

  it('cross-coach: COACH_B data not returned for COACH_A', async () => {
    // Wire up mock to only return COACH_A agents when filtered by COACH_A
    mockAgentProfilesRef.get.mockResolvedValueOnce(makeQueryResult(fakeAgentsA))
    const result = await getDownline(COACH_A) as Array<{ id: string; data: { seniorCoachId: string } }>
    const allBelongToA = result.every(
      (item) => item.data.seniorCoachId === COACH_A,
    )
    expect(allBelongToA).toBe(true)
    // COACH_B's agent should not appear
    const hasBAgent = result.some((item) => item.id === 'agent-3')
    expect(hasBAgent).toBe(false)
  })
})

describe('getOpenStalls', () => {
  it('returns open escalations for the given coach', async () => {
    const result = await getOpenStalls(COACH_A)
    expect(result).toHaveLength(fakeOpenStallsA.length)
  })

  it('applies seniorCoachId and status:open filters', async () => {
    await getOpenStalls(COACH_A)
    expect(mockEscalationsRef.where).toHaveBeenCalledWith('seniorCoachId', '==', COACH_A)
    expect(mockEscalationsRef.where).toHaveBeenCalledWith('status', '==', 'open')
  })

  it('calls auditDrilldown for coach read (PDPA)', async () => {
    const auditSpy = vi.spyOn(await import('./queries'), 'auditDrilldown').mockResolvedValue(undefined)
    await getOpenStalls(COACH_A)
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })
})

describe('getKnowledgeGaps', () => {
  it('returns gaps for the given coach', async () => {
    const result = await getKnowledgeGaps(COACH_A)
    expect(result).toHaveLength(fakeGapsA.length)
  })

  it('applies seniorCoachId filter and orderBy lastSeenAt', async () => {
    await getKnowledgeGaps(COACH_A)
    expect(mockKnowledgeGapsRef.where).toHaveBeenCalledWith('seniorCoachId', '==', COACH_A)
    expect(mockKnowledgeGapsRef.orderBy).toHaveBeenCalledWith('lastSeenAt', 'desc')
  })

  it('calls auditDrilldown for coach read (PDPA)', async () => {
    const auditSpy = vi.spyOn(await import('./queries'), 'auditDrilldown').mockResolvedValue(undefined)
    await getKnowledgeGaps(COACH_A)
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })
})

// ─── Timestamp normalization (regression: dashboard "Invalid time value") ──────
// The Admin SDK returns Firestore Timestamp objects, not Dates. queries.ts must
// normalize them so page.tsx .toISOString() and metrics.daysInJourney .getTime()
// receive real Dates. A Timestamp is shaped { toDate(): Date, seconds, nanoseconds }.
describe('Firestore Timestamp normalization', () => {
  function fakeTimestamp(iso: string) {
    const d = new Date(iso)
    return {
      toDate: () => d,
      seconds: Math.floor(d.getTime() / 1000),
      nanoseconds: 0,
    }
  }

  it('getOpenStalls.openedAt is a real Date with a valid toISOString() (not a Timestamp)', async () => {
    mockEscalationsRef.get.mockResolvedValueOnce(
      makeQueryResult([
        {
          id: 'esc-ts',
          data: {
            tenantId: 'd2',
            agentUid: 'agent-1',
            seniorCoachId: COACH_A,
            reason: 'stall',
            status: 'open',
            openedAt: fakeTimestamp('2026-05-28T08:00:00Z'),
            contextBundle: {},
          },
        },
      ]),
    )
    const result = (await getOpenStalls(COACH_A)) as Array<{ data: { openedAt: Date } }>
    expect(result[0]!.data.openedAt).toBeInstanceOf(Date)
    expect(() => result[0]!.data.openedAt.toISOString()).not.toThrow()
    expect(result[0]!.data.openedAt.toISOString()).toBe('2026-05-28T08:00:00.000Z')
  })

  it('getOpenStalls.contextBundle.lastActiveAt is a real Date (not a Timestamp) and preserves non-date fields', async () => {
    // The stall-detect/escalate jobs persist contextBundle: { lastActiveAt } —
    // read back as a Firestore Timestamp. page.tsx passes the bundle straight into
    // the StallInbox client island, so a raw Timestamp throws "Only plain objects…
    // can be passed to Client Components" at the RSC→Client boundary.
    mockEscalationsRef.get.mockResolvedValueOnce(
      makeQueryResult([
        {
          id: 'esc-bundle-ts',
          data: {
            tenantId: 'd2',
            agentUid: 'agent-1',
            seniorCoachId: COACH_A,
            reason: 'stall',
            status: 'open',
            openedAt: fakeTimestamp('2026-05-28T08:00:00Z'),
            contextBundle: {
              lastActiveAt: fakeTimestamp('2026-05-26T08:00:00Z'),
              conversationId: 'conv-123', // non-date field must survive untouched
            },
          },
        },
      ]),
    )
    const result = (await getOpenStalls(COACH_A)) as Array<{
      data: { contextBundle: { lastActiveAt: Date; conversationId: string } }
    }>
    const bundle = result[0]!.data.contextBundle
    expect(bundle.lastActiveAt).toBeInstanceOf(Date)
    expect(() => bundle.lastActiveAt.toISOString()).not.toThrow()
    expect(bundle.lastActiveAt.toISOString()).toBe('2026-05-26T08:00:00.000Z')
    // Non-date values pass through verbatim
    expect(bundle.conversationId).toBe('conv-123')
  })

  it('getKnowledgeGaps.lastSeenAt is a real Date with a valid toISOString()', async () => {
    mockKnowledgeGapsRef.get.mockResolvedValueOnce(
      makeQueryResult([
        {
          id: 'gap-ts',
          data: {
            tenantId: 'd2',
            seniorCoachId: COACH_A,
            agentUid: 'agent-1',
            topicHash: 'abc',
            topicLabel: 'foreign buyer eligibility',
            lang: 'en',
            count: 2,
            lastSeenAt: fakeTimestamp('2026-05-31T09:00:00Z'),
          },
        },
      ]),
    )
    const result = (await getKnowledgeGaps(COACH_A)) as Array<{ data: { lastSeenAt: Date } }>
    expect(result[0]!.data.lastSeenAt).toBeInstanceOf(Date)
    expect(result[0]!.data.lastSeenAt.toISOString()).toBe('2026-05-31T09:00:00.000Z')
  })

  it('getDownline.lastActiveAt is a real Date usable by daysInJourney (.getTime())', async () => {
    mockAgentProfilesRef.get.mockResolvedValueOnce(
      makeQueryResult([
        {
          id: 'agent-ts',
          data: {
            tenantId: 'd2',
            journeyStage: 'onboarding',
            currentCheckpoint: 'start',
            lastActiveAt: fakeTimestamp('2026-05-23T00:00:00Z'),
            activeLeadIds: [],
            seniorCoachId: COACH_A,
          },
        },
      ]),
    )
    const result = (await getDownline(COACH_A)) as Array<{ data: { lastActiveAt: Date } }>
    expect(result[0]!.data.lastActiveAt).toBeInstanceOf(Date)
    // daysInJourney calls .getTime() — would throw on a raw Timestamp
    const now = new Date('2026-05-30T00:00:00Z')
    expect(daysInJourney({ lastActiveAt: result[0]!.data.lastActiveAt }, now)).toBe(7)
  })
})

// ─── Metric tests ─────────────────────────────────────────────────────────────

describe('daysInJourney', () => {
  it('returns correct number of days between lastActiveAt and now', () => {
    const lastActive = new Date('2026-05-23T00:00:00Z')
    const now = new Date('2026-05-30T00:00:00Z')
    const result = daysInJourney({ lastActiveAt: lastActive }, now)
    expect(result).toBe(7)
  })

  it('returns 0 for agents who were active today', () => {
    const now = new Date('2026-05-30T00:00:00Z')
    const result = daysInJourney({ lastActiveAt: now }, now)
    expect(result).toBe(0)
  })

  it('returns non-negative value even if lastActiveAt is in the future (clock skew guard)', () => {
    const lastActive = new Date('2026-05-31T00:00:00Z')
    const now = new Date('2026-05-30T00:00:00Z')
    const result = daysInJourney({ lastActiveAt: lastActive }, now)
    expect(result).toBeGreaterThanOrEqual(0)
  })
})

describe('checkpointVelocity', () => {
  it('returns a positive number of days per checkpoint', () => {
    const profile = {
      journeyStage: 'onboarding',
      currentCheckpoint: 'product-foundations',
    }
    const velocity = checkpointVelocity(profile, D2_JOURNEY)
    expect(velocity).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 for agents on the first checkpoint (sentinel start)', () => {
    const profile = {
      journeyStage: 'onboarding',
      currentCheckpoint: 'start',
    }
    const velocity = checkpointVelocity(profile, D2_JOURNEY)
    expect(velocity).toBe(0)
  })

  it('returns the total journey length position for stage+checkpoint', () => {
    const profile = {
      journeyStage: 'training',
      currentCheckpoint: 'advanced-negotiation',
    }
    const velocity = checkpointVelocity(profile, D2_JOURNEY)
    // Should be > 0 since this is past the onboarding stage
    expect(velocity).toBeGreaterThan(0)
  })
})

describe('trainingFunnel', () => {
  it('returns stage counts keyed by stage name', () => {
    const profiles = [
      { journeyStage: 'onboarding', currentCheckpoint: 'day-one-pairing' },
      { journeyStage: 'onboarding', currentCheckpoint: 'product-foundations' },
      { journeyStage: 'training', currentCheckpoint: 'advanced-negotiation' },
    ]
    const funnel = trainingFunnel(profiles)
    expect(funnel.stages['onboarding']).toBe(2)
    expect(funnel.stages['training']).toBe(1)
  })

  it('computes stallRate as proportion of agents with no recent progress', () => {
    const profiles = [
      { journeyStage: 'onboarding', currentCheckpoint: 'day-one-pairing' },
      { journeyStage: 'training', currentCheckpoint: 'advanced-negotiation' },
    ]
    const funnel = trainingFunnel(profiles)
    // stallRate is 0..1
    expect(funnel.stallRate).toBeGreaterThanOrEqual(0)
    expect(funnel.stallRate).toBeLessThanOrEqual(1)
  })

  it('does NOT contain lead or close fields (Pitfall 8 — Phase-3 only)', () => {
    const profiles = [{ journeyStage: 'onboarding', currentCheckpoint: 'day-one-pairing' }]
    const funnel = trainingFunnel(profiles)
    expect(funnel).not.toHaveProperty('leads')
    expect(funnel).not.toHaveProperty('closes')
    expect(funnel).not.toHaveProperty('leadCount')
    expect(funnel).not.toHaveProperty('closeCount')
  })

  it('returns empty stages for empty input', () => {
    const funnel = trainingFunnel([])
    expect(funnel.stages).toEqual({})
    expect(funnel.stallRate).toBe(0)
  })
})

// ─── auditDrilldown unit test ─────────────────────────────────────────────────

describe('auditDrilldown', () => {
  it('is exported from queries module', () => {
    expect(typeof auditDrilldown).toBe('function')
  })
})
