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
 *
 * Offline — all Firestore and Firebase Admin calls are mocked.
 * No real Firebase credentials or network access required.
 *
 * References:
 *   - src/jobs/runDueJobs.ts (system under test)
 *   - src/jobs/heartbeat.ts (writeHeartbeat side-effect)
 *   - Decision override 2026-06-01: on-visit lazy-cron
 *   - T-01-34: heartbeat per run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'

// ─── vi.hoisted mock variables ─────────────────────────────────────────────────

const mockFindStalled = vi.hoisted(() => vi.fn())
const mockEmitHandoffSignal = vi.hoisted(() => vi.fn())
const mockWriteHeartbeat = vi.hoisted(() => vi.fn())

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

// ─── Mock @/src/jobs/heartbeat ────────────────────────────────────────────────

vi.mock('@/src/jobs/heartbeat', () => ({
  writeHeartbeat: mockWriteHeartbeat,
  readHeartbeat: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollectionDoc.mockReturnValue({ id: 'stall-detect' })
    mockWriteHeartbeat.mockResolvedValue(undefined)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
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
