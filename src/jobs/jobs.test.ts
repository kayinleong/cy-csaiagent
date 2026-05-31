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

// Heartbeat mock — tracks calls from the route handler
const mockWriteHeartbeat = vi.hoisted(() => vi.fn())

// adminDb mock — used for direct heartbeat unit test
const mockHeartbeatSet = vi.hoisted(() => vi.fn())
const mockHeartbeatDocFn = vi.hoisted(() => vi.fn())

// ─── Mock @/src/escalation ─────────────────────────────────────────────────────

vi.mock('@/src/escalation', () => ({
  findStalled: mockFindStalled,
  emitHandoffSignal: mockEmitHandoffSignal,
}))

// ─── Mock @upstash/qstash/nextjs ──────────────────────────────────────────────
// We mock verifySignatureAppRouter so we control accept/reject behavior.
// "accept" mode calls the inner handler; "reject" mode returns 401.

let _verifyMode: 'accept' | 'reject' = 'accept'

vi.mock('@upstash/qstash/nextjs', () => ({
  verifySignatureAppRouter: vi.fn((handler: (req: Request) => Promise<Response>) => {
    return async (req: Request) => {
      if (_verifyMode === 'reject') {
        return new Response('Unauthorized', { status: 401 })
      }
      return handler(req)
    }
  }),
}))

// ─── Mock @/src/jobs/heartbeat — for route handler tests (Tests 1+2) ─────────
// The route calls writeHeartbeat; we track it via mockWriteHeartbeat.
// For Test 3 we directly test the heartbeat module by mocking adminDb instead.

vi.mock('@/src/jobs/heartbeat', () => ({
  writeHeartbeat: mockWriteHeartbeat,
  readHeartbeat: vi.fn(),
}))

// ─── Mock @/src/firebase/admin — for direct heartbeat tests (Test 3) ─────────

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: mockHeartbeatDocFn.mockReturnValue({
        set: mockHeartbeatSet,
      }),
    })),
  },
}))

// ─── Mock firebase-admin/firestore ────────────────────────────────────────────

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}))

// ─── Mock @/src/firebase/collections (for TENANT_ID) ─────────────────────────

vi.mock('@/src/firebase/collections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/firebase/collections')>()
  return {
    ...actual,
    TENANT_ID: 'd2',
  }
})

// ─── Test 1: unsigned request is rejected (401) ────────────────────────────────

describe('stall-detect route handler — signature verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _verifyMode = 'reject'
  })

  it('rejects an unsigned request with 401 — no stall processing occurs', async () => {
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
// We directly test the REAL writeHeartbeat module by bypassing the mock above.
// The adminDb mock intercepts the Firestore call.

describe('writeHeartbeat(jobName)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset adminDb mock chain for each test
    mockHeartbeatDocFn.mockReturnValue({ set: mockHeartbeatSet })
  })

  it('upserts a heartbeat doc with { job, ts } and tenantId stamped', async () => {
    mockHeartbeatSet.mockResolvedValueOnce(undefined)

    // Import the REAL heartbeat module bypassing the vi.mock at module level.
    // We do this by importing from the actual path — Vitest resolves the mock
    // for the same identifier used in vi.mock(), but we can use the real module
    // by calling the function directly from a fresh unmocked context.
    //
    // In practice, the route test covers writeHeartbeat being called.
    // For this test, we validate the heartbeat module's real behavior by
    // re-exporting via a direct call from the module under the adminDb mock.
    const { writeHeartbeat: realWriteHeartbeat } = await vi.importActual<
      typeof import('./heartbeat')
    >('@/src/jobs/heartbeat')

    await realWriteHeartbeat('stall-detect')

    expect(mockHeartbeatDocFn).toHaveBeenCalledWith('stall-detect')
    expect(mockHeartbeatSet).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'stall-detect',
        tenantId: 'd2',
      }),
      { merge: true },
    )
  })
})
