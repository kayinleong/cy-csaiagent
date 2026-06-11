// Phase-7 Wave-0 RED stub — implementation lands in 07-05-PLAN.md

/**
 * app/[lang]/(admin)/audit-log/actions.test.ts — AUDIT-01 bounded read contract.
 *
 * Pins the secure behavior of listAuditLogs (D-12 / D-13 / D-14):
 *   1. ADMIN-ONLY (D-13): non-admin → {ok:false, error:'Forbidden'} (role from the
 *      VERIFIED token, never from args). read-only DENIED.
 *   2. BOUNDED (D-13): the query applies orderBy('ts','desc').limit(50) — never
 *      fetch-all (mirrors searchConversations).
 *   3. NO SELF-AUDIT (D-14): listAuditLogs does NOT call auditDrilldown — viewing
 *      hashes-only metadata touches no PII, so auditing the audit-viewer would be
 *      a useless recursion. The server-side gate is the control.
 *   4. METADATA-ONLY (D-12): returns {actorUid, action, targetRef, ts} only —
 *      hashes are sha256 one-way and are NEVER decoded.
 *
 * RED-BY-DESIGN: ./actions does not exist until 07-05 → the import rejects and
 * every spec fails. No emulator needed — all dependencies mocked.
 *
 * Requirements: AUDIT-01, D-12, D-13, D-14.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

// auditDrilldown MUST NOT be called by the audit-log viewer (D-14, no self-audit).
const mockAuditDrilldown = vi.fn().mockResolvedValue(undefined)
vi.mock('@/src/audit/log', () => ({
  log: vi.fn().mockResolvedValue(undefined),
  auditDrilldown: mockAuditDrilldown,
}))

// Capture the bounded query shape (orderBy('ts','desc').limit(50)).
const mockGet = vi.fn().mockResolvedValue({
  docs: [
    {
      id: 'audit-1',
      data: () => ({
        actorUid: 'admin-uid',
        action: 'role-assign',
        targetRef: 'users/x',
        ts: new Date(),
        hashes: { targetUid: 'deadbeef' }, // present in storage — must NOT be returned
      }),
    },
  ],
})
const mockLimit = vi.fn(() => ({ get: mockGet, startAfter: vi.fn().mockReturnThis() }))
const mockOrderBy = vi.fn(() => ({ limit: mockLimit, where: vi.fn().mockReturnThis() }))
const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy, where: vi.fn().mockReturnThis() }))

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import FAILS until 07-05 creates the action module (Wave-0 red-bar intent):
import { listAuditLogs } from './actions'

describe('AUDIT-01 listAuditLogs — admin-gate + bounded + no-self-audit + metadata-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns {ok:false, error:'Forbidden'} for a non-admin (senior-coach) caller (D-13)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await listAuditLogs({})
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
  })

  it("returns {ok:false, error:'Forbidden'} for a read-only caller (D-13/D-24)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'ro-uid', role: 'read-only', tenantId: 'd2',
    } as unknown as AuthenticatedUser)

    const result = await listAuditLogs({})
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
  })

  it("applies orderBy('ts','desc').limit(50) — bounded, never fetch-all (D-13)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)

    await listAuditLogs({})
    expect(mockOrderBy).toHaveBeenCalledWith('ts', 'desc')
    expect(mockLimit).toHaveBeenCalledWith(50)
  })

  it('does NOT call auditDrilldown — the viewer never self-audits (D-14)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)

    await listAuditLogs({})
    expect(mockAuditDrilldown).not.toHaveBeenCalled()
  })

  it('returns metadata-only rows {actorUid, action, targetRef, ts} — hashes NOT decoded (D-12)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid', role: 'admin', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = (await listAuditLogs({})) as { ok: true; rows: Array<Record<string, unknown>> }
    expect(result.ok).toBe(true)
    const row = result.rows[0]
    expect(row).toHaveProperty('actorUid')
    expect(row).toHaveProperty('action')
    expect(row).toHaveProperty('targetRef')
    expect(row).toHaveProperty('ts')
    // sha256 hashes are one-way — never surfaced/decoded by the viewer.
    expect(row).not.toHaveProperty('hashes')
  })
})
