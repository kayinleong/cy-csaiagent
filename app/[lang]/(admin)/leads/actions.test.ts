/**
 * app/[lang]/(admin)/leads/actions.test.ts — lead-registry contract
 * (quick-kayinleong-046).
 *
 * Pins the four invariants that make this surface safe and make Reply reachable:
 *   1. ADMIN-ONLY (Layer 3): role is read from the VERIFIED token, never from args
 *      (T-02-31). senior-coach / new-agent / read-only → {ok:false,error:'Forbidden'};
 *      a missing session cookie → 'Unauthorized'. No write is attempted.
 *   2. TWO-DOC INVARIANT: createLead writes BOTH `leads/{id}` and `leadContext/{id}`
 *      in ONE atomic batch, under the SAME id, with all three agent slots seeded as
 *      `{}`. Omitting the context doc reproduces the unhandled NOT_FOUND thrown by
 *      writeLeadSlot's `.update()` inside the un-try/caught Reply `onFinish`
 *      (app/api/chat/route.ts:578-586). deleteLead removes both.
 *   3. BLANK ownerUid REJECTED: PDPA erasure sweeps by ownerUid, so an owner-less
 *      lead would be un-erasable orphan PII.
 *   4. RAW PHONE NEVER PERSISTED: only a 12-hex sha256 `phoneHash` reaches Firestore;
 *      the raw digits appear in NO batch payload and in NO audit row.
 *
 * Logic-only unit test — every dependency is mocked, no emulator, no network.
 * Mirrors coach-assignment/actions.test.ts (including the vi.hoisted() dance that
 * keeps the mock refs out of their TDZ when vi.mock factories are hoisted).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/audit', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
}))

const {
  GENERATED_LEAD_ID,
  mockBatchSet,
  mockBatchDelete,
  mockBatchCommit,
  mockBatch,
  mockLeadDocRef,
  mockLeadContextDocRef,
  mockLeadUpdate,
  mockOwnerGet,
  mockLeadsLimitGet,
  mockCookieGet,
} = vi.hoisted(() => {
  // Declared INSIDE the hoisted block: a plain module-scope `const` would still be
  // in its TDZ when this factory runs (vi.hoisted is lifted above it).
  const GENERATED_LEAD_ID = 'lead-generated-id'
  const mockBatchSet = vi.fn().mockReturnThis()
  const mockBatchDelete = vi.fn().mockReturnThis()
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined)
  const mockBatch = vi.fn(() => ({
    set: mockBatchSet,
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  }))
  const mockLeadUpdate = vi.fn().mockResolvedValue(undefined)
  const mockLeadDocRef = { __ref: 'leads/doc', id: GENERATED_LEAD_ID, update: mockLeadUpdate }
  const mockLeadContextDocRef = { __ref: 'leadContext/doc', id: GENERATED_LEAD_ID }
  // The owner-existence check (no dangling / un-erasable owner pointer).
  const mockOwnerGet = vi.fn().mockResolvedValue({ exists: true })
  const mockLeadsLimitGet = vi.fn().mockResolvedValue({ docs: [] })
  const mockCookieGet = vi.fn().mockReturnValue({ value: 'mock-session-token' })
  return {
    GENERATED_LEAD_ID,
    mockBatchSet,
    mockBatchDelete,
    mockBatchCommit,
    mockBatch,
    mockLeadDocRef,
    mockLeadContextDocRef,
    mockLeadUpdate,
    mockOwnerGet,
    mockLeadsLimitGet,
    mockCookieGet,
  }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { batch: mockBatch },
}))

vi.mock('@/src/firebase/collections', () => ({
  TENANT_ID: 'd2',
  leadsRef: vi.fn(() => ({
    doc: vi.fn(() => mockLeadDocRef),
    limit: vi.fn(() => ({ get: mockLeadsLimitGet })),
  })),
  leadContextRef: vi.fn(() => ({ doc: vi.fn(() => mockLeadContextDocRef) })),
  usersRef: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockOwnerGet })) })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookieGet }),
}))

import { createLead, updateLead, deleteLead, listLeads, type LeadInput } from './actions'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RAW_PHONE = '012-345 6789'
/** Same convention as src/audit/pdpa.ts hashValue: sha256, first 12 hex chars. */
const EXPECTED_HASH = createHash('sha256').update('0123456789').digest('hex').slice(0, 12)

const VALID_INPUT: LeadInput = {
  label: '<LEAD_ID:ab12cd34ef56>',
  ownerUid: 'agent-uid-1',
  phone: RAW_PHONE,
  consentFlag: true,
  nationality: 'MY',
  segment: 'first-time-buyer',
}

async function asRole(role: AuthenticatedUser['role'], uid = 'caller-uid') {
  const { requireUser } = await import('@/src/firebase/auth')
  vi.mocked(requireUser).mockResolvedValueOnce({ uid, role, tenantId: 'd2' } as AuthenticatedUser)
}

/** Every value handed to batch.set(), flattened for "the raw phone is nowhere" scans. */
function allSetPayloads(): unknown[] {
  return mockBatchSet.mock.calls.map((call) => call[1])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBatchCommit.mockResolvedValue(undefined)
  mockLeadUpdate.mockResolvedValue(undefined)
  mockOwnerGet.mockResolvedValue({ exists: true })
  mockLeadsLimitGet.mockResolvedValue({ docs: [] })
  mockCookieGet.mockReturnValue({ value: 'mock-session-token' })
})

// ─── 1. Admin-role re-check (Layer 3) ─────────────────────────────────────────

describe('leads actions — admin-only gate from the VERIFIED token (T-02-31 / D-24)', () => {
  const nonAdminRoles: AuthenticatedUser['role'][] = ['senior-coach', 'new-agent', 'read-only']

  for (const role of nonAdminRoles) {
    it(`createLead returns Forbidden for a ${role} caller and writes nothing`, async () => {
      await asRole(role)
      const result = await createLead(VALID_INPUT)
      expect(result).toEqual({ ok: false, error: 'Forbidden' })
      expect(mockBatchSet).not.toHaveBeenCalled()
      expect(mockBatchCommit).not.toHaveBeenCalled()
    })

    it(`updateLead returns Forbidden for a ${role} caller and writes nothing`, async () => {
      await asRole(role)
      const result = await updateLead('lead-1', VALID_INPUT)
      expect(result).toEqual({ ok: false, error: 'Forbidden' })
      expect(mockLeadUpdate).not.toHaveBeenCalled()
    })

    it(`deleteLead returns Forbidden for a ${role} caller and deletes nothing`, async () => {
      await asRole(role)
      const result = await deleteLead('lead-1')
      expect(result).toEqual({ ok: false, error: 'Forbidden' })
      expect(mockBatchDelete).not.toHaveBeenCalled()
      expect(mockBatchCommit).not.toHaveBeenCalled()
    })

    it(`listLeads returns Forbidden for a ${role} caller`, async () => {
      await asRole(role)
      const result = await listLeads()
      expect(result).toEqual({ ok: false, error: 'Forbidden' })
      expect(mockLeadsLimitGet).not.toHaveBeenCalled()
    })
  }

  it('createLead returns Unauthorized when there is no __session cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const result = await createLead(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('createLead returns Unauthorized when token verification rejects', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('token expired'))
    const result = await createLead(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})

// ─── 2. Two-doc invariant ─────────────────────────────────────────────────────

describe('createLead — writes BOTH leads/{id} and leadContext/{id} atomically', () => {
  it('batches exactly two sets (lead + leadContext) under ONE commit', async () => {
    await asRole('admin', 'admin-uid')
    const result = await createLead(VALID_INPUT)

    expect(result).toEqual({ ok: true, id: GENERATED_LEAD_ID })
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)

    // The lead doc.
    expect(mockBatchSet).toHaveBeenCalledWith(
      mockLeadDocRef,
      expect.objectContaining({
        tenantId: 'd2',
        ownerUid: 'agent-uid-1',
        name: '<LEAD_ID:ab12cd34ef56>',
        consentFlag: true,
        nationality: 'MY',
        segment: 'first-time-buyer',
      }),
    )
    // The paired context doc — SAME id (the mock doc ref is keyed on it).
    expect(mockLeadContextDocRef.id).toBe(mockLeadDocRef.id)
  })

  it('seeds ALL THREE agent slots as {} plus an empty rollingSummary', async () => {
    await asRole('admin', 'admin-uid')
    await createLead(VALID_INPUT)

    // readFinderSlot/readReplySlot treat {} as "never written" (leadContext.ts:149,184)
    // and the leadContext read rule predicates on coachSlot != null (rules:167).
    expect(mockBatchSet).toHaveBeenCalledWith(
      mockLeadContextDocRef,
      expect.objectContaining({
        tenantId: 'd2',
        coachSlot: {},
        finderSlot: {},
        replySlot: {},
        rollingSummary: '',
      }),
    )
  })

  it('does NOT commit a lead doc without its context doc when the batch fails', async () => {
    await asRole('admin', 'admin-uid')
    mockBatchCommit.mockRejectedValueOnce(new Error('commit blew up'))
    const result = await createLead(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'commit blew up' })
  })

  it("writes an action:'lead-create' audit row on success", async () => {
    await asRole('admin', 'admin-uid')
    const audit = await import('@/src/audit')
    await createLead(VALID_INPUT)

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin-uid',
        action: 'lead-create',
        targetRef: `leads/${GENERATED_LEAD_ID}`,
      }),
    )
  })
})

describe('deleteLead — removes BOTH docs atomically', () => {
  it('batches a delete on the lead AND the leadContext, then commits once', async () => {
    await asRole('admin', 'admin-uid')
    const result = await deleteLead('lead-1')

    expect(result).toEqual({ ok: true, id: 'lead-1' })
    expect(mockBatchDelete).toHaveBeenCalledTimes(2)
    expect(mockBatchDelete).toHaveBeenCalledWith(mockLeadDocRef)
    expect(mockBatchDelete).toHaveBeenCalledWith(mockLeadContextDocRef)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })
})

// ─── 3. Blank ownerUid rejection (PDPA — un-erasable orphan PII) ──────────────

describe('ownerUid is mandatory — an owner-less lead would be un-erasable PII', () => {
  it('createLead rejects a blank ownerUid before any write', async () => {
    await asRole('admin', 'admin-uid')
    const result = await createLead({ ...VALID_INPUT, ownerUid: '' })
    expect(result).toEqual({ ok: false, error: 'Missing owner' })
    expect(mockBatchSet).not.toHaveBeenCalled()
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('createLead rejects a whitespace-only ownerUid before any write', async () => {
    await asRole('admin', 'admin-uid')
    const result = await createLead({ ...VALID_INPUT, ownerUid: '   ' })
    expect(result).toEqual({ ok: false, error: 'Missing owner' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('updateLead rejects a blank ownerUid before any write', async () => {
    await asRole('admin', 'admin-uid')
    const result = await updateLead('lead-1', { ...VALID_INPUT, ownerUid: '' })
    expect(result).toEqual({ ok: false, error: 'Missing owner' })
    expect(mockLeadUpdate).not.toHaveBeenCalled()
  })

  it('createLead rejects an ownerUid with no users/{uid} doc (no dangling owner)', async () => {
    await asRole('admin', 'admin-uid')
    mockOwnerGet.mockResolvedValueOnce({ exists: false })
    const result = await createLead(VALID_INPUT)
    expect(result).toEqual({ ok: false, error: 'Owner not found' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('createLead rejects a label shorter than 3 chars (over-redaction needle guard)', async () => {
    await asRole('admin', 'admin-uid')
    const result = await createLead({ ...VALID_INPUT, label: 'ab' })
    expect(result).toEqual({ ok: false, error: 'Label too short' })
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})

// ─── 4. The raw phone never reaches Firestore ─────────────────────────────────

describe('PDPA — the raw phone is hashed in the action and never persisted', () => {
  it('stores a 12-hex sha256 phoneHash, and no `phone` field exists on the doc', async () => {
    await asRole('admin', 'admin-uid')
    await createLead(VALID_INPUT)

    const leadPayload = mockBatchSet.mock.calls.find((c) => c[0] === mockLeadDocRef)?.[1] as
      Record<string, unknown>

    expect(leadPayload.phoneHash).toBe(EXPECTED_HASH)
    expect(leadPayload.phoneHash).toMatch(/^[0-9a-f]{12}$/)
    expect(leadPayload).not.toHaveProperty('phone')
  })

  it('the raw phone digits appear in NO Firestore payload', async () => {
    await asRole('admin', 'admin-uid')
    await createLead(VALID_INPUT)

    const serialized = JSON.stringify(allSetPayloads())
    expect(serialized).not.toContain(RAW_PHONE)
    expect(serialized).not.toContain('0123456789')
    expect(serialized).toContain(EXPECTED_HASH)
  })

  it('the raw phone appears in NO audit row', async () => {
    await asRole('admin', 'admin-uid')
    const audit = await import('@/src/audit')
    await createLead(VALID_INPUT)

    const serialized = JSON.stringify(vi.mocked(audit.log).mock.calls)
    expect(serialized).not.toContain(RAW_PHONE)
    expect(serialized).not.toContain('0123456789')
  })

  it('normalizes phone formatting so the same number always hashes identically', async () => {
    await asRole('admin', 'admin-uid')
    await createLead({ ...VALID_INPUT, phone: '(012) 345.6789' })

    const leadPayload = mockBatchSet.mock.calls.find((c) => c[0] === mockLeadDocRef)?.[1] as
      Record<string, unknown>
    expect(leadPayload.phoneHash).toBe(EXPECTED_HASH)
  })

  it('stores an empty phoneHash when no phone is supplied (lead known before number)', async () => {
    await asRole('admin', 'admin-uid')
    await createLead({ ...VALID_INPUT, phone: '' })

    const leadPayload = mockBatchSet.mock.calls.find((c) => c[0] === mockLeadDocRef)?.[1] as
      Record<string, unknown>
    expect(leadPayload.phoneHash).toBe('')
  })

  it('updateLead with a blank phone leaves the stored phoneHash untouched', async () => {
    await asRole('admin', 'admin-uid')
    await updateLead('lead-1', { ...VALID_INPUT, phone: '' })

    expect(mockLeadUpdate).toHaveBeenCalledTimes(1)
    const payload = mockLeadUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('phoneHash')
    expect(payload).toMatchObject({ ownerUid: 'agent-uid-1', name: VALID_INPUT.label })
  })

  it('updateLead with a phone re-hashes it and never stores the raw value', async () => {
    await asRole('admin', 'admin-uid')
    await updateLead('lead-1', VALID_INPUT)

    const payload = mockLeadUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload.phoneHash).toBe(EXPECTED_HASH)
    expect(JSON.stringify(payload)).not.toContain('0123456789')
  })
})

// ─── listLeads projection ─────────────────────────────────────────────────────

describe('listLeads — bounded read, hash projected down to a boolean', () => {
  it('never sends phoneHash to the client; exposes only hasPhone', async () => {
    await asRole('admin', 'admin-uid')
    mockLeadsLimitGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'lead-1',
          data: () => ({
            tenantId: 'd2',
            ownerUid: 'agent-uid-1',
            name: '<LEAD_ID:001>',
            phoneHash: 'abc123def456',
            consentFlag: true,
            nationality: 'MY',
            segment: 'investor',
          }),
        },
      ],
    })

    const result = await listLeads()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.leads).toEqual([
      {
        id: 'lead-1',
        label: '<LEAD_ID:001>',
        ownerUid: 'agent-uid-1',
        hasPhone: true,
        consentFlag: true,
        nationality: 'MY',
        segment: 'investor',
      },
    ])
    expect(JSON.stringify(result.leads)).not.toContain('abc123def456')
  })
})
