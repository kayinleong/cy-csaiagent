// QUAL-09 Wave-0 stub — implementation lands in 05-03-PLAN.md

/**
 * app/[lang]/(admin)/conversations/actions.test.ts — ADMIN-02 conversation viewer assertions.
 *
 * These unit tests prove that the admin conversation viewer Server Action:
 *   1. Returns {ok:false, error:'Forbidden'} for non-admin roles (role !== 'admin').
 *   2. Calls `auditDrilldown` BEFORE returning any message data (ADMIN-02 / HR-5 audit).
 *      "Call auditDrilldown(user.uid, `conversations/${cid}`) BEFORE returning data."
 *   3. Is READ-ONLY — no resolve/edit/delete path exists.
 *
 * Per PATTERNS.md §conversations/actions.ts: reuse getAgentChatHistory audited-drilldown
 * pattern (dashboard/actions.ts:237), widened to admin/cross-pillar scope.
 *
 * Wave 0: FAILS because the action module is absent.
 * Wave 1+ (05-03-PLAN.md): implementation created; tests turn GREEN.
 *
 * No emulator needed — all dependencies are mocked (unit test).
 *
 * Requirements: ADMIN-02, HR-5 (audit-before-read), PDPA (auditDrilldown)
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

vi.mock('@/src/audit/log', () => ({
  auditDrilldown: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/src/memory/conversation', () => ({
  loadRecent: vi.fn().mockResolvedValue([
    { id: 'msg-001', data: { role: 'user', content: 'Hello', redacted: false } },
    { id: 'msg-002', data: { role: 'assistant', content: 'Hi there', redacted: false } },
  ]),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import will FAIL until the action module is created (Wave 0 red-bar intent):
// The module under test: app/[lang]/(admin)/conversations/actions.ts
import { getConversationForReview } from './actions'

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('ADMIN-02 getConversationForReview — admin-only + audit-before-read (HR-5)', () => {
  // Wave 0: the import above fails ("Cannot find module './actions'") —
  // the intended red bar for this Wave-0 stub.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns {ok:false, error:"Forbidden"} for a non-admin role', async () => {
    // ADMIN-02: conversation viewer is admin-only (not coach + admin).
    // A senior-coach must be Forbidden.

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid',
      role: 'senior-coach',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await getConversationForReview('conv-test-001')

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
  })

  it('calls auditDrilldown BEFORE returning message data (HR-5 audit-before-read)', async () => {
    // HR-5 critical assertion: the drilldown must be audited BEFORE the data is returned.
    // Order: 1. auth check, 2. auditDrilldown(), 3. loadRecent(), 4. return messages.
    //
    // "PDPA: audit the drill-down BEFORE returning any conversation data."
    // (PATTERNS.md §conversations/actions.ts, citing dashboard/actions.ts:258)

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const { auditDrilldown } = await import('@/src/audit/log')
    const { loadRecent } = await import('@/src/memory/conversation')

    // Track call order
    const callOrder: string[] = []
    vi.mocked(auditDrilldown).mockImplementationOnce(async () => { callOrder.push('auditDrilldown'); return undefined })
    vi.mocked(loadRecent).mockImplementationOnce(async () => { callOrder.push('loadRecent'); return [] })

    await getConversationForReview('conv-test-001')

    // auditDrilldown MUST be called before loadRecent
    expect(auditDrilldown).toHaveBeenCalledOnce()
    expect(callOrder.indexOf('auditDrilldown')).toBeLessThan(callOrder.indexOf('loadRecent'))
  })

  it('returns conversation messages on success (admin role)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await getConversationForReview('conv-test-001')

    expect(result.ok).toBe(true)
    expect(Array.isArray((result as { ok: true; messages: unknown[] }).messages)).toBe(true)
  })

  it('is READ-ONLY: no resolve/edit/delete function is exported', async () => {
    // HR-5: the conversation viewer is read-only. The action module must NOT export
    // any mutation function (no deleteMessage, no editMessage, no resolveConversation).
    //
    // Wave 1+ assertion: check the module's exports don't include mutation functions.
    // Wave 0: this test is unreachable — module import fails first.

    const mod = await import('./actions')
    expect(mod).not.toHaveProperty('deleteMessage')
    expect(mod).not.toHaveProperty('editMessage')
    expect(mod).not.toHaveProperty('resolveConversation')
    expect(mod).not.toHaveProperty('deleteConversation')
  })
})
