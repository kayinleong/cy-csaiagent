/**
 * src/firebase/auth.test.ts
 *
 * Unit tests for the server-side auth gate (requireUser) and claim-setting
 * helper (setUserClaims). These tests use a mocked adminAuth so they run
 * offline without live Firebase credentials.
 *
 * Behaviors under test:
 *   1. requireUser — valid token returns { uid, role, tenantId } from claims.
 *   2. requireUser — missing/invalid token throws (fails closed, 401-equivalent).
 *   3. setUserClaims — calls setCustomUserClaims with { role, tenantId:'d2' }
 *                     and rejects an unknown role string.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock firebase-admin/auth BEFORE importing auth.ts ───────────────────────
// vi.hoisted() ensures mock variables are available when vi.mock() factories run.
const { mockVerifyIdToken, mockSetCustomUserClaims, mockDocSet } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockSetCustomUserClaims: vi.fn(),
  mockDocSet: vi.fn(),
}))

// Build a chainable mock: adminDb.collection('x').withConverter(c).doc('id').set(data)
// collections.ts calls withConverter() on the collection ref, then .doc().set()
const mockDocRef = {
  set: () => mockDocSet(),
  update: vi.fn(),
}
const mockCollectionRef = {
  doc: () => mockDocRef,
  withConverter: () => ({
    doc: () => mockDocRef,
    withConverter: () => ({ doc: () => mockDocRef }),
  }),
}

vi.mock('@/src/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: mockVerifyIdToken,
    setCustomUserClaims: mockSetCustomUserClaims,
  },
  adminDb: {
    collection: () => mockCollectionRef,
  },
}))

// Import AFTER mocks are registered
import { requireUser, setUserClaims, UnauthorizedError } from '@/src/firebase/auth'

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeRequest(authHeader?: string): Request {
  const headers: HeadersInit = {}
  if (authHeader) {
    headers['Authorization'] = authHeader
  }
  return new Request('https://example.com/api/test', { headers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Behavior 1: returns { uid, role, tenantId } from verified token claims (NOT from request body)', async () => {
    // Arrange — mock a valid verifyIdToken result carrying custom claims
    const decodedToken = {
      uid: 'test-uid-new-agent-001',
      role: 'new-agent' as const,
      tenantId: 'd2',
    }
    mockVerifyIdToken.mockResolvedValueOnce(decodedToken)

    const req = makeRequest('Bearer valid-id-token-string')

    // Act
    const result = await requireUser(req)

    // Assert — role/tenantId come from verifyIdToken output, not the request body
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-id-token-string')
    expect(result).toEqual({
      uid: 'test-uid-new-agent-001',
      role: 'new-agent',
      tenantId: 'd2',
    })
  })

  it('Behavior 2a: throws UnauthorizedError when Authorization header is missing', async () => {
    // Arrange — request with no Authorization header
    const req = makeRequest()

    // Act + Assert — gate fails closed
    await expect(requireUser(req)).rejects.toThrow(UnauthorizedError)
    // verifyIdToken should not be called if no token is present
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('Behavior 2b: throws UnauthorizedError when token is invalid / verifyIdToken rejects', async () => {
    // Arrange — adminAuth rejects (expired, forged, revoked token)
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Firebase: invalid token'))

    const req = makeRequest('Bearer invalid-or-expired-token')

    // Act + Assert — gate fails closed on any verify error
    await expect(requireUser(req)).rejects.toThrow(UnauthorizedError)
  })
})

describe('setUserClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetCustomUserClaims.mockResolvedValue(undefined)
    mockDocSet.mockResolvedValue(undefined)
  })

  it('Behavior 3a: calls setCustomUserClaims with { role, tenantId:"d2" } for all valid roles', async () => {
    const validRoles = ['new-agent', 'senior-coach', 'admin'] as const

    for (const role of validRoles) {
      vi.clearAllMocks()
      mockSetCustomUserClaims.mockResolvedValue(undefined)
      mockDocSet.mockResolvedValue(undefined)

      await setUserClaims('<UID_PLACEHOLDER>', role)

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('<UID_PLACEHOLDER>', {
        role,
        tenantId: 'd2',
      })
    }
  })

  it('Behavior 3b: rejects an unknown role string (type-narrowed at runtime)', async () => {
    // Cast to bypass TS type check — simulates a runtime call with a bad value
    await expect(
      setUserClaims('<UID_PLACEHOLDER>', 'superadmin' as 'admin')
    ).rejects.toThrow(/invalid role/i)

    // setCustomUserClaims must NOT be called with a bad role
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled()
  })

  // ─── Phase 6 (RO-01): 4th role tier — read-only stakeholder ──────────────────
  // GREEN as of Wave 1 (06-02): 'read-only' is now in the Role union / VALID_ROLES
  // (src/firebase/auth.ts:36,46), so setUserClaims accepts it directly — no cast.

  it("Behavior 3c (RO-01): setUserClaims(uid, 'read-only') resolves once the role is valid", async () => {
    await setUserClaims('<UID_PLACEHOLDER>', 'read-only')

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('<UID_PLACEHOLDER>', {
      role: 'read-only',
      tenantId: 'd2',
    })
  })

  it("Behavior 3c-guard (RO-01): setUserClaims(uid, 'read-only') does NOT upsert an agentProfiles doc", async () => {
    // The agentProfiles upsert (src/firebase/auth.ts:172) is new-agent-only.
    // read-only must get a users/{uid} doc but NO agent profile (by design).
    // Both writes route through the same mocked doc().set() (mockDocSet), so we
    // assert exactly ONE write happens for read-only vs TWO for new-agent.
    vi.clearAllMocks()
    mockSetCustomUserClaims.mockResolvedValue(undefined)
    mockDocSet.mockResolvedValue(undefined)

    await setUserClaims('<UID_PLACEHOLDER>', 'read-only')
    const readOnlyWrites = mockDocSet.mock.calls.length

    vi.clearAllMocks()
    mockSetCustomUserClaims.mockResolvedValue(undefined)
    mockDocSet.mockResolvedValue(undefined)

    await setUserClaims('<UID_PLACEHOLDER>', 'new-agent')
    const newAgentWrites = mockDocSet.mock.calls.length

    expect(readOnlyWrites).toBe(1) // users/{uid} only — no agentProfiles
    expect(newAgentWrites).toBe(2) // users/{uid} + agentProfiles/{uid}
  })

  it('Behavior 3d (RO-01 guard): an unknown role STILL throws InvalidRoleError after adding read-only', async () => {
    // Adding 'read-only' must NOT widen the validator to accept arbitrary roles.
    await expect(
      setUserClaims('<UID_PLACEHOLDER>', 'bogus-role' as 'admin')
    ).rejects.toThrow(/invalid role/i)

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled()
  })
})
