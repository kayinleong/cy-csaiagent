/**
 * src/jobs/jobs.test.ts
 *
 * Unit tests for the QStash stall-detect job:
 *   - Test 1: unsigned request is rejected before stall processing
 *   - Test 2: signed request runs findStalled, emitHandoffSignal, writeHeartbeat
 *   - Test 3: writeHeartbeat upserts a heartbeat doc with timestamp + tenantId
 *
 * Offline / pure-logic assertions — no real QStash keys or Firestore creds.
 * verifySignatureAppRouter is mocked so we can drive both signed/unsigned paths.
 *
 * References:
 *   - TSD §3.4 scheduled jobs + §9 cron heartbeats
 *   - 01-11 PLAN.md Task 2 behaviors
 *   - T-01-33 (unsigned cron rejected), T-01-34 (heartbeat per run)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── vi.hoisted mock variables ─────────────────────────────────────────────────

const mockFindStalled = vi.hoisted(() => vi.fn())
const mockEmitHandoffSignal = vi.hoisted(() => vi.fn())
const mockWriteHeartbeat = vi.hoisted(() => vi.fn())
const mockHeartbeatSet = vi.hoisted(() => vi.fn())
const mockHeartbeatDoc = vi.hoisted(() => vi.fn())

// ─── Mock @/src/escalation ─────────────────────────────────────────────────────

vi.mock('@/src/escalation', () => ({
  findStalled: mockFindStalled,
  emitHandoffSignal: mockEmitHandoffSignal,
}))

// ─── Mock @/src/jobs/heartbeat ─────────────────────────────────────────────────

vi.mock('@/src/jobs/heartbeat', () => ({
  writeHeartbeat: mockWriteHeartbeat,
}))

// ─── Mock firebase-admin/firestore (for heartbeat unit tests) ─────────────────

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}))

// ─── Mock @/src/firebase/admin ─────────────────────────────────────────────────

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: mockHeartbeatDoc.mockReturnValue({
        set: mockHeartbeatSet,
      }),
    })),
  },
}))

// ─── Mock @upstash/qstash/nextjs ──────────────────────────────────────────────
// We mock verifySignatureAppRouter so we control accept/reject behavior.
// In "verify mode" we simply call through to the inner handler.
// In "reject mode" we return a 401 Response without calling the handler.

let _verifyMode: 'accept' | 'reject' = 'accept'

vi.mock('@upstash/qstash/nextjs', () => ({
  verifySignatureAppRouter: vi.fn((handler: (req: Request) => Promise<Response>) => {
    // Return a wrapped handler that respects _verifyMode
    return async (req: Request) => {
      if (_verifyMode === 'reject') {
        return new Response('Unauthorized', { status: 401 })
      }
      return handler(req)
    }
  }),
}))

// ─── Import modules under test AFTER all mocks ────────────────────────────────

import { writeHeartbeat } from '@/src/jobs/heartbeat'

// ─── Test 1: unsigned request is rejected (401) ────────────────────────────────

describe('stall-detect route handler — signature verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _verifyMode = 'reject'
  })

  it('rejects an unsigned request with 401 — no stall processing occurs', async () => {
    // Dynamic import inside test to get fresh module with the mock in "reject" mode
    const { POST } = await import('../../app/api/jobs/stall-detect/route')

    const req = new Request('https://example.app/api/jobs/stall-detect', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockFindStalled).not.toHaveBeenCalled()
    expect(mockEmitHandoffSignal).not.toHaveBeenCalled()
    expect(mockWriteHeartbeat).not.toHaveBeenCalled()
  })
})

// ─── Test 2: signed request runs stall detection loop + heartbeat ─────────────

describe('stall-detect route handler — signed request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _verifyMode = 'accept'
  })

  it('runs findStalled({days:2}), emitHandoffSignal for each stalled agent, writes heartbeat, returns {processed:N}', async () => {
    const stalledAgents = [
      { agentUid: 'agent-001', seniorCoachId: 'coach-001', lastActiveAt: new Date() },
      { agentUid: 'agent-002', seniorCoachId: 'coach-001', lastActiveAt: new Date() },
    ]
    mockFindStalled.mockResolvedValueOnce(stalledAgents)
    mockEmitHandoffSignal.mockResolvedValue(undefined)
    mockWriteHeartbeat.mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/jobs/stall-detect/route')

    const req = new Request('https://example.app/api/jobs/stall-detect', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json() as { processed: number }
    expect(body.processed).toBe(2)

    expect(mockFindStalled).toHaveBeenCalledWith({ days: 2 })
    expect(mockEmitHandoffSignal).toHaveBeenCalledTimes(2)
    expect(mockEmitHandoffSignal).toHaveBeenCalledWith({
      agentUid: 'agent-001',
      seniorCoachId: 'coach-001',
      reason: 'stall',
      contextBundle: expect.objectContaining({ lastActiveAt: expect.any(Date) }),
    })
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('stall-detect')
  })

  it('returns {processed:0} and still writes a heartbeat when no agents are stalled', async () => {
    mockFindStalled.mockResolvedValueOnce([])
    mockWriteHeartbeat.mockResolvedValue(undefined)

    const { POST } = await import('../../app/api/jobs/stall-detect/route')

    const req = new Request('https://example.app/api/jobs/stall-detect', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { processed: number }
    expect(body.processed).toBe(0)
    expect(mockEmitHandoffSignal).not.toHaveBeenCalled()
    expect(mockWriteHeartbeat).toHaveBeenCalledWith('stall-detect')
  })
})

// ─── Test 3: writeHeartbeat upserts heartbeat doc ─────────────────────────────

describe('writeHeartbeat(jobName)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts a heartbeat doc with { job, ts } and tenantId stamped', async () => {
    mockHeartbeatSet.mockResolvedValueOnce(undefined)

    await writeHeartbeat('stall-detect')

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
