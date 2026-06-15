/**
 * src/jobs/jobs.test.ts
 *
 * Unit tests for the on-visit lazy-cron job runner (runDueJobs / runJob).
 *
 * Covers:
 *   1. A job runs when it is DUE (lastRunAt older than windowMs)
 *   2. A job is SKIPPED when it is NOT due (lastRunAt is recent)
 *   3. The last-run doc is written (new lastRunAt) when a job runs
 *   4. Idempotency under concurrent double-call: both calls hit the same
 *      transaction; the second sees the updated lastRunAt and skips the body
 *   5. writeHeartbeat is called after a successful stall-detect run
 *   6. First-ever run (no existing doc) treats the job as due
 *   7. isWithinWorkingHours: true for KL weekday 10:00, false for 02:00 / weekend
 *   8. stall-detect writes exactly ONE nudge for a stalled agent (cadence-capped)
 *   9. escalate defers when outside working hours, emits when inside + stall ≥48h
 *
 * Offline — all Firestore and Firebase Admin calls are mocked.
 * No real Firebase credentials or network access required.
 *
 * References:
 *   - src/jobs/runDueJobs.ts (system under test)
 *   - src/jobs/heartbeat.ts (writeHeartbeat side-effect)
 *   - src/jobs/workingHours.ts (isWithinWorkingHours)
 *   - Decision override 2026-06-01: on-visit lazy-cron
 *   - T-01-34: heartbeat per run
 *   - CDASH-06: working-hours gate
 *   - COACH-04: in-app nudge, cadence-capped
 *   - COACH-05: 48h escalation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'

// ─── vi.hoisted mock variables ─────────────────────────────────────────────────

const mockFindStalled = vi.hoisted(() => vi.fn())
const mockEmitHandoffSignal = vi.hoisted(() => vi.fn())
const mockWriteHeartbeat = vi.hoisted(() => vi.fn())
const mockAppendMessage = vi.hoisted(() => vi.fn())
const mockRollupUsage = vi.hoisted(() => vi.fn())

// Firestore transaction mock infrastructure
const mockTxGet = vi.hoisted(() => vi.fn())
const mockTxSet = vi.hoisted(() => vi.fn())
const mockRunTransaction = vi.hoisted(() => vi.fn())
const mockCollectionDoc = vi.hoisted(() => vi.fn())

// ─── Mock @/src/escalation ─────────────────────────────────────────────────────

vi.mock('@/src/escalation', () => ({
  findStalled: mockFindStalled,
  emitHandoffSignal: mockEmitHandoffSignal,
}))

// ─── Mock @/src/memory/conversation ───────────────────────────────────────────

vi.mock('@/src/memory/conversation', () => ({
  appendMessage: mockAppendMessage,
  loadRecent: vi.fn(),
}))

// ─── Mock @/src/jobs/heartbeat ────────────────────────────────────────────────

vi.mock('@/src/jobs/heartbeat', () => ({
  writeHeartbeat: mockWriteHeartbeat,
  readHeartbeat: vi.fn(),
}))

// ─── Mock @/src/usage/rollup (usage-rollup job body) ──────────────────────────

vi.mock('@/src/usage/rollup', () => ({
  rollupUsage: mockRollupUsage,
}))

// ─── Mock @/src/firebase/admin ────────────────────────────────────────────────

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: mockCollectionDoc,
    })),
    runTransaction: mockRunTransaction,
  },
}))

// ─── Mock firebase-admin/firestore ────────────────────────────────────────────

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
  Timestamp: {
    fromDate: vi.fn((d: Date) => ({
      toMillis: () => d.getTime(),
      toDate: () => d,
    })),
  },
}))

// ─── Mock @/src/firebase/collections (for TENANT_ID) ─────────────────────────

vi.mock('@/src/firebase/collections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/firebase/collections')>()
  return { ...actual, TENANT_ID: 'd2' }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock Firestore Timestamp-like object from a Date. */
function makeTimestamp(d: Date): Pick<Timestamp, 'toMillis' | 'toDate'> {
  return { toMillis: () => d.getTime(), toDate: () => d }
}

/**
 * Set up mockRunTransaction to simulate a Firestore transaction.
 *
 * The callback receives a transaction object with `get` and `set` wired to
 * the shared mock functions. The transaction body is called once.
 *
 * @param snapExists  Whether the lastRun doc exists in the simulated store.
 * @param lastRunDate The lastRunAt value if the doc exists.
 */
function setupTransaction(snapExists: boolean, lastRunDate?: Date) {
  mockRunTransaction.mockImplementation(
    async (callback: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) => {
      mockTxGet.mockResolvedValue({
        exists: snapExists,
        data: () =>
          snapExists && lastRunDate
            ? { jobName: 'stall-detect', lastRunAt: makeTimestamp(lastRunDate), tenantId: 'd2' }
            : undefined,
      })
      await callback({ get: mockTxGet, set: mockTxSet })
    },
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runJob — due/skip/first-ever logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'stall-detect' })
    mockFindStalled.mockResolvedValue([])
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
  })

  it('runs the job when lastRunAt is older than windowMs (due)', async () => {
    // lastRunAt = 25 hours ago; window = 24 hours → DUE
    const now = new Date('2026-06-01T10:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    setupTransaction(true, lastRun)

    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('stall-detect', now)

    expect(ran).toBe(true)
    // The transaction must have committed the new lastRunAt
    expect(mockTxSet).toHaveBeenCalledOnce()
    // stall-detect body: findStalled + writeHeartbeat
    expect(mockFindStalled).toHaveBeenCalledWith({ days: 2 })
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('stall-detect')
  })

  it('skips the job when lastRunAt is recent (not due)', async () => {
    // lastRunAt = 1 hour ago; window = 24 hours → NOT due
    const now = new Date('2026-06-01T10:00:00Z')
    const lastRun = new Date(now.getTime() - 1 * 60 * 60 * 1000)

    setupTransaction(true, lastRun)

    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('stall-detect', now)

    expect(ran).toBe(false)
    expect(mockTxSet).not.toHaveBeenCalled()
    expect(mockFindStalled).not.toHaveBeenCalled()
  })

  it('runs on first-ever visit (no existing doc)', async () => {
    // No doc in the simulated store → job has never run → treat as due
    setupTransaction(false)

    const now = new Date('2026-06-01T10:00:00Z')
    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('stall-detect', now)

    expect(ran).toBe(true)
    expect(mockTxSet).toHaveBeenCalledOnce()
    expect(mockFindStalled).toHaveBeenCalledWith({ days: 2 })
  })

  it('writes the new lastRunAt inside the transaction when the job runs', async () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    setupTransaction(true, lastRun)

    const { runJob } = await import('./runDueJobs')
    await runJob('stall-detect', now)

    // The set call should include the updated lastRunAt derived from `now`
    const [, setData] = mockTxSet.mock.calls[0] as [unknown, { lastRunAt: { toMillis(): number } }]
    expect(setData.lastRunAt.toMillis()).toBe(now.getTime())
  })

  it('returns false for an unknown job name', async () => {
    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('nonexistent-job', new Date())
    expect(ran).toBe(false)
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })
})

describe('runJob — idempotency under simulated concurrent double-call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'stall-detect' })
    mockFindStalled.mockResolvedValue([])
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
  })

  it('only runs the job body once when two concurrent calls race', async () => {
    const now = new Date('2026-06-01T10:00:00Z')
    // Both callers start with a stale lastRunAt (25 h ago)
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    let callCount = 0

    // Simulate the transaction race:
    //   - First call: doc shows stale lastRunAt → runs body, writes new lastRunAt
    //   - Second call (retry): doc shows fresh lastRunAt (from call 1) → skips body
    mockRunTransaction.mockImplementation(
      async (callback: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) => {
        callCount++
        const isFirstCall = callCount === 1

        mockTxGet.mockResolvedValue({
          exists: true,
          data: () => ({
            jobName: 'stall-detect',
            // First call sees stale; second call sees fresh (post-commit)
            lastRunAt: makeTimestamp(isFirstCall ? lastRun : now),
            tenantId: 'd2',
          }),
        })

        await callback({ get: mockTxGet, set: mockTxSet })
      },
    )

    const { runJob } = await import('./runDueJobs')

    // Simulate two concurrent visitors
    const [ran1, ran2] = await Promise.all([
      runJob('stall-detect', now),
      runJob('stall-detect', now),
    ])

    // Exactly one should have run; the other skipped
    const runCount = [ran1, ran2].filter(Boolean).length
    expect(runCount).toBe(1)

    // Job body (findStalled) called exactly once
    expect(mockFindStalled).toHaveBeenCalledOnce()
  })
})

describe('runDueJobs — stall-detect with stalled agents', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'stall-detect' })
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
    mockAppendMessage.mockResolvedValue('msg-001')
    // Default: no existing nudge in thread
    const memoryMod = await import('@/src/memory/conversation')
    vi.mocked(memoryMod.loadRecent).mockResolvedValue([])
  })

  it('calls emitHandoffSignal for each stalled agent and writes heartbeat', async () => {
    const stalledAgents = [
      { agentUid: 'agent-001', seniorCoachId: 'coach-001', lastActiveAt: new Date() },
      { agentUid: 'agent-002', seniorCoachId: 'coach-001', lastActiveAt: new Date() },
    ]
    mockFindStalled.mockResolvedValue(stalledAgents)

    const now = new Date('2026-06-01T10:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    setupTransaction(true, lastRun)

    const { runDueJobs } = await import('./runDueJobs')
    const result = await runDueJobs(now)

    expect(result.ran).toContain('stall-detect')
    expect(mockEmitHandoffSignal).toHaveBeenCalledTimes(2)
    expect(mockEmitHandoffSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentUid: 'agent-001',
        seniorCoachId: 'coach-001',
        reason: 'stall',
        contextBundle: expect.objectContaining({ lastActiveAt: expect.any(Date) }),
      }),
    )
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('stall-detect')
  })

  it('returns {processed:0} and writes heartbeat when no agents are stalled', async () => {
    mockFindStalled.mockResolvedValue([])

    const now = new Date('2026-06-01T10:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    setupTransaction(true, lastRun)

    const { runDueJobs } = await import('./runDueJobs')
    const result = await runDueJobs(now)

    expect(result.ran).toContain('stall-detect')
    expect(mockEmitHandoffSignal).not.toHaveBeenCalled()
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('stall-detect')
  })
})

// ─── isWithinWorkingHours tests ───────────────────────────────────────────────

describe('isWithinWorkingHours()', () => {
  it('returns true for Asia/Kuala_Lumpur weekday within 09:00–18:00', async () => {
    const { isWithinWorkingHours } = await import('./workingHours')
    // 2026-06-01 is a Monday. 02:00 UTC = 10:00 KL (UTC+8)
    const klWeekday10am = new Date('2026-06-01T02:00:00Z')
    expect(isWithinWorkingHours(klWeekday10am)).toBe(true)
  })

  it('returns false for Asia/Kuala_Lumpur at 02:00 local time (outside working hours)', async () => {
    const { isWithinWorkingHours } = await import('./workingHours')
    // 2026-06-01 is Monday. 18:00 UTC = 02:00+8 KL next day → no, let's use 18:01 UTC = 02:01 KL
    // More simply: 22:00 UTC = 06:00 KL (before 09:00)
    const klEarlyMorning = new Date('2026-06-01T22:00:00Z') // Mon 22:00 UTC = Tue 06:00 KL
    expect(isWithinWorkingHours(klEarlyMorning)).toBe(false)
  })

  it('returns false for Asia/Kuala_Lumpur on a Saturday', async () => {
    const { isWithinWorkingHours } = await import('./workingHours')
    // 2026-06-06 is a Saturday. 02:00 UTC = 10:00 KL
    const klSaturday = new Date('2026-06-06T02:00:00Z')
    expect(isWithinWorkingHours(klSaturday)).toBe(false)
  })

  it('returns false for Asia/Kuala_Lumpur on a Sunday', async () => {
    const { isWithinWorkingHours } = await import('./workingHours')
    // 2026-06-07 is a Sunday. 02:00 UTC = 10:00 KL
    const klSunday = new Date('2026-06-07T02:00:00Z')
    expect(isWithinWorkingHours(klSunday)).toBe(false)
  })

  it('respects custom startHour/endHour opts', async () => {
    const { isWithinWorkingHours } = await import('./workingHours')
    // 2026-06-01 Mon, 02:00 UTC = 10:00 KL → within 08:00–12:00 custom window
    const klMon10am = new Date('2026-06-01T02:00:00Z')
    expect(isWithinWorkingHours(klMon10am, { startHour: 8, endHour: 12 })).toBe(true)
    // Same time but custom window 11:00–18:00 → 10:00 is before 11:00 → false
    expect(isWithinWorkingHours(klMon10am, { startHour: 11, endHour: 18 })).toBe(false)
  })
})

// ─── stall-detect nudge body tests ────────────────────────────────────────────

describe('runDueJobs — stall-detect nudge write (COACH-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'stall-detect' })
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
    mockAppendMessage.mockResolvedValue('msg-001')
  })

  it('writes an in-app nudge MessageDoc into coach-{uid}/messages for a stalled agent', async () => {
    const stalledAgent = {
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      lastActiveAt: new Date('2026-05-29T10:00:00Z'),
    }
    mockFindStalled.mockResolvedValue([stalledAgent])

    // No existing nudge within window
    const mockLoadRecent = vi.mocked(
      (await import('@/src/memory/conversation')).loadRecent,
    )
    mockLoadRecent.mockResolvedValue([])

    const now = new Date('2026-06-01T02:00:00Z') // Mon 10:00 KL
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    setupTransaction(true, lastRun)

    const { runDueJobs } = await import('./runDueJobs')
    await runDueJobs(now)

    expect(mockAppendMessage).toHaveBeenCalledOnce()
    const [cid, msg] = mockAppendMessage.mock.calls[0] as [string, unknown]
    expect(cid).toBe('coach-agent-001')
    expect(msg).toMatchObject({
      role: 'assistant',
      routeDecision: 'nudge',
      redacted: true,
      citations: [],
    })
  })

  it('does NOT write a second nudge if one already exists within the stall window (cadence-cap)', async () => {
    const stalledAgent = {
      agentUid: 'agent-002',
      seniorCoachId: 'coach-001',
      lastActiveAt: new Date('2026-05-29T10:00:00Z'),
    }
    mockFindStalled.mockResolvedValue([stalledAgent])

    // Simulate an existing nudge in the current window
    const mockLoadRecent = vi.mocked(
      (await import('@/src/memory/conversation')).loadRecent,
    )
    mockLoadRecent.mockResolvedValue([
      {
        id: 'existing-nudge',
        data: {
          role: 'assistant' as const,
          content: 'previous nudge',
          routeDecision: 'nudge',
          citations: [],
          tokens: 10,
          redacted: true,
          tenantId: 'd2' as const,
        },
      },
    ])

    const now = new Date('2026-06-01T02:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    setupTransaction(true, lastRun)

    const { runDueJobs } = await import('./runDueJobs')
    await runDueJobs(now)

    // appendMessage must NOT be called because a nudge already exists in the window
    expect(mockAppendMessage).not.toHaveBeenCalled()
  })
})

// ─── escalate job body tests ──────────────────────────────────────────────────

describe('runDueJobs — escalate job body (COACH-05 + CDASH-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'escalate' })
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
    mockAppendMessage.mockResolvedValue('msg-001')
  })

  it('emits a stall escalation when stall ≥48h AND within working hours', async () => {
    const stalledAgent = {
      agentUid: 'agent-escalate-001',
      seniorCoachId: 'coach-001',
      // lastActiveAt = 3 days ago (well past 48h)
      lastActiveAt: new Date('2026-05-29T02:00:00Z'),
    }
    mockFindStalled.mockResolvedValue([stalledAgent])

    // Mon 02:00 UTC = Mon 10:00 KL — within working hours
    const now = new Date('2026-06-01T02:00:00Z')
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    // Override transaction to target 'escalate' job
    mockRunTransaction.mockImplementation(
      async (callback: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) => {
        mockTxGet.mockResolvedValue({
          exists: true,
          data: () => ({
            jobName: 'escalate',
            lastRunAt: makeTimestamp(lastRun),
            tenantId: 'd2',
          }),
        })
        await callback({ get: mockTxGet, set: mockTxSet })
      },
    )

    const { runJob } = await import('./runDueJobs')
    await runJob('escalate', now)

    expect(mockEmitHandoffSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentUid: 'agent-escalate-001',
        seniorCoachId: 'coach-001',
        reason: 'stall',
      }),
    )
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('escalate')
  })

  it('does NOT emit a stall escalation when outside working hours (CDASH-06 gate)', async () => {
    const stalledAgent = {
      agentUid: 'agent-escalate-002',
      seniorCoachId: 'coach-001',
      // lastActiveAt = 3 days ago (well past 48h)
      lastActiveAt: new Date('2026-05-29T02:00:00Z'),
    }
    mockFindStalled.mockResolvedValue([stalledAgent])

    // Sun 22:00 UTC = Mon 06:00 KL — OUTSIDE working hours
    const now = new Date('2026-05-31T22:00:00Z') // Sunday 22:00 UTC
    const lastRun = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    mockRunTransaction.mockImplementation(
      async (callback: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) => {
        mockTxGet.mockResolvedValue({
          exists: true,
          data: () => ({
            jobName: 'escalate',
            lastRunAt: makeTimestamp(lastRun),
            tenantId: 'd2',
          }),
        })
        await callback({ get: mockTxGet, set: mockTxSet })
      },
    )

    const { runJob } = await import('./runDueJobs')
    await runJob('escalate', now)

    // emitHandoffSignal must NOT be called because it's outside working hours
    expect(mockEmitHandoffSignal).not.toHaveBeenCalled()
    // heartbeat still written (job ran; no escalation emitted but job succeeded)
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('escalate')
  })
})

// ─── usage-rollup job body tests (quick-kayinleong-015) ───────────────────────

describe('runJob — usage-rollup (quick-015)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'usage-rollup' })
    mockRollupUsage.mockResolvedValue(undefined)
    mockWriteHeartbeat.mockResolvedValue(undefined)
  })

  it('rolls up BOTH yesterday and today, then writes the heartbeat', async () => {
    // now = 2026-06-15 03:00 UTC = 11:00 MYT
    const now = new Date('2026-06-15T03:00:00Z')
    setupTransaction(false) // never ran → due

    const { runJob } = await import('./runDueJobs')
    const { dayKey } = await import('@/src/usage/types')
    const ran = await runJob('usage-rollup', now)

    const today = dayKey(now)
    const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))

    expect(ran).toBe(true)
    expect(mockRollupUsage).toHaveBeenCalledWith(yesterday)
    expect(mockRollupUsage).toHaveBeenCalledWith(today)
    expect(mockRollupUsage).toHaveBeenCalledTimes(2)
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('usage-rollup')
  })

  it('uses a 1h window — due at 90m since last run', async () => {
    const now = new Date('2026-06-15T03:00:00Z')
    setupTransaction(true, new Date(now.getTime() - 90 * 60 * 1000)) // 90m ago

    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('usage-rollup', now)

    expect(ran).toBe(true)
    expect(mockRollupUsage).toHaveBeenCalledTimes(2)
  })

  it('uses a 1h window — skipped at 30m since last run (recompute throttled)', async () => {
    const now = new Date('2026-06-15T03:00:00Z')
    setupTransaction(true, new Date(now.getTime() - 30 * 60 * 1000)) // 30m ago

    const { runJob } = await import('./runDueJobs')
    const ran = await runJob('usage-rollup', now)

    expect(ran).toBe(false)
    expect(mockRollupUsage).not.toHaveBeenCalled()
  })
})

// ─── Heartbeat unit test (carried over from previous jobs.test.ts) ─────────────

describe('writeHeartbeat(jobName)', () => {
  const mockHeartbeatSet = vi.fn()
  const mockHeartbeatDoc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockHeartbeatDoc.mockReturnValue({ set: mockHeartbeatSet })
  })

  it('upserts a heartbeat doc with { job, ts } and tenantId stamped', async () => {
    // Re-mock adminDb specifically for the heartbeat module path
    vi.doMock('@/src/firebase/admin', () => ({
      adminDb: {
        collection: vi.fn(() => ({ doc: mockHeartbeatDoc })),
        runTransaction: mockRunTransaction,
      },
    }))

    mockHeartbeatSet.mockResolvedValueOnce(undefined)

    const { writeHeartbeat: realWriteHeartbeat } = await vi.importActual<
      typeof import('./heartbeat')
    >('@/src/jobs/heartbeat')

    await realWriteHeartbeat('stall-detect')

    expect(mockHeartbeatDoc).toHaveBeenCalledWith('stall-detect')
    expect(mockHeartbeatSet).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'stall-detect',
        tenantId: 'd2',
      }),
      { merge: true },
    )
  })
})
