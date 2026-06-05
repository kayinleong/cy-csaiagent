/**
 * src/reply/reply-edit-actions.test.ts — captureReplyEdit tests (GREEN since Plan 04-07).
 *
 * THE ADMIN-06 PRODUCER TEST. Plan 04-07 added the Server Action
 *   captureReplyEdit({ leadId, draftId, sopDocIds, originalDraft, editedFinal, lang, thumbsDown? })
 * which writes ONE replyEdits row via the Admin SDK (clients can't write — rules deny).
 * The Plan-10 thumbs-down-rate KPI aggregates `count(thumbsDown==true) / count(all)`,
 * so a `thumbsDown:true` write MUST have a guaranteed producer (threat T-04-03).
 *
 * GREEN as of Plan 04-07: `@/app/[lang]/chat/reply-edit-actions` now exists. The
 * prior RED `it.fails` / `@ts-expect-error` guards have been removed and the auth +
 * Admin-SDK collaborators are mocked (mirror the (admin)/kb/actions.ts session pattern):
 *   - `next/headers` cookies() returns a synthetic __session cookie;
 *   - `@/src/firebase/auth` requireUser() returns a fixed agent user;
 *   - `@/src/firebase/collections` replyEditsRef().add and agentProfilesRef().doc().get()
 *     are mocked so the action's write + seniorCoachId denormalization run in isolation.
 *
 * Offline only — a unit-level mock is sufficient (no Firestore emulator). The
 * replyEdits SECURITY RULES are proven separately in src/firebase/__tests__/rules.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
// Spies declared via vi.hoisted so the mock factories (also hoisted) can close
// over them while still being reset per test.
const { mockAdd, mockGet } = vi.hoisted(() => ({
  mockAdd: vi.fn(async (_doc: Record<string, unknown>) => ({ id: 'reply-edit-001' })),
  mockGet: vi.fn(async () => ({ data: () => ({ seniorCoachId: 'coach-123' }) })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (_name: string) => ({ value: 'synthetic-session-token' }),
  })),
}))

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(async () => ({ uid: 'agent-001', role: 'new-agent', tenantId: 'd2' })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}))

vi.mock('@/src/firebase/collections', () => ({
  replyEditsRef: vi.fn(() => ({ add: mockAdd })),
  agentProfilesRef: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockGet })) })),
  TENANT_ID: 'd2',
}))

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => '__server_timestamp__') },
}))

import { captureReplyEdit } from '@/app/[lang]/chat/reply-edit-actions'

describe('captureReplyEdit (REPLY-09 / ADMIN-06 producer) — GREEN since Plan 04-07', () => {
  beforeEach(() => {
    mockAdd.mockClear()
    mockGet.mockClear()
  })

  // (a) the denominator row: every Copy writes ONE replyEdits row (editRatio:0 when unchanged)
  it('writes ONE replyEdits row with editRatio:0 on an unchanged copy (denominator)', async () => {
    const result = await captureReplyEdit({
      leadId: 'lead-001',
      draftId: 'draft-001',
      sopDocIds: ['s1'],
      originalDraft: 'x',
      editedFinal: 'x',
      lang: 'en',
    })

    expect(result.ok).toBe(true)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const written = mockAdd.mock.calls[0][0] as Record<string, unknown>
    expect(written.editRatio).toBe(0)
  })

  // (b) THE thumbs-down producer: a thumbsDown:true call writes a row with thumbsDown === true
  it('a thumbsDown:true call writes a replyEdits row with thumbsDown === true (ADMIN-06 producer)', async () => {
    await captureReplyEdit({
      leadId: 'lead-001',
      draftId: 'draft-002',
      sopDocIds: ['s1'],
      originalDraft: 'original draft text',
      editedFinal: 'original draft text',
      lang: 'en',
      thumbsDown: true,
    })

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const written = mockAdd.mock.calls[0][0] as Record<string, unknown>
    // The object passed to .add(...) MUST carry thumbsDown: true — the KPI producer.
    expect(written).toMatchObject({ thumbsDown: true })
  })

  // (c) an omitted thumbsDown does NOT write thumbsDown:false (stays absent / optional)
  it('an omitted thumbsDown does NOT write a thumbsDown:false field (stays absent)', async () => {
    await captureReplyEdit({
      leadId: 'lead-001',
      draftId: 'draft-003',
      sopDocIds: ['s1'],
      originalDraft: 'a',
      editedFinal: 'a substantially edited final reply',
      lang: 'en',
    })

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const written = mockAdd.mock.calls[0][0] as Record<string, unknown>
    // Optional field stays absent — not written as false.
    expect(written.thumbsDown).toBeUndefined()
  })

  // (d) seniorCoachId is DENORMALIZED from agentProfiles onto the row (Pitfall D)
  it('denormalizes seniorCoachId from agentProfiles onto the row (coach downline read)', async () => {
    await captureReplyEdit({
      leadId: 'lead-001',
      draftId: 'draft-004',
      sopDocIds: ['s1'],
      originalDraft: 'hello',
      editedFinal: 'hello there',
      lang: 'en',
    })

    expect(mockGet).toHaveBeenCalledTimes(1)
    const written = mockAdd.mock.calls[0][0] as Record<string, unknown>
    expect(written.seniorCoachId).toBe('coach-123')
    // agentUid comes from the verified token, never the args (T-02-31).
    expect(written.agentUid).toBe('agent-001')
  })
})
