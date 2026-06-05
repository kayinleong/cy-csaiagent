/**
 * src/reply/reply-edit-actions.test.ts — captureReplyEdit RED tests (Wave 0).
 *
 * THE ADMIN-06 PRODUCER TEST. Plan 04-07 adds the Server Action
 *   captureReplyEdit({ leadId, draftId, sopDocIds, originalDraft, editedFinal, lang, thumbsDown? })
 * which writes ONE replyEdits row via the Admin SDK (clients can't write — rules deny).
 * The Plan-10 thumbs-down-rate KPI aggregates `count(thumbsDown==true) / count(all)`,
 * so a `thumbsDown:true` write MUST have a guaranteed producer. Without this RED test
 * the KPI is structurally un-deliverable (threat T-04-03).
 *
 * STATUS: RED — `@/app/[lang]/chat/reply-edit-actions` does not exist until Plan 04-07.
 * Tests dynamically import the action inside `it.fails` blocks so the module-not-found
 * failure keeps the offline suite GREEN (exit 0) while documenting the contract. When
 * 04-07 lands the action, the imports resolve, the mocked `replyEditsRef().add(...)`
 * assertions pass, and `it.fails` flips — the implementer then removes `.fails` and
 * wires the real session/auth + Admin-SDK mocks (mirror (admin)/kb/actions.ts).
 *
 * Offline only — a unit-level mock of the ref is sufficient for the RED→GREEN cycle
 * (no Firestore emulator). The replyEdits SECURITY RULES are proven separately in
 * src/firebase/__tests__/rules.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'

describe('captureReplyEdit (REPLY-09 / ADMIN-06 producer) — RED until Plan 04-07', () => {
  // (a) the denominator row: every Copy writes ONE replyEdits row (editRatio:0 when unchanged)
  it.fails('writes ONE replyEdits row with editRatio:0 on an unchanged copy (denominator)', async () => {
    const mockAdd = vi.fn(async (_doc: Record<string, unknown>) => ({ id: 'reply-edit-001' }))
    vi.doMock('@/src/firebase/collections', () => ({
      replyEditsRef: vi.fn(() => ({ add: mockAdd })),
      TENANT_ID: 'd2',
    }))

    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { captureReplyEdit } = await import('@/app/[lang]/chat/reply-edit-actions')
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
  it.fails('a thumbsDown:true call writes a replyEdits row with thumbsDown === true (ADMIN-06 producer)', async () => {
    const mockAdd = vi.fn(async (_doc: Record<string, unknown>) => ({ id: 'reply-edit-002' }))
    vi.doMock('@/src/firebase/collections', () => ({
      replyEditsRef: vi.fn(() => ({ add: mockAdd })),
      TENANT_ID: 'd2',
    }))

    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { captureReplyEdit } = await import('@/app/[lang]/chat/reply-edit-actions')
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
  it.fails('an omitted thumbsDown does NOT write a thumbsDown:false field (stays absent)', async () => {
    const mockAdd = vi.fn(async (_doc: Record<string, unknown>) => ({ id: 'reply-edit-003' }))
    vi.doMock('@/src/firebase/collections', () => ({
      replyEditsRef: vi.fn(() => ({ add: mockAdd })),
      TENANT_ID: 'd2',
    }))

    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { captureReplyEdit } = await import('@/app/[lang]/chat/reply-edit-actions')
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
})
